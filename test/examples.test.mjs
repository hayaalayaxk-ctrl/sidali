// Integration tests: every shipped example must compile and run without error,
// and the translator must produce executable SidAli from English.
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runSource, GraphemeDecomposer, alpPolicy, rtaMetric } from '../dist/engine.node.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const examplesDir = resolve(here, '../examples');

test('all examples run without errors', () => {
  const files = readdirSync(examplesDir).filter(f => f.endsWith('.sidali')).sort();
  assert.ok(files.length >= 5, 'expected at least 5 examples');
  for (const f of files) {
    const src = readFileSync(resolve(examplesDir, f), 'utf8');
    const r = runSource(src);
    assert.equal(r.error, null, `${f} failed: ${r.error}`);
    assert.ok(r.output.length > 0, `${f} produced no output`);
  }
});

test('English -> SidAli: x=5 y=10 sum', () => {
  const d = new GraphemeDecomposer();
  const a = d.decompose('create variable x equal to 5');
  assert.match(a.code, /let x = 5/);
  const b = d.decompose('create variable y equal to 10');
  assert.match(b.code, /let y = 10/);
  const c = d.decompose('compute z as add x and y');
  assert.match(c.code, /let z = x \+ y/);
  const prog = a.code + '\n' + b.code + '\n' + c.code + '\nprint z';
  const r = runSource(prog);
  assert.equal(r.error, null);
  assert.equal(r.output.at(-1), '15');
});

test('English -> SidAli: build intents compile', () => {
  const d = new GraphemeDecomposer();
  for (const phrase of [
    'build me an operating system',
    'create a social platform',
    'write a zk smart contract',
    'show me ghost logic and zero width steganography',
    'compute fibonacci',
  ]) {
    const dec = d.decompose(phrase);
    const r = runSource(dec.code);
    assert.equal(r.error, null, `${phrase} -> ${dec.intent} failed: ${r.error}`);
  }
});

test('English -> SidAli: repeat and conditionals', () => {
  const d = new GraphemeDecomposer();
  const rep = d.decompose('repeat 3 times print hello');
  const r = runSource(rep.code);
  assert.equal(r.error, null);
  assert.equal(r.output.length, 3);
});

test('AlpPolicy and RtaMetric', () => {
  assert.equal(alpPolicy(1, 0).policy, 'INCREASE_MULTIPLICITY');
  assert.equal(alpPolicy(5, 2).policy, 'REDUCE_ARTA');
  assert.ok(rtaMetric(1, 0) <= 1 && rtaMetric(1, 5) >= 0);
});
