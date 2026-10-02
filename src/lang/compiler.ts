// SidAli Compiler — lowers the AST into stack-VM bytecode chunks.
// No eval anywhere: source -> tokens -> AST -> bytecode -> switch-dispatch VM.

import * as A from './parser';

export interface Instr { op: string; a?: any; b?: any; line?: number; }

export interface Chunk {
  id: number;
  name: string;
  params: string[];
  code: Instr[];
  isMethod: boolean;
}

export interface CompileResult {
  main: Chunk;
  chunks: Chunk[];
  constants: any[];
}

export class CompileError extends Error {}

export function compile(program: A.Program): CompileResult {
  const chunks: Chunk[] = [];
  let chunkId = 0;

  function newChunk(name: string, params: string[], isMethod = false): Chunk {
    const c: Chunk = { id: chunkId++, name, params, code: [], isMethod };
    chunks.push(c);
    return c;
  }

  const main = newChunk('__main__', []);

  function emit(c: Chunk, op: string, a?: any, b?: any, line?: number) {
    c.code.push({ op, a, b, line });
    return c.code.length - 1;
  }

  function compileBlockTo(c: Chunk, block: A.Block) {
    for (const st of block.body) compileStmt(c, st);
  }

  function compileStmt(c: Chunk, node: A.Node) {
    switch (node.kind) {
      case 'VarDecl': {
        if (node.init) compileExpr(c, node.init);
        else emit(c, 'CONST', null);
        emit(c, 'DECLARE', node.name);
        break;
      }
      case 'ConstDecl': {
        compileExpr(c, node.init);
        emit(c, 'DECLARE_CONST', node.name);
        break;
      }
      case 'FnDecl': {
        const fc = newChunk(node.name, node.params);
        compileBlockTo(fc, node.body);
        emit(fc, 'RET');
        emit(c, 'MAKE_FN', fc.id);
        emit(c, 'DECLARE', node.name);
        break;
      }
      case 'ClassDecl': {
        const methods: Array<{ name: string; chunk: number }> = [];
        const statics: Array<{ name: string; value: A.Node }> = [];
        for (const m of node.members) {
          if (m.kind === 'FnDecl') {
            const mc = newChunk(`${node.name}.${m.name}`, m.params, true);
            compileBlockTo(mc, m.body);
            emit(mc, 'RET');
            methods.push({ name: m.name, chunk: mc.id });
          } else if (m.kind === 'VarDecl' || m.kind === 'ConstDecl') {
            statics.push({ name: (m as any).name, value: (m as any).init });
          }
        }
        emit(c, 'MAKE_CLASS', { name: node.name, parent: node.parent, methods, statics: statics.map(s => s.name) });
        emit(c, 'DECLARE', node.name);
        for (const s of statics) {
          emit(c, 'LOAD', node.name);
          if (s.value) compileExpr(c, s.value); else emit(c, 'CONST', null);
          emit(c, 'SET_MEMBER', s.name);
          emit(c, 'POP');
        }
        break;
      }
      case 'ContractDecl': {
        emit(c, 'CONST', `contract:${node.name}`);
        emit(c, 'DECLARE', node.name);
        compileBlockTo(c, node.body);
        break;
      }
      case 'ReturnStmt': {
        if (node.value) compileExpr(c, node.value); else emit(c, 'CONST', null);
        emit(c, 'RET');
        break;
      }
      case 'IfStmt': {
        compileExpr(c, node.cond);
        const jz = emit(c, 'JZ', -1);
        compileBlockTo(c, node.then);
        if (node.else) {
          const j = emit(c, 'JUMP', -1);
          c.code[jz].a = c.code.length;
          if ((node.else as any).kind === 'IfStmt') compileStmt(c, node.else as A.Node);
          else compileBlockTo(c, node.else as A.Block);
          c.code[j].a = c.code.length;
        } else {
          c.code[jz].a = c.code.length;
        }
        break;
      }
      case 'WhileStmt': {
        const loopEnter = emit(c, 'LOOP_ENTER', -1, -1);
        const start = c.code.length;
        compileExpr(c, node.cond);
        const jz = emit(c, 'JZ', -1);
        compileBlockTo(c, node.body);
        emit(c, 'JUMP', start);
        c.code[jz].a = c.code.length;
        emit(c, 'LOOP_END');
        c.code[loopEnter].a = start;
        c.code[loopEnter].b = c.code.length;
        break;
      }
      case 'RepeatStmt': {
        compileExpr(c, node.count);
        const idx = `__rep_i_${c.code.length}`;
        emit(c, 'DECLARE', idx);
        const loopEnter = emit(c, 'LOOP_ENTER', -1, -1);
        const start = c.code.length;
        emit(c, 'LOAD', idx);
        emit(c, 'CONST', 0);
        emit(c, 'BINOP', '>');
        const jz = emit(c, 'JZ', -1);
        compileBlockTo(c, node.body);
        emit(c, 'LOAD', idx);
        emit(c, 'CONST', 1);
        emit(c, 'BINOP', '-');
        emit(c, 'STORE', idx);
        emit(c, 'JUMP', start);
        c.code[jz].a = c.code.length;
        emit(c, 'LOOP_END');
        c.code[loopEnter].a = start;
        c.code[loopEnter].b = c.code.length;
        break;
      }
      case 'ForStmt': {
        const it = `__for_it_${c.code.length}`;
        const ix = `__for_ix_${c.code.length}`;
        compileExpr(c, node.iter);
        emit(c, 'DECLARE', it);
        emit(c, 'CONST', 0);
        emit(c, 'DECLARE', ix);
        const loopEnter = emit(c, 'LOOP_ENTER', -1, -1);
        const start = c.code.length;
        emit(c, 'LOAD', ix);
        emit(c, 'LOAD', it);
        emit(c, 'LEN');
        emit(c, 'BINOP', '<');
        const jz = emit(c, 'JZ', -1);
        emit(c, 'LOAD', it);
        emit(c, 'LOAD', ix);
        emit(c, 'INDEX');
        emit(c, 'STORE', node.varName);
        compileBlockTo(c, node.body);
        const inc = c.code.length;
        emit(c, 'LOAD', ix);
        emit(c, 'CONST', 1);
        emit(c, 'BINOP', '+');
        emit(c, 'STORE', ix);
        emit(c, 'JUMP', start);
        c.code[jz].a = c.code.length;
        emit(c, 'LOOP_END');
        c.code[loopEnter].a = inc;
        c.code[loopEnter].b = c.code.length;
        break;
      }
      case 'PrintStmt': {
        compileExpr(c, node.value);
        emit(c, 'PRINT');
        break;
      }
      case 'BreakStmt': emit(c, 'BREAK'); break;
      case 'ContinueStmt': emit(c, 'CONTINUE'); break;
      case 'ThrowStmt': compileExpr(c, node.value); emit(c, 'THROW'); break;
      case 'TryStmt': {
        const tryEnter = emit(c, 'TRY_ENTER', -1);
        compileBlockTo(c, node.body);
        emit(c, 'TRY_LEAVE');
        const after = emit(c, 'JUMP', -1);
        c.code[tryEnter].a = c.code.length; // handler start
        emit(c, 'CATCH_BIND', node.param);
        compileBlockTo(c, node.handler);
        if (node.finalizer) compileBlockTo(c, node.finalizer);
        emit(c, 'FINALLY_END');
        c.code[after].a = c.code.length;
        break;
      }
      case 'ImportStmt': emit(c, 'IMPORT', node.name); break;
      case 'BuildStmt': {
        emit(c, 'BUILD', node.target);
        for (const a of node.args) compileExpr(c, a);
        emit(c, 'BUILD_APPLY', node.args.length);
        break;
      }
      case 'Block': compileBlockTo(c, node as A.Block); break;
      case 'ExprStmt': compileExpr(c, node.expr); emit(c, 'POP'); break;
      default: throw new CompileError(`cannot compile statement ${node.kind}`);
    }
  }

  function compileExpr(c: Chunk, node: A.Node) {
    switch (node.kind) {
      case 'NumLit': emit(c, 'CONST', node.value); break;
      case 'StrLit': emit(c, 'CONST', node.value); break;
      case 'BoolLit': emit(c, 'CONST', node.value); break;
      case 'NilLit': emit(c, 'CONST', null); break;
      case 'Ident': emit(c, 'LOAD', node.name); break;
      case 'InterpStr': {
        emit(c, 'CONST', '');
        for (const p of node.parts) {
          if (p.text !== undefined) emit(c, 'CONST', p.text);
          else if (p.expr) compileExpr(c, p.expr);
          emit(c, 'BINOP', '+');
        }
        break;
      }
      case 'ArrayLit': {
        for (const it of node.items) compileExpr(c, it);
        emit(c, 'ARRAY', node.items.length);
        break;
      }
      case 'ObjectLit': {
        for (const e of node.entries) { emit(c, 'CONST', e.key); compileExpr(c, e.value); }
        emit(c, 'OBJECT', node.entries.length);
        break;
      }
      case 'BinOp': {
        compileExpr(c, node.left);
        compileExpr(c, node.right);
        emit(c, 'BINOP', node.op);
        break;
      }
      case 'UnaryOp': {
        compileExpr(c, node.operand);
        emit(c, 'UNOP', node.op);
        break;
      }
      case 'Assign': {
        if (node.target.kind === 'Ident') {
          if (node.op === '=') compileExpr(c, node.value);
          else {
            emit(c, 'LOAD', node.target.name);
            compileExpr(c, node.value);
            emit(c, 'BINOP', node.op[0]);
          }
          emit(c, 'STORE', node.target.name);
        } else if (node.target.kind === 'Index') {
          compileExpr(c, node.target.object);
          compileExpr(c, node.target.index);
          if (node.op === '=') compileExpr(c, node.value);
          else {
            compileExpr(c, node.target.object);
            compileExpr(c, node.target.index);
            emit(c, 'INDEX');
            compileExpr(c, node.value);
            emit(c, 'BINOP', node.op[0]);
          }
          emit(c, 'SET_INDEX');
        } else if (node.target.kind === 'Member') {
          compileExpr(c, node.target.object);
          if (node.op === '=') compileExpr(c, node.value);
          else {
            compileExpr(c, node.target.object);
            emit(c, 'MEMBER', node.target.property);
            compileExpr(c, node.value);
            emit(c, 'BINOP', node.op[0]);
          }
          emit(c, 'SET_MEMBER', node.target.property);
        } else throw new CompileError('invalid assignment target');
        break;
      }
      case 'Ternary': {
        compileExpr(c, node.cond);
        const jz = emit(c, 'JZ', -1);
        compileExpr(c, node.then);
        const j = emit(c, 'JUMP', -1);
        c.code[jz].a = c.code.length;
        compileExpr(c, node.else);
        c.code[j].a = c.code.length;
        break;
      }
      case 'Call': {
        if (node.callee.kind === 'Member') {
          compileExpr(c, node.callee.object);
          for (const a of node.args) compileExpr(c, a);
          emit(c, 'CALL_METHOD', node.callee.property, node.args.length);
        } else {
          compileExpr(c, node.callee);
          for (const a of node.args) compileExpr(c, a);
          emit(c, 'CALL', node.args.length);
        }
        break;
      }
      case 'Index': {
        compileExpr(c, node.object);
        compileExpr(c, node.index);
        emit(c, 'INDEX');
        break;
      }
      case 'Member': {
        compileExpr(c, node.object);
        emit(c, 'MEMBER', node.property);
        break;
      }
      case 'Lambda': {
        const lc = newChunk('__lambda__', node.params);
        compileBlockTo(lc, node.body);
        emit(lc, 'RET');
        emit(c, 'MAKE_FN', lc.id);
        break;
      }
      case 'NewExpr': {
        for (const a of node.args) compileExpr(c, a);
        emit(c, 'NEW', node.className, node.args.length);
        break;
      }
      case 'Transcendental': {
        compileExpr(c, node.arg);
        emit(c, 'TRANSCEND', node.symbol, node.op);
        break;
      }
      default: throw new CompileError(`cannot compile expression ${node.kind}`);
    }
  }

  compileBlockTo(main, { kind: 'Block', body: program.body });
  emit(main, 'HALT');

  return { main, chunks, constants: [] };
}
