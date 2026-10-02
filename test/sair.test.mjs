// SAIR + universal backend/substrate tests.
import { test } from 'node:test';
import assert from 'node:assert';
import { tokenize, parse, compile, lowerBytecode, evaluate, makeSubstrate, defaultRegistry, totalEnergy, SUBSTRATE_ENERGY, ELECTRON_TARGETS, NEW_SUBSTRATE_TARGETS } from '../dist/engine.node.mjs';

const SRC = `fn main() {
  let x = 5;
  let y = 10;
  let z = x + y;
  print(z);
  if z > 10 { print(1); } else { print(0); }
}
main();
`;

function sair(src = SRC) {
  return lowerBytecode(compile(parse(src)), src);
}

test('SAIR lowers bytecode to State + Transition + Energy only', () => {
  const ir = sair();
  assert.ok(ir.functions.length >= 1);
  const ops = new Set(ir.functions.flatMap(f => f.transitions.map(t => t.op)));
  // only SAIR vocabulary appears — no electron/transistor concepts
  for (const op of ops) {
    assert.ok(['const', 'load', 'store', 'add', 'sub', 'mul', 'div', 'mod', 'pow',
      'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'xor', 'shl', 'shr',
      'neg', 'not', 'print', 'jump', 'branch', 'call', 'ret', 'range', 'transcend', 'sys'].includes(op), `unexpected op ${op}`);
  }
  assert.ok(ir.meta.states > 0 && ir.meta.transitions > 0);
  assert.ok(ir.meta.energy > 0);
});

test('the same SAIR evaluates identically on every substrate', () => {
  const ir = sair();
  const expected = ['15', '1'];
  for (const name of Object.keys(SUBSTRATE_ENERGY)) {
    const r = evaluate(ir, makeSubstrate(name));
    assert.deepEqual(r.output, expected, `substrate ${name}`);
  }
});

test('substrates differ only in energy, not in results', () => {
  const ir = sair();
  const electron = totalEnergy(ir, makeSubstrate('electron'));
  const plasma = totalEnergy(ir, makeSubstrate('plasma'));
  const energy = totalEnergy(ir, makeSubstrate('energy'));
  assert.ok(plasma > electron, 'plasma costs more than electrons');
  assert.ok(energy < electron, 'energy-as-medium costs less');
  const a = evaluate(ir, makeSubstrate('electron')).output;
  const b = evaluate(ir, makeSubstrate('plasma')).output;
  assert.deepEqual(a, b);
});

test('backend registry: 6 electron targets + 7 new substrates', () => {
  const reg = defaultRegistry();
  assert.equal(ELECTRON_TARGETS.length, 6);
  assert.equal(NEW_SUBSTRATE_TARGETS.length, 7);
  assert.equal(reg.list().length, 13);
  for (const t of ELECTRON_TARGETS) assert.ok(reg.get(t), `missing backend ${t}`);
  for (const t of NEW_SUBSTRATE_TARGETS) assert.ok(reg.get(t), `missing backend ${t}`);
  // each backend declares a real clang triple
  for (const b of reg.list()) assert.ok(b.triple && b.triple.length > 3, `${b.name} triple`);
  assert.equal(reg.bySubstrate('photon').length, 1);
  assert.equal(reg.bySubstrate('electron').length, 6);
});

test('recursion and calls work on every substrate', () => {
  const src = 'fn fib(n: i64) -> i64 { if n < 2 { return n } return fib(n - 1) + fib(n - 2) }\nfn main() { print(fib(10)); }\nmain();\n';
  const ir = sair(src);
  for (const name of Object.keys(SUBSTRATE_ENERGY)) {
    assert.deepEqual(evaluate(ir, makeSubstrate(name)).output, ['55'], `substrate ${name}`);
  }
});
