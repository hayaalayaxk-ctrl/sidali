#!/usr/bin/env node
// sidac — the SidAli compiler driver.
//
//   sidac run <file.sidali>              execute on the SidAli VM
//   sidac build <file.sidali> [flags]    compile to a native executable / object
//   sidac build <file.sidali> --emit=fat compile ONE universal .sda for every substrate
//   sidac emit-ir <file.sidali>          print LLVM IR
//   sidac targets                        list supported targets
//   sidac substrates                     list execution substrates
//   sidac dna <file>                     read/verify a DNA header or fat manifest
//   sidac version                        print version
//
// Flags for build: --target=<name> --substrate=<name> --emit=<exe|obj|asm|ir|fat> -O0..3 --out=<name>

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Locate a bundle: SIDALI_ENGINE/SIDALI_NATIVE env vars win (standalone install),
// otherwise look beside the CLI (repo checkout).
function pickBundle(envName, relPaths) {
  if (process.env[envName] && existsSync(process.env[envName])) return process.env[envName];
  for (const rel of relPaths) {
    const u = new URL(rel, import.meta.url);
    if (existsSync(u)) return fileURLToPath(u);
  }
  return null;
}
const enginePath = pickBundle('SIDALI_ENGINE', ['../dist/engine.node.mjs', './engine.node.mjs']);
const nativePath = pickBundle('SIDALI_NATIVE', ['../dist/native.node.mjs', './native.node.mjs']);
if (!enginePath || !nativePath) {
  console.error('sidac: engine bundles not found (run `npm run build` or reinstall)');
  process.exit(1);
}

const { runSource } = await import(pathToFileURL(enginePath).href);
const native = await import(pathToFileURL(nativePath).href);
const { buildNative, buildFat, runNative, TARGETS, SUBSTRATES, findDna, verifyDna } = native;

const VERSION = '1.0.0';
const C = { red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' };

function usage() {
  console.log(`sidac ${VERSION} — SidAli compiler

usage:
  sidac run <file.sidali> [--target=<t>]
  sidac build <file.sidali> [--target=<t>] [--emit=exe|obj|asm|ir|fat] [-O0..3] [--out=<name>]
  sidac emit-ir <file.sidali> [--target=<t>]
  sidac targets
  sidac substrates
  sidac dna <file>
  sidac version

targets:    ${Object.keys(TARGETS).join(', ')}
substrates: ${SUBSTRATES.join(', ')}`);
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--target=')) flags.target = a.slice(9);
    else if (a.startsWith('--substrate=')) flags.substrate = a.slice(12);
    else if (a.startsWith('--emit=')) flags.emit = a.slice(7);
    else if (a.startsWith('--out=')) flags.out = a.slice(6);
    else if (/^-O[0-3]$/.test(a)) flags.opt = Number(a[2]);
    else if (a.startsWith('-')) flags[a] = true;
    else positional.push(a);
  }
  return { flags, positional };
}

// An explicit --target wins; otherwise --substrate maps to the first target with it.
function resolveTarget(flags) {
  if (flags.target) return flags.target;
  if (flags.substrate) {
    const hit = Object.entries(TARGETS).find(([, t]) => (t.substrate || 'electron') === flags.substrate);
    if (!hit) { console.error(`${C.red}error:${C.reset} unknown substrate: ${flags.substrate}`); process.exit(1); }
    return hit[0];
  }
  return 'x86_64-linux';
}

function readSource(file) {
  if (!existsSync(file)) { console.error(`${C.red}error:${C.reset} file not found: ${file}`); process.exit(1); }
  return readFileSync(file, 'utf8');
}

const [, , cmd, ...rest] = process.argv;
const { flags, positional } = parseFlags(rest);
const target = resolveTarget(flags);
const opt = flags.opt ?? 2;

