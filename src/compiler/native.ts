// SidAli native build pipeline: AST -> LLVM IR -> clang -> native object / executable.
// Node-only (child_process). Used by the sidac CLI; the browser playground keeps using the VM.

import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as A from './parser';
import { parse } from './parser';
import { emitLlvm, TARGETS, TargetProfile, SUBSTRATES } from './llvm';
import { buildDnaHeader, formatDnaHeader, withDnaHeader, readDnaHeader, verifyDna, DNA_END } from './dna';
import { blake3Bytes, hex } from '../std/blake3';
import { halRuntimeC } from '../hal/hal';

export { TARGETS, SUBSTRATES };
export type { TargetProfile, Substrate } from './llvm';
export { withDnaHeader, readDnaHeader, readDnaTrailer, findDna, stripDna, verifyDna, buildDnaHeader, formatDnaHeader, DNA_START, DNA_END } from './dna';
export type { DnaHeader } from './dna';
export { HAL_SPECS, halSpec, halRuntimeC, halAddressMap } from '../hal/hal';
export type { HalSpec, HalDevice } from '../hal/hal';

/** Fat-binary components: one SidAli source, many substrates in one file. */
export const FAT_SUBSTRATES = [
  'x86_64-linux',
  'aarch64-linux',
  'riscv64-none-elf',
  'wasm32',
  'photon-riscv',
  'qubit-riscv',
  'fluidic-riscv',
  'vacuum-riscv',
  'holographic-wasm',
  'plasma-arm',
  'energy-riscv',
] as const;

export interface BuildOptions {
  target?: string;
  outDir?: string;
  outName?: string;
  optLevel?: number;
  emit?: 'exe' | 'obj' | 'ir' | 'asm' | 'wasm' | 'fat';
  entry?: string;
  keepTemps?: boolean;
  /** Skip the DNA header (raw machine code only). */
  noDna?: boolean;
}

export interface BuildResult {
  ok: boolean;
  artifact?: string;
  ir?: string;
  target: TargetProfile;
  stdout: string;
  stderr: string;
  stages: Array<{ name: string; ok: boolean; detail: string }>;
}

function which(cmd: string): string | null {
  const r = spawnSync('bash', ['-lc', `command -v ${cmd}`], { encoding: 'utf8' });
  const p = (r.stdout || '').trim();
  return p || null;
}

export function clangPath(): string {
  for (const c of ['clang-19', 'clang', 'clang-18', 'clang-17']) {
    const p = which(c);
    if (p) return p;
  }
  return 'clang';
}

export function buildNative(source: string, opts: BuildOptions = {}): BuildResult {
  const targetName = opts.target || 'x86_64-linux';
  const target = TARGETS[targetName];
  const stages: Array<{ name: string; ok: boolean; detail: string }> = [];
  const outDir = opts.outDir || join(process.cwd(), 'dist-native');
  mkdirSync(outDir, { recursive: true });
  const outName = opts.outName || 'a';

  if (!target) {
    return { ok: false, target: TARGETS['x86_64-linux'], stdout: '', stderr: `unknown target ${targetName}`, stages };
  }

  let program: A.Program;
  try {
    program = parse(source);
    stages.push({ name: 'parse', ok: true, detail: `${program.body.length} top-level items` });
  } catch (e: any) {
    stages.push({ name: 'parse', ok: false, detail: e.message });
    return { ok: false, target, stdout: '', stderr: e.message, stages };
  }

  let ir: string;
  try {
    ir = emitLlvm(program, { target: targetName, optLevel: opts.optLevel ?? 2, entry: opts.entry ?? 'main' }).ir;
    stages.push({ name: 'llvm', ok: true, detail: `${ir.split('\n').length} lines of IR` });
  } catch (e: any) {
    stages.push({ name: 'llvm', ok: false, detail: e.message });
    return { ok: false, target, stdout: '', stderr: e.message, stages };
  }

  const irPath = join(outDir, `${outName}.ll`);
  writeFileSync(irPath, ir);
  if (opts.emit === 'ir') {
    return { ok: true, artifact: irPath, ir, target, stdout: '', stderr: '', stages };
  }

  const clang = clangPath();
  const args: string[] = [irPath, '-o', join(outDir, outName)];
  args.push(`--target=${target.triple}`, `-O${opts.optLevel ?? 2}`);
  if (target.cpu) args.push(`-mcpu=${target.cpu}`);
  if (target.march) args.push(`-march=${target.march}`);
  if (target.features) args.push(`-mattr=${target.features}`);

  if (opts.emit === 'asm') args.push('-S');
  else if (opts.emit === 'obj') args.push('-c');
  else if (target.objectOnly) {
    // Some targets (eBPF) are always object files; the host linker cannot link them.
    args.push('-c');
  } else if (target.freestanding) {
    args.push('-ffreestanding', '-nostdlib', '-fno-stack-protector', '-Wl,-e,_start');
    // The bare-metal HAL provides sid_write / sid_mmio_write / the substrate's
    // device. It is generated per substrate so the same program drives a UART,
    // an optical modulator, a qubit gate, a valve, … without changing the source.
    const halPath = join(outDir, `${outName}.hal.c`);
    writeFileSync(halPath, halRuntimeC(target.substrate || 'electron'));
    args.push(halPath);
  }

  const res = spawnSync(clang, args, { encoding: 'utf8' });
  const ok = res.status === 0 && existsSync(args[args.indexOf('-o') + 1]);
  stages.push({ name: 'clang', ok, detail: ok ? `clang ${args.join(' ')}` : (res.stderr || '').slice(0, 400) });
  if (!ok) return { ok: false, target, stdout: res.stdout || '', stderr: res.stderr || '', stages, ir };

  const artifact = args[args.indexOf('-o') + 1];
  const substrate = target.substrate || 'electron';

  // An ELF/object keeps its magic at byte 0 so the OS loader still runs it, so the
  // DNA header is appended as a trailer (plus a companion `.dna` for tooling).
  // `emit=fat` instead writes one self-describing `.sda` container (see buildFat).
  if (!opts.noDna) {
    const bytes = readFileSync(artifact);
    const header = formatDnaHeader(buildDnaHeader(substrate, target.triple, bytes));
    writeFileSync(artifact, Buffer.concat([bytes, Buffer.from('\n' + header + DNA_END + '\n')]));
    writeFileSync(`${artifact}.dna`, header + DNA_END + '\n');
  }

  return { ok: true, artifact, ir, target, stdout: res.stdout || '', stderr: res.stderr || '', stages };
}

