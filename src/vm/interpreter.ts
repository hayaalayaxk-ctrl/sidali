// SidAli Interpreter — stack VM with switch-case dispatch. No eval.
// Values: number | string | boolean | null | array | object | function | class | instance.

import * as C from '../compiler/bytecode';
import * as A from '../compiler/parser';
import { blake3, blake3Bytes, utf8Encode, hex } from '../std/blake3';
import * as M from '../std/math';
import * as S from '../std/sedenion';
import * as D from '../std/dilithium';
import * as G from '../std/governance';
import * as V from './machine';

export class RuntimeError extends Error {
  line?: number;
  constructor(msg: string, line?: number) {
    super(msg);
    this.line = line;
  }
}

export interface Frame {
  vars: Map<string, any>;
  parent: Frame | null;
  isFnBoundary: boolean;
}

function makeFrame(parent: Frame | null, isFnBoundary = false): Frame {
  return { vars: new Map(), parent, isFnBoundary };
}

function lookupFrame(f: Frame, name: string): Frame | null {
  let cur: Frame | null = f;
  while (cur) {
    if (cur.vars.has(name)) return cur;
    cur = cur.parent;
  }
  return null;
}

function getVar(f: Frame, name: string): any {
  const found = lookupFrame(f, name);
  if (!found) throw new RuntimeError(`undefined variable '${name}'`);
  return found.vars.get(name);
}

function setVar(f: Frame, name: string, value: any) {
  const found = lookupFrame(f, name);
  if (found) found.vars.set(name, value);
  else f.vars.set(name, value);
}

function declareVar(f: Frame, name: string, value: any, isConst = false) {
  f.vars.set(name, isConst ? Object.freeze({ v: value }) : value);
  if (isConst) f.vars.set(name, value);
}

function truthy(v: any): boolean {
  if (v === null || v === undefined || v === false) return false;
  if (typeof v === 'number') return v !== 0 && !Number.isNaN(v);
  if (typeof v === 'string') return v.length > 0;
  return true;
}

export function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  if (!isFinite(n)) return String(n);
  return String(Number(n.toPrecision(12)));
}

export function toStr(v: any): string {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'number') return fmtNum(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (Array.isArray(v)) return '[' + v.map(toStr).join(', ') + ']';
  if (v instanceof SidAliFunction) return `<fn ${v.name}>`;
  if (v instanceof SidAliClass) return `<class ${v.name}>`;
  if (v instanceof SidAliInstance) return `<${v.cls.name} instance>`;
  if (v && typeof v === 'object') {
    try { return JSON.stringify(v, (k, val) => typeof val === 'bigint' ? val.toString() : val); }
    catch { return String(v); }
  }
  return String(v);
}

export class SidAliFunction {
  constructor(public chunk: C.Chunk, public closure: Frame, public name: string) {}
  call(interp: Interpreter, args: any[], thisVal?: any): any {
    return interp.callChunk(this.chunk, args, thisVal, this.closure);
  }
}

export class SidAliClass {
  parent: SidAliClass | null = null;
  methods: Map<string, SidAliFunction> = new Map();
  statics: Map<string, any> = new Map();
  constructor(public name: string) {}
  lookupMethod(name: string): SidAliFunction | undefined {
    if (this.methods.has(name)) return this.methods.get(name);
    if (this.parent) return this.parent.lookupMethod(name);
    return undefined;
  }
  lookupStatic(name: string): any {
    if (this.statics.has(name)) return this.statics.get(name);
    if (this.parent) return this.parent.lookupStatic(name);
    return undefined;
  }
}

export class SidAliInstance {
  fields: Map<string, any> = new Map();
  constructor(public cls: SidAliClass, public struct: SidAliStruct | null = null) {}
}

// Zero-cost data types: structs, enums and their methods live on the class object.
export class SidAliStruct {
  staticMethods: Map<string, SidAliFunction> = new Map();
  constructor(public name: string, public fields: string[], public reprC = false, public packed = false) {}
  lookupMethod(name: string): SidAliFunction | undefined { return this.staticMethods.get(name); }
}
export class SidAliEnumVariant {
  constructor(public enumName: string, public variant: string, public arity: number) {}
  toString() { return `${this.enumName}::${this.variant}`; }
}

export interface RunResult {
  output: string[];
  error: string | null;
  stats: {
    instructions: number;
    timeMs: number;
    witnesses: number;
    ramUsed: number;
    ledgerHeight: number;
  };
  witnesses: string[];
  dna: string;
  ace: G.ACEState;
}

export class Interpreter {
  chunks = new Map<number, C.Chunk>();
  main!: C.Chunk;
  globals = makeFrame(null, true);
  output: string[] = [];
  instructions = 0;
  maxInstructions = 5_000_000;
  witnesses: string[] = [];
  ace: G.ACEEnvelope;
  ledger = new G.Ledger();
  machine: V.Machine;
  natives: Map<string, { arity: number; fn: (interp: Interpreter, args: any[]) => any }> = new Map();
  unsafeDepth = 0;
  externs = new Map<string, (interp: Interpreter, args: any[]) => any>();

