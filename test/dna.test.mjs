// DNA header + fat (universal) binary tests.
import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNative, buildFat, clangPath, withDnaHeader, readDnaHeader, findDna, verifyDna } from '../dist/native.node.mjs';

const hasClang = !!clangPath() && existsSync(clangPath());
const out = mkdtempSync(join(tmpdir(), 'sidali-dna-'));

const SRC = 'fn main() { let x = 5; let y = 10; print(x + y); }\nmain();\n';

test('DNA header round-trips and verifies', () => {
  const payload = new TextEncoder().encode('machine code here');
  const img = withDnaHeader(payload, 'photon', 'riscv64', 1);
  const h = readDnaHeader(img);
  assert.equal(h.substrate, 'photon');
  assert.equal(h.arch, 'riscv64');
  assert.equal(h.version, 1);
  assert.ok(verifyDna(img));
  // tampering breaks verification
  img[img.length - 1] ^= 0xff;
  assert.equal(verifyDna(img), false);
});

test('every target tags its binary with a DNA descriptor', { skip: !hasClang }, () => {
  const r = buildNative(SRC, { target: 'x86_64-linux', outDir: out, outName: 'dna-x86' });
  assert.ok(r.ok, r.stderr);
  assert.ok(existsSync(`${r.artifact}.dna`));
  const companion = readFileSync(`${r.artifact}.dna`, 'utf8').trim();
  assert.match(companion, /^\[START:SUBSTRATE=electron:ARCH=x86_64-unknown-linux-gnu:VERSION=1:BLAKE3=[0-9a-f]{64}\]\[END\]$/);
  // the trailer is embedded in the ELF and verifies
  const img = readFileSync(r.artifact);
  const trailer = findDna(img);
  assert.equal(trailer.substrate, 'electron');
  assert.ok(verifyDna(img));
  // the ELF still runs (magic intact at byte 0)
  assert.equal(img.subarray(0, 4).toString('hex'), '7f454c46');
});

test('non-electron substrates lower to real code with the right DNA', { skip: !hasClang }, () => {
  for (const [target, substrate] of [['photon-riscv', 'photon'], ['qubit-riscv', 'qubit'], ['holographic-wasm', 'holographic'], ['plasma-arm', 'plasma']]) {
    const r = buildNative(SRC, { target, emit: 'obj', outDir: out, outName: `sub-${substrate}` });
    assert.ok(r.ok, `${target}: ${r.stderr}`);
    const dna = findDna(readFileSync(r.artifact));
    assert.equal(dna.substrate, substrate, target);
  }
});

test('fat binary bundles many substrates into one .sda', { skip: !hasClang }, () => {
  const r = buildFat(SRC, { outDir: out, outName: 'fat-test' });
  assert.ok(r.ok, r.stderr);
  assert.ok(r.artifact.endsWith('.sda'));
  const text = readFileSync(r.artifact).subarray(0, 4096).toString('utf8');
  assert.match(text, /^\[SIDALI-FAT:VERSION=1:SECTIONS=\d+\]/);
  const sections = text.match(/\[SUBSTRATE=/g) || [];
  assert.ok(sections.length >= 6, `expected many sections, got ${sections.length}`);
  for (const s of ['photon', 'qubit', 'holographic', 'plasma']) {
    assert.match(text, new RegExp(`SUBSTRATE=${s}:`));
  }
  // every section records a BLAKE3
  assert.match(text, /LEN=\d+:BLAKE3=[0-9a-f]{64}\]/);
});
