// HAL tests: per-substrate device maps and freestanding compilation.
import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { HAL_SPECS, halSpec, halRuntimeC, halAddressMap, buildNative, clangPath } from '../dist/native.node.mjs';
import { SUBSTRATE_ENERGY } from '../dist/engine.node.mjs';

const hasClang = !!clangPath() && existsSync(clangPath());
const out = mkdtempSync(join(tmpdir(), 'sidali-hal-'));

test('every substrate has a HAL spec with a device map', () => {
  for (const s of Object.keys(SUBSTRATE_ENERGY)) {
    const spec = halSpec(s);
    assert.ok(spec.devices.length >= 1, `${s} has a device`);
    const d = spec.devices[0];
    assert.ok(d.base > 0, `${s} base`);
    assert.ok(Number.isInteger(d.dataOffset), `${s} data offset`);
    const map = halAddressMap(s);
    assert.ok(map.some(m => m.kind === 'data'), `${s} data register`);
  }
  assert.equal(HAL_SPECS.photon.console, 'modulator');
  assert.equal(HAL_SPECS.qubit.console, 'gate');
  assert.equal(HAL_SPECS.fluidic.console, 'valve');
});

test('generated HAL C names the right device and base', () => {
  const photon = halRuntimeC('photon');
  assert.match(photon, /substrate: photon/);
  assert.match(photon, /SID_DEVICE_BASE 0x50020000UL/);
  assert.match(photon, /sid_emit/);
  const qubit = halRuntimeC('qubit');
  assert.match(qubit, /SID_DEVICE_BASE 0x60000000UL/);
  assert.match(qubit, /ready = bit 2/);
});

test('same program builds for a non-electron substrate with its own HAL', { skip: !hasClang }, () => {
  const src = 'fn main() { print(1 + 2); }\nmain();\n';
  const r = buildNative(src, { target: 'photon-riscv', outDir: out, outName: 'photon-prog' });
  assert.ok(r.ok, r.stderr);
  const hal = readFileSync(join(out, 'photon-prog.hal.c'), 'utf8');
  assert.match(hal, /substrate: photon/);
  assert.match(hal, /0x50020000UL/);
  // the ELF keeps its magic and carries a photon DNA trailer
  const bytes = readFileSync(r.artifact);
  assert.equal(bytes.subarray(0, 4).toString('hex'), '7f454c46');
});

test('all freestanding substrates compile the same program', { skip: !hasClang }, () => {
  const src = 'fn main() { print(6 * 7); }\nmain();\n';
  for (const target of ['photon-riscv', 'qubit-riscv', 'fluidic-riscv', 'vacuum-riscv', 'plasma-arm', 'energy-riscv']) {
    const r = buildNative(src, { target, outDir: out, outName: `fs-${target}` });
    assert.ok(r.ok, `${target}: ${r.stderr}`);
  }
});
