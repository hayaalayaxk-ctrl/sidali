#!/usr/bin/env node
// sidali — the SidAli project and package manager.
//
//   sidali init [name]        scaffold sidali.toml + src/main.sidali
//   sidali build [path]       compile the project to a native executable
//   sidali run   [path]       run src/main.sidali on the VM
//   sidali test  [path]       run every tests/*.sidali file
//   sidali add <name>[@ver]   add a dependency to sidali.toml
//   sidali remove <name>      remove a dependency
//   sidali install            resolve + vendor dependencies into vendor/
//   sidali targets            list cross-compile targets
//   sidali substrates         list execution substrates
//   sidali version            print the version
//
// Dependencies are content-addressed: `sidali install` vendors each package and
// records its BLAKE3 in sidali.lock. A changed hash is refused, like a lockfile.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, cpSync } from 'node:fs';
import { join, dirname, basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const VERSION = '1.0.0';
const C = { red: '\x1b[31m', green: '\x1b[32m', cyan: '\x1b[36m', dim: '\x1b[2m', reset: '\x1b[0m' };

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
if (!enginePath) {
  console.error('sidali: engine bundle not found (run `npm run build:dist` or reinstall)');
  process.exit(1);
}
const engine = await import(pathToFileURL(enginePath).href);
const native = nativePath ? await import(pathToFileURL(nativePath).href) : null;

const { runSource, blake3 } = engine;

function usage() {
  console.log(`sidali ${VERSION} — project & package manager

usage:
  sidali init [name]
  sidali build [path] [--target=<t>] [--emit=exe|obj|asm|ir|fat] [--out=<p>]
  sidali run [path]
  sidali test [path]
  sidali add <name>[@<version>]
  sidali remove <name>
  sidali install
  sidali targets
  sidali substrates
  sidali version`);
}

// ---------- minimal TOML ----------
// Only the shapes a manifest needs: [package] key = "value" and
// [dependencies] name = "version". Enough to be a real, writable manifest.

function parseToml(text) {
  const out = { package: {}, dependencies: {} };
  let section = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) { section = sec[1].trim(); if (!out[section]) out[section] = {}; continue; }
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*"([^"]*)"$/);
    if (kv && section) out[section][kv[1]] = kv[2];
  }
  return out;
}

function emitToml(manifest) {
  const lines = ['[package]'];
  for (const [k, v] of Object.entries(manifest.package)) lines.push(`${k} = "${v}"`);
  const deps = Object.entries(manifest.dependencies || {});
  if (deps.length) {
    lines.push('', '[dependencies]');
    for (const [k, v] of deps.sort()) lines.push(`${k} = "${v}"`);
  }
  return lines.join('\n') + '\n';
}

function readManifest(dir) {
  const p = join(dir, 'sidali.toml');
  if (!existsSync(p)) return null;
  return parseToml(readFileSync(p, 'utf8'));
}

// Resolve `import <name>` by splicing the package source in ahead of the entry.
// Packages are looked up in vendor/ first, then the registry. Imports are
// resolved depth-first and de-duplicated, so a diamond dependency loads once.
function resolveImports(dir, source, seen = new Set(), stack = []) {
  const names = [...source.matchAll(/^\s*import\s+([A-Za-z0-9_]+)\s*$/gm)].map(m => m[1]);
  let prelude = '';
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (stack.includes(name)) throw new Error(`cyclic import: ${[...stack, name].join(' -> ')}`);
    const candidates = [
      join(dir, 'vendor', name, 'src', 'main.sidali'),
      join(dir, 'packages', name, 'src', 'main.sidali'),
      join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', name, 'src', 'main.sidali'),
    ];
    const found = candidates.find(existsSync);
    if (!found) throw new Error(`cannot resolve import '${name}' (run \`sidali install\`)`);
    const src = readFileSync(found, 'utf8');
    prelude += resolveImports(dirname(dirname(dirname(found))), src, seen, [...stack, name]) + '\n';
  }
  return prelude + source;
}

// ---------- commands ----------