  constructor(public program: C.CompileResult) {
    this.main = program.main;
    for (const ch of program.chunks) this.chunks.set(ch.id, ch);
    this.ace = new G.ACEEnvelope('S0');
    this.machine = new V.Machine();
    this.installBuiltins();
    this.installGlobals();
  }

  private installGlobals() {
    this.globals.vars.set('PI', Math.PI);
    this.globals.vars.set('E', Math.E);
    this.globals.vars.set('e', Math.E);
    this.globals.vars.set('K_MAX', G.K_MAX);
    this.globals.vars.set('TAU_R', G.TAU_R);
    this.globals.vars.set('machine', this.machine);
    this.globals.vars.set('ledger', this.ledger);
    this.globals.vars.set('ace', this.ace);
  }

  private defNative(name: string, arity: number, fn: (interp: Interpreter, args: any[]) => any) {
    this.natives.set(name, { arity, fn });
    this.globals.vars.set(name, { __native: name });
  }

  private installBuiltins() {
    const N = (name: string, arity: number, fn: (i: Interpreter, a: any[]) => any) => this.defNative(name, arity, fn);

    N('len', 1, (_, a) => {
      const v = a[0];
      if (typeof v === 'string') return [...v].length;
      if (Array.isArray(v)) return v.length;
      if (v instanceof Map) return v.size;
      if (v && typeof v === 'object') return Object.keys(v).length;
      throw new RuntimeError('len() expects string/array/object');
    });
    N('push', 2, (_, a) => { if (!Array.isArray(a[0])) throw new RuntimeError('push() expects array'); a[0].push(a[1]); return a[0]; });
    N('pop', 1, (_, a) => (Array.isArray(a[0]) ? a[0].pop() : null));
    N('range', 2, (_, a) => { const out: number[] = []; const [s, e] = [a[0], a[1]]; if (e >= s) for (let i = s; i < e; i++) out.push(i); else for (let i = s; i > e; i--) out.push(i); return out; });
    N('keys', 1, (_, a) => (a[0] && typeof a[0] === 'object' ? Object.keys(a[0]) : []));
    N('values', 1, (_, a) => (a[0] && typeof a[0] === 'object' ? Object.values(a[0]) : []));
    N('str', 1, (_, a) => toStr(a[0]));
    N('num', 1, (_, a) => (typeof a[0] === 'number' ? a[0] : parseFloat(toStr(a[0])) || 0));
    N('int', 1, (_, a) => Math.trunc(Number(a[0]) || 0));
    N('abs', 1, (_, a) => Math.abs(a[0]));
    N('floor', 1, (_, a) => Math.floor(a[0]));
    N('ceil', 1, (_, a) => Math.ceil(a[0]));
    N('round', 1, (_, a) => Math.round(a[0]));
    N('sqrt', 1, (_, a) => Math.sqrt(a[0]));
    N('pow', 2, (_, a) => Math.pow(a[0], a[1]));
    N('min', 2, (_, a) => Math.min(a[0], a[1]));
    N('max', 2, (_, a) => Math.max(a[0], a[1]));
    N('sin', 1, (_, a) => Math.sin(a[0]));
    N('cos', 1, (_, a) => Math.cos(a[0]));
    N('tan', 1, (_, a) => Math.tan(a[0]));
    N('log', 1, (_, a) => Math.log(a[0]));
    N('exp', 1, (_, a) => Math.exp(a[0]));
    N('now', 0, () => Date.now());
    N('type', 1, (_, a) => {
      const v = a[0];
      if (v === null || v === undefined) return 'nil';
      if (Array.isArray(v)) return 'array';
      if (v instanceof SidAliFunction) return 'function';
      if (v instanceof SidAliClass) return 'class';
      if (v instanceof SidAliInstance) return v.cls.name;
      return typeof v;
    });
    N('chr', 1, (_, a) => String.fromCodePoint(a[0]));
    N('ord', 1, (_, a) => (toStr(a[0]).codePointAt(0) ?? 0));
    N('split', 2, (_, a) => toStr(a[0]).split(toStr(a[1])));
    N('join', 2, (_, a) => (Array.isArray(a[0]) ? a[0].map(toStr).join(toStr(a[1])) : ''));
    N('upper', 1, (_, a) => toStr(a[0]).toUpperCase());
    N('lower', 1, (_, a) => toStr(a[0]).toLowerCase());
    N('trim', 1, (_, a) => toStr(a[0]).trim());
    N('contains', 2, (_, a) => toStr(a[0]).includes(toStr(a[1])));
    N('replace', 3, (_, a) => toStr(a[0]).split(toStr(a[1])).join(toStr(a[2])));

    // functional
    N('map', 2, (i, a) => (Array.isArray(a[0]) ? a[0].map((x, idx) => i.callValue(a[1], [x, idx])) : []));
    N('filter', 2, (i, a) => (Array.isArray(a[0]) ? a[0].filter((x, idx) => truthy(i.callValue(a[1], [x, idx]))) : []));
    N('reduce', 3, (i, a) => {
      if (!Array.isArray(a[0])) return null;
      let acc = a[2];
      for (let idx = 0; idx < a[0].length; idx++) acc = i.callValue(a[1], [acc, a[0][idx], idx]);
      return acc;
    });

    // math suite
    N('fib', 1, (_, a) => { const n = Math.max(0, Math.floor(a[0])); let x = 0, y = 1; for (let k = 0; k < n; k++) { [x, y] = [y, x + y]; } return x; });
    N('fibList', 1, (_, a) => { const n = Math.max(0, Math.floor(a[0])); const out = [0, 1]; while (out.length < n) out.push(out[out.length - 1] + out[out.length - 2]); return out.slice(0, n); });
    N('factorial', 1, (_, a) => { let r = 1; for (let k = 2; k <= Math.floor(a[0]); k++) r *= k; return r; });
    N('isPrime', 1, (_, a) => M.isPrimeMillerRabin(a[0]));
    N('fermat', 1, (_, a) => M.fermatCertify(a[0]));
    N('zeta', 1, (_, a) => M.zeta(a[0]));
    N('goldmul', 2, (_, a) => M.goldMul(BigInt(a[0]), BigInt(a[1])).toString());
    N('goldadd', 2, (_, a) => M.goldAdd(BigInt(a[0]), BigInt(a[1])).toString());
    N('zmod', 2, (_, a) => M.zmod(a[0], a[1]));
    N('jInvariant', 1, (_, a) => M.jInvariant(a[0]));

    // crypto / algebra
    N('blake3', 1, (_, a) => blake3(toStr(a[0])));
    N('sedenionMul', 2, (_, a) => S.sedenionMul(a[0], a[1]));
    N('zeroDivisor', 2, (_, a) => S.detectZeroDivisor(a[0], a[1]));
    N('opcodes', 0, () => S.opcodeTable());
    N('executeOpcode', 3, (_, a) => S.executeOpcode(S.opcodeTable()[a[0]], a[1], a[2] || new Array(16).fill(0)));

    // zero-width steganography
    N('zwsEncode', 1, (_, a) => M.toZeroWidth(toStr(a[0])));
    N('zwsDecode', 1, (_, a) => M.fromZeroWidth(toStr(a[0])));

    // post-quantum signatures
    N('dilithiumKeygen', 1, (_, a) => D.keygen(toStr(a[0])));
    N('dilithiumSign', 2, (i, a) => { const kp = a[1]; return D.sign(toStr(a[0]), kp); });
    N('dilithiumVerify', 3, (_, a) => D.verify(toStr(a[0]), a[1], a[2]));

    // governance / verification
    N('sigma', 2, (_, a) => G.sigmaKernel(a[0], a[1]));
    N('rho', 2, (_, a) => G.rhoGuard(a[0], a[1]));
    N('tierPolicy', 1, (_, a) => G.tierPolicy(a[0]));
    N('proofAnchor', 1, (_, a) => G.proofAnchor(Array.isArray(a[0]) ? a[0].map(toStr) : [toStr(a[0])]));
    N('zeroDivisorVault', 1, (_, a) => G.zeroDivisorVault(toStr(a[0])));
    N('kani', 2, (i, a) => {
      const fn = a[0]; const bound = a[1] || 4;
      let checked = 0;
      const rec = (args: number[]): number[] | null => {
        if (args.length === 2) {
          try { const out = i.callValue(fn, [args]); checked++; return typeof out === 'number' && isFinite(out) ? null : args.slice(); }
          catch { return args.slice(); }
        }
        for (let v = 0; v < bound; v++) { const ce = rec([...args, v]); if (ce) return ce; }
        return null;
      };
      const ce = rec([]);
      return { passed: ce === null, bound, checked, counterexample: ce };
    });
    N('ghost', 1, (_, a) => V.ghostLogic(toStr(a[0])));
    N('inCantorSet', 2, (_, a) => M.inCantorSet(a[0], a[1] || 20));

    // new native instances
    N('newLedger', 0, () => new G.Ledger());
    N('newCRDT', 0, () => new G.CRDT());
    N('newMachine', 0, (_, a) => new V.Machine(a[0] || undefined));

    // OS-ish file store (in-memory), so OS examples really read/write
    N('fsWrite', 2, (i, a) => { (i.globals.vars.get('__fs') as Map<string, string>).set(toStr(a[0]), toStr(a[1])); return true; });
    N('fsRead', 1, (i, a) => { const fs = i.globals.vars.get('__fs') as Map<string, string>; return fs.has(toStr(a[0])) ? fs.get(toStr(a[0])) : null; });
    N('fsList', 0, (i) => [...(i.globals.vars.get('__fs') as Map<string, string>).keys()]);
    this.globals.vars.set('__fs', new Map<string, string>());
  }

