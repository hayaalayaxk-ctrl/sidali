// Systems-language tests: structs, enums, impls, match, ranges, casts, generics, references.
import { test } from 'node:test';
import assert from 'node:assert';
import { runSource } from '../dist/engine.node.mjs';

function run(src) {
  const r = runSource(src);
  if (r.error) throw new Error(r.error + '\n--- output ---\n' + r.output.join('\n'));
  return r;
}

test('struct fields compute real values', () => {
  const r = run(`struct Point { x: i64, y: i64 }
fn main() { let p = Point { x: 3, y: 4 }; print(p.x + p.y); }
main();`);
  assert.equal(r.output.at(-1), '7');
});

test('impl methods with self', () => {
  const r = run(`struct Vec2 { x: i64, y: i64 }
impl Vec2 { fn len2(self) -> i64 { return self.x * self.x + self.y * self.y } }
fn main() { let v = Vec2 { x: 3, y: 4 }; print(v.len2()); }
main();`);
  assert.equal(r.output.at(-1), '25');
});

test('enum variants and match', () => {
  const r = run(`enum Color { Red, Green, Blue }
fn name(c) { match c { Red => "red", Green => "green", _ => "other" } }
fn main() { print(name(Color::Green)); }
main();`);
  assert.equal(r.output.at(-1), 'green');
});

test('match with multi-literal arms', () => {
  const r = run(`fn classify(n) {
  match n { 0 => "zero", 1 | 2 | 3 => "small", _ => "big" }
}
fn main() { print(classify(2)); print(classify(9)); }
main();`);
  assert.deepEqual(r.output.slice(-2), ['small', 'big']);
});

test('for loop over inclusive range', () => {
  const r = run(`fn main() { let mut s = 0; for i in 0..=5 { s += i; } print(s); }
main();`);
  assert.equal(r.output.at(-1), '15');
});

test('for loop over exclusive range', () => {
  const r = run(`fn main() { let mut s = 0; for i in 0..10 { s += i; } print(s); }
main();`);
  assert.equal(r.output.at(-1), '45');
});

test('for-in over an array', () => {
  const r = run(`fn main() { let a = [10, 20, 30]; let mut s = 0; for x in a { s += x; } print(s); }
main();`);
  assert.equal(r.output.at(-1), '60');
});

test('integer cast truncates to width', () => {
  const r = run(`fn main() { let x: i32 = 300; print(x as u8); }
main();`);
  assert.equal(r.output.at(-1), '44');
});

test('while with break and continue', () => {
  const r = run(`fn main() {
  let mut i = 0; let mut s = 0;
  while true { i += 1; if i > 10 { break } if i % 2 == 0 { continue } s += i; }
  print(s);
}
main();`);
  assert.equal(r.output.at(-1), '25');
});

test('repeat loop runs exactly n times', () => {
  const r = run(`fn main() { let mut c = 0; repeat 7 { c += 1; } print(c); }
main();`);
  assert.equal(r.output.at(-1), '7');
});

test('unsafe block executes MMIO-style operations', () => {
  const r = run(`fn main() { unsafe { let x = 5; print(x * 2); } }
main();`);
  assert.equal(r.output.at(-1), '10');
});

test('recursion with typed params', () => {
  const r = run(`fn fib(n: i64) -> i64 { if n < 2 { return n } return fib(n - 1) + fib(n - 2) }
fn main() { print(fib(20)); }
main();`);
  assert.equal(r.output.at(-1), '6765');
});

test('nested struct construction and field mutation', () => {
  const r = run(`struct Counter { n: i64 }
fn main() { let c = Counter { n: 10 }; c.n = c.n + 5; print(c.n); }
main();`);
  assert.equal(r.output.at(-1), '15');
});
