// SidAli native build pipeline: AST -> LLVM IR -> clang -> native object / executable.
// Node-only (child_process). Used by the sidac CLI; the browser playground keeps using the VM.

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import * as A from './parser';
import { parse } from './parser';
import { emitLlvm, TARGETS, TargetProfile } from './llvm';

export { TARGETS };
export type { TargetProfile };

export interface BuildOptions {
  target?: string;
  outDir?: string;
  outName?: string;
  optLevel?: number;
  emit?: 'exe' | 'obj' | 'ir' | 'asm' | 'wasm';
  entry?: string;
  keepTemps?: boolean;
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

// Bare-metal HAL, embedded so freestanding builds link without the source tree.
// sid_u64 is 64-bit on every target to match the i64 in the emitted LLVM IR.
const HAL_RUNTIME_C = `/* SidAli HAL runtime — freestanding primitives the compiler lowers to. */
typedef unsigned long long sid_u64;

#ifndef SID_UART_BASE
#define SID_UART_BASE 0x40011000UL
#endif

static inline void sid_uart_putc(unsigned char c) {
  volatile unsigned int *sr = (volatile unsigned int *)(SID_UART_BASE + 0x00);
  volatile unsigned int *dr = (volatile unsigned int *)(SID_UART_BASE + 0x04);
  while (!((*sr) & (1u << 7))) { }
  *dr = c;
}

void sid_write(const char *s, sid_u64 len) {
  if (!s) return;
  if (len == 0) {
    for (const char *p = s; *p; p++) sid_uart_putc((unsigned char)*p);
  } else {
    for (sid_u64 i = 0; i + 1 < len; i++) sid_uart_putc((unsigned char)s[i]);
  }
}

sid_u64 sid_read(void) { return (sid_u64)-1; }

void sid_mmio_write(sid_u64 addr, sid_u64 val) {
  *(volatile sid_u64 *)addr = val;
}

sid_u64 sid_mmio_read(sid_u64 addr) {
  return *(volatile sid_u64 *)addr;
}
`;

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
    // The bare-metal HAL provides sid_write / sid_mmio_write / UART. It is
    // embedded here so the compiler works from a bundled CLI with no source tree.
    const halPath = join(outDir, `${outName}.hal.c`);
    writeFileSync(halPath, HAL_RUNTIME_C);
    args.push(halPath);
  }

  const res = spawnSync(clang, args, { encoding: 'utf8' });
  const ok = res.status === 0 && existsSync(args[args.indexOf('-o') + 1]);
  stages.push({ name: 'clang', ok, detail: ok ? `clang ${args.join(' ')}` : (res.stderr || '').slice(0, 400) });
  if (!ok) return { ok: false, target, stdout: res.stdout || '', stderr: res.stderr || '', stages, ir };

  return { ok: true, artifact: args[args.indexOf('-o') + 1], ir, target, stdout: res.stdout || '', stderr: res.stderr || '', stages };
}

export function runNative(binary: string, timeoutMs = 5000): { stdout: string; stderr: string; status: number } {
  const res = spawnSync(binary, [], { encoding: 'utf8', timeout: timeoutMs });
  return { stdout: res.stdout || '', stderr: res.stderr || '', status: res.status ?? -1 };
}