  castValue(v: any, typeName: string): any {
    const t = typeName.replace(/\s/g, '');
    if (/^[iu](8|16|32|64|size)$/.test(t)) {
      const n = Math.trunc(Number(v) || 0);
      if (t === 'u8') return n & 0xff;
      if (t === 'u16') return n & 0xffff;
      if (t === 'u32') return n >>> 0;
      if (t === 'i8') return (n << 24) >> 24;
      if (t === 'i16') return (n << 16) >> 16;
      if (t === 'i32') return n | 0;
      return n;
    }
    if (t === 'f32' || t === 'f64' || t === 'float') return Number(v);
    if (t === 'bool') return truthy(v);
    if (t === 'str' || t === 'string') return toStr(v);
    if (t === 'usize' || t === 'isize') return Math.trunc(Number(v) || 0);
    return v;
  }

  callValue(fn: any, args: any[], thisVal?: any): any {
    if (fn instanceof SidAliFunction) return fn.call(this, args, thisVal);
    if (fn && typeof fn === 'object' && fn.__native) {
      const nat = this.natives.get(fn.__native)!;
      return nat.fn(this, args);
    }
    if (fn instanceof SidAliClass) {
      const inst = new SidAliInstance(fn);
      const ctor = fn.lookupMethod('init') || fn.lookupMethod('constructor');
      if (ctor) ctor.call(this, args, inst);
      return inst;
    }
    if (fn instanceof SidAliStruct) {
      const inst = new SidAliInstance(new SidAliClass(fn.name), fn);
      for (let i = 0; i < fn.fields.length; i++) inst.fields.set(fn.fields[i], args[i]);
      return inst;
    }
    if (fn && typeof fn === 'object' && fn.__extern) {
      const impl = this.externs.get(fn.name);
      if (impl) return impl(this, args);
      return null;
    }
    if (fn && typeof fn === 'object' && fn.__enum) {
      // Enum variant constructor: Color::Red or Option::Some(x)
      return { __variant: true, enumName: fn.name, variant: args[0], value: args[1] };
    }
    throw new RuntimeError(`value is not callable: ${toStr(fn)}`);
  }

