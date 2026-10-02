// SidAli Parser — recursive descent producing a transcendental-capable AST.
// Nodes: declarations, control flow, functions, classes, contracts, transcendental ops.

import { tokenize, Token, LexError } from './lexer';

export type Node =
  | Program
  | VarDecl | ConstDecl | FnDecl | ClassDecl | ContractDecl | ReturnStmt | IfStmt
  | WhileStmt | RepeatStmt | ForStmt | PrintStmt | ExprStmt | Block | BreakStmt
  | ContinueStmt | ThrowStmt | TryStmt | ImportStmt | BuildStmt
  | NumLit | StrLit | BoolLit | NilLit | Ident | InterpStr | ArrayLit | ObjectLit
  | BinOp | UnaryOp | Assign | Call | Index | Member | Transcendental | Lambda
  | NewExpr | Ternary
  | StructDecl | EnumDecl | TraitDecl | ImplBlock | MatchStmt | UnsafeBlock
  | ExternBlock | UseStmt | TypeAlias | Cast | RefExpr | Deref | RangeExpr | Attribute;

export interface VarDecl { kind: 'VarDecl'; name: string; init: Node | null; mut: boolean; type: TypeNode | null; }
export interface ConstDecl { kind: 'ConstDecl'; name: string; init: Node; mut: boolean; type: TypeNode | null; }
export interface FnDecl { kind: 'FnDecl'; name: string; params: Param[]; body: Block; ret: TypeNode | null; pub: boolean; unsafe: boolean; generics: string[]; isAsync: boolean; }
export interface ClassDecl { kind: 'ClassDecl'; name: string; parent: string | null; members: Node[]; }
export interface ContractDecl { kind: 'ContractDecl'; name: string; body: Block; }
export interface ReturnStmt { kind: 'ReturnStmt'; value: Node | null; }
export interface IfStmt { kind: 'IfStmt'; cond: Node; then: Block; else: Block | IfStmt | null; }
export interface WhileStmt { kind: 'WhileStmt'; cond: Node; body: Block; }
export interface RepeatStmt { kind: 'RepeatStmt'; count: Node; body: Block; }
export interface ForStmt { kind: 'ForStmt'; varName: string; iter: Node; body: Block; }
export interface PrintStmt { kind: 'PrintStmt'; value: Node; }
export interface ExprStmt { kind: 'ExprStmt'; expr: Node; }
export interface Block { kind: 'Block'; body: Node[]; }
export interface BreakStmt { kind: 'BreakStmt'; }
export interface ContinueStmt { kind: 'ContinueStmt'; }
export interface ThrowStmt { kind: 'ThrowStmt'; value: Node; }
export interface TryStmt { kind: 'TryStmt'; body: Block; param: string; handler: Block; finalizer: Block | null; }
export interface ImportStmt { kind: 'ImportStmt'; name: string; }
export interface BuildStmt { kind: 'BuildStmt'; target: string; args: Node[]; }
export interface NumLit { kind: 'NumLit'; value: number; }
export interface StrLit { kind: 'StrLit'; value: string; }
export interface BoolLit { kind: 'BoolLit'; value: boolean; }
export interface NilLit { kind: 'NilLit'; }
export interface Ident { kind: 'Ident'; name: string; }
export interface InterpStr { kind: 'InterpStr'; parts: Array<{ text?: string; expr?: Node }>; }
export interface ArrayLit { kind: 'ArrayLit'; items: Node[]; }
export interface ObjectLit { kind: 'ObjectLit'; entries: Array<{ key: string; value: Node }>; typeName?: string; }
export interface BinOp { kind: 'BinOp'; op: string; left: Node; right: Node; }
export interface UnaryOp { kind: 'UnaryOp'; op: string; operand: Node; }
export interface Assign { kind: 'Assign'; op: string; target: Node; value: Node; }
export interface Call { kind: 'Call'; callee: Node; args: Node[]; }
export interface Index { kind: 'Index'; object: Node; index: Node; }
export interface Member { kind: 'Member'; object: Node; property: string; }
export interface Lambda { kind: 'Lambda'; params: string[]; body: Block; ret?: TypeNode | null; }
export interface NewExpr { kind: 'NewExpr'; className: string; args: Node[]; }
export interface Ternary { kind: 'Ternary'; cond: Node; then: Node; else: Node; }
// Transcendental node: π (circle) and e (spiral) manifold operations.
export interface Transcendental { kind: 'Transcendental'; symbol: 'pi' | 'e'; op: string; arg: Node; }