switch (cmd) {
  case 'run': {
    const file = positional[0];
    if (!file) { usage(); process.exit(1); }
    const r = runSource(readSource(file));
    for (const line of r.output) console.log(line);
    if (r.error) { console.error(`${C.red}runtime error:${C.reset} ${r.error}`); process.exit(1); }
    break;
  }
  case 'emit-ir': {
    const file = positional[0];
    if (!file) { usage(); process.exit(1); }
    const r = buildNative(readSource(file), { target, emit: 'ir', optLevel: opt, outDir: '.sidali-build', outName: basename(file, '.sidali') });
    if (!r.ok) { console.error(`${C.red}error:${C.reset} ${r.stderr}`); process.exit(1); }
    process.stdout.write(r.ir);
    break;
  }
  case 'build': {
    const file = positional[0];
    if (!file) { usage(); process.exit(1); }
    const outName = flags.out || basename(file, '.sidali');
    const emit = flags.emit || 'exe';
    const r = emit === 'fat'
      ? buildFat(readSource(file), { optLevel: opt, outDir: '.sidali-build', outName })
      : buildNative(readSource(file), { target, emit, optLevel: opt, outDir: '.sidali-build', outName });
    if (!r.ok) {
      console.error(`${C.red}compile failed${C.reset} (target ${target})`);
      for (const s of r.stages) console.error(`  ${s.ok ? C.green + 'ok' : C.red + 'FAIL'}${C.reset} ${s.name}: ${s.detail}`);
      process.exit(1);
    }
    for (const s of r.stages) console.error(`  ${s.ok ? C.green + 'ok' : C.red + 'FAIL'}${C.reset} ${s.name}: ${C.dim}${s.detail.slice(0, 100)}${C.reset}`);
    console.log(`${C.cyan}artifact:${C.reset} ${r.artifact}`);
    if (r.artifact && existsSync(r.artifact)) {
      const dna = findDna(readFileSync(r.artifact));
      if (dna) console.log(`${C.dim}dna: ${dna.substrate}/${dna.arch} blake3=${dna.blake3.slice(0, 16)}... verified=${verifyDna(readFileSync(r.artifact))}${C.reset}`);
      if (existsSync(`${r.artifact}.dna`)) console.log(`${C.dim}dna: ${readFileSync(`${r.artifact}.dna`, 'utf8').trim()}${C.reset}`);
    }
    if (emit === 'exe' && !TARGETS[target].freestanding) {
      const run = runNative(r.artifact);
      process.stdout.write(run.stdout);
      if (run.stderr) console.error(run.stderr);
    }
    break;
  }
  case 'targets':
    for (const [name, t] of Object.entries(TARGETS)) {
      console.log(`${name.padEnd(20)} ${t.triple.padEnd(28)} ${(t.substrate || 'electron').padEnd(12)} ${t.freestanding ? 'freestanding' : 'hosted'}  ${t.ptrBits}-bit`);
    }
    break;
  case 'substrates':
    for (const s of SUBSTRATES) {
      const ts = Object.keys(TARGETS).filter(k => (TARGETS[k].substrate || 'electron') === s);
      console.log(`${s.padEnd(12)} ${ts.join(', ') || '(none)'}`);
    }
    break;
  case 'dna': {
    const file = positional[0];
    if (!file) { usage(); process.exit(1); }
    const img = readFileSync(file);
    const dna = findDna(img);
    if (dna) {
      console.log(`substrate=${dna.substrate} arch=${dna.arch} version=${dna.version} blake3=${dna.blake3} verified=${verifyDna(img)}`);
    } else {
      const head = img.subarray(0, 1024).toString('utf8');
      if (head.startsWith('[SIDALI-FAT')) {
        for (const line of head.split('\n')) {
          if (line.startsWith('[')) console.log(line);
          if (line.startsWith('[END]')) break;
        }
      } else {
        console.error(`${C.red}error:${C.reset} no DNA header or fat manifest in ${file}`);
        process.exit(1);
      }
    }
    break;
  }
  case 'version': console.log(`sidac ${VERSION} (llvm backend, ${Object.keys(TARGETS).length} targets, ${SUBSTRATES.length} substrates)`); break;
  default: usage(); process.exit(cmd ? 1 : 0);
}