  callChunk(chunk: C.Chunk, args: any[], thisVal: any, closure: Frame): any {
    const frame = makeFrame(closure, true);
    for (let i = 0; i < chunk.params.length; i++) frame.vars.set(chunk.params[i], args[i]);
    if (thisVal !== undefined) {
      frame.vars.set('this', thisVal);
      frame.vars.set('self', thisVal);
    }
    return this.executeChunk(chunk, frame, thisVal);
  }

  run(): RunResult {
    const start = Date.now();
    let error: string | null = null;
    try {
      this.executeChunk(this.main, this.globals, undefined);
    } catch (e: any) {
      error = e instanceof Error ? e.message : String(e);
    }
    const dna = this.machine.exportDNA(1024);
    return {
      output: this.output,
      error,
      stats: {
        instructions: this.instructions,
        timeMs: Date.now() - start,
        witnesses: this.witnesses.length,
        ramUsed: this.machine.lattice.size,
        ledgerHeight: this.ledger.entries.length,
      },
      witnesses: this.witnesses.slice(),
      dna,
      ace: this.ace.state,
    };
  }

  private executeChunk(chunk: C.Chunk, frame: Frame, thisVal: any): any {
    const stack: any[] = [];
    const code = chunk.code;
    let ip = 0;
    const loopStack: Array<{ continuePc: number; breakPc: number }> = [];
    const tryStack: Array<{ handlerPc: number }> = [];
    let lastThrown: any = null;
    let pendingReturn = false;

    const pop = () => stack.pop();

    while (ip < code.length) {
      if (++this.instructions > this.maxInstructions) throw new RuntimeError('instruction limit exceeded (possible infinite loop)');
      const ins = code[ip];
      const op = ins.op;
      switch (op) {
        case 'CONST': stack.push(ins.a); ip++; break;
        case 'LOAD': stack.push(getVar(frame, ins.a)); ip++; break;
        case 'DECLARE': { const v = stack.pop(); frame.vars.set(ins.a, v); ip++; break; }
        case 'DECLARE_CONST': { const v = stack.pop(); frame.vars.set(ins.a, v); ip++; break; }
        case 'STORE': { const v = stack.pop(); setVar(frame, ins.a, v); ip++; break; }
        case 'POP': stack.pop(); ip++; break;
        case 'DUP': { const v = stack[stack.length - 1]; stack.push(v); ip++; break; }

        case 'BINOP': { const b = pop(), a = pop(); stack.push(this.binop(ins.a, a, b, ins.line)); ip++; break; }
        case 'UNOP': { const a = pop(); stack.push(this.unop(ins.a, a)); ip++; break; }

        case 'JZ': { const c = pop(); if (!truthy(c)) ip = ins.a; else ip++; break; }
        case 'JUMP': ip = ins.a; break;

        case 'ARRAY': { const n = ins.a; const items = stack.splice(stack.length - n, n); stack.push(items); ip++; break; }
        case 'OBJECT': {
          const n = ins.a;
          const pairs = stack.splice(stack.length - n * 2, n * 2);
          const obj: Record<string, any> = {};
          for (let i = 0; i < n; i++) obj[pairs[i * 2]] = pairs[i * 2 + 1];
          stack.push(obj); ip++; break;
        }
        case 'STRUCT_LIT': {
          const { name, n } = ins.a;
          const pairs = stack.splice(stack.length - n * 2, n * 2);
          const ty = lookupFrame(frame, name) ? getVar(frame, name) : null;
          const struct = ty instanceof SidAliStruct ? ty : new SidAliStruct(name, []);
          const inst = new SidAliInstance(new SidAliClass(name), struct);
          for (let i = 0; i < n; i++) inst.fields.set(pairs[i * 2], pairs[i * 2 + 1]);
          stack.push(inst); ip++; break;
        }
        case 'INDEX': { const idx = pop(), obj = pop(); stack.push(this.index(obj, idx)); ip++; break; }
        case 'SET_INDEX': {
          const val = pop(), idx = pop(), obj = pop();
          if (Array.isArray(obj)) obj[idx < 0 ? obj.length + idx : idx] = val;
          else if (obj && typeof obj === 'object') obj[idx] = val;
          stack.push(val); ip++; break;
        }
        case 'MEMBER': { const obj = pop(); stack.push(this.member(obj, ins.a)); ip++; break; }
        case 'SET_MEMBER': { const val = pop(), obj = pop(); if (obj instanceof SidAliInstance) obj.fields.set(ins.a, val); else if (obj && typeof obj === 'object') obj[ins.a] = val; stack.push(val); ip++; break; }

        case 'LEN': { const v = pop(); stack.push(this.lengthOf(v)); ip++; break; }

        case 'MAKE_FN': { const ch = this.chunks.get(ins.a)!; stack.push(new SidAliFunction(ch, frame, ch.name)); ip++; break; }
        case 'MAKE_STRUCT': {
          const spec = ins.a;
          stack.push(new SidAliStruct(spec.name, spec.fields, spec.reprC, spec.packed)); ip++; break;
        }
        case 'MAKE_ENUM': {
          const spec = ins.a;
          const variants: Record<string, SidAliEnumVariant> = {};
          for (const v of spec.variants) variants[v.name] = new SidAliEnumVariant(spec.name, v.name, v.arity);
          stack.push({ __enum: true, name: spec.name, variants }); ip++; break;
        }
        case 'ATTACH_METHOD': {
          const target = getVar(frame, ins.a);
          const ch = this.chunks.get(ins.b.chunk)!;
          const fn = new SidAliFunction(ch, frame, `${ins.a}.${ins.b.name}`);
          if (target instanceof SidAliStruct) target.staticMethods.set(ins.b.name, fn);
          else if (target instanceof SidAliClass) target.methods.set(ins.b.name, fn);
          else if (target && typeof target === 'object' && target.__enum) target.methods = target.methods || new Map(), target.methods.set(ins.b.name, fn);
          ip++; break;
        }
        case 'UNSAFE_ENTER': this.unsafeDepth++; ip++; break;
        case 'UNSAFE_LEAVE': this.unsafeDepth = Math.max(0, this.unsafeDepth - 1); ip++; break;
        case 'DECLARE_EXTERN': {
          const spec = ins.a;
          const native = (this.externs.get(spec.name)) || null;
          frame.vars.set(spec.name, native || { __extern: true, name: spec.name, params: spec.params });
          ip++; break;
        }
        case 'USE': ip++; break;
        case 'CAST': { const v = pop(); stack.push(this.castValue(v, ins.a)); ip++; break; }
        case 'REF': { const v = pop(); stack.push({ __ref: true, mut: !!ins.a, target: v, box: { value: v } }); ip++; break; }
        case 'DEREF': {
          const v = pop();
          stack.push(v && v.__ref ? v.box.value : v); ip++; break;
        }
        case 'MAKE_RANGE': { const end = pop(), start = pop(); stack.push({ __range: true, start, end, inclusive: !!ins.a }); ip++; break; }
        case 'MAKE_CLASS': {
          const spec = ins.a;
          const cls = new SidAliClass(spec.name);
          if (spec.parent) {
            const parentVal = lookupFrame(frame, spec.parent) ? getVar(frame, spec.parent) : null;
            if (parentVal instanceof SidAliClass) cls.parent = parentVal;
          }
          for (const m of spec.methods) {
            const ch = this.chunks.get(m.chunk)!;
            cls.methods.set(m.name, new SidAliFunction(ch, frame, `${spec.name}.${m.name}`));
          }
          stack.push(cls); ip++; break;
        }
        case 'NEW': {
          const n = ins.b;
          const args = stack.splice(stack.length - n, n);
          const cls = getVar(frame, ins.a);
          if (!(cls instanceof SidAliClass)) throw new RuntimeError(`${ins.a} is not a class`);
          const inst = new SidAliInstance(cls);
          const ctor = cls.lookupMethod('init') || cls.lookupMethod('constructor');
          if (ctor) ctor.call(this, args, inst);
          stack.push(inst); ip++; break;
        }

        case 'CALL': {
          const n = ins.a;
          const args = stack.splice(stack.length - n, n);
          const fn = pop();
          stack.push(this.callValue(fn, args)); ip++; break;
        }
        case 'CALL_METHOD': {
          const n = ins.b;
          const args = stack.splice(stack.length - n, n);
          const obj = pop();
          stack.push(this.callMethod(obj, ins.a, args)); ip++; break;
        }

        case 'TRANSCEND': {
          const arg = pop();
          if (ins.a === 'pi') stack.push(Math.PI * arg);
          else stack.push(Math.log(Math.abs(arg) || 1) * Math.E);
          ip++; break;
        }

        case 'PRINT': { const v = pop(); this.output.push(toStr(v)); ip++; break; }

        case 'LOOP_ENTER': loopStack.push({ continuePc: ins.a, breakPc: ins.b }); ip++; break;
        case 'LOOP_END': loopStack.pop(); ip++; break;
        case 'BREAK': { const l = loopStack[loopStack.length - 1]; ip = l ? l.breakPc : code.length; break; }
        case 'CONTINUE': { const l = loopStack[loopStack.length - 1]; ip = l ? l.continuePc : ip + 1; break; }

        case 'TRY_ENTER': tryStack.push({ handlerPc: ins.a }); ip++; break;
        case 'TRY_LEAVE': tryStack.pop(); ip++; break;
        case 'CATCH_BIND': { frame.vars.set(ins.a, lastThrown); lastThrown = null; ip++; break; }
        case 'FINALLY_END': ip++; break;
        case 'THROW': {
          const v = pop();
          lastThrown = v;
          if (tryStack.length) {
            const t = tryStack.pop()!;
            ip = t.handlerPc;
          } else {
            throw new RuntimeError(`uncaught: ${toStr(v)}`, ins.line);
          }
          break;
        }

        case 'IMPORT': ip++; break;
        case 'BUILD': stack.push({ __builder: true, target: ins.a, args: [] }); ip++; break;
        case 'BUILD_APPLY': {
          const n = ins.a;
          const args = stack.splice(stack.length - n, n);
          const b = pop();
          b.args = args;
          this.onBuild(b);
          stack.push(b); ip++; break;
        }

        case 'RET': {
          const v = stack.length ? pop() : null;
          return v;
        }
        case 'HALT': return null;
        default: throw new RuntimeError(`unknown opcode ${op}`);
      }
      void pendingReturn;
    }
    return null;
  }