// ---- systems-language extensions ----
export interface TypeNode {
  kind: 'Type';
  name: string;          // i32, u8, f64, bool, MyStruct, ...
  args: TypeNode[];      // generics: Result<T, E>
  ref: boolean;          // &T
  refMut: boolean;       // &mut T
  ptr: boolean;          // *const T / *mut T
  ptrMut: boolean;
  arrayLen: number | null; // [T; N]
}
export interface Param { name: string; type: TypeNode | null; mut: boolean; self: boolean; }
export interface StructDecl { kind: 'StructDecl'; name: string; fields: Param[]; pub: boolean; reprC: boolean; packed: boolean; }
export interface EnumDecl { kind: 'EnumDecl'; name: string; variants: Array<{ name: string; fields: TypeNode[] }>; pub: boolean; }
export interface TraitDecl { kind: 'TraitDecl'; name: string; methods: FnDecl[]; pub: boolean; }
export interface ImplBlock { kind: 'ImplBlock'; traitName: string | null; typeName: string; methods: FnDecl[]; }
export interface MatchArm { pattern: string; literals: Node[]; body: Block; }
export interface MatchStmt { kind: 'MatchStmt'; value: Node; arms: MatchArm[]; }
export interface UnsafeBlock { kind: 'UnsafeBlock'; body: Block; }
export interface ExternBlock { kind: 'ExternBlock'; abi: string; items: FnDecl[]; }
export interface UseStmt { kind: 'UseStmt'; path: string; }
export interface TypeAlias { kind: 'TypeAlias'; name: string; type: TypeNode; }
export interface Cast { kind: 'Cast'; value: Node; type: TypeNode; }
export interface RefExpr { kind: 'RefExpr'; value: Node; mut: boolean; }
export interface Deref { kind: 'Deref'; value: Node; }
export interface RangeExpr { kind: 'RangeExpr'; start: Node | null; end: Node | null; inclusive: boolean; }
export interface Attribute { kind: 'Attribute'; name: string; value: string | null; }

export interface Program { kind: 'Program'; body: Node[]; attributes: string[]; noStd: boolean; }

export class ParseError extends Error {
  line: number; col: number;
  constructor(msg: string, line: number, col: number) {
    super(`ParseError at ${line}:${col}: ${msg}`);
    this.line = line; this.col = col;
  }
}

