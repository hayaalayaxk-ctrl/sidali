#!/usr/bin/env node
// sidac — the SidAli compiler driver.
//
//   sidac run <file.sidali>              execute on the SidAli VM
//   sidac build <file.sidali> [flags]    compile to a native executable / object
//   sidac emit-ir <file.sidali>          print LLVM IR
//   sidac targets                        list supported targets
//   sidac version                        print version
//
// Flags for build: --target=<name> --emit=<exe|obj|asm|ir> -O0..3 --out=<name>

import { readFileSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { runSource } from '../dist/engine.node.mjs';
import { buildNative, runNative, TARGETS, clangPath } from '../dist/native.node.mjs';

const VERSION = '1.0.0';
const C = { red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' };

function usage() {
  console.log(`sidac ${VERSION} — SidAli compiler

usage:
  sidac run <file.sidali> [--target=<t>]
  sidac build <file.sidali> [--target=<t>] [--emit=exe|obj|asm|ir] [-O0..3] [--out=<name>]
  sidac emit-ir <file.sidali> [--target=<t>]
  sidac targets
  sidac version

targets: ${Object.keys(TARGETS).join(', ')}
llvm toolchain: ${clangPath()}`);
}

function parseFlags(argv) {
  const flags = {};
  const positional = [];
  for (const a of argv) {
    if (a.startsWith('--target=')) flags.target = a.slice(9);
    else if (a.startsWith('--emit=')) flags.emit = a.slice(7);
    else if (a.startsWith('--out=')) flags.out = a.slice(6);
    else if (/^-O[0-3]$/.test(a)) flags.opt = Number(a[2]);
    else if (a.startsWith('-')) flags[a] = true;
    else positional.push(a);
  }
  return { flags, positional };
}

function readSource(file) {
  if (!existsSync(file)) { console.error(`${C.red}error:${C.reset} file not found: ${file}`); process.exit(1); }
  return readFileSync(file, 'utf8');
}

const [, , cmd, ...rest] = process.argv;
const { flags, positional } = parseFlags(rest);
const target = flags.target || 'x86_64-linux';
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
    const r = buildNative(readSource(file), { target, emit, optLevel: opt, outDir: '.sidali-build', outName });
    if (!r.ok) {
      console.error(`${C.red}compile failed${C.reset} (target ${target})`);
      for (const s of r.stages) console.error(`  ${s.ok ? C.green + 'ok' : C.red + 'FAIL'}${C.reset} ${s.name}: ${s.detail}`);
      process.exit(1);
    }
    for (const s of r.stages) console.error(`  ${C.green}ok${C.reset} ${s.name}: ${C.dim}${s.detail.slice(0, 100)}${C.reset}`);
    console.log(`${C.cyan}artifact:${C.reset} ${r.artifact}`);
    if (emit === 'exe' && !TARGETS[target].freestanding) {
      const run = runNative(r.artifact);
      process.stdout.write(run.stdout);
      if (run.stderr) console.error(run.stderr);
    }
    break;
  }
  case 'targets':
    for (const [name, t] of Object.entries(TARGETS)) {
      console.log(`${name.padEnd(20)} ${t.triple.padEnd(28)} ${t.freestanding ? 'freestanding' : 'hosted'}  ${t.ptrBits}-bit`);
    }
    break;
  case 'version': console.log(`sidac ${VERSION} (llvm backend, ${Object.keys(TARGETS).length} targets)`); break;
  default: usage(); process.exit(cmd ? 1 : 0);
}
