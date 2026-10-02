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
  | NewExpr | Ternary;

export interface Program { kind: 'Program'; body: Node[]; }
export interface VarDecl { kind: 'VarDecl'; name: string; init: Node | null; }
export interface ConstDecl { kind: 'ConstDecl'; name: string; init: Node; }
export interface FnDecl { kind: 'FnDecl'; name: string; params: string[]; body: Block; }
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
export interface ObjectLit { kind: 'ObjectLit'; entries: Array<{ key: string; value: Node }>; }
export interface BinOp { kind: 'BinOp'; op: string; left: Node; right: Node; }
export interface UnaryOp { kind: 'UnaryOp'; op: string; operand: Node; }
export interface Assign { kind: 'Assign'; op: string; target: Node; value: Node; }
export interface Call { kind: 'Call'; callee: Node; args: Node[]; }
export interface Index { kind: 'Index'; object: Node; index: Node; }
export interface Member { kind: 'Member'; object: Node; property: string; }
export interface Lambda { kind: 'Lambda'; params: string[]; body: Block; }
export interface NewExpr { kind: 'NewExpr'; className: string; args: Node[]; }
export interface Ternary { kind: 'Ternary'; cond: Node; then: Node; else: Node; }
// Transcendental node: π (circle) and e (spiral) manifold operations.
export interface Transcendental { kind: 'Transcendental'; symbol: 'pi' | 'e'; op: string; arg: Node; }

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

  function parseProgram(): Program {
    const body: Node[] = [];
    skipSeparators();
    while (cur().type !== 'eof') {
      body.push(parseStatement());
      skipSeparators();
    }
    return { kind: 'Program', body };
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

    if (atKw('let')) return parseVarDecl(false);
    if (atKw('const')) return parseVarDecl(true);

    if (atKw('fn')) {
      next();
      const name = expectIdent();
      const params = parseParams();
      const body = parseBlock();
      return { kind: 'FnDecl', name, params, body };
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
          const params = parseParams();
          const body = parseBlock();
          members.push({ kind: 'FnDecl', name: mName, params, body });
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

  function parseVarDecl(isConst: boolean): Node {
    next(); // let/const
    const name = expectIdent();
    let init: Node | null = null;
    if (at('=')) { next(); init = parseExpr(); }
    return isConst
      ? ({ kind: 'ConstDecl', name, init: init! } as Node)
      : ({ kind: 'VarDecl', name, init } as Node);
  }

  function parseParams(): string[] {
    expect('(');
    const params: string[] = [];
    skipNewlines();
    while (!at(')')) {
      params.push(expectIdent());
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
    if (at('..')) {
      next();
      const right = parseAdditive();
      return { kind: 'Call', callee: { kind: 'Ident', name: 'range' }, args: [left, right] };
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
      const body = parseBlock();
      return { kind: 'Lambda', params, body };
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
    if (t.type === 'ident' || atKw('this')) {
      if (atKw('this')) { next(); return { kind: 'Ident', name: 'this' }; }
      next();
      // transcendental circle node: pi(x) -> PI * x
      if ((t.value === 'pi' || t.value === 'PI') && cur().value === '(') {
        next();
        const arg = parseExpr();
        expect(')');
        return { kind: 'Transcendental', symbol: 'pi', op: 'mul', arg };
      }
      if (t.value === 'pi' || t.value === 'PI') return { kind: 'Ident', name: 'PI' };
      if (t.value === 'e' && cur().value === '(') {
        // e(x) spiral op
        next();
        const arg = parseExpr();
        expect(')');
        return { kind: 'Transcendental', symbol: 'e', op: 'log', arg };
      }
      return { kind: 'Ident', name: t.value };
    }
    throw new ParseError(`unexpected token '${t.value || t.type}'`, t.line, t.col);
  }

  return parseProgram();
}