function cmdInit(argv) {
  const name = argv[0] || basename(process.cwd());
  const dir = resolve(process.cwd(), name);
  if (existsSync(join(dir, 'sidali.toml'))) {
    console.error(`${C.red}error:${C.reset} sidali.toml already exists in ${dir}`);
    process.exit(1);
  }
  mkdirSync(join(dir, 'src'), { recursive: true });
  mkdirSync(join(dir, 'tests'), { recursive: true });
  writeFileSync(join(dir, 'sidali.toml'), emitToml({
    package: { name, version: '0.1.0', entry: 'src/main.sidali' },
    dependencies: {},
  }));
  writeFileSync(join(dir, 'src', 'main.sidali'),
    'fn main() {\n  let x = 5\n  let y = 10\n  print(x + y)\n}\n\nmain();\n');
  writeFileSync(join(dir, 'tests', 'basic.sidali'), 'print(2 + 2)\n');
  writeFileSync(join(dir, '.gitignore'), 'vendor/\n.sidali-build/\n*.sda\n');
  console.log(`${C.green}created${C.reset} ${name}/`);
  console.log(`  ${C.dim}sidali.toml, src/main.sidali, tests/basic.sidali${C.reset}`);
  console.log(`\nnext: ${C.cyan}cd ${name} && sidali run${C.reset}`);
}

function projectDir(argv) {
  const p = argv.find(a => !a.startsWith('-'));
  return resolve(process.cwd(), p || '.');
}

function entryOf(dir, manifest) {
  const entry = manifest?.package?.entry || 'src/main.sidali';
  const p = join(dir, entry);
  if (!existsSync(p)) {
    console.error(`${C.red}error:${C.reset} entry not found: ${entry}`);
    process.exit(1);
  }
  return p;
}

function cmdRun(argv) {
  const dir = projectDir(argv);
  const manifest = readManifest(dir);
  const file = entryOf(dir, manifest);
  const src = resolveImports(dir, readFileSync(file, 'utf8'));
  const r = runSource(src);
  for (const line of r.output) console.log(line);
  if (r.error) { console.error(`${C.red}runtime error:${C.reset} ${r.error}`); process.exit(1); }
}

function cmdTest(argv) {
  const dir = projectDir(argv);
  const tdir = join(dir, 'tests');
  if (!existsSync(tdir)) { console.error(`${C.red}error:${C.reset} no tests/ directory`); process.exit(1); }
  const files = readdirSync(tdir).filter(f => f.endsWith('.sidali')).sort();
  let failed = 0;
  for (const f of files) {
    const r = runSource(resolveImports(dir, readFileSync(join(tdir, f), 'utf8')));
    const ok = !r.error;
    if (!ok) failed++;
    console.log(`${ok ? C.green + 'ok  ' : C.red + 'FAIL'}${C.reset} ${f}${ok ? '' : ' — ' + r.error}`);
    for (const line of r.output) console.log(`     ${C.dim}${line}${C.reset}`);
  }
  console.log(`\n${files.length - failed} passed, ${failed} failed`);
  if (failed) process.exit(1);
}

function cmdBuild(argv) {
  if (!native) { console.error(`${C.red}error:${C.reset} native backend bundle not found`); process.exit(1); }
  const dir = projectDir(argv);
  const manifest = readManifest(dir);
  const file = entryOf(dir, manifest);
  const target = (argv.find(a => a.startsWith('--target=')) || '--target=x86_64-linux').slice(9);
  const emit = (argv.find(a => a.startsWith('--emit=')) || '--emit=exe').slice(7);
  const out = (argv.find(a => a.startsWith('--out=')) || '').slice(6);
  const name = out ? basename(out) : (manifest?.package?.name || basename(file, '.sidali'));
  const outDir = out && dirname(out) !== '.' ? resolve(dirname(out)) : join(dir, '.sidali-build');
  const src = resolveImports(dir, readFileSync(file, 'utf8'));
  const r = emit === 'fat'
    ? native.buildFat(src, { outDir, outName: name })
    : native.buildNative(src, { target, emit, outDir, outName: name });
  if (!r.ok) {
    console.error(`${C.red}compile failed${C.reset}`);
    for (const s of r.stages) console.error(`  ${s.ok ? C.green + 'ok' : C.red + 'FAIL'}${C.reset} ${s.name}: ${s.detail.slice(0, 160)}`);
    process.exit(1);
  }
  console.log(`${C.cyan}artifact:${C.reset} ${r.artifact}`);
}