/**
 * Build a fat (universal) SidAli image: one source, every substrate in one `.sda`
 * file. The container is a DNA manifest followed by concatenated payloads; a
 * loader reads the manifest, verifies BLAKE3, and picks the section matching the
 * host (CPUID / QPUID / PhotonicID). Sections that fail to compile are skipped.
 */
export function buildFat(source: string, opts: BuildOptions = {}): BuildResult {
  const stages: Array<{ name: string; ok: boolean; detail: string }> = [];
  const outDir = opts.outDir || join(process.cwd(), 'dist-native');
  mkdirSync(outDir, { recursive: true });
  const outName = opts.outName || 'a';
  const targets = (opts.target ? [opts.target] : [...FAT_SUBSTRATES]) as string[];

  const payloads: Array<{ target: TargetProfile; bytes: Buffer }> = [];
  const tmpDir = join(outDir, `.fat-${outName}`);
  mkdirSync(tmpDir, { recursive: true });
  for (const t of targets) {
    if (!TARGETS[t]) { stages.push({ name: `target:${t}`, ok: false, detail: 'unknown target' }); continue; }
    const r = buildNative(source, { ...opts, target: t, outDir: tmpDir, outName: `part-${t}`, emit: 'obj', noDna: true });
    if (r.ok && r.artifact && existsSync(r.artifact)) {
      payloads.push({ target: TARGETS[t], bytes: readFileSync(r.artifact) });
      stages.push({ name: `target:${t}`, ok: true, detail: `${readFileSync(r.artifact).length} bytes` });
    } else {
      stages.push({ name: `target:${t}`, ok: false, detail: (r.stderr || 'compile failed').slice(0, 120) });
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });

  if (!payloads.length) {
    return { ok: false, target: TARGETS['x86_64-linux'], stdout: '', stderr: 'no substrate compiled', stages };
  }

  const manifest: string[] = [`[SIDALI-FAT:VERSION=1:SECTIONS=${payloads.length}]`];
  let offset = 0;
  for (const p of payloads) {
    const substrate = p.target.substrate || 'electron';
    const blake = hex(blake3Bytes(new Uint8Array(p.bytes)));
    manifest.push(`[SUBSTRATE=${substrate}:ARCH=${p.target.triple}:OFFSET=${offset}:LEN=${p.bytes.length}:BLAKE3=${blake}]`);
    offset += p.bytes.length;
  }
  manifest.push(DNA_END);
  const manifestBytes = new TextEncoder().encode(manifest.join('\n') + '\n');
  const total = manifestBytes.length + offset;
  const out = Buffer.alloc(total);
  out.set(manifestBytes, 0);
  let pos = manifestBytes.length;
  for (const p of payloads) { out.set(p.bytes, pos); pos += p.bytes.length; }

  const artifact = join(outDir, outName.endsWith('.sda') ? outName : `${outName}.sda`);
  writeFileSync(artifact, out);
  stages.push({ name: 'fat', ok: true, detail: `${payloads.length} substrates, ${total} bytes` });
  return { ok: true, artifact, target: TARGETS['x86_64-linux'], stdout: '', stderr: '', stages };
}

export function runNative(binary: string, timeoutMs = 5000): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(binary, [], { encoding: 'utf8', timeout: timeoutMs });
  return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status ?? -1 };
}
