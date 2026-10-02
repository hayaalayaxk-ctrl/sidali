// Native backend tests: real LLVM IR + real machine code via clang.
// Skipped automatically when no clang is installed.
import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildNative, runNative, clangPath } from '../dist/native.node.mjs';

const clang = clangPath();
const hasClang = !!clang && existsSync(clang);
const out = mkdtempSync(join(tmpdir(), 'sidali-native-'));

const SRC = `
fn add(a: i64, b: i64) -> i64 { return a + b }
fn square(n: i64) -> i64 { return n * n }
fn fib(n: i64) -> i64 { if n < 2 { return n } return fib(n - 1) + fib(n - 2) }
struct Point { x: i64, y: i64 }
impl Point { fn norm2(self) -> i64 { return self.x * self.x + self.y * self.y } }
fn main() {
  let x = 5;
  let y = 10;
  print(add(x, y));
  print(square(7));
  print(fib(10));
  let p = Point { x: 3, y: 4 };
  print(p.norm2());
  let mut s = 0;
  for i in 0..10 { s += i; }
  print(s);
}
main();
`;

test('LLVM IR is emitted with the right target triple', () => {
  const r = buildNative(SRC, { target: 'x86_64-linux', emit: 'ir', outDir: out, outName: 'ir-test' });
  assert.ok(r.ok, r.stderr);
  assert.match(r.ir, /target triple = "x86_64-unknown-linux-gnu"/);
  assert.match(r.ir, /define i64 @add\(/);
  assert.match(r.ir, /%struct\.Point = type \{ i64, i64 \}/);
});

test('native executable computes correct results', { skip: !hasClang }, () => {
  const r = buildNative(SRC, { target: 'x86_64-linux', outDir: out, outName: 'exe-test', optLevel: 2 });
  assert.ok(r.ok, r.stderr);
  const run = runNative(r.artifact);
  assert.equal(run.status, 0, run.stderr);
  const lines = run.stdout.trim().split('\n');
  assert.deepEqual(lines, ['15', '49', '55', '25', '45']);
});

test('freestanding cross-compile to bare metal (thumbv7m)', { skip: !hasClang }, () => {
  const r = buildNative('fn main() { let x = 5; }\nmain();', { target: 'armv7m-none-eabi', emit: 'obj', outDir: out, outName: 'm3' });
  assert.ok(r.ok, r.stderr);
  assert.ok(existsSync(r.artifact));
});

test('cross-compile to riscv32 and wasm32', { skip: !hasClang }, () => {
  for (const target of ['riscv32-none-elf', 'wasm32']) {
    const r = buildNative('fn main() { print(1); }\nmain();', { target, emit: 'obj', outDir: out, outName: `x-${target}` });
    assert.ok(r.ok, `${target}: ${r.stderr}`);
  }
});

const SYSTEMS_SRC = `
const LIMIT: i64 = 100;
fn gcd(a: i64, b: i64) -> i64 {
  let mut x = a; let mut y = b;
  while y != 0 { let t = y; y = x % y; x = t; }
  return x;
}
fn isPrime(n: i64) -> bool {
  if n < 2 { return false }
  let mut i = 2;
  while i * i <= n { if n % i == 0 { return false } i += 1; }
  return true;
}
struct Rect { w: i64, h: i64 }
impl Rect {
  fn area(self) -> i64 { return self.w * self.h }
  fn scale(self, k: i64) -> Rect { return Rect { w: self.w * k, h: self.h * k } }
}
fn collatz(n: i64) -> i64 {
  let mut steps = 0; let mut x = n;
  while x != 1 { if x % 2 == 0 { x = x / 2 } else { x = 3 * x + 1 } steps += 1; }
  return steps;
}
fn main() {
  print(gcd(48, 36));
  print(isPrime(97));
  let r = Rect { w: 6, h: 7 };
  print(r.area());
  let s = r.scale(3);
  print(s.area());
  print(collatz(27));
  let mut acc = 0;
  for i in 1..=LIMIT { acc += i; }
  print(acc);
  print("done");
}
main();
`;

test('native systems program: structs, methods, ranges, bool returns', { skip: !hasClang }, () => {
  const r = buildNative(SYSTEMS_SRC, { target: 'x86_64-linux', outDir: out, outName: 'systems', optLevel: 2 });
  assert.ok(r.ok, r.stderr);
  const run = runNative(r.artifact);
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(run.stdout.trim().split('\n'), ['12', '1', '42', '378', '111', '5050', 'done']);
});

const BARE_SRC = 'fn main() { let mut i = 0; while i < 3 { mmio_write(0x40000000, i); i += 1; } }\nmain();\n';

test('freestanding targets link a bare-metal ELF with the HAL', { skip: !hasClang }, () => {
  const elfTargets = ['armv7m-none-eabi', 'cortex-m4', 'riscv32-none-elf', 'riscv64-none-elf'];
  for (const target of elfTargets) {
    const r = buildNative(BARE_SRC, { target, outDir: out, outName: `bare-${target}` });
    assert.ok(r.ok, `${target}: ${r.stderr}`);
    const bytes = readFileSync(r.artifact);
    assert.deepEqual([...bytes.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46], `${target} is not an ELF`);
  }
});

test('wasm32 freestanding build produces a wasm module', { skip: !hasClang }, () => {
  const r = buildNative(BARE_SRC, { target: 'wasm32', outDir: out, outName: 'bare-wasm' });
  assert.ok(r.ok, r.stderr);
  assert.deepEqual([...readFileSync(r.artifact).subarray(0, 4)], [0x00, 0x61, 0x73, 0x6d]);
});

test('object-only targets emit relocatable objects', { skip: !hasClang }, () => {
  const r = buildNative(BARE_SRC, { target: 'bpfel', outDir: out, outName: 'bare-bpf' });
  assert.ok(r.ok, r.stderr);
  assert.ok(readFileSync(r.artifact).length > 0);
});