  private onBuild(b: any) {
    const target = b.target || 'build';
    const label = toStr(b.args[0] ?? target);
    const witness = blake3(`${target}|${label}|${b.args.map(toStr).join(',')}`);
    this.witnesses.push(witness);
    this.ace.charge(1, target);
    this.ledger.append('build', `${target}:${label}`);
    this.output.push(`[build] ${target} → ${label} (witness ${witness.slice(0, 12)})`);
  }

  private lengthOf(v: any): number {
    if (typeof v === 'string') return [...v].length;
    if (Array.isArray(v)) return v.length;
    if (v instanceof Map) return v.size;
    if (v && typeof v === 'object' && v.__range) {
      const { start, end, inclusive } = v;
      const hi = inclusive ? end + 1 : end;
      return end >= start ? Math.max(0, hi - start) : Math.max(0, start - hi);
    }
    if (v && typeof v === 'object') return Object.keys(v).length;
    return 0;
  }

  private index(obj: any, idx: any): any {
    if (obj && typeof obj === 'object' && obj.__range) {
      const { start, end, inclusive } = obj;
      const hi = inclusive ? end + 1 : end;
      if (end >= start) return start + idx;
      return start - idx;
    }
    if (typeof obj === 'string') return [...obj][idx] ?? null;
    if (Array.isArray(obj)) return obj[idx < 0 ? obj.length + idx : idx] ?? null;
    if (obj instanceof Map) return obj.get(idx);
    if (obj && typeof obj === 'object') return obj[idx] ?? null;
    return null;
  }

