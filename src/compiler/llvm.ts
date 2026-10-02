// SidAli LLVM backend — emits real LLVM IR (opaque pointers, LLVM 15+) from the SidAli AST.
// The IR is handed to clang, which produces native machine code for the requested target.
// This is the path that makes SidAli a systems language: OS kernels, firmware, WASM, .o files.

import * as A from './parser';

export interface TargetProfile {
  name: string;
  triple: string;
  cpu: string;
  march: string;
  features: string;
  freestanding: boolean;
  ptrBits: number;
  objectOnly?: boolean;
  /** Execution substrate (electron, photon, qubit, ...). Defaults to `electron`. */
  substrate?: string;
}

/** The physical substrate a binary is emitted for. */
export const SUBSTRATES = ['electron', 'photon', 'qubit', 'fluidic', 'vacuum', 'holographic', 'plasma', 'energy', 'generic'] as const;
export type Substrate = (typeof SUBSTRATES)[number];

export const TARGETS: Record<string, TargetProfile> = {
  'x86_64-linux': { name: 'x86_64-linux', triple: 'x86_64-unknown-linux-gnu', cpu: '', march: '', features: '', freestanding: false, ptrBits: 64 },
  'aarch64-linux': { name: 'aarch64-linux', triple: 'aarch64-unknown-linux-gnu', cpu: '', march: '', features: '', freestanding: false, ptrBits: 64 },
  'armv7m-none-eabi': { name: 'armv7m-none-eabi', triple: 'thumbv7m-none-eabi', cpu: 'cortex-m3', march: 'armv7-m', features: '', freestanding: true, ptrBits: 32, substrate: 'electron' },
  'cortex-m4': { name: 'cortex-m4', triple: 'thumbv7em-none-eabi', cpu: 'cortex-m4', march: 'armv7e-m', features: '', freestanding: true, ptrBits: 32, substrate: 'electron' },
  'riscv32-none-elf': { name: 'riscv32-none-elf', triple: 'riscv32-none-elf', cpu: '', march: 'rv32imac', features: '', freestanding: true, ptrBits: 32, substrate: 'electron' },
  'riscv64-none-elf': { name: 'riscv64-none-elf', triple: 'riscv64-none-elf', cpu: '', march: 'rv64imac', features: '', freestanding: true, ptrBits: 64, substrate: 'electron' },
  wasm32: { name: 'wasm32', triple: 'wasm32-unknown-unknown', cpu: 'generic', march: '', features: '', freestanding: true, ptrBits: 32, substrate: 'electron' },
  bpfel: { name: 'bpfel', triple: 'bpfel-unknown-none', cpu: 'generic', march: '', features: '', freestanding: true, ptrBits: 64, objectOnly: true, substrate: 'electron' },

  // --- non-electron substrates: same SAIR, different physics.
  // Photonic/quantum/fluidic/vacuum/holographic/plasma/energy logic all lowers to
  // a real clang architecture today (RISC-V, ARM, wasm); the DNA header records
  // which physical substrate the image is destined for.
  'photon-riscv': { name: 'photon-riscv', triple: 'riscv64-unknown-none-elf', cpu: '', march: 'rv64imac', features: '', freestanding: true, ptrBits: 64, substrate: 'photon' },
  'qubit-riscv': { name: 'qubit-riscv', triple: 'riscv32-unknown-none-elf', cpu: '', march: 'rv32imac', features: '', freestanding: true, ptrBits: 32, substrate: 'qubit' },
  'fluidic-riscv': { name: 'fluidic-riscv', triple: 'riscv32-unknown-none-elf', cpu: '', march: 'rv32imac', features: '', freestanding: true, ptrBits: 32, substrate: 'fluidic' },
  'vacuum-riscv': { name: 'vacuum-riscv', triple: 'riscv64-unknown-none-elf', cpu: '', march: 'rv64imac', features: '', freestanding: true, ptrBits: 64, substrate: 'vacuum' },
  'holographic-wasm': { name: 'holographic-wasm', triple: 'wasm32-unknown-unknown', cpu: 'generic', march: '', features: '', freestanding: true, ptrBits: 32, substrate: 'holographic' },
  'plasma-arm': { name: 'plasma-arm', triple: 'thumbv7em-none-eabi', cpu: 'cortex-m4', march: 'armv7e-m', features: '', freestanding: true, ptrBits: 32, substrate: 'plasma' },
  'energy-riscv': { name: 'energy-riscv', triple: 'riscv32-unknown-none-elf', cpu: '', march: 'rv32imac', features: '', freestanding: true, ptrBits: 32, substrate: 'energy' },
};

export class LlvmError extends Error {}

export interface SType {
  name: string;
  llvm: string;
  kind: 'int' | 'float' | 'bool' | 'str' | 'void' | 'struct' | 'ptr' | 'array';
  bits?: number;
  signed?: boolean;
  elem?: SType;
  len?: number;
  fields?: Array<{ name: string; ty: SType }>;
}

const I64: SType = { name: 'i64', llvm: 'i64', kind: 'int', bits: 64, signed: true };
const I32: SType = { name: 'i32', llvm: 'i32', kind: 'int', bits: 32, signed: true };
const F64: SType = { name: 'f64', llvm: 'double', kind: 'float', bits: 64 };
const VOID: SType = { name: 'void', llvm: 'void', kind: 'void' };
const BOOL: SType = { name: 'bool', llvm: 'i1', kind: 'bool' };
const STR: SType = { name: 'str', llvm: 'ptr', kind: 'str' };
const PTR: SType = { name: 'ptr', llvm: 'ptr', kind: 'ptr' };

function intType(bits: number, signed: boolean): SType {
  return { name: `${signed ? 'i' : 'u'}${bits}`, llvm: `i${bits}`, kind: 'int', bits, signed };
}

const PRIM: Record<string, SType> = {
  i8: intType(8, true), u8: intType(8, false), char: intType(8, false),
  i16: intType(16, true), u16: intType(16, false),
  i32: intType(32, true), u32: intType(32, false),
  i64: intType(64, true), u64: intType(64, false),
  int: I64, isize: I64, usize: I64, long: I64,
  f32: { name: 'f32', llvm: 'float', kind: 'float', bits: 32 },
  f64: F64, float: F64,
  bool: BOOL, str: STR, string: STR, void: VOID,
};

export interface Value { ty: SType; val: string; }

export interface LlvmOptions { target: string; optLevel?: number; entry?: string; }
export interface LlvmResult { ir: string; target: TargetProfile; }

export function emitLlvm(program: A.Program, opts: LlvmOptions): LlvmResult {
  const target = TARGETS[opts.target];
  if (!target) throw new LlvmError(`unknown target '${opts.target}' (available: ${Object.keys(TARGETS).join(', ')})`);
  const gen = new LlvmGen(program, target, opts.optLevel ?? 2, opts.entry ?? 'main');
  return { ir: gen.generate(), target };
}

export class LlvmGen {
  private structs = new Map<string, SType>();
  private enums = new Map<string, string[]>();
  private fns = new Map<string, { params: SType[]; ret: SType; variadic: boolean; extern: boolean }>();
  private lines: string[] = [];
  private strings: string[] = [];
  private strCounter = 0;
  private regCounter = 0;
  private labelCounter = 0;
  private currentRet: SType = VOID;
  private locals = new Map<string, { ptr: string; ty: SType; mut: boolean }>();
  private loopStack: Array<{ brk: string; cont: string }> = [];
  private declares: string[] = [];
  private rangeEnd: string | null = null;
  private selfStruct: string | null = null;
  private globals = new Map<string, SType>();

  /** Evaluate a compile-time constant expression to an LLVM constant string. */
  private constEval(node: A.Node, ty: SType): string | null {
    switch (node.kind) {
      case 'NumLit': return ty.kind === 'float' ? this.floatLit(node.value) : String(Math.trunc(node.value));
      case 'BoolLit': return node.value ? '1' : '0';
      case 'StrLit': { const s = this.internString(node.value); return this.ptrToStrConst(s.name); }
      case 'UnaryOp': {
        const v = this.constEval(node.operand, ty);
        if (v === null) return null;
        if (node.op === '-') return ty.kind === 'float' ? `-${v}` : String(-Number(v));
        return v;
      }
      case 'BinOp': {
        const l = this.constEval(node.left, ty), r = this.constEval(node.right, ty);
        if (l === null || r === null) return null;
        if (ty.kind === 'float') {
          const a = Number(l), b = Number(r);
          return String(node.op === '+' ? a + b : node.op === '-' ? a - b : node.op === '*' ? a * b : node.op === '/' ? a / b : 0);
        }
        const a = Number(l), b = Number(r);
        const ops: Record<string, number> = { '+': a + b, '-': a - b, '*': a * b, '/': Math.trunc(a / b), '%': a % b, '<<': a << b, '>>': a >> b, '&': a & b, '|': a | b, '^': a ^ b };
        return ops[node.op] !== undefined ? String(ops[node.op]) : null;
      }
      case 'Ident': { const g = this.globals.get(node.name); return null; void g; }
      default: return null;
    }
  }

