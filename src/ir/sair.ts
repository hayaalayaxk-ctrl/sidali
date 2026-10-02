// SAIR — the SidAli Abstract Intermediate Representation.
//
// SAIR is deliberately physics-free: it describes only State, Transition and
// Energy. The same SAIR lowers to a transistor, a photonic switch, a quantum
// entanglement, a water valve, a holographic voxel, a laser pulse or a plasma
// arc, because none of those distinctions exist at this layer.
//
//   State       — a typed value location (SSA-ish: each transition writes one).
//   Transition  — a pure operation over states, with an energy cost.
//   Energy      — a dimensionless cost unit, summed per program and per substrate.
//
// `lowerBytecode` translates the stack-VM chunks into SAIR; `evaluate` runs SAIR
// on any Substrate (see backends/backend.ts), which is what makes the IR universal.

import * as A from '../compiler/parser';
import type { CompileResult, Chunk, Instr } from '../compiler/bytecode';

export type SairType = 'i64' | 'f64' | 'bool' | 'str' | 'any';

export type SairOp =
  | 'const' | 'load' | 'store'
  | 'add' | 'sub' | 'mul' | 'div' | 'mod' | 'pow'
  | 'eq' | 'ne' | 'lt' | 'le' | 'gt' | 'ge'
  | 'and' | 'or' | 'xor' | 'shl' | 'shr'
  | 'neg' | 'not'
  | 'print'
  | 'jump' | 'branch'
  | 'call' | 'ret'
  | 'range' | 'transcend'
  | 'sys';

export interface SairState {
  id: number;
  type: SairType;
  /** Debug origin: a variable name, or a synthetic slot label. */
  name: string;
}

export interface SairTransition {
  op: SairOp;
  /** Destination state id, when the transition produces a value. */
  dst?: number;
  /** Source state ids, in operand order. */
  srcs: number[];
  /** Immediate operand: literal, variable name, jump target, opcode, … */
  imm?: unknown;
  energy: number;
  line?: number;
}

export interface SairFunction {
  id: number;
  name: string;
  params: string[];
  states: SairState[];
  transitions: SairTransition[];
}

export interface SairProgram {
  functions: SairFunction[];
  main: number;
  meta: { source: string; states: number; transitions: number; energy: number };
}

export class SairError extends Error {}

/** Energy cost of each op. Transcendentals dominate, as they do in silicon. */
export const OP_ENERGY: Record<SairOp, number> = {
  const: 1, load: 1, store: 1,
  add: 1, sub: 1, mul: 2, div: 4, mod: 4, pow: 16,
  eq: 1, ne: 1, lt: 1, le: 1, gt: 1, ge: 1,
  and: 1, or: 1, xor: 1, shl: 1, shr: 1,
  neg: 1, not: 1,
  print: 8,
  jump: 1, branch: 1,
  call: 4, ret: 1,
  range: 2, transcend: 16,
  sys: 2,
};

const BINOP: Record<string, SairOp> = {
  '+': 'add', '-': 'sub', '*': 'mul', '/': 'div', '%': 'mod', '**': 'pow',
  '==': 'eq', '!=': 'ne', '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge',
  '&&': 'and', '||': 'or', '&': 'and', '|': 'or', '^': 'xor', '<<': 'shl', '>>': 'shr',
};

const UNOP: Record<string, SairOp> = { '-': 'neg', '!': 'not', '~': 'not' };

export function typeOfValue(v: unknown): SairType {
  if (typeof v === 'number') return Number.isInteger(v) ? 'i64' : 'f64';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'string') return 'str';
  return 'any';
}