  private member(obj: any, prop: string): any {
    if (obj instanceof SidAliInstance) {
      if (obj.fields.has(prop)) return obj.fields.get(prop);
      const m = obj.cls.lookupMethod(prop) || (obj.struct ? obj.struct.lookupMethod(prop) : undefined);
      if (m) return m;
      const st = obj.cls.lookupStatic(prop);
      if (st !== undefined) return st;
      return null;
    }
    if (obj instanceof SidAliClass) {
      const st = obj.lookupStatic(prop);
      if (st !== undefined) return st;
      return null;
    }
    if (obj instanceof SidAliStruct) {
      const m = obj.staticMethods.get(prop);
      if (m) return m;
      return null;
    }
    if (obj && typeof obj === 'object' && obj.__enum) return obj.variants[prop] ?? null;
    if (Array.isArray(obj) && (prop === 'length' || prop === 'len')) return obj.length;
    if (typeof obj === 'string' && (prop === 'length' || prop === 'len')) return [...obj].length;
    if (obj instanceof G.Ledger && prop === 'height') return obj.entries.length;
    if (obj instanceof G.Ledger && prop === 'size') return obj.entries.length;
    if (obj instanceof G.CRDT && prop === 'size') return obj.size;
    if (obj instanceof V.Machine && prop === 'ring') return obj.ring;
    if (obj && typeof obj === 'object') return obj[prop] ?? null;
    return null;
  }