  private ptrToStrConst(name: string): string {
    return `getelementptr inbounds ([1 x i8], ptr ${name}, i64 0, i64 0)`;
  }

  private genGlobal(node: A.ConstDecl | A.VarDecl) {
    const ty = node.type ? this.resolveType(node.type) : this.inferType(node.init!);
    this.globals.set(node.name, ty);
    const isConst = node.kind === 'ConstDecl';
    const init = node.init ? this.constEval(node.init, ty) : null;
    const value = init !== null ? init : this.zero(ty);
    this.declares.push(`@${node.name} = ${isConst ? 'constant' : 'global'} ${ty.llvm} ${value}`);
  }

  constructor(private program: A.Program, private target: TargetProfile, private optLevel: number, private entry: string) {}

  private reg(): string { return `%t${this.regCounter++}`; }
  private label(p = 'L'): string { return `${p}.${this.labelCounter++}`; }
  private emit(line: string) { this.lines.push('  ' + line); }
  private emitRaw(line: string) { this.lines.push(line); }

  private internString(s: string): { name: string; len: number } {
    const idx = this.strCounter++;
    const name = `@.str.${idx}`;
    const bytes = [...new TextEncoder().encode(s)];
    const esc = bytes.map(b => {
      if (b === 0x22) return '\\22';
      if (b === 0x5c) return '\\5C';
      if (b >= 0x20 && b < 0x7f) return String.fromCharCode(b);
      return '\\' + b.toString(16).toUpperCase().padStart(2, '0');
    }).join('');
    this.strings.push(`${name} = private unnamed_addr constant [${bytes.length + 1} x i8] c"${esc}\\00", align 1`);
    return { name, len: bytes.length };
  }

  private gepStr(name: string): string {
    const r = this.reg();
    this.emit(`${r} = getelementptr inbounds i8, ptr ${name}, i64 0`);
    return r;
  }

  // ---------- type resolution ----------
  private resolveType(t: A.TypeNode | null): SType {
    if (!t) return I64;
    if (t.ptr || t.ref) return PTR;
    if (t.arrayLen !== null && t.arrayLen !== undefined) {
      const elem = this.resolveType({ ...t, arrayLen: null });
      return { name: `[${t.arrayLen} x ${elem.name}]`, llvm: `[${t.arrayLen} x ${elem.llvm}]`, kind: 'array', elem, len: t.arrayLen };
    }
    const base = PRIM[t.name];
    if (base) return base;
    if (t.name.startsWith('(')) return I64;
    if (this.structs.has(t.name)) return this.structs.get(t.name)!;
    if (this.enums.has(t.name)) return I64;
    return I64;
  }

  private fieldIndex(structName: string, field: string): { idx: number; ty: SType } | null {
    const st = this.structs.get(structName);
    if (!st || !st.fields) return null;
    for (let i = 0; i < st.fields.length; i++) if (st.fields[i].name === field) return { idx: i, ty: st.fields[i].ty };
    return null;
  }

  // ---------- program ----------
  generate(): string {
    this.collectTypes();
    this.collectFns();

    const bodyLines: string[] = [];
    for (const node of this.program.body) {
      if (node.kind === 'FnDecl') bodyLines.push(this.genFunction(node));
      else if (node.kind === 'ImplBlock') {
        for (const m of node.methods) bodyLines.push(this.genFunction(m, `${node.typeName}.${m.name}`));
      } else if (node.kind === 'ConstDecl' || (node.kind === 'VarDecl' && (node as A.VarDecl).type)) {
        this.genGlobal(node as A.ConstDecl | A.VarDecl);
      }
    }

    // Freestanding targets boot through the HAL's `_start`, which just calls the
    // user entry point and returns to the reset vector.
    if (this.target.freestanding && this.fns.has(`@${this.entry}`)) {
      bodyLines.push(`define void @_start() {\nentry:\n  call ${this.fns.get(`@${this.entry}`)!.ret.llvm} @${this.entry}()\n  ret void\n}\n`);
    }

    const header: string[] = [];
    header.push(`; SidAli -> LLVM IR`);
    header.push(`source_filename = "sidali"`);
    header.push(`target triple = "${this.target.triple}"`);
    header.push('');
    header.push('declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)');
    header.push('declare double @llvm.log.f64(double)');
    header.push('declare double @llvm.pow.f64(double, double)');
    if (this.target.freestanding) {
      const builtins: Array<[string, string]> = [
        ['sid_write', 'declare void @sid_write(ptr, i64)'],
        ['sid_read', 'declare i64 @sid_read()'],
        ['sid_mmio_write', 'declare void @sid_mmio_write(i64, i64)'],
        ['sid_mmio_read', 'declare i64 @sid_mmio_read(i64)'],
      ];
      for (const [fn, decl] of builtins) if (!this.fns.has(`@${fn}`)) header.push(decl);
    }
    header.push('');
    header.push(...this.declares);
    header.push('');
    header.push(...this.strings);
    header.push('');
    const fnDecls = [...this.fns.entries()]
      .filter(([, v]) => v.extern)
      .map(([name, v]) => `declare ${v.ret.llvm} ${name}(${v.params.map(p => p.llvm).join(', ')}${v.variadic ? (v.params.length ? ', ...' : '...') : ''})`);
    header.push(...fnDecls);
    header.push('');
    return [...header, ...bodyLines].join('\n') + '\n';
  }

  private collectTypes() {
    for (const node of this.program.body) {
      if (node.kind === 'StructDecl') {
        const fields: Array<{ name: string; ty: SType }> = [];
        for (const f of node.fields) fields.push({ name: f.name, ty: this.resolveType(f.type) });
        this.structs.set(node.name, { name: node.name, llvm: `%struct.${node.name}`, kind: 'struct', fields });
      } else if (node.kind === 'EnumDecl') {
        this.enums.set(node.name, node.variants.map(v => v.name));
      }
    }
    for (const [name, st] of this.structs) {
      const body = (st.fields || []).map(f => f.ty.llvm).join(', ');
      this.declares.push(`%struct.${name} = type { ${body} }`);
    }
  }

  private collectFns() {
    for (const node of this.program.body) {
      if (node.kind === 'FnDecl') {
        this.fns.set(`@${node.name}`, { params: node.params.map(p => this.resolveType(p.type)), ret: this.inferFnRet(node), variadic: false, extern: false });
      } else if (node.kind === 'ExternBlock') {
        for (const fn of node.items) {
          this.fns.set(`@${fn.name}`, { params: fn.params.map(p => this.resolveType(p.type)), ret: this.resolveType(fn.ret), variadic: false, extern: true });
        }
      } else if (node.kind === 'ImplBlock') {
        for (const m of node.methods) {
          this.fns.set(`@${node.typeName}.${m.name}`, { params: m.params.map(p => this.resolveType(p.type)), ret: this.inferFnRet(m), variadic: false, extern: false });
        }
      }
    }
    if (!this.target.freestanding) {
      if (!this.fns.has('@printf')) this.fns.set('@printf', { params: [PTR], ret: I32, variadic: true, extern: true });
      if (!this.fns.has('@snprintf')) this.fns.set('@snprintf', { params: [PTR, I64, PTR], ret: I32, variadic: true, extern: true });
      if (!this.fns.has('@puts')) this.fns.set('@puts', { params: [PTR], ret: I32, variadic: false, extern: true });
    }
  }

  // When no return type is declared, infer it from the first `return <expr>`.
  // Without this, a boolean-returning helper defaults to i64 and the emitted
  // `ret i64` clashes with the i1 the body produces. Functions with no
  // `return` keep the historical i64 default (main's exit code depends on it).
  private inferFnRet(fn: A.FnDecl): SType {
    if (fn.ret) return this.resolveType(fn.ret);
    const found = this.findReturn(fn.body);
    return found ? this.inferType(found) : I64;
  }