export function parse(src: string): Program {
  let toks: Token[];
  try {
    toks = tokenize(src);
  } catch (e) {
    if (e instanceof LexError) throw e;
    throw e;
  }
  let p = 0;
  const cur = () => toks[p];
  const at = (v: string) => cur().value === v && (cur().type === 'keyword' || cur().type === 'op' || cur().type === 'punct');
  const atKw = (v: string) => cur().type === 'keyword' && cur().value === v;
  const next = () => toks[p++];
  const skipNewlines = () => { while (cur().type === 'newline') p++; };
  const skipSeparators = () => { while (cur().type === 'newline' || at(';')) p++; };

  const expect = (v: string) => {
    if (!at(v)) throw new ParseError(`expected '${v}' but found '${cur().value || cur().type}'`, cur().line, cur().col);
    return next();
  };
  const expectIdent = () => {
    if (cur().type !== 'ident') throw new ParseError(`expected identifier but found '${cur().value || cur().type}'`, cur().line, cur().col);
    return next().value;
  };

  // Parse a single inline expression (used by string interpolation ${...}).
  function parseInlineExpr(code: string): Node {
    const sub = parse(code);
    const st = sub.body[0];
    if (st && st.kind === 'ExprStmt') return (st as ExprStmt).expr;
    return { kind: 'Ident', name: 'nil' } as Node;
  }

  // ---- type grammar: i32, &mut T, *const T, [T; N], Vec<T>, Result<T,E> ----
  function parseType(): TypeNode {
    const mk = (name: string): TypeNode => ({
      kind: 'Type', name, args: [], ref: false, refMut: false, ptr: false, ptrMut: false, arrayLen: null,
    });
    if (at('&')) {
      next();
      const mut = atKw('mut');
      if (mut) next();
      const inner = parseType();
      return { ...inner, ref: true, refMut: mut || inner.refMut };
    }
    if (at('*')) {
      next();
      let mut = false;
      if (atKw('mut')) { mut = true; next(); }
      else if (atKw('const')) next();
      const inner = parseType();
      return { ...inner, ptr: true, ptrMut: mut };
    }
    if (at('[')) {
      next();
      const inner = parseType();
      expect(';');
      const len = Number(next().value);
      expect(']');
      return { ...inner, arrayLen: len };
    }
    if (at('(')) {
      // tuple type (T, U)
      next();
      const args: TypeNode[] = [];
      skipNewlines();
      while (!at(')')) { args.push(parseType()); skipNewlines(); if (at(',')) { next(); skipNewlines(); } }
      expect(')');
      const t = mk('(' + args.map(a => a.name).join(',') + ')');
      t.args = args;
      return t;
    }
    if (cur().type !== 'ident' && cur().type !== 'keyword') {
      throw new ParseError(`expected type but found '${cur().value || cur().type}'`, cur().line, cur().col);
    }
    let name = next().value;
    while (at('::')) { next(); name += '::' + next().value; }
    const t = mk(name);
    if (at('<')) {
      next();
      skipNewlines();
      while (!at('>')) {
        t.args.push(parseType());
        skipNewlines();
        if (at(',')) { next(); skipNewlines(); }
      }
      expect('>');
    }
    return t;
  }

  function parseGenericParams(): string[] {
    const params: string[] = [];
    if (at('<')) {
      next();
      skipNewlines();
      while (!at('>')) {
        params.push(expectIdent());
        skipNewlines();
        if (at(':')) { next(); parseType(); }
        if (at(',')) { next(); skipNewlines(); }
      }
      expect('>');
    }
    return params;
  }

  function parseFnSignature(name: string, isPub: boolean, isUnsafe: boolean, generics: string[], isAsync: boolean): FnDecl {
    expect('(');
    const params: Param[] = [];
    skipNewlines();
    while (!at(')')) {
      if (at('&')) {
        next();
        const mut = atKw('mut'); if (mut) next();
        const pname = atKw('self') ? next().value : expectIdent();
        params.push({ name: pname, type: null, mut, self: pname === 'self' });
      } else if (atKw('mut')) {
        next();
        const pname = expectIdent();
        let ptype: TypeNode | null = null;
        if (at(':')) { next(); ptype = parseType(); }
        params.push({ name: pname, type: ptype, mut: true, self: false });
      } else {
        const pname = atKw('self') ? next().value : expectIdent();
        let ptype: TypeNode | null = null;
        if (at(':')) { next(); ptype = parseType(); }
        params.push({ name: pname, type: ptype, mut: false, self: pname === 'self' });
      }
      skipNewlines();
      if (at(',')) { next(); skipNewlines(); }
    }
    expect(')');
    let ret: TypeNode | null = null;
    if (at('->')) { next(); ret = parseType(); }
    let body: Block;
    if (at(';')) { next(); body = { kind: 'Block', body: [] }; }
    else body = parseBlock();
    return { kind: 'FnDecl', name, params, body, ret, pub: isPub, unsafe: isUnsafe, generics, isAsync };
  }

  function parseStruct(isPub: boolean, reprC: boolean, packed: boolean): Node {
    next(); // struct
    const name = expectIdent();
    const generics = parseGenericParams();
    void generics;
    if (at(';')) { next(); return { kind: 'StructDecl', name, fields: [], pub: isPub, reprC, packed }; }
    expect('{');
    const fields: Param[] = [];
    skipSeparators();
    while (!at('}') && cur().type !== 'eof') {
      if (atKw('pub')) next();
      const fname = expectIdent();
      expect(':');
      const ftype = parseType();
      fields.push({ name: fname, type: ftype, mut: false, self: false });
      skipSeparators();
      if (at(',')) { next(); skipSeparators(); }
    }
    expect('}');
    return { kind: 'StructDecl', name, fields, pub: isPub, reprC, packed };
  }

  function parseEnum(isPub: boolean): Node {
    next(); // enum
    const name = expectIdent();
    parseGenericParams();
    expect('{');
    const variants: Array<{ name: string; fields: TypeNode[] }> = [];
    skipSeparators();
    while (!at('}') && cur().type !== 'eof') {
      const vname = expectIdent();
      const fields: TypeNode[] = [];
      if (at('(')) {
        next();
        skipNewlines();
        while (!at(')')) { fields.push(parseType()); skipNewlines(); if (at(',')) { next(); skipNewlines(); } }
        expect(')');
      } else if (at('{')) {
        // struct-variant; treat fields as named types
        next();
        skipSeparators();
        while (!at('}')) { expectIdent(); expect(':'); fields.push(parseType()); skipSeparators(); if (at(',')) { next(); skipSeparators(); } }
        expect('}');
      }
      variants.push({ name: vname, fields });
      skipSeparators();
      if (at(',')) { next(); skipSeparators(); }
    }
    expect('}');
    return { kind: 'EnumDecl', name, variants, pub: isPub };
  }

  function parseTrait(isPub: boolean): Node {
    next(); // trait
    const name = expectIdent();
    parseGenericParams();
    expect('{');
    const methods: FnDecl[] = [];
    skipSeparators();
    while (!at('}') && cur().type !== 'eof') {
      if (atKw('fn')) { next(); methods.push(parseFnSignature(expectIdent(), false, false, [], false)); }
      else next();
      skipSeparators();
    }
    expect('}');
    return { kind: 'TraitDecl', name, methods, pub: isPub };
  }

  function parseImpl(): Node {
    next(); // impl
    parseGenericParams();
    let traitName: string | null = null;
    let typeName = expectIdent();
    if (atKw('for')) { next(); traitName = typeName; typeName = expectIdent(); }
    expect('{');
    const methods: FnDecl[] = [];
    skipSeparators();
    while (!at('}') && cur().type !== 'eof') {
      if (atKw('fn')) { next(); methods.push(parseFnSignature(expectIdent(), false, false, [], false)); }
      else next();
      skipSeparators();
    }
    expect('}');
    return { kind: 'ImplBlock', traitName, typeName, methods };
  }

  function parseExtern(): Node {
    next(); // extern
    let abi = 'C';
    if (cur().type === 'string') abi = next().value;
    expect('{');
    const items: FnDecl[] = [];
    skipSeparators();
    while (!at('}') && cur().type !== 'eof') {
      if (atKw('fn')) { next(); items.push(parseFnSignature(expectIdent(), false, false, [], false)); }
      else next();
      skipSeparators();
    }
    expect('}');
    return { kind: 'ExternBlock', abi, items };
  }

  function parseMatch(): Node {
    next(); // match
    const value = parseExpr();
    expect('{');
    const arms: MatchArm[] = [];
    skipSeparators();
    while (!at('}') && cur().type !== 'eof') {
      let pattern = '_';
      const literals: Node[] = [];
      if (at('_')) { next(); pattern = '_'; }
      else if (cur().type === 'number' || cur().type === 'string') {
        pattern = 'literal';
        literals.push(cur().type === 'number' ? { kind: 'NumLit', value: Number(next().value) } : { kind: 'StrLit', value: next().value });
        while (at('|')) { next(); const tk = next(); literals.push(tk.type === 'number' ? { kind: 'NumLit', value: Number(tk.value) } : { kind: 'StrLit', value: tk.value }); }
      } else {
        pattern = expectIdent();
        if (at('(')) { next(); skipNewlines(); while (!at(')')) { expectIdent(); skipNewlines(); if (at(',')) { next(); skipNewlines(); } } expect(')'); }
      }
      if (at('=>')) next(); else expect(':');
      const body = at('{') ? parseBlock() : { kind: 'Block', body: [{ kind: 'ExprStmt', expr: parseExpr() } as Node] } as Block;
      arms.push({ pattern, literals, body });
      skipSeparators();
      if (at(',')) { next(); skipSeparators(); }
    }
    expect('}');
    return { kind: 'MatchStmt', value, arms };
  }

  function parseProgram(): Program {
    const body: Node[] = [];
    const attributes: string[] = [];
    let noStd = false;
    skipSeparators();
    while (cur().type !== 'eof') {
      // inner attributes: #![no_std]
      if (at('#')) {
        next();
        if (at('!')) next();
        if (at('[')) {
          next();
          const attrName = expectIdent();
          if (attrName === 'no_std') noStd = true;
          attributes.push(attrName);
          if (at('(')) { next(); while (!at(')') && cur().type !== 'eof') next(); expect(')'); }
          expect(']');
          skipSeparators();
          continue;
        }
      }
      body.push(parseStatement());
      skipSeparators();
    }
    return { kind: 'Program', body, attributes, noStd };
  }

  function parseBlock(): Block {
    expect('{');
    const body: Node[] = [];
    skipSeparators();
    while (!at('}') && cur().type !== 'eof') {
      body.push(parseStatement());
      skipSeparators();
    }
    expect('}');
    return { kind: 'Block', body };
  }

  function parseStatement(): Node {
    const t = cur();

    // visibility / attributes prefix
    let isPub = false;
    if (atKw('pub')) { isPub = true; next(); }
    let reprC = false, packed = false;
    while (at('#') && toks[p + 1] && toks[p + 1].value === '[') {
      next(); next();
      const attr = expectIdent();
      if (attr === 'repr') { if (at('(')) { next(); const v = expectIdent(); if (v === 'C') reprC = true; else if (v === 'packed') packed = true; expect(')'); } }
      expect(']');
      skipSeparators();
    }

    if (atKw('let')) return parseVarDecl(false);
    if (atKw('const')) return parseVarDecl(true);
    if (atKw('static')) { next(); if (atKw('mut')) next(); return parseVarDecl(true); }

    if (atKw('struct')) return parseStruct(isPub, reprC, packed);
    if (atKw('enum')) return parseEnum(isPub);
    if (atKw('trait')) return parseTrait(isPub);
    if (atKw('impl')) return parseImpl();
    if (atKw('extern')) return parseExtern();
    if (atKw('match')) return parseMatch();
    if (atKw('use')) { next(); let path = ''; while (cur().type === 'ident' || cur().type === 'keyword' || at('::')) { path += next().value; } return { kind: 'UseStmt', path }; }
    if (atKw('mod')) { next(); const name = expectIdent(); if (at(';')) next(); return { kind: 'UseStmt', path: 'mod ' + name }; }
    if (atKw('type')) { next(); const name = expectIdent(); if (at('=')) next(); const ty = parseType(); if (at(';')) next(); return { kind: 'TypeAlias', name, type: ty }; }
    if (atKw('unsafe')) {
      next();
      if (atKw('fn')) { next(); return parseFnSignature(expectIdent(), isPub, true, [], false); }
      const body = parseBlock();
      return { kind: 'UnsafeBlock', body };
    }

    if (atKw('fn')) {
      next();
      const name = expectIdent();
      const generics = parseGenericParams();
      return parseFnSignature(name, isPub, false, generics, false);
    }

    if (atKw('class')) {
      next();
      const name = expectIdent();
      let parent: string | null = null;
      if (atKw('extends')) { next(); parent = expectIdent(); }
      expect('{');
      const members: Node[] = [];
      skipSeparators();
      while (!at('}') && cur().type !== 'eof') {
        if (atKw('let') || atKw('const')) {
          members.push(parseVarDecl(atKw('const')));
        } else {
          const mName = expectIdent();
          const params = parseLegacyParams();
          const body = parseBlock();
          members.push({ kind: 'FnDecl', name: mName, params, body, ret: null, pub: false, unsafe: false, generics: [], isAsync: false });
        }
        skipSeparators();
      }
      expect('}');
      return { kind: 'ClassDecl', name, parent, members };
    }

    if (atKw('contract')) {
      next();
      const name = expectIdent();
      const body = parseBlock();
      return { kind: 'ContractDecl', name, body };
    }

    if (atKw('system') || atKw('platform')) {
      const target = next().value;
      const name = expectIdent();
      return { kind: 'BuildStmt', target, args: [{ kind: 'StrLit', value: name } as Node] };
    }

    if (atKw('build')) {
      next();
      const parts: string[] = [];
      while (cur().type === 'ident' || cur().type === 'keyword') parts.push(next().value);
      const args: Node[] = parts.length ? [{ kind: 'StrLit', value: parts.join(' ') } as Node] : [];
      return { kind: 'BuildStmt', target: 'build', args };
    }

    if (atKw('import')) {
      next();
      const name = expectIdent();
      return { kind: 'ImportStmt', name };
    }

    if (atKw('return')) {
      next();
      let value: Node | null = null;
      if (cur().type !== 'newline' && !at('}') && !at(';') && cur().type !== 'eof') value = parseExpr();
      return { kind: 'ReturnStmt', value };
    }

    if (atKw('if')) return parseIf();
    if (atKw('while')) {
      next();
      const cond = parseExpr();
      const body = parseBlock();
      return { kind: 'WhileStmt', cond, body };
    }
    if (atKw('loop')) {
      next();
      const body = parseBlock();
      return { kind: 'WhileStmt', cond: { kind: 'BoolLit', value: true } as Node, body };
    }
    if (atKw('repeat')) {
      next();
      const count = parseExpr();
      if (atKw('times')) next();
      const body = parseBlock();
      return { kind: 'RepeatStmt', count, body };
    }
    if (atKw('for')) {
      next();
      const varName = expectIdent();
      if (atKw('in')) next();
      const iter = parseExpr();
      const body = parseBlock();
      return { kind: 'ForStmt', varName, iter, body };
    }
    if (atKw('print')) {
      next();
      let value: Node;
      if (at('(')) { next(); value = parseExpr(); expect(')'); }
      else value = parseExpr();
      return { kind: 'PrintStmt', value };
    }
    if (atKw('break')) { next(); return { kind: 'BreakStmt' }; }
    if (atKw('continue')) { next(); return { kind: 'ContinueStmt' }; }
    if (atKw('throw')) { next(); return { kind: 'ThrowStmt', value: parseExpr() }; }
    if (atKw('try')) return parseTry();

    if (at('{')) return parseBlock();

    // expression / assignment statement
    const expr = parseExpr();
    return { kind: 'ExprStmt', expr };
  }

  // legacy string[] params (classes / contract syntax)
  function parseLegacyParams(): Param[] {
    expect('(');
    const params: Param[] = [];
    skipNewlines();
    while (!at(')')) {
      const name = expectIdent();
      let type: TypeNode | null = null;
      if (at(':')) { next(); type = parseType(); }
      params.push({ name, type, mut: false, self: name === 'self' });
      skipNewlines();
      if (at(',')) { next(); skipNewlines(); }
    }
    expect(')');
    return params;
  }

  function parseVarDecl(isConst: boolean): Node {
    next(); // let/const/static
    let mut = false;
    if (atKw('mut')) { mut = true; next(); }
    const name = expectIdent();
    let type: TypeNode | null = null;
    if (at(':')) { next(); type = parseType(); }
    let init: Node | null = null;
    if (at('=')) { next(); init = parseExpr(); }
    return isConst
      ? { kind: 'ConstDecl', name, init: init as Node, mut, type }
            : { kind: 'VarDecl', name, init, mut, type };
  }



  function parseParams(): Param[] {
    expect('(');
    const params: Param[] = [];
    skipNewlines();
    while (!at(')')) {
      const name = expectIdent();
      let type: TypeNode | null = null;
      if (at(':')) { next(); type = parseType(); }
      params.push({ name, type, mut: false, self: name === 'self' });
      skipNewlines();
      if (at(',')) { next(); skipNewlines(); }
    }
    expect(')');
    return params;
  }

  function parseIf(): Node {
    next();
    const cond = parseExpr();
    const then = parseBlock();
    let els: Block | IfStmt | null = null;
    skipSeparators();
    if (atKw('else')) {
      next();
      skipSeparators();
      if (atKw('if')) els = parseIf() as IfStmt;
      else els = parseBlock();
    }
    return { kind: 'IfStmt', cond, then, else: els };
  }

  function parseTry(): Node {
    next();
    const body = parseBlock();
    skipSeparators();
    let param = 'err';
    let handler: Block = { kind: 'Block', body: [] };
    if (atKw('catch')) {
      next();
      if (at('(')) { next(); param = expectIdent(); expect(')'); }
      handler = parseBlock();
      skipSeparators();
    }
    let finalizer: Block | null = null;
    if (atKw('finally')) { next(); finalizer = parseBlock(); }
    return { kind: 'TryStmt', body, param, handler, finalizer };
  }

  // ---- Expression precedence climbing ----
  function parseExpr(): Node { return parseAssign(); }

  function parseAssign(): Node {
    const left = parseTernary();
    if (['=', '+=', '-=', '*=', '/=', '%='].includes(cur().value) &&
        (cur().type === 'op')) {
      const op = next().value;
      const value = parseAssign();
      return { kind: 'Assign', op, target: left, value };
    }
    return left;
  }

  function parseTernary(): Node {
    const cond = parseOr();
    if (at('?')) {
      next();
      const then = parseExpr();
      expect(':');
      const els = parseExpr();
      return { kind: 'Ternary', cond, then, else: els };
    }
    return cond;
  }

  function parseOr(): Node {
    let left = parseAnd();
    while (at('||') || atKw('or')) {
      next();
      const right = parseAnd();
      left = { kind: 'BinOp', op: '||', left, right };
    }
    return left;
  }
  function parseAnd(): Node {
    let left = parseEquality();
    while (at('&&') || atKw('and')) {
      next();
      const right = parseEquality();
      left = { kind: 'BinOp', op: '&&', left, right };
    }
    return left;
  }
  function parseEquality(): Node {
    let left = parseComparison();
    while (at('==') || at('!=')) {
      const op = next().value;
      left = { kind: 'BinOp', op, left, right: parseComparison() };
    }
    return left;
  }
  function parseComparison(): Node {
    let left = parseRange();
    while (at('<') || at('>') || at('<=') || at('>=')) {
      const op = next().value;
      left = { kind: 'BinOp', op, left, right: parseRange() };
    }
    return left;
  }
  function parseRange(): Node {
    let left = parseAdditive();
    if (at('..') || at('..=')) {
      const inclusive = cur().value === '..=';
      next();
      if (at(')') || at(']') || at(',') || at('{') || cur().type === 'newline' || cur().type === 'eof') {
        return { kind: 'RangeExpr', start: left, end: null, inclusive };
      }
      const right = parseAdditive();
      return { kind: 'RangeExpr', start: left, end: right, inclusive };
    }
    return left;
  }
  function parseAdditive(): Node {
    let left = parseMultiplicative();
    while (at('+') || at('-')) {
      const op = next().value;
      left = { kind: 'BinOp', op, left, right: parseMultiplicative() };
    }
    return left;
  }
  function parseMultiplicative(): Node {
    let left = parsePower();
    while (at('*') || at('/') || at('%')) {
      const op = next().value;
      left = { kind: 'BinOp', op, left, right: parsePower() };
    }
    return left;
  }
  function parsePower(): Node {
    const left = parseUnary();
    if (at('**')) {
      next();
      const right = parsePower();
      return { kind: 'BinOp', op: '**', left, right };
    }
    return left;
  }
  function parseUnary(): Node {
    if (at('&')) {
      next();
      const mut = atKw('mut');
      if (mut) next();
      return { kind: 'RefExpr', value: parseUnary(), mut };
    }
    if (at('*')) {
      next();
      return { kind: 'Deref', value: parseUnary() };
    }
    if (at('!') || at('-') || at('+') || at('~') || atKw('not')) {
      const raw = next().value;
      const op = raw === 'not' ? '!' : raw;
      return { kind: 'UnaryOp', op, operand: parseUnary() };
    }
    return parsePostfix();
  }

  function parsePostfix(): Node {
    let node = parsePrimary();
    for (;;) {
      if (at('(')) {
        next();
        const args: Node[] = [];
        skipNewlines();
        while (!at(')')) {
          args.push(parseExpr());
          skipNewlines();
          if (at(',')) { next(); skipNewlines(); }
        }
        expect(')');
        node = { kind: 'Call', callee: node, args };
      } else if (at('[')) {
        next();
        const index = parseExpr();
        expect(']');
        node = { kind: 'Index', object: node, index };
      } else if (at('.')) {
        next();
        const prop = cur().type === 'ident' || cur().type === 'keyword' ? next().value : (() => { throw new ParseError('expected property name', cur().line, cur().col); })();
        node = { kind: 'Member', object: node, property: prop };
      } else if (atKw('as')) {
        next();
        const type = parseType();
        node = { kind: 'Cast', value: node, type };
      } else break;
    }
    return node;
  }

  function parsePrimary(): Node {
    const t = cur();
    if (t.type === 'number') { next(); return { kind: 'NumLit', value: Number(t.value) }; }
    if (t.type === 'string') {
      next();
      const parts = t.parts || [];
      if (parts.length === 1 && parts[0].text !== undefined) return { kind: 'StrLit', value: parts[0].text };
      return {
        kind: 'InterpStr',
        parts: parts.map(pp => pp.expr !== undefined
          ? { expr: parseInlineExpr(pp.expr) }
          : { text: pp.text }),
      };
    }
    if (atKw('true')) { next(); return { kind: 'BoolLit', value: true }; }
    if (atKw('false')) { next(); return { kind: 'BoolLit', value: false }; }
    if (atKw('nil')) { next(); return { kind: 'NilLit' }; }
    if (atKw('fn')) {
      next();
      const params = parseParams();
      let ret: TypeNode | null = null;
      if (at('->')) { next(); ret = parseType(); }
      const body = parseBlock();
      return { kind: 'Lambda', params: params.map(pp => pp.name), body, ret } as Node;
    }
    if (atKw('new')) {
      next();
      const className = expectIdent();
      const args: Node[] = [];
      if (at('(')) {
        next();
        skipNewlines();
        while (!at(')')) { args.push(parseExpr()); skipNewlines(); if (at(',')) { next(); skipNewlines(); } }
        expect(')');
      }
      return { kind: 'NewExpr', className, args };
    }
    if (at('(')) {
      next();
      const e = parseExpr();
      expect(')');
      return e;
    }
    if (at('[')) {
      next();
      const items: Node[] = [];
      skipNewlines();
      while (!at(']')) { items.push(parseExpr()); skipNewlines(); if (at(',')) { next(); skipNewlines(); } }
      expect(']');
      return { kind: 'ArrayLit', items };
    }
    if (at('{')) {
      next();
      const entries: Array<{ key: string; value: Node }> = [];
      skipNewlines();
      while (!at('}')) {
        let key: string;
        if (cur().type === 'string' || cur().type === 'ident' || cur().type === 'keyword') key = next().value;
        else throw new ParseError('expected object key', cur().line, cur().col);
        expect(':');
        const value = parseExpr();
        entries.push({ key, value });
        skipNewlines();
        if (at(',')) { next(); skipNewlines(); }
      }
      expect('}');
      return { kind: 'ObjectLit', entries };
    }
    if (t.type === 'ident' || atKw('this') || atKw('self') || atKw('Self')) {
      if (atKw('this')) { next(); return { kind: 'Ident', name: 'this' }; }
      next();
      // path expression: A::B::c
      let name = t.value;
      while (at('::')) { next(); name += '::' + (cur().type === 'ident' || cur().type === 'keyword' ? next().value : expectIdent()); }
      // struct literal: Point { x: 1, y: 2 }
      if (at('{') && name !== 'this') {
        const save = p;
        next();
        skipNewlines();
        const isStructLit = (cur().type === 'ident' || cur().type === 'keyword') &&
          toks[p + 1] && (toks[p + 1].value === ':' || toks[p + 1].value === ',');
        p = save;
        if (isStructLit) {
          next(); // {
          const entries: Array<{ key: string; value: Node }> = [];
          skipNewlines();
          while (!at('}')) {
            const key = cur().type === 'string' || cur().type === 'ident' || cur().type === 'keyword' ? next().value : expectIdent();
            expect(':');
            entries.push({ key, value: parseExpr() });
            skipNewlines();
            if (at(',')) { next(); skipNewlines(); }
          }
          expect('}');
          return { kind: 'ObjectLit', entries, typeName: name } as Node;
        }
      }
      // transcendental circle node: pi(x) -> PI * x
      if ((name === 'pi' || name === 'PI') && cur().value === '(') {
        next();
        const arg = parseExpr();
        expect(')');
        return { kind: 'Transcendental', symbol: 'pi', op: 'mul', arg };
      }
      if (name === 'pi' || name === 'PI') return { kind: 'Ident', name: 'PI' };
      if (name === 'e' && cur().value === '(') {
        next();
        const arg = parseExpr();
        expect(')');
        return { kind: 'Transcendental', symbol: 'e', op: 'log', arg };
      }
      return { kind: 'Ident', name };
    }
    throw new ParseError(`unexpected token '${t.value || t.type}'`, t.line, t.col);
  }

  return parseProgram();
}