  private callMethod(obj: any, name: string, args: any[]): any {
    if (obj instanceof SidAliInstance) {
      const m = obj.cls.lookupMethod(name) || (obj.struct ? obj.struct.lookupMethod(name) : undefined);
      if (m) return m.call(this, args, obj);
      const native = this.instanceNative(obj, name, args);
      if (native !== undefined) return native;
      throw new RuntimeError(`${obj.struct ? obj.struct.name : obj.cls.name} has no method '${name}'`);
    }
    if (Array.isArray(obj)) return this.arrayMethod(obj, name, args);
    if (typeof obj === 'string') return this.stringMethod(obj, name, args);
    if (typeof obj === 'number') return this.numberMethod(obj, name, args);
    if (obj instanceof G.Ledger) return this.ledgerMethod(obj, name, args);
    if (obj instanceof G.CRDT) return this.crdtMethod(obj, name, args);
    if (obj instanceof V.Machine) return this.machineMethod(obj, name, args);
    if (obj instanceof G.ACEEnvelope) return this.aceMethod(obj, name, args);
    throw new RuntimeError(`cannot call method '${name}' on ${toStr(obj)}`);
  }

  private instanceNative(obj: SidAliInstance, name: string, args: any[]): any {
    // Built-in instance helpers for classes that don't define them.
    if (name === 'toString') return toStr(obj);
    if (name === 'get') return obj.fields.get(args[0]);
    if (name === 'set') { obj.fields.set(args[0], args[1]); return obj; }
    return undefined;
  }

  private arrayMethod(arr: any[], name: string, args: any[]): any {
    switch (name) {
      case 'push': arr.push(args[0]); return arr;
      case 'pop': return arr.pop();
      case 'len': case 'length': return arr.length;
      case 'map': return arr.map((x, i) => this.callValue(args[0], [x, i]));
      case 'filter': return arr.filter((x, i) => truthy(this.callValue(args[0], [x, i])));
      case 'reduce': { let acc = args[1]; for (let i = 0; i < arr.length; i++) acc = this.callValue(args[0], [acc, arr[i], i]); return acc; }
      case 'join': return arr.map(toStr).join(toStr(args[0] ?? ','));
      case 'slice': return arr.slice(args[0], args[1]);
      case 'sort': return arr.slice().sort((a, b) => (args[0] ? this.callValue(args[0], [a, b]) : (a > b ? 1 : a < b ? -1 : 0)));
      case 'reverse': return arr.slice().reverse();
      case 'indexOf': return arr.indexOf(args[0]);
      case 'includes': return arr.includes(args[0]);
      case 'sum': return arr.reduce((s, x) => s + (Number(x) || 0), 0);
      case 'min': return Math.min(...arr);
      case 'max': return Math.max(...arr);
      default: throw new RuntimeError(`array has no method '${name}'`);
    }
  }

  private stringMethod(s: string, name: string, args: any[]): any {
    switch (name) {
      case 'upper': return s.toUpperCase();
      case 'lower': return s.toLowerCase();
      case 'trim': return s.trim();
      case 'split': return s.split(toStr(args[0]));
      case 'includes': return s.includes(toStr(args[0]));
      case 'indexOf': return s.indexOf(toStr(args[0]));
      case 'slice': return s.slice(args[0], args[1]);
      case 'replace': return s.split(toStr(args[0])).join(toStr(args[1]));
      case 'repeat': return s.repeat(args[0]);
      case 'chars': return [...s];
      case 'len': case 'length': return [...s].length;
      case 'startsWith': return s.startsWith(toStr(args[0]));
      case 'endsWith': return s.endsWith(toStr(args[0]));
      case 'toNumber': return parseFloat(s) || 0;
      default: throw new RuntimeError(`string has no method '${name}'`);
    }
  }

