// sidac CLI tests: driver behaviour, --out path handling, native run.
import { test } from 'node:test';
import assert from 'node:assert';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { clangPath } from '../dist/native.node.mjs';

const CLI = resolve('bin/sidac.mjs');
const hasClang = !!clangPath() && existsSync(clangPath());
const dir = mkdtempSync(join(tmpdir(), 'sidali-cli-'));
const src = join(dir, 'prog.sidali');
writeFileSync(src, 'fn main() { let x = 5; let y = 10; print(x + y); }\nmain();\n');

function sidac(args) {
  return spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });
}

test('sidac run executes on the VM', () => {
  const r = sidac(['run', src]);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), '15');
});

test('sidac substrates lists every substrate with its targets', () => {
  const r = sidac(['substrates']);
  assert.equal(r.status, 0, r.stderr);
  for (const s of ['electron', 'photon', 'qubit', 'fluidic', 'vacuum', 'holographic', 'plasma', 'energy']) {
    assert.match(r.stdout, new RegExp(`^${s}\\b`, 'm'));
  }
});

test('--out as a path writes there, not under .sidali-build', { skip: !hasClang }, () => {
  const out = join(dir, 'nested', 'prog');
  const r = sidac(['build', src, '--target=x86_64-linux', '--emit=obj', `--out=${out}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(out), `expected ${out}`);
  assert.ok(!existsSync(join(dir, '.sidali-build', 'prog')), 'must not write under .sidali-build');
});

test('hosted build produces a runnable executable', { skip: !hasClang }, () => {
  const out = join(dir, 'runme');
  const r = sidac(['build', src, '--target=x86_64-linux', '--emit=exe', `--out=${out}`]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(existsSync(out));
  const run = spawnSync(out, { encoding: 'utf8' });
  assert.equal(run.stdout.trim(), '15');
});