function lowerChunk(chunk: Chunk, id: number, chunkNames: Map<number,string>): SairFunction {
  const states: SairState[] = [];
  const transitions: SairTransition[] = [];
  const stack: number[] = [];
  const names = new Map<number, string>();
  let next = 0;

  const newState = (type: SairType, name: string): number => {
    const s: SairState = { id: next++, type, name };
    states.push(s);
    return s.id;
  };
  const emit = (t: Omit<SairTransition, 'energy'> & { energy?: number }): number => {
    const full: SairTransition = { ...t, energy: t.energy ?? OP_ENERGY[t.op] };
    transitions.push(full);
    return transitions.length - 1;
  };
  const pop = (): number => {
    const v = stack.pop();
    if (v === undefined) throw new SairError(`stack underflow in ${chunk.name}`);
    return v;
  };

  for (const ins of chunk.code as Instr[]) {
    const line = ins.line;
    switch (ins.op) {
      case 'CONST': {
        const s = newState(typeOfValue(ins.a), 'const');
        emit({ op: 'const', dst: s, srcs: [], imm: ins.a, line });
        stack.push(s);
        break;
      }
      case 'LOAD': {
        const s = newState('any', String(ins.a));
        names.set(s, String(ins.a));
        emit({ op: 'load', dst: s, srcs: [], imm: ins.a, line });
        stack.push(s);
        break;
      }
      case 'STORE':
      case 'DECLARE':
      case 'DECLARE_CONST': {
        emit({ op: 'store', srcs: [pop()], imm: ins.a, line });
        break;
      }
      case 'POP': pop(); break;
      case 'MAKE_FN': {
        // A function value. Calls are resolved by name in the evaluator, so the
        // value only needs to keep the stack balanced.
        const s = newState('any', 'fn');
        names.set(s, chunkNames.get(Number(ins.a)) || `fn#${ins.a}`);
        emit({ op: 'const', dst: s, srcs: [], imm: { fn: ins.a }, line });
        stack.push(s);
        break;
      }
      case 'BINOP': {
        const b = pop(), a = pop();
        const op = BINOP[String(ins.a)];
        if (!op) throw new SairError(`unsupported binary op ${ins.a}`);
        const s = newState('any', 'binop');
        emit({ op, dst: s, srcs: [a, b], imm: ins.a, line });
        stack.push(s);
        break;
      }
      case 'UNOP': {
        const a = pop();
        const op = UNOP[String(ins.a)];
        if (!op) throw new SairError(`unsupported unary op ${ins.a}`);
        const s = newState('any', 'unop');
        emit({ op, dst: s, srcs: [a], imm: ins.a, line });
        stack.push(s);
        break;
      }
      case 'PRINT': emit({ op: 'print', srcs: [pop()], line }); break;
      case 'JZ': emit({ op: 'branch', srcs: [pop()], imm: ins.a, line }); break;
      case 'JUMP': emit({ op: 'jump', srcs: [], imm: ins.a, line }); break;
      case 'CALL': {
        const argc = Number(ins.a) || 0;
        const args: number[] = [];
        for (let i = 0; i < argc; i++) args.unshift(pop());
        const callee = stack.pop();
        const calleeName = callee === undefined ? '' : (names.get(callee) || '');
        const s = newState('any', 'call');
        emit({ op: 'call', dst: s, srcs: args, imm: calleeName, line });
        stack.push(s);
        break;
      }
      case 'RET': {
        const srcs = stack.length ? [pop()] : [];
        emit({ op: 'ret', srcs, line });
        break;
      }
      case 'MAKE_RANGE': {
        const end = pop(), start = pop();
        const s = newState('any', 'range');
        emit({ op: 'range', dst: s, srcs: [start, end], imm: !!ins.a, line });
        stack.push(s);
        break;
      }
      case 'TRANSCEND': {
        const s = newState('f64', String(ins.a));
        emit({ op: 'transcend', dst: s, srcs: [], imm: { symbol: ins.a, kind: ins.b }, line });
        stack.push(s);
        break;
      }
      default: {
        // Everything else is preserved verbatim as a `sys` transition so SAIR is
        // a total lowering — no bytecode is silently dropped.
        emit({ op: 'sys', srcs: [], imm: { bytecode: ins.op, a: ins.a, b: ins.b }, line });
        break;
      }
    }
  }
  return { id, name: chunk.name, params: chunk.params, states, transitions };
}

export function lowerBytecode(result: CompileResult, source = ''): SairProgram {
  const chunkNames = new Map<number,string>();
  result.chunks.forEach(c => chunkNames.set(c.id, c.name));
  const functions = result.chunks.map((c, i) => lowerChunk(c, i, chunkNames));
  const main = result.chunks.indexOf(result.main);
  return { functions, main, meta: summarize(functions, source) };
}

export function lowerSource(
  src: string,
  compile: (p: A.Program) => CompileResult,
  parse: (t: unknown[]) => A.Program,
  tokenize: (s: string) => unknown[],
): SairProgram {
  return lowerBytecode(compile(parse(tokenize(src))), src);
}

function summarize(functions: SairFunction[], source: string) {
  let states = 0, transitions = 0, energy = 0;
  for (const f of functions) {
    states += f.states.length;
    transitions += f.transitions.length;
    for (const t of f.transitions) energy += t.energy;
  }
  return { source, states, transitions, energy };
}

export function energyOf(program: SairProgram): number {
  return program.meta.energy;
}

