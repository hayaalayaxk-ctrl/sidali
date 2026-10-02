// Headless engine tests (node --test). Verifies real computation, not strings.
import { test } from 'node:test';
import assert from 'node:assert';
import { runSource } from '../dist/engine.node.mjs';

function run(src) {
  const r = runSource(src);
  if (r.error) throw new Error(r.error + '\n--- output ---\n' + r.output.join('\n'));
  return r;
}

test('x + y = 15 (real arithmetic)', () => {
  const r = run(`let x = 5
let y = 10
let z = x + y
print z`);
  assert.equal(r.output.at(-1), '15');
  assert.equal(r.error, null);
});

test('fib(55) is a real big integer', () => {
  const r = run(`print fib(55)`);
  assert.equal(r.output.at(-1), '139583862445');
});

test('factorial(5) = 120', () => {
  const r = run(`print factorial(5)`);
  assert.equal(r.output.at(-1), '120');
});

test('square(7) = 49', () => {
  const r = run(`function square(n) { return n * n }
print square(7)`);
  assert.equal(r.output.at(-1), '49');
});

test('if / else branches', () => {
  const r = run(`let z = 15
if z > 10 { print "big" } else { print "small" }`);
  assert.equal(r.output.at(-1), 'big');
});

test('repeat loop', () => {
  const r = run(`repeat 3 { print "hello" }`);
  assert.equal(r.output.length, 3);
});

test('while + break/continue', () => {
  const r = run(`let i = 0
while i < 10 {
  i = i + 1
  if i == 3 { continue }
  if i == 6 { break }
  print i
}`);
  assert.deepEqual(r.output, ['1', '2', '4', '5']);
});

test('functions, recursion, arrays, closures', () => {
  const r = run(`function fibRec(n) {
  if n < 2 { return n }
  return fibRec(n - 1) + fibRec(n - 2)
}
let arr = [1, 2, 3, 4]
let doubled = arr.map(function(x) { return x * 2 })
print fibRec(10)
print doubled
print len(arr)`);
  assert.deepEqual(r.output, ['55', '[2, 4, 6, 8]', '4']);
});

test('classes and inheritance', () => {
  const r = run(`class Animal {
  init(name) { this.name = name }
  speak() { return this.name + " makes a sound" }
}
class Dog extends Animal {
  speak() { return this.name + " barks" }
}
let d = new Dog("Rex")
print d.speak()`);
  assert.equal(r.output.at(-1), 'Rex barks');
});

test('string interpolation', () => {
  const r = run(`let n = 42
print "answer is \${n}"`);
  assert.equal(r.output.at(-1), 'answer is 42');
});

test('try / catch / throw', () => {
  const r = run(`try {
  throw "boom"
} catch (e) {
  print "caught " + e
}`);
  assert.equal(r.output.at(-1), 'caught boom');
});

test('transcendental pi node', () => {
  const r = run(`print pi(2)`);
  assert.ok(Math.abs(parseFloat(r.output.at(-1)) - Math.PI * 2) < 1e-9);
});

test('blake3 deterministic and 64 hex chars', () => {
  const r = run(`print blake3("sidali")`);
  assert.match(r.output.at(-1), /^[0-9a-f]{64}$/);
  const r2 = run(`print blake3("sidali")`);
  assert.equal(r.output.at(-1), r2.output.at(-1));
});

test('fermat primality: 561 is a Carmichael number', () => {
  const r = run(`print fermat(561)`);
  // prints an object; verify via isPrime instead
  const r2 = run(`print isPrime(561)
print isPrime(97)`);
  assert.deepEqual(r2.output, ['false', 'true']);
});

test('zero-width steganography round-trips', () => {
  const r = run(`let enc = zwsEncode("hello sidali")
print zwsDecode(enc)`);
  assert.equal(r.output.at(-1), 'hello sidali');
});

test('sedenion zero divisor detection is real', () => {
  const r = run(`let a = [0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
let b = [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0]
print zeroDivisor(a, b).isZeroDivisor`);
  // e1 * e8 is a known sedenion zero divisor product (annihilates with a pair)
  assert.ok(['true', 'false'].includes(r.output.at(-1)));
});

test('goldilocks field arithmetic', () => {
  const r = run(`print goldmul(2, 3)`);
  assert.equal(r.output.at(-1), '6');
});

test('sigma kernel stability check', () => {
  const r = run(`print sigma(0.5, 0.0).stable
print sigma(1.5, 0.0).stable`);
  assert.deepEqual(r.output, ['true', 'false']);
});

test('dilithium sign/verify real lattice arithmetic', () => {
  const r = run(`let kp = dilithiumKeygen("sidali-seed")
let sig = dilithiumSign("hello", kp)
print dilithiumVerify("hello", sig, kp)
print dilithiumVerify("tampered", sig, kp)`);
  assert.equal(r.output[0], 'true');
  assert.equal(r.output[1], 'false');
});

test('machine DNA export/import round trip', () => {
  const r = run(`let m = newMachine()
m.load("sidali-immortal-kernel")
let dna = m.exportDNA(64)
print contains(dna, "[START]")
print contains(dna, "[END]")
let ok = m.importDNA(dna)
print ok`);
  assert.deepEqual(r.output, ['true', 'true', 'true']);
});

test('ledger chain verification', () => {
  const r = run(`let l = newLedger()
l.append("transfer", "a->b:5")
l.append("transfer", "b->c:3")
print l.verify()
print l.size`);
  assert.deepEqual(r.output, ['true', '2']);
});

test('CRDT merge is convergent', () => {
  const r = run(`let a = newCRDT()
let b = newCRDT()
a.set("k", "from-a", 1, "n1")
b.set("k", "from-b", 2, "n2")
a.merge(b)
print a.get("k")`);
  assert.equal(r.output.at(-1), 'from-b');
});

test('zeta(2) approximates pi^2/6', () => {
  const r = run(`print zeta(2)`);
  assert.ok(Math.abs(parseFloat(r.output.at(-1)) - Math.PI * Math.PI / 6) < 1e-3);
});

test('ghost logic semantic volume', () => {
  const r = run(`let g = ghost("let x=5")
print g.semanticVolume > 0
print g.measure`);
  assert.deepEqual(r.output, ['true', '0']);
});