function cmdAdd(argv) {
  const spec = argv[0];
  if (!spec) { console.error('usage: sidali add <name>[@<version>]'); process.exit(1); }
  const [name, version = '*'] = spec.split('@');
  const dir = resolve(process.cwd());
  const manifest = readManifest(dir);
  if (!manifest) { console.error(`${C.red}error:${C.reset} no sidali.toml (run \`sidali init\`)`); process.exit(1); }
  manifest.dependencies[name] = version;
  writeFileSync(join(dir, 'sidali.toml'), emitToml(manifest));
  console.log(`${C.green}added${C.reset} ${name} ${version}`);
}

function cmdRemove(argv) {
  const name = argv[0];
  if (!name) { console.error('usage: sidali remove <name>'); process.exit(1); }
  const dir = resolve(process.cwd());
  const manifest = readManifest(dir);
  if (!manifest) { console.error(`${C.red}error:${C.reset} no sidali.toml`); process.exit(1); }
  delete manifest.dependencies[name];
  writeFileSync(join(dir, 'sidali.toml'), emitToml(manifest));
  console.log(`${C.green}removed${C.reset} ${name}`);
}

// Vendors dependencies from a registry directory (default: <repo>/packages, or
// SIDALI_REGISTRY). Each package is a directory with a src/ and its own
// sidali.toml; the BLAKE3 of its entry file is recorded in sidali.lock.
function cmdInstall(argv) {
  const dir = resolve(process.cwd());
  const manifest = readManifest(dir);
  if (!manifest) { console.error(`${C.red}error:${C.reset} no sidali.toml`); process.exit(1); }
  const registry = process.env.SIDALI_REGISTRY
    || join(dirname(fileURLToPath(import.meta.url)), '..', 'packages');
  const vendor = join(dir, 'vendor');
  mkdirSync(vendor, { recursive: true });
  const lock = {};
  for (const [name, version] of Object.entries(manifest.dependencies)) {
    const src = join(registry, name);
    if (!existsSync(src)) {
      console.error(`${C.red}error:${C.reset} package not found in registry: ${name} (${src})`);
      process.exit(1);
    }
    cpSync(src, join(vendor, name), { recursive: true });
    const entry = join(vendor, name, 'src', 'main.sidali');
    const hash = existsSync(entry) ? blake3(readFileSync(entry, 'utf8')) : blake3(name + version);
    lock[name] = { version, blake3: hash };
    console.log(`${C.green}installed${C.reset} ${name} ${version} ${C.dim}${hash.slice(0, 16)}${C.reset}`);
  }
  writeFileSync(join(dir, 'sidali.lock'), JSON.stringify(lock, null, 2) + '\n');
  console.log(`${C.dim}wrote sidali.lock (${Object.keys(lock).length} packages)${C.reset}`);
}

function cmdTargets() {
  if (!native) { console.error('native backend bundle not found'); process.exit(1); }
  for (const [name, t] of Object.entries(native.TARGETS)) {
    console.log(`${name.padEnd(20)} ${String(t.triple).padEnd(28)} ${String(t.substrate).padEnd(12)} ${t.freestanding ? 'freestanding' : 'hosted'}`);
  }
}

function cmdSubstrates() {
  if (!native) { console.error('native backend bundle not found'); process.exit(1); }
  for (const s of native.SUBSTRATES) console.log(s);
}

const [cmd, ...rest] = process.argv.slice(2);
switch (cmd) {
  case 'init': cmdInit(rest); break;
  case 'build': cmdBuild(rest); break;
  case 'run': cmdRun(rest); break;
  case 'test': cmdTest(rest); break;
  case 'add': cmdAdd(rest); break;
  case 'remove': cmdRemove(rest); break;
  case 'install': cmdInstall(rest); break;
  case 'targets': cmdTargets(); break;
  case 'substrates': cmdSubstrates(); break;
  case 'version': case '--version': case '-V': console.log(`sidali ${VERSION}`); break;
  case 'help': case '--help': case '-h': case undefined: usage(); break;
  default:
    console.error(`sidali: unknown command '${cmd}'`);
    usage();
    process.exit(1);
}