export interface SubstrateLike {
  readonly name: string;
  compute(op: SairOp, args: number[], imm: unknown): number;
  energy(op: SairOp, base: number): number;
}

export interface EvalResult {
  output: string[];
  states: Map<string, unknown>;
  energy: number;
  substrate: string;
}

/**
 * Execute SAIR on a substrate. States are name-keyed (each `load`/`store` carries
 * its variable name) and calls are resolved by name, so recursion and multiple
 * functions work. Every arithmetic transition is delegated to `substrate.compute`,
 * so the same SAIR yields the same result on electrons, photons, qubits, water,
 * vacuum, light.
 */
export function evaluate(program: SairProgram, substrate: SubstrateLike, maxSteps = 5_000_000): EvalResult {
  const byName = new Map<string, SairFunction>();
  for (const f of program.functions) byName.set(f.name, f);
  const output: string[] = [];
  let energy = 0;
  let steps = 0;

  interface Frame { fn: SairFunction; env: Map<string, unknown>; pc: number; dst?: number; ret?: unknown; }

  const run = (fn: SairFunction, args: unknown[]): unknown => {
    const env = new Map<string, unknown>();
    fn.params.forEach((p, i) => env.set(p, args[i]));
    const frames: Frame[] = [{ fn, env, pc: 0 }];
    let last: unknown = null;

    while (frames.length) {
      const fr = frames[frames.length - 1];
      if (fr.pc < 0 || fr.pc >= fr.fn.transitions.length) {
        const v = fr.ret !== undefined ? fr.ret : last;
        const dstId = fr.dst;
        frames.pop();
        if (frames.length) {
          const parent = frames[frames.length - 1];
          if (dstId !== undefined) parent.env.set(String(dstId), v);
        }
        last = v;
        continue;
      }
      if (++steps > maxSteps) throw new SairError('step limit exceeded');
      const t = fr.fn.transitions[fr.pc];
      energy += substrate.energy(t.op, t.energy);

      const val = (id: number | undefined): unknown => (id === undefined ? 0 : fr.env.get(String(id)));
      const num = (id: number | undefined): number => {
        const v = val(id);
        return typeof v === 'number' ? v : Number(v ?? 0);
      };
      const bool = (id: number | undefined): boolean => !!val(id);
      const set = (id: number | undefined, v: unknown) => { if (id !== undefined) fr.env.set(String(id), v); };

      switch (t.op) {
        case 'const': set(t.dst, t.imm); break;
        case 'load': set(t.dst, fr.env.get(String(t.imm))); break;
        case 'store': fr.env.set(String(t.imm), val(t.srcs[0])); break;
        case 'add': case 'sub': case 'mul': case 'div': case 'mod': case 'pow':
        case 'eq': case 'ne': case 'lt': case 'le': case 'gt': case 'ge':
        case 'and': case 'or': case 'xor': case 'shl': case 'shr':
          set(t.dst, substrate.compute(t.op, t.srcs.map(num), t.imm)); break;
        case 'neg': set(t.dst, substrate.compute('neg', [num(t.srcs[0])], t.imm)); break;
        case 'not': set(t.dst, substrate.compute('not', [num(t.srcs[0])], t.imm)); break;
        case 'print': output.push(String(val(t.srcs[0]))); break;
        case 'jump': fr.pc = Number(t.imm); continue;
        case 'branch': fr.pc = bool(t.srcs[0]) ? fr.pc + 1 : Number(t.imm); continue;
        case 'range': set(t.dst, { start: num(t.srcs[0]), end: num(t.srcs[1]), inclusive: !!t.imm }); break;
        case 'transcend': {
          const imm = t.imm as { symbol: string };
          set(t.dst, imm.symbol === 'e' ? Math.E : Math.PI);
          break;
        }
        case 'call': {
          const target = byName.get(String(t.imm));
          if (target) {
            const callArgs = t.srcs.map(val);
            fr.pc++;
            frames.push({ fn: target, env: new Map(), pc: 0, dst: t.dst });
            const callee = frames[frames.length - 1];
            target.params.forEach((p, i) => callee.env.set(p, callArgs[i]));
            continue;
          }
          set(t.dst, 0);
          break;
        }
        case 'ret': fr.ret = val(t.srcs[0]); fr.pc = fr.fn.transitions.length; continue;
        case 'sys': break;
      }
      fr.pc++;
    }
    return last;
  };

  run(program.functions[program.main], []);
  return { output, states: new Map(), energy, substrate: substrate.name };
}