  private findReturn(node: A.Node | null): A.Node | null {
    if (!node) return null;
    switch (node.kind) {
      case 'ReturnStmt': return (node as A.ReturnStmt).value;
      case 'Block': for (const st of (node as A.Block).body) { const r = this.findReturn(st); if (r) return r; } return null;
      case 'IfStmt': {
        const i = node as A.IfStmt;
        return this.findReturn(i.then) || (i.else ? this.findReturn(i.else as A.Node) : null);
      }
      case 'WhileStmt': return this.findReturn((node as any).body);
      case 'ForStmt': return this.findReturn((node as any).body);
      case 'RepeatStmt': return this.findReturn((node as any).body);
      case 'TryStmt': {
        const t = node as any;
        return this.findReturn(t.body) || (t.catch ? this.findReturn(t.catch.body) : null) || (t.finalizer ? this.findReturn(t.finalizer) : null);
      }
      default: return null;
    }
  }

  private genFunction(fn: A.FnDecl, mangled?: string): string {
    const name = mangled || fn.name;
    const ret = this.inferFnRet(fn);
    const params = fn.params;
    const paramTys = params.map(p => this.resolveType(p.type));
    const selfType = mangled ? this.structs.get(mangled.split('.')[0]) : undefined;

    const savedLines = this.lines, savedLocals = this.locals, savedReg = this.regCounter, savedLabel = this.labelCounter, savedRet = this.currentRet, savedSelf = this.selfStruct;
    this.lines = [];
    this.locals = new Map();
    this.regCounter = 0;
    this.labelCounter = 0;
    this.currentRet = ret;
    this.selfStruct = selfType ? selfType.name : null;

    const argNames: string[] = [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p.self) { argNames.push(`ptr %self`); continue; }
      argNames.push(`${paramTys[i].llvm} %${p.name}`);
    }
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p.self) {
        const selfTy = selfType || PTR;
        this.locals.set('self', { ptr: '%self', ty: selfTy, mut: false });
        this.locals.set('this', { ptr: '%self', ty: selfTy, mut: false });
        continue;
      }
      const slot = `%${p.name}.addr`;
      this.emit(`${slot} = alloca ${paramTys[i].llvm}`);
      this.emit(`store ${paramTys[i].llvm} %${p.name}, ptr ${slot}`);
      this.locals.set(p.name, { ptr: slot, ty: paramTys[i], mut: true });
    }

    this.genBlock(fn.body);

    if (ret.llvm === 'void') this.emit('ret void');
    else if (ret.kind === 'float') this.emit(`ret ${ret.llvm} 0.0`);
    else if (ret.llvm === 'ptr') this.emit('ret ptr null');
    else if (ret.kind === 'struct' || ret.kind === 'array') this.emit(`ret ${ret.llvm} zeroinitializer`);
    else this.emit(`ret ${ret.llvm} 0`);

    const body = this.lines;
    this.lines = savedLines;
    this.locals = savedLocals;
    this.regCounter = savedReg;
    this.labelCounter = savedLabel;
    this.currentRet = savedRet;
    this.selfStruct = savedSelf;

    return [`define ${ret.llvm} @${name}(${argNames.join(', ')}) {`, 'entry:', ...body, '}', ''].join('\n');
  }

  private genBlock(block: A.Block) { for (const st of block.body) this.genStmt(st); }

  // ---------- statements ----------
  private genStmt(node: A.Node) {
    switch (node.kind) {
      case 'VarDecl': case 'ConstDecl': {
        const decl = node as A.VarDecl;
        const ty = decl.type ? this.resolveType(decl.type) : (decl.init ? this.inferType(decl.init) : I64);
        const slot = `%${decl.name}.addr.${this.regCounter}`;
        this.emit(`${slot} = alloca ${ty.llvm}`);
        if (decl.init) {
          // Arrays are value types. A literal lowers to a pointer to its own
          // storage, so a plain `store` would store the pointer. Copy the
          // elements into the declared slot instead.
          const lit = decl.init.kind === 'ArrayLit' ? decl.init as A.ArrayLit : null;
          if (ty.kind === 'array' && ty.elem && lit && lit.items.length === ty.len) {
            for (let i = 0; i < lit.items.length; i++) {
              const ev = this.coerce(this.genExpr(lit.items[i], ty.elem), ty.elem);
              const ep = this.reg();
              this.emit(`${ep} = getelementptr inbounds ${ty.llvm}, ptr ${slot}, i64 0, i64 ${i}`);
              this.emit(`store ${ty.elem.llvm} ${ev.val}, ptr ${ep}`);
            }
          } else {
            const v = this.coerce(this.genExpr(decl.init, ty), ty);
            this.emit(`store ${ty.llvm} ${v.val}, ptr ${slot}`);
          }
        } else {
          this.emit(`store ${ty.llvm} ${this.zero(ty)}, ptr ${slot}`);
        }
        this.locals.set(decl.name, { ptr: slot, ty, mut: !!(decl as any).mut });
        break;
      }
      case 'ExprStmt': { this.genExpr(node.expr); break; }
      case 'PrintStmt': { this.genPrint(node); break; }
      case 'ReturnStmt': {
        if (node.value) {
          const v = this.coerce(this.genExpr(node.value, this.currentRet), this.currentRet);
          this.emit(`ret ${this.currentRet.llvm} ${v.val}`);
        } else if (this.currentRet.llvm === 'void') this.emit('ret void');
        else if (this.currentRet.kind === 'float') this.emit(`ret ${this.currentRet.llvm} 0.0`);
        else this.emit(`ret ${this.currentRet.llvm} 0`);
        break;
      }
      case 'IfStmt': {
        const c = this.toBool(this.genExpr(node.cond, BOOL));
        const thenL = this.label('if.then'), elseL = this.label('if.else'), endL = this.label('if.end');
        this.emit(`br i1 ${c.val}, label %${thenL}, label %${node.else ? elseL : endL}`);
        this.emitRaw(`${thenL}:`);
        this.genBlock(node.then);
        this.emit(`br label %${endL}`);
        if (node.else) {
          this.emitRaw(`${elseL}:`);
          if ((node.else as A.IfStmt).kind === 'IfStmt') this.genStmt(node.else as A.Node);
          else this.genBlock(node.else as A.Block);
          this.emit(`br label %${endL}`);
        }
        this.emitRaw(`${endL}:`);
        break;
      }
      case 'WhileStmt': {
        const condL = this.label('while.cond'), bodyL = this.label('while.body'), endL = this.label('while.end');
        this.emit(`br label %${condL}`);
        this.emitRaw(`${condL}:`);
        const c = this.toBool(this.genExpr(node.cond, BOOL));
        this.emit(`br i1 ${c.val}, label %${bodyL}, label %${endL}`);
        this.emitRaw(`${bodyL}:`);
        this.loopStack.push({ brk: endL, cont: condL });
        this.genBlock(node.body);
        this.loopStack.pop();
        this.emit(`br label %${condL}`);
        this.emitRaw(`${endL}:`);
        break;
      }
      case 'RepeatStmt': {
        const count = this.genExpr(node.count, I64);
        const slot = `%rep.n.${this.regCounter}`;
        this.emit(`${slot} = alloca i64`);
        this.emit(`store i64 ${count.val}, ptr ${slot}`);
        const idx = `%rep.i.${this.regCounter}`;
        this.emit(`${idx} = alloca i64`);
        this.emit(`store i64 0, ptr ${idx}`);
        const condL = this.label('rep.cond'), bodyL = this.label('rep.body'), endL = this.label('rep.end');
        this.emit(`br label %${condL}`);
        this.emitRaw(`${condL}:`);
        const i0 = this.reg(); this.emit(`${i0} = load i64, ptr ${idx}`);
        const n0 = this.reg(); this.emit(`${n0} = load i64, ptr ${slot}`);
        const cmp = this.reg(); this.emit(`${cmp} = icmp slt i64 ${i0}, ${n0}`);
        this.emit(`br i1 ${cmp}, label %${bodyL}, label %${endL}`);
        this.emitRaw(`${bodyL}:`);
        this.loopStack.push({ brk: endL, cont: condL });
        this.genBlock(node.body);
        this.loopStack.pop();
        const i1 = this.reg(); this.emit(`${i1} = load i64, ptr ${idx}`);
        const i2 = this.reg(); this.emit(`${i2} = add i64 ${i1}, 1`);
        this.emit(`store i64 ${i2}, ptr ${idx}`);
        this.emit(`br label %${condL}`);
        this.emitRaw(`${endL}:`);
        break;
      }
      case 'ForStmt': { this.genFor(node); break; }
      case 'BreakStmt': { const l = this.loopStack[this.loopStack.length - 1]; if (l) this.emit(`br label %${l.brk}`); break; }
      case 'ContinueStmt': { const l = this.loopStack[this.loopStack.length - 1]; if (l) this.emit(`br label %${l.cont}`); break; }
      case 'UnsafeBlock': { this.genBlock(node.body); break; }
      case 'MatchStmt': { this.genMatch(node); break; }
      case 'Block': { this.genBlock(node); break; }
      case 'ContractDecl': { this.genBlock(node.body); break; }
      case 'TryStmt': { this.genBlock(node.body); if (node.finalizer) this.genBlock(node.finalizer); break; }
      case 'ImportStmt': { break; } // resolved by the driver before lowering
      default: { this.genExpr(node); }
    }
  }

  private zero(ty: SType): string {
    if (ty.kind === 'float') return '0.0';
    if (ty.llvm === 'ptr') return 'null';
    if (ty.kind === 'array' || ty.kind === 'struct') return 'zeroinitializer';
    return '0';
  }

  private genFor(node: A.ForStmt) {
    const iter = this.genExpr(node.iter);
    if (iter.ty.kind === 'array' && iter.ty.elem) {
      const elemTy = iter.ty.elem;
      const arrSlot = `%for.arr.${this.regCounter}`;
      this.emit(`${arrSlot} = alloca ptr`);
      this.emit(`store ptr ${iter.val}, ptr ${arrSlot}`);
      const idx = `%for.i.${this.regCounter}`;
      this.emit(`${idx} = alloca i64`);
      this.emit(`store i64 0, ptr ${idx}`);
      const slot = `%${node.varName}.addr.${this.regCounter}`;
      this.emit(`${slot} = alloca ${elemTy.llvm}`);
      this.locals.set(node.varName, { ptr: slot, ty: elemTy, mut: false });
      const condL = this.label('for.cond'), bodyL = this.label('for.body'), endL = this.label('for.end');
      this.emit(`br label %${condL}`);
      this.emitRaw(`${condL}:`);
      const i0 = this.reg(); this.emit(`${i0} = load i64, ptr ${idx}`);
      const c = this.reg(); this.emit(`${c} = icmp slt i64 ${i0}, ${iter.ty.len}`);
      this.emit(`br i1 ${c}, label %${bodyL}, label %${endL}`);
      this.emitRaw(`${bodyL}:`);
      const p = this.reg(); this.emit(`${p} = load ptr, ptr ${arrSlot}`);
      const ep = this.reg(); this.emit(`${ep} = getelementptr inbounds ${elemTy.llvm}, ptr ${p}, i64 ${i0}`);
      const ev = this.reg(); this.emit(`${ev} = load ${elemTy.llvm}, ptr ${ep}`);
      this.emit(`store ${elemTy.llvm} ${ev}, ptr ${slot}`);
      this.loopStack.push({ brk: endL, cont: condL });
      this.genBlock(node.body);
      this.loopStack.pop();
      const i1 = this.reg(); this.emit(`${i1} = load i64, ptr ${idx}`);
      const i2 = this.reg(); this.emit(`${i2} = add i64 ${i1}, 1`);
      this.emit(`store i64 ${i2}, ptr ${idx}`);
      this.emit(`br label %${condL}`);
      this.emitRaw(`${endL}:`);
      return;
    }
    // numeric range loop: for i in start..end
    const startV = iter;
    const endV = this.rangeEnd ?? '0';
    this.rangeEnd = null;
    const slot = `%${node.varName}.addr.${this.regCounter}`;
    this.emit(`${slot} = alloca i64`);
    this.emit(`store i64 ${startV.val}, ptr ${slot}`);
    this.locals.set(node.varName, { ptr: slot, ty: I64, mut: false });
    const limit = `%for.lim.${this.regCounter}`;
    this.emit(`${limit} = alloca i64`);
    this.emit(`store i64 ${endV}, ptr ${limit}`);
    const condL = this.label('for.cond'), bodyL = this.label('for.body'), endL = this.label('for.end');
    this.emit(`br label %${condL}`);
    this.emitRaw(`${condL}:`);
    const i0 = this.reg(); this.emit(`${i0} = load i64, ptr ${slot}`);
    const n0 = this.reg(); this.emit(`${n0} = load i64, ptr ${limit}`);
    const c = this.reg(); this.emit(`${c} = icmp slt i64 ${i0}, ${n0}`);
    this.emit(`br i1 ${c}, label %${bodyL}, label %${endL}`);
    this.emitRaw(`${bodyL}:`);
    this.loopStack.push({ brk: endL, cont: condL });
    this.genBlock(node.body);
    this.loopStack.pop();
    const i1 = this.reg(); this.emit(`${i1} = load i64, ptr ${slot}`);
    const i2 = this.reg(); this.emit(`${i2} = add i64 ${i1}, 1`);
    this.emit(`store i64 ${i2}, ptr ${slot}`);
    this.emit(`br label %${condL}`);
    this.emitRaw(`${endL}:`);
  }

  private genMatch(node: A.MatchStmt) {
    const val = this.genExpr(node.value);
    const slot = `%match.${this.regCounter}`;
    this.emit(`${slot} = alloca ${val.ty.llvm}`);
    this.emit(`store ${val.ty.llvm} ${val.val}, ptr ${slot}`);
    const endL = this.label('match.end');
    for (const arm of node.arms) {
      if (arm.pattern === '_') { this.genBlock(arm.body); this.emit(`br label %${endL}`); continue; }
      const cur = this.reg(); this.emit(`${cur} = load ${val.ty.llvm}, ptr ${slot}`);
      let condVal: string;
      if (arm.pattern === 'literal') {
        let acc: string | null = null;
        for (const lit of arm.literals) {
          const lv = this.coerce(this.genExpr(lit, val.ty), val.ty);
          const cmp = this.reg();
          if (val.ty.kind === 'float') this.emit(`${cmp} = fcmp oeq ${val.ty.llvm} ${cur}, ${lv.val}`);
          else this.emit(`${cmp} = icmp eq ${val.ty.llvm} ${cur}, ${lv.val}`);
          if (acc === null) acc = cmp;
          else { const orr = this.reg(); this.emit(`${orr} = or i1 ${acc}, ${cmp}`); acc = orr; }
        }
        condVal = acc!;
      } else {
        const enumName = this.enumForVariant(arm.pattern);
        const ord = enumName ? this.enums.get(enumName)!.indexOf(arm.pattern) : 0;
        const cmp = this.reg(); this.emit(`${cmp} = icmp eq ${val.ty.llvm} ${cur}, ${ord}`);
        condVal = cmp;
      }
      const hitL = this.label('match.hit'), nextL = this.label('match.next');
      this.emit(`br i1 ${condVal}, label %${hitL}, label %${nextL}`);
      this.emitRaw(`${hitL}:`);
      this.genBlock(arm.body);
      this.emit(`br label %${endL}`);
      this.emitRaw(`${nextL}:`);
    }
    this.emitRaw(`${endL}:`);
  }

  private enumForVariant(variant: string): string | null {
    for (const [name, variants] of this.enums) if (variants.includes(variant)) return name;
    return null;
  }

  // ---------- expressions ----------
  private inferType(node: A.Node): SType {
    switch (node.kind) {
      case 'NumLit': return Number.isInteger(node.value) ? I64 : F64;
      case 'StrLit': case 'InterpStr': return STR;
      case 'BoolLit': return BOOL;
      case 'ArrayLit': {
        const elem = node.items.length ? this.inferType(node.items[0]) : I64;
        return { name: `[${node.items.length} x ${elem.name}]`, llvm: `[${node.items.length} x ${elem.llvm}]`, kind: 'array', elem, len: node.items.length };
      }
      case 'ObjectLit': return node.typeName && this.structs.has(node.typeName) ? this.structs.get(node.typeName)! : PTR;
      case 'BinOp': {
        if (['==', '!=', '<', '>', '<=', '>=', '&&', '||'].includes(node.op)) return BOOL;
        const l = this.inferType(node.left), r = this.inferType(node.right);
        if (l.kind === 'float' || r.kind === 'float') return F64;
        if (l.kind === 'str') return l;
        if (r.kind === 'str') return r;
        return l.kind === 'int' ? l : r;
      }
      case 'UnaryOp': return node.op === '!' ? BOOL : this.inferType(node.operand);
      case 'Call': {
        if (node.callee.kind === 'Ident') { const f = this.fns.get(`@${node.callee.name}`); if (f) return f.ret; }
        if (node.callee.kind === 'Member') {
          const objTy = this.inferType(node.callee.object);
          const f = this.fns.get(`@${objTy.name}.${node.callee.property}`);
          if (f) return f.ret;
        }
        return I64;
      }
      case 'Cast': return this.resolveType(node.type);
      case 'Ident': { const l = this.locals.get(node.name); return l ? l.ty : I64; }
      case 'RefExpr': return PTR;
      case 'Ternary': return this.inferType(node.then);
      default: return I64;
    }
  }

  private toBool(v: Value): Value {
    if (v.ty.kind === 'bool') return v;
    const r = this.reg();
    if (v.ty.kind === 'int') this.emit(`${r} = icmp ne ${v.ty.llvm} ${v.val}, 0`);
    else if (v.ty.kind === 'float') this.emit(`${r} = fcmp one ${v.ty.llvm} ${v.val}, 0.0`);
    else this.emit(`${r} = icmp ne ptr ${v.val}, null`);
    return { ty: BOOL, val: r };
  }

  private coerce(v: Value, to: SType): Value {
    if (v.ty.llvm === to.llvm) return v;
    if (to.kind === 'bool') return this.toBool(v);
    if (to.kind === 'int' && v.ty.kind === 'int') {
      const from = v.ty.bits ?? 64, toB = to.bits ?? 64;
      if (from === toB) return v;
      const r = this.reg();
      if (from < toB) this.emit(`${r} = sext i${from} ${v.val} to i${toB}`);
      else this.emit(`${r} = trunc i${from} ${v.val} to i${toB}`);
      return { ty: to, val: r };
    }
    if (to.kind === 'float' && v.ty.kind === 'int') {
      const r = this.reg(); this.emit(`${r} = sitofp ${v.ty.llvm} ${v.val} to ${to.llvm}`); return { ty: to, val: r };
    }
    if (to.kind === 'int' && v.ty.kind === 'float') {
      const r = this.reg(); this.emit(`${r} = fptosi ${v.ty.llvm} ${v.val} to ${to.llvm}`); return { ty: to, val: r };
    }
    if (to.llvm === 'ptr' && v.ty.kind === 'int') {
      const r = this.reg(); this.emit(`${r} = inttoptr ${v.ty.llvm} ${v.val} to ptr`); return { ty: PTR, val: r };
    }
    if (to.kind === 'int' && v.ty.llvm === 'ptr') {
      const r = this.reg(); this.emit(`${r} = ptrtoint ptr ${v.val} to ${to.llvm}`); return { ty: to, val: r };
    }
    if (to.llvm === 'ptr' && v.ty.llvm === 'ptr') return { ty: PTR, val: v.val };
    if (to.llvm === 'ptr') { const r = this.reg(); this.emit(`${r} = inttoptr i64 ${v.val} to ptr`); return { ty: PTR, val: r }; }
    return v;
  }

  private genExpr(node: A.Node, hint?: SType): Value {
    switch (node.kind) {
      case 'NumLit': {
        const ty = hint && hint.kind === 'float' ? hint : (Number.isInteger(node.value) ? (hint && hint.kind === 'int' ? hint : I64) : F64);
        const lit = ty.kind === 'float' ? this.floatLit(node.value) : String(Math.trunc(node.value));
        return { ty, val: lit };
      }
      case 'StrLit': { const s = this.internString(node.value); return { ty: STR, val: this.gepStr(s.name) }; }
      case 'BoolLit': return { ty: BOOL, val: node.value ? '1' : '0' };
      case 'NilLit': return { ty: PTR, val: 'null' };
      case 'InterpStr': return this.genInterp(node);
      case 'Ident': return this.genIdent(node);
      case 'ArrayLit': return this.genArrayLit(node);
      case 'ObjectLit': return this.genObjectLit(node);
      case 'BinOp': return this.genBinOp(node);
      case 'UnaryOp': return this.genUnary(node);
      case 'Assign': return this.genAssign(node);
      case 'Call': return this.genCall(node);
      case 'Cast': return this.coerce(this.genExpr(node.value), this.resolveType(node.type));
      case 'RefExpr': {
        const lv = this.lvaluePtr(node.value);
        if (lv) return { ty: PTR, val: lv.ptr };
        const v = this.genExpr(node.value);
        const slot = `%ref.${this.regCounter}`;
        this.emit(`${slot} = alloca ${v.ty.llvm}`);
        this.emit(`store ${v.ty.llvm} ${v.val}, ptr ${slot}`);
        return { ty: PTR, val: slot };
      }
      case 'Deref': {
        const v = this.genExpr(node.value);
        const r = this.reg(); this.emit(`${r} = load i64, ptr ${v.val}`);
        return { ty: I64, val: r };
      }
      case 'Ternary': {
        const c = this.toBool(this.genExpr(node.cond, BOOL));
        const ty = hint || this.inferType(node.then);
        const a = this.coerce(this.genExpr(node.then, ty), ty);
        const b = this.coerce(this.genExpr(node.else, ty), ty);
        const r = this.reg();
        this.emit(`${r} = select i1 ${c.val}, ${ty.llvm} ${a.val}, ${ty.llvm} ${b.val}`);
        return { ty, val: r };
      }
      case 'RangeExpr': {
        const start = node.start ? this.coerce(this.genExpr(node.start, I64), I64) : { ty: I64, val: '0' };
        const end = node.end ? this.coerce(this.genExpr(node.end, I64), I64) : { ty: I64, val: '0' };
        if (node.inclusive) {
          const e = this.reg(); this.emit(`${e} = add i64 ${end.val}, 1`);
          this.rangeEnd = e;
        } else {
          this.rangeEnd = end.val;
        }
        return { ty: I64, val: start.val };
      }
      case 'Member': return this.genMember(node);
      case 'Index': return this.genIndex(node);
      case 'NewExpr': return this.genNew(node);
      case 'Lambda': return { ty: PTR, val: 'null' };
      case 'Transcendental': {
        const arg = this.coerce(this.genExpr(node.arg), F64);
        const r = this.reg();
        if (node.symbol === 'pi') this.emit(`${r} = fmul double ${arg.val}, 0x400921FB54442D18`);
        else this.emit(`${r} = call double @llvm.log.f64(double ${arg.val})`);
        return { ty: F64, val: r };
      }
      default:
        throw new LlvmError(`cannot lower '${(node as any).kind}' to LLVM IR`);
    }
  }

  private floatLit(n: number): string {
    if (!isFinite(n)) return n > 0 ? '0x7FF0000000000000' : '0xFFF0000000000000';
    return n.toString();
  }

  private genIdent(node: A.Ident): Value {
    const l = this.locals.get(node.name);
    if (l) { const r = this.reg(); this.emit(`${r} = load ${l.ty.llvm}, ptr ${l.ptr}`); return { ty: l.ty, val: r }; }
    if (node.name === 'PI') return { ty: F64, val: '0x400921FB54442D18' };
    if (node.name === 'E') return { ty: F64, val: '0x4005BF0A8B145769' };
    if (node.name === 'true') return { ty: BOOL, val: '1' };
    if (node.name === 'false') return { ty: BOOL, val: '0' };
    if (node.name === 'nil') return { ty: PTR, val: 'null' };
    if (this.globals.has(node.name)) {
      const gty = this.globals.get(node.name)!;
      const r = this.reg(); this.emit(`${r} = load ${gty.llvm}, ptr @${node.name}`);
      return { ty: gty, val: r };
    }
    if (this.fns.has(`@${node.name}`)) return { ty: PTR, val: `@${node.name}` };
    throw new LlvmError(`undefined variable '${node.name}'`);
  }

  private genArrayLit(node: A.ArrayLit): Value {
    const elemTy = node.items.length ? this.inferType(node.items[0]) : I64;
    const arrTy: SType = { name: `[${node.items.length} x ${elemTy.name}]`, llvm: `[${node.items.length} x ${elemTy.llvm}]`, kind: 'array', elem: elemTy, len: node.items.length };
    const slot = `%arr.${this.regCounter}`;
    this.emit(`${slot} = alloca ${arrTy.llvm}`);
    for (let i = 0; i < node.items.length; i++) {
      const v = this.coerce(this.genExpr(node.items[i], elemTy), elemTy);
      const ep = this.reg();
      this.emit(`${ep} = getelementptr inbounds ${arrTy.llvm}, ptr ${slot}, i64 0, i64 ${i}`);
      this.emit(`store ${elemTy.llvm} ${v.val}, ptr ${ep}`);
    }
    return { ty: arrTy, val: slot };
  }

  private genObjectLit(node: A.ObjectLit): Value {
    if (!node.typeName) return { ty: PTR, val: 'null' };
    const st = this.structs.get(node.typeName);
    if (!st) throw new LlvmError(`unknown struct '${node.typeName}'`);
    const slot = `%obj.${this.regCounter}`;
    this.emit(`${slot} = alloca ${st.llvm}`);
    this.emit(`store ${st.llvm} zeroinitializer, ptr ${slot}`);
    for (const e of node.entries) {
      const fi = this.fieldIndex(node.typeName, e.key);
      if (!fi) continue;
      const v = this.coerce(this.genExpr(e.value, fi.ty), fi.ty);
      const fp = this.reg();
      this.emit(`${fp} = getelementptr inbounds ${st.llvm}, ptr ${slot}, i32 0, i32 ${fi.idx}`);
      this.emit(`store ${fi.ty.llvm} ${v.val}, ptr ${fp}`);
    }
    const r = this.reg(); this.emit(`${r} = load ${st.llvm}, ptr ${slot}`);
    return { ty: st, val: r };
  }

  private genMember(node: A.Member): Value {
    // enum path: Color::Green -> ordinal
    if (node.object.kind === 'Ident' && this.enums.has((node.object as A.Ident).name)) {
      const variants = this.enums.get((node.object as A.Ident).name)!;
      const ord = variants.indexOf(node.property);
      if (ord >= 0) return { ty: I64, val: String(ord) };
    }
    // struct field
    const lv = this.lvaluePtr(node.object);
    if (lv && lv.ty.kind === 'struct') {
      const fi = this.fieldIndex(lv.ty.name, node.property);
      if (fi) {
        const fp = this.reg();
        this.emit(`${fp} = getelementptr inbounds ${lv.ty.llvm}, ptr ${lv.ptr}, i32 0, i32 ${fi.idx}`);
        const r = this.reg(); this.emit(`${r} = load ${fi.ty.llvm}, ptr ${fp}`);
        return { ty: fi.ty, val: r };
      }
    }
    const obj = this.genExpr(node.object);
    if (obj.ty.kind === 'struct' && obj.ty.fields) {
      const fi = this.fieldIndex(obj.ty.name, node.property);
      if (fi) {
        const base = `%fld.${this.regCounter}`;
        this.emit(`${base} = alloca ${obj.ty.llvm}`);
        this.emit(`store ${obj.ty.llvm} ${obj.val}, ptr ${base}`);
        const fp = this.reg();
        this.emit(`${fp} = getelementptr inbounds ${obj.ty.llvm}, ptr ${base}, i32 0, i32 ${fi.idx}`);
        const r = this.reg(); this.emit(`${r} = load ${fi.ty.llvm}, ptr ${fp}`);
        return { ty: fi.ty, val: r };
      }
    }
    // .len / .length
    if (node.property === 'len' || node.property === 'length') {
      if (obj.ty.kind === 'array') return { ty: I64, val: String(obj.ty.len) };
    }
    return { ty: I64, val: '0' };
  }

  private genIndex(node: A.Index): Value {
    const lv = this.lvaluePtr(node.object);
    const idx = this.coerce(this.genExpr(node.index, I64), I64);
    if (lv && lv.ty.kind === 'array' && lv.ty.elem) {
      const ep = this.reg();
      this.emit(`${ep} = getelementptr inbounds ${lv.ty.llvm}, ptr ${lv.ptr}, i64 0, i64 ${idx.val}`);
      const r = this.reg(); this.emit(`${r} = load ${lv.ty.elem.llvm}, ptr ${ep}`);
      return { ty: lv.ty.elem, val: r };
    }
    const obj = this.genExpr(node.object);
    if (obj.ty.kind === 'array' && obj.ty.elem) {
      const ep = this.reg();
      this.emit(`${ep} = getelementptr inbounds ${obj.ty.llvm}, ptr ${obj.val}, i64 0, i64 ${idx.val}`);
      const r = this.reg(); this.emit(`${r} = load ${obj.ty.elem.llvm}, ptr ${ep}`);
      return { ty: obj.ty.elem, val: r };
    }
    if (obj.ty.llvm === 'ptr') {
      const ep = this.reg();
      this.emit(`${ep} = getelementptr inbounds i64, ptr ${obj.val}, i64 ${idx.val}`);
      const r = this.reg(); this.emit(`${r} = load i64, ptr ${ep}`);
      return { ty: I64, val: r };
    }
    return { ty: I64, val: '0' };
  }

  private genNew(node: A.NewExpr): Value {
    const st = this.structs.get(node.className);
    if (st) return this.genObjectLit({ kind: 'ObjectLit', entries: [], typeName: node.className });
    return { ty: PTR, val: 'null' };
  }

  private genBinOp(node: A.BinOp): Value {
    const op = node.op;
    if (op === '&&' || op === '||') {
      const l = this.toBool(this.genExpr(node.left, BOOL));
      const r = this.toBool(this.genExpr(node.right, BOOL));
      const res = this.reg();
      this.emit(`${res} = ${op === '&&' ? 'and' : 'or'} i1 ${l.val}, ${r.val}`);
      return { ty: BOOL, val: res };
    }
    const l = this.genExpr(node.left);
    let ty = l.ty;
    const r0 = this.genExpr(node.right, l.ty.kind === 'float' ? l.ty : undefined);
    let lv = l, rv = r0;
    // Array concatenation: materialize a new fixed array of both lengths.
    if (op === '+' && l.ty.kind === 'array' && r0.ty.kind === 'array' && l.ty.elem && r0.ty.elem) {
      const elem = l.ty.elem;
      const n = (l.ty.len || 0) + (r0.ty.len || 0);
      const arrTy: SType = { name: `[${n} x ${elem.name}]`, llvm: `[${n} x ${elem.llvm}]`, kind: 'array', elem, len: n };
      const slot = `%cat.${this.regCounter}`;
      this.emit(`${slot} = alloca ${arrTy.llvm}`);
      let i = 0;
      for (let k = 0; k < (l.ty.len || 0); k++, i++) {
        const dp = this.reg(); this.emit(`${dp} = getelementptr inbounds ${arrTy.llvm}, ptr ${slot}, i64 0, i64 ${i}`);
        const sp = this.reg(); this.emit(`${sp} = getelementptr inbounds ${l.ty.llvm}, ptr ${l.val}, i64 0, i64 ${k}`);
        const ev = this.reg(); this.emit(`${ev} = load ${elem.llvm}, ptr ${sp}`);
        this.emit(`store ${elem.llvm} ${ev}, ptr ${dp}`);
      }
      for (let k = 0; k < (r0.ty.len || 0); k++, i++) {
        const dp = this.reg(); this.emit(`${dp} = getelementptr inbounds ${arrTy.llvm}, ptr ${slot}, i64 0, i64 ${i}`);
        const sp = this.reg(); this.emit(`${sp} = getelementptr inbounds ${r0.ty.llvm}, ptr ${r0.val}, i64 0, i64 ${k}`);
        const ev = this.reg(); this.emit(`${ev} = load ${elem.llvm}, ptr ${sp}`);
        this.emit(`store ${elem.llvm} ${ev}, ptr ${dp}`);
      }
      return { ty: arrTy, val: slot };
    }
    if (l.ty.kind === 'float' || r0.ty.kind === 'float') {
      const fty: SType = l.ty.kind === 'float' ? l.ty : (r0.ty.kind === 'float' ? r0.ty : F64);
      lv = this.coerce(l, fty); rv = this.coerce(r0, fty); ty = fty;
    } else if (l.ty.kind === 'str' || r0.ty.kind === 'str') {
      ty = STR;
    } else if (l.ty.kind === 'int') {
      ty = l.ty;
      rv = this.coerce(r0, l.ty);
    } else {
      ty = r0.ty; lv = this.coerce(l, r0.ty);
    }
    const r = this.reg();
    const isCmp = ['==', '!=', '<', '>', '<=', '>='].includes(op);
    if (ty.kind === 'float') {
      const fop: Record<string, string> = { '==': 'oeq', '!=': 'one', '<': 'olt', '>': 'ogt', '<=': 'ole', '>=': 'oge' };
      if (fop[op]) { this.emit(`${r} = fcmp ${fop[op]} ${ty.llvm} ${lv.val}, ${rv.val}`); return { ty: BOOL, val: r }; }
      if (op === '+') this.emit(`${r} = fadd ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === '-') this.emit(`${r} = fsub ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === '*') this.emit(`${r} = fmul ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === '/') this.emit(`${r} = fdiv ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === '%') this.emit(`${r} = frem ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === '**') this.emit(`${r} = call double @llvm.pow.f64(double ${lv.val}, double ${rv.val})`);
      return { ty, val: r };
    }
    if (ty.kind === 'str') {
      if (op === '+') { /* string concat unsupported at IR level: return left */ return l; }
      if (isCmp) { this.emit(`${r} = icmp eq ptr ${lv.val}, ${rv.val}`); return { ty: BOOL, val: r }; }
      return l;
    }
    // integer
    const signed = ty.signed !== false;
    const cmpOp: Record<string, string> = {
      '==': 'eq', '!=': 'ne',
      '<': signed ? 'slt' : 'ult', '>': signed ? 'sgt' : 'ugt',
      '<=': signed ? 'sle' : 'ule', '>=': signed ? 'sge' : 'uge',
    };
    if (cmpOp[op]) { this.emit(`${r} = icmp ${cmpOp[op]} ${ty.llvm} ${lv.val}, ${rv.val}`); return { ty: BOOL, val: r }; }
    if (op === '+') this.emit(`${r} = add ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '-') this.emit(`${r} = sub ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '*') this.emit(`${r} = mul ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '/') this.emit(`${r} = ${signed ? 'sdiv' : 'udiv'} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '%') this.emit(`${r} = ${signed ? 'srem' : 'urem'} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '**') {
      const fl = this.reg(), fr = this.reg(), fp = this.reg(), fi = this.reg();
      this.emit(`${fl} = sitofp ${ty.llvm} ${lv.val} to double`);
      this.emit(`${fr} = sitofp ${ty.llvm} ${rv.val} to double`);
      this.emit(`${fp} = call double @llvm.pow.f64(double ${fl}, double ${fr})`);
      this.emit(`${fi} = fptosi double ${fp} to ${ty.llvm}`);
      return { ty, val: fi };
    }
    else if (op === '&') this.emit(`${r} = and ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '|') this.emit(`${r} = or ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '^') this.emit(`${r} = xor ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '<<') this.emit(`${r} = shl ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '>>') this.emit(`${r} = ${signed ? 'ashr' : 'lshr'} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else return l;
    return { ty, val: r };
  }

  private genUnary(node: A.UnaryOp): Value {
    const v = this.genExpr(node.operand);
    const r = this.reg();
    if (node.op === '!') { const b = this.toBool(v); this.emit(`${r} = xor i1 ${b.val}, true`); return { ty: BOOL, val: r }; }
    if (node.op === '-') {
      if (v.ty.kind === 'float') this.emit(`${r} = fneg ${v.ty.llvm} ${v.val}`);
      else this.emit(`${r} = sub ${v.ty.llvm} 0, ${v.val}`);
      return { ty: v.ty, val: r };
    }
    if (node.op === '+') return v;
    if (node.op === '~') { this.emit(`${r} = xor ${v.ty.llvm} ${v.val}, -1`); return { ty: v.ty, val: r }; }
    return v;
  }

  private genAssign(node: A.Assign): Value {
    const lv = this.lvaluePtr(node.target);
    if (!lv) throw new LlvmError(`cannot assign to this expression`);
    let v: Value;
    if (node.op === '=') v = this.coerce(this.genExpr(node.value, lv.ty), lv.ty);
    else {
      const binOp = node.op[0];
      const cur = this.reg(); this.emit(`${cur} = load ${lv.ty.llvm}, ptr ${lv.ptr}`);
      const rhs = this.coerce(this.genExpr(node.value, lv.ty), lv.ty);
      v = this.genBinOpValues(binOp, { ty: lv.ty, val: cur }, rhs);
    }
    // Fixed arrays are value types whose length is part of the type; a
    // mismatched store would emit IR clang rejects, so fail loudly instead.
    if (lv.ty.kind === 'array' && v.ty.kind === 'array' && lv.ty.llvm !== v.ty.llvm) {
      throw new LlvmError(`array size mismatch: cannot store ${v.ty.name} into ${lv.ty.name}`);
    }
    this.emit(`store ${lv.ty.llvm} ${v.val}, ptr ${lv.ptr}`);
    return v;
  }

  private genBinOpValues(op: string, l: Value, r0: Value): Value {
    let ty = l.ty; let lv = l; let rv = r0;
    if (l.ty.kind === 'float' || r0.ty.kind === 'float') {
      const fty: SType = l.ty.kind === 'float' ? l.ty : (r0.ty.kind === 'float' ? r0.ty : F64);
      lv = this.coerce(l, fty); rv = this.coerce(r0, fty); ty = fty;
    } else if (l.ty.kind === 'int') { ty = l.ty; rv = this.coerce(r0, l.ty); }
    const r = this.reg();
    const cmpOp: Record<string, string> = {
      '==': 'eq', '!=': 'ne',
      '<': ty.signed !== false ? 'slt' : 'ult', '>': ty.signed !== false ? 'sgt' : 'ugt',
      '<=': ty.signed !== false ? 'sle' : 'ule', '>=': ty.signed !== false ? 'sge' : 'uge',
    };
    if (ty.kind === 'float') {
      const fop: Record<string, string> = { '==': 'oeq', '!=': 'one', '<': 'olt', '>': 'ogt', '<=': 'ole', '>=': 'oge' };
      if (fop[op]) { this.emit(`${r} = fcmp ${fop[op]} ${ty.llvm} ${lv.val}, ${rv.val}`); return { ty: BOOL, val: r }; }
      if (op === '+') this.emit(`${r} = fadd ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === '-') this.emit(`${r} = fsub ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === '*') this.emit(`${r} = fmul ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === '/') this.emit(`${r} = fdiv ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === '%') this.emit(`${r} = frem ${ty.llvm} ${lv.val}, ${rv.val}`);
      return { ty, val: r };
    }
    if (cmpOp[op]) { this.emit(`${r} = icmp ${cmpOp[op]} ${ty.llvm} ${lv.val}, ${rv.val}`); return { ty: BOOL, val: r }; }
    if (op === '+') this.emit(`${r} = add ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '-') this.emit(`${r} = sub ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '*') this.emit(`${r} = mul ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '/') this.emit(`${r} = ${ty.signed !== false ? 'sdiv' : 'udiv'} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '%') this.emit(`${r} = ${ty.signed !== false ? 'srem' : 'urem'} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '&') this.emit(`${r} = and ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '|') this.emit(`${r} = or ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === '^') this.emit(`${r} = xor ${ty.llvm} ${lv.val}, ${rv.val}`);
    else return lv;
    return { ty, val: r };
  }

  private lvaluePtr(node: A.Node): { ptr: string; ty: SType } | null {
    if (node.kind === 'Ident') {
      const l = this.locals.get(node.name);
      if (l) return { ptr: l.ptr, ty: l.ty };
      return null;
    }
    if (node.kind === 'Member') {
      const base = this.lvaluePtr(node.object);
      if (base && base.ty.kind === 'struct') {
        const fi = this.fieldIndex(base.ty.name, node.property);
        if (fi) {
          const fp = this.reg();
          this.emit(`${fp} = getelementptr inbounds ${base.ty.llvm}, ptr ${base.ptr}, i32 0, i32 ${fi.idx}`);
          return { ptr: fp, ty: fi.ty };
        }
      }
      return null;
    }
    if (node.kind === 'Index') {
      const base = this.lvaluePtr(node.object);
      const idx = this.coerce(this.genExpr(node.index, I64), I64);
      if (base && base.ty.kind === 'array' && base.ty.elem) {
        const ep = this.reg();
        this.emit(`${ep} = getelementptr inbounds ${base.ty.llvm}, ptr ${base.ptr}, i64 0, i64 ${idx.val}`);
        return { ptr: ep, ty: base.ty.elem };
      }
      if (base && base.ty.llvm === 'ptr') {
        const ep = this.reg();
        this.emit(`${ep} = getelementptr inbounds i64, ptr ${base.ptr}, i64 ${idx.val}`);
        return { ptr: ep, ty: I64 };
      }
      return null;
    }
    if (node.kind === 'Deref') {
      const v = this.genExpr(node.value);
      return { ptr: v.val, ty: I64 };
    }
    return null;
  }

  private genCall(node: A.Call): Value {
    const args = node.args.map(a => this.genExpr(a));
    let name: string | null = null;
    if (node.callee.kind === 'Ident') name = node.callee.name;
    else if (node.callee.kind === 'Member') name = node.callee.property;

    // builtins that need special lowering
    if (name === 'str' || name === 'toStr') return this.toStrValue(args[0]);
    if (name === 'len' || name === 'length') {
      if (args[0] && args[0].ty.kind === 'array') return { ty: I64, val: String(args[0].ty.len) };
      return { ty: I64, val: '0' };
    }
    if (name === 'mmio_write') {
      const addr = this.coerce(args[0], I64), val = this.coerce(args[1], I64);
      if (this.target.freestanding) this.emit(`call void @sid_mmio_write(i64 ${addr.val}, i64 ${val.val})`);
      else { const p = this.reg(); this.emit(`${p} = inttoptr i64 ${addr.val} to ptr`); this.emit(`store volatile i64 ${val.val}, ptr ${p}`); }
      return { ty: VOID, val: '0' };
    }
    if (name === 'mmio_read') {
      const addr = this.coerce(args[0], I64);
      const r = this.reg();
      if (this.target.freestanding) this.emit(`${r} = call i64 @sid_mmio_read(i64 ${addr.val})`);
      else { const p = this.reg(); this.emit(`${p} = inttoptr i64 ${addr.val} to ptr`); this.emit(`${r} = load volatile i64, ptr ${p}`); }
      return { ty: I64, val: r };
    }
    if (name === 'nop') { this.emit('call void asm sideeffect "", ""()'); return { ty: VOID, val: '0' }; }

    if (name && this.fns.has(`@${name}`)) {
      const sig = this.fns.get(`@${name}`)!;
      const coerced = args.map((a, i) => sig.params[i] ? this.coerce(a, sig.params[i]) : a);
      const r = this.reg();
      if (sig.ret.llvm === 'void') { this.emit(`call void @${name}(${coerced.map((c, i) => `${(sig.params[i] || c.ty).llvm} ${c.val}`).join(', ')})`); return { ty: VOID, val: '0' }; }
      this.emit(`${r} = call ${sig.ret.llvm} @${name}(${coerced.map((c, i) => `${(sig.params[i] || c.ty).llvm} ${c.val}`).join(', ')})`);
      return { ty: sig.ret, val: r };
    }
    // method on a struct value -> direct call to Type.method
    if (node.callee.kind === 'Member') {
      const objPtr = this.lvaluePtr(node.callee.object);
      const objTy = objPtr ? objPtr.ty : this.inferType(node.callee.object);
      const methodName = `${objTy.name}.${node.callee.property}`;
      if (this.fns.has(`@${methodName}`)) {
        const sig = this.fns.get(`@${methodName}`)!;
        const callArgs = [`ptr ${objPtr ? objPtr.ptr : args[0]?.val}`];
        for (let i = 0; i < args.length; i++) callArgs.push(`${args[i].ty.llvm} ${args[i].val}`);
        const r = this.reg();
        if (sig.ret.llvm === 'void') { this.emit(`call void @${methodName}(${callArgs.join(', ')})`); return { ty: VOID, val: '0' }; }
        this.emit(`${r} = call ${sig.ret.llvm} @${methodName}(${callArgs.join(', ')})`);
        return { ty: sig.ret, val: r };
      }
      // builtin math methods
      if (node.callee.property === 'sqrt') {
        const a = this.coerce(args[0], F64); const r = this.reg();
        this.emit(`${r} = call double @llvm.sqrt.f64(double ${a.val})`); return { ty: F64, val: r };
      }
      if (node.callee.property === 'abs') {
        const a = args[0]; const r = this.reg();
        if (a.ty.kind === 'float') { this.emit(`${r} = call double @llvm.fabs.f64(double ${a.val})`); return { ty: F64, val: r }; }
        const c = this.reg(); this.emit(`${c} = icmp slt ${a.ty.llvm} ${a.val}, 0`);
        const n = this.reg(); this.emit(`${n} = sub ${a.ty.llvm} 0, ${a.val}`);
        const s = this.reg(); this.emit(`${s} = select i1 ${c}, ${a.ty.llvm} ${n}, ${a.ty.llvm} ${a.val}`);
        return { ty: a.ty, val: s };
      }
    }
    throw new LlvmError(`call to undefined function '${name ?? '<expr>'}'`);
  }

  private toStrValue(v: Value): Value {
    // numeric -> string via snprintf into a stack buffer
    const buf = `%tostr.${this.regCounter}`;
    this.emit(`${buf} = alloca [32 x i8]`);
    if (this.target.freestanding) return { ty: STR, val: buf };
    const fmtStr = v.ty.kind === 'float' ? '%g' : '%lld';
    const f = this.internString(fmtStr);
    const fp = this.gepStr(f.name);
    const arg = v.ty.kind === 'float' ? v : this.coerce(v, I64);
    const argTy = v.ty.kind === 'float' ? F64 : I64;
    this.emit(`call i32 (ptr, i64, ptr, ...) @snprintf(ptr ${buf}, i64 32, ptr ${fp}, ${argTy.llvm} ${arg.val})`);
    return { ty: STR, val: buf };
  }

  private genInterp(node: A.InterpStr): Value {
    const buf = `%istr.${this.regCounter}`;
    this.emit(`${buf} = alloca [256 x i8]`);
    this.emit(`store [256 x i8] zeroinitializer, ptr ${buf}`);
    let off = 0;
    for (const part of node.parts) {
      if (part.text !== undefined) {
        const s = this.internString(part.text);
        const len = s.len;
        const dp = this.reg();
        this.emit(`${dp} = getelementptr inbounds [256 x i8], ptr ${buf}, i64 0, i64 ${off}`);
        const sp = this.gepStr(s.name);
        this.emit(`call void @llvm.memcpy.p0.p0.i64(ptr align 1 ${dp}, ptr align 1 ${sp}, i64 ${len}, i1 false)`);
        off += len;
      } else if (part.expr) {
        const v = this.genExpr(part.expr);
        if (this.target.freestanding) continue;
        const dp = this.reg();
        this.emit(`${dp} = getelementptr inbounds [256 x i8], ptr ${buf}, i64 0, i64 ${off}`);
        const fmtStr = v.ty.kind === 'float' ? '%g' : v.ty.kind === 'int' ? '%lld' : '%s';
        const f = this.internString(fmtStr);
        const fp = this.gepStr(f.name);
        const arg = v.ty.kind === 'float' ? v : v.ty.kind === 'int' ? this.coerce(v, I64) : v;
        const argTy = v.ty.kind === 'float' ? F64 : v.ty.kind === 'int' ? I64 : PTR;
        this.emit(`call i32 (ptr, i64, ptr, ...) @snprintf(ptr ${dp}, i64 64, ptr ${fp}, ${argTy.llvm} ${arg.val})`);
        off += 24;
      }
    }
    return { ty: STR, val: buf };
  }

  private genPrint(node: A.PrintStmt) {
    const v = this.genExpr(node.value);
    if (this.target.freestanding) {
      // freestanding targets print via sid_write; honor the declared signature
      if (v.ty.kind === 'str' || v.ty.llvm === 'ptr') {
        const sig = this.fns.get('@sid_write');
        if (sig && sig.params[0]) {
          const a = this.coerce(v, sig.params[0]);
          this.emit(`call void @sid_write(${sig.params[0].llvm} ${a.val}, i64 0)`);
        } else {
          this.emit(`call void @sid_write(ptr ${v.val}, i64 0)`);
        }
      }
      return;
    }
    const fmt = v.ty.kind === 'float' ? '%g\n' : v.ty.kind === 'bool' ? '%lld\n' : v.ty.kind === 'int' ? '%lld\n' : '%s\n';
    const s = this.internString(fmt);
    const fp = this.gepStr(s.name);
    if (v.ty.kind === 'str' || v.ty.llvm === 'ptr') {
      this.emit(`call i32 (ptr, ...) @printf(ptr ${fp}, ptr ${v.val})`);
    } else if (v.ty.kind === 'bool') {
      const ext = this.reg(); this.emit(`${ext} = zext i1 ${v.val} to i64`);
      this.emit(`call i32 (ptr, ...) @printf(ptr ${fp}, i64 ${ext})`);
    } else if (v.ty.kind === 'float') {
      this.emit(`call i32 (ptr, ...) @printf(ptr ${fp}, double ${v.val})`);
    } else {
      const c = this.coerce(v, I64);
      this.emit(`call i32 (ptr, ...) @printf(ptr ${fp}, i64 ${c.val})`);
    }
  }
}