  private numberMethod(n: number, name: string, _args: any[]): any {
    switch (name) {
      case 'floor': return Math.floor(n);
      case 'ceil': return Math.ceil(n);
      case 'round': return Math.round(n);
      case 'abs': return Math.abs(n);
      case 'toString': return fmtNum(n);
      default: throw new RuntimeError(`number has no method '${name}'`);
    }
  }

  private ledgerMethod(l: G.Ledger, name: string, args: any[]): any {
    switch (name) {
      case 'append': return l.append(toStr(args[0]), toStr(args[1]));
      case 'verify': return l.verifyChain();
      case 'size': return l.entries.length;
      case 'all': return l.entries;
      default: throw new RuntimeError(`ledger has no method '${name}'`);
    }
  }

  private crdtMethod(c: G.CRDT, name: string, args: any[]): any {
    switch (name) {
      case 'set': c.set(toStr(args[0]), toStr(args[1]), args[2] ?? Date.now(), toStr(args[3] ?? 'n1')); return c;
      case 'get': return c.get(toStr(args[0])) ?? null;
      case 'merge': c.merge(args[0]); return c;
      case 'size': return c.size;
      case 'entries': return Object.fromEntries(c.entries());
      default: throw new RuntimeError(`crdt has no method '${name}'`);
    }
  }

  private machineMethod(m: V.Machine, name: string, args: any[]): any {
    switch (name) {
      case 'boot': return m.boot();
      case 'load': return m.loadLattice(toStr(args[0]));
      case 'exportDNA': return m.exportDNA(args[0] || 1024);
      case 'importDNA': return m.importDNA(toStr(args[0]));
      case 'writeMBR': return m.writeMBR(toStr(args[0]));
      case 'read': return Array.from(m.read(args[0], args[1]));
      default: throw new RuntimeError(`machine has no method '${name}'`);
    }
  }

  private aceMethod(a: G.ACEEnvelope, name: string, args: any[]): any {
    switch (name) {
      case 'charge': return a.charge(args[0], toStr(args[1] ?? 'op'));
      case 'witness': return a.witness(toStr(args[0]));
      case 'state': return a.state;
      default: throw new RuntimeError(`ace has no method '${name}'`);
    }
  }

  private binop(op: string, a: any, b: any, line?: number): any {
    switch (op) {
      case '+': {
        if (typeof a === 'string' || typeof b === 'string') return toStr(a) + toStr(b);
        return a + b;
      }
      case '-': return a - b;
      case '*': return a * b;
      case '/': {
        // Integer operands divide as integers (like the native backend and
        // Rust/C++); a float operand switches to true division.
        if (b === 0) return Number.isInteger(a) && Number.isInteger(b) ? 0 : NaN;
        if (Number.isInteger(a) && Number.isInteger(b)) return Math.trunc(a / b);
        return a / b;
      }
      case '%': return a % b;
      case '**': return Math.pow(a, b);
      case '==': return this.looseEq(a, b);
      case '!=': return !this.looseEq(a, b);
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
      case '&&': return truthy(a) ? b : a;
      case '||': return truthy(a) ? a : b;
      case '&': return (a | 0) & (b | 0);
      case '|': return (a | 0) | (b | 0);
      case '^': return (a | 0) ^ (b | 0);
      default: throw new RuntimeError(`unsupported operator ${op}`, line);
    }
  }

  private looseEq(a: any, b: any): boolean {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return false;
    if (a instanceof SidAliEnumVariant && typeof b === 'string') return a.variant === b;
    if (b instanceof SidAliEnumVariant && typeof a === 'string') return b.variant === a;
    if (a instanceof SidAliEnumVariant && b instanceof SidAliEnumVariant) return a.enumName === b.enumName && a.variant === b.variant;
    if (typeof a === 'number' && typeof b === 'string') return a === Number(b);
    if (typeof a === 'string' && typeof b === 'number') return Number(a) === b;
    if (Array.isArray(a) && Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
    return false;
  }

  private unop(op: string, a: any): any {
    switch (op) {
      case '-': return -a;
      case '+': return +a;
      case '!': return !truthy(a);
      case '~': return ~a;
      default: throw new RuntimeError(`unsupported unary operator ${op}`);
    }
  }
}

// Convenience: compile + run in one call.
export function runSource(source: string): RunResult {
  const ast = A.parse(source);
  const compiled = C.compile(ast);
  const interp = new Interpreter(compiled);
  return interp.run();
}
