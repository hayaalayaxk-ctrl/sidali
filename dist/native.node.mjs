// src/compiler/native.ts
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// src/compiler/lexer.ts
var KEYWORDS = {
  // English canonical keywords
  "let": "let",
  "const": "const",
  "var": "let",
  "fn": "fn",
  "function": "fn",
  "return": "return",
  "if": "if",
  "else": "else",
  "while": "while",
  "repeat": "repeat",
  "times": "times",
  "for": "for",
  "in": "in",
  "print": "print",
  "class": "class",
  "extends": "extends",
  "new": "new",
  "this": "this",
  "try": "try",
  "catch": "catch",
  "finally": "finally",
  "throw": "throw",
  "true": "true",
  "false": "false",
  "nil": "nil",
  "null": "nil",
  "and": "and",
  "or": "or",
  "not": "not",
  "import": "import",
  "build": "build",
  "contract": "contract",
  "system": "system",
  "platform": "platform",
  "break": "break",
  "continue": "continue",
  // systems keywords (Rust-like)
  "mut": "mut",
  "ref": "ref",
  "struct": "struct",
  "impl": "impl",
  "trait": "trait",
  "enum": "enum",
  "match": "match",
  "unsafe": "unsafe",
  "extern": "extern",
  "pub": "pub",
  "use": "use",
  "mod": "mod",
  "crate": "crate",
  "as": "as",
  "where": "where",
  "dyn": "dyn",
  "move": "move",
  "loop": "loop",
  "type": "type",
  "static": "static",
  "box": "box",
  "unsized": "unsized",
  "async": "async",
  "await": "await",
  "yield": "yield",
  "self": "self",
  "Self": "Self",
  "macro": "macro",
  "packed": "packed",
  "no_std": "no_std",
  "volatile": "volatile",
  "no_mangle": "no_mangle",
  // Arabic source spellings -> canonical English keyword
  "\u0645\u062A\u063A\u064A\u0631": "let",
  "\u062B\u0627\u0628\u062A": "const",
  "\u062F\u0627\u0644\u0629": "fn",
  "\u0627\u0631\u062C\u0627\u0639": "return",
  "\u0625\u0631\u062C\u0627\u0639": "return",
  "\u0627\u0630\u0627": "if",
  "\u0625\u0630\u0627": "if",
  "\u0648\u0627\u0644\u0627": "else",
  "\u0648\u0625\u0644\u0627": "else",
  "\u0637\u0627\u0644\u0645\u0627": "while",
  "\u0643\u0631\u0631": "repeat",
  "\u0644\u0643\u0644": "for",
  "\u0641\u064A": "in",
  "\u0627\u0637\u0628\u0639": "print",
  "\u0637\u0628\u0627\u0639\u0629": "print",
  "\u0635\u0646\u0641": "class",
  "\u064A\u0645\u062A\u062F": "extends",
  "\u062C\u062F\u064A\u062F": "new",
  "\u0647\u0630\u0627": "this",
  "\u0645\u062D\u0627\u0648\u0644\u0629": "try",
  "\u0627\u0644\u062A\u0642\u0627\u0637": "catch",
  "\u0627\u062E\u064A\u0631\u0627": "finally",
  "\u0623\u062E\u064A\u0631\u0627": "finally",
  "\u0627\u0631\u0641\u0639": "throw",
  "\u0635\u062D\u064A\u062D": "true",
  "\u062E\u0637\u0623": "false",
  "\u0644\u0627\u0634\u064A\u0621": "nil",
  "\u0644\u0627_\u0634\u064A\u0621": "nil",
  "\u0648": "and",
  "\u0627\u0648": "or",
  "\u0623\u0648": "or",
  "\u0644\u064A\u0633": "not",
  "\u0639\u0642\u062F": "contract",
  "\u0646\u0638\u0627\u0645": "system",
  "\u0646\u0638\u0627\u0645_\u062A\u0634\u063A\u064A\u0644": "system",
  "\u0628\u0646\u0627\u0621": "build",
  "\u0645\u0646\u0635\u0629": "platform",
  "\u0642\u0627\u0639\u062F\u0629": "database",
  "\u062E\u0627\u062F\u0645": "server",
  "\u0648\u0627\u062C\u0647\u0629": "interface",
  "\u0632\u0648\u062C": "pair",
  "\u062F\u0639": "let",
  "\u0639\u0631\u0641": "let",
  // Arabic systems keywords
  "\u0647\u064A\u0643\u0644": "struct",
  "\u0633\u0645\u0629": "trait",
  "\u062A\u0639\u062F\u0627\u062F": "enum",
  "\u0637\u0627\u0628\u0642": "match",
  "\u063A\u064A\u0631_\u0622\u0645\u0646": "unsafe",
  "\u062E\u0627\u0631\u062C\u064A": "extern",
  "\u0639\u0627\u0645": "pub",
  "\u0627\u0633\u062A\u062E\u062F\u0645": "use",
  "\u0648\u062D\u062F\u0629": "mod",
  "\u0646\u0648\u0639": "type",
  "\u0645\u0631\u062C\u0639": "ref"
};
var PUNCT3 = ["...", "..=", "<<=", ">>=", "===", "!=="];
var PUNCT2 = ["==", "!=", "<=", ">=", "&&", "||", "->", "=>", "+=", "-=", "*=", "/=", "%=", "**", "..", "::"];
var LexError = class extends Error {
  constructor(msg, line, col) {
    super(`LexError at ${line}:${col}: ${msg}`);
    this.line = line;
    this.col = col;
  }
};
function tokenize(src) {
  const toks = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;
  const peek = (k = 0) => src[i + k];
  const advance = () => {
    const c = src[i++];
    if (c === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return c;
  };
  const push = (type, value, l = line, c = col) => toks.push({ type, value, line: l, col: c });
  const isIdStart = (ch) => ch >= "a" && ch <= "z" || ch >= "A" && ch <= "Z" || ch === "_" || ch === "$" || /[\u0600-\u06FF]/.test(ch);
  const isIdPart = (ch) => isIdStart(ch) || ch >= "0" && ch <= "9";
  const isDigit = (ch) => ch >= "0" && ch <= "9";
  while (i < n) {
    const ch = peek();
    if (ch === "\n") {
      const l = line, c = col;
      advance();
      push("newline", "\n", l, c);
      continue;
    }
    if (ch === " " || ch === "	" || ch === "\r") {
      advance();
      continue;
    }
    if (ch === "/" && peek(1) === "/") {
      while (i < n && peek() !== "\n") advance();
      continue;
    }
    if (ch === "/" && peek(1) === "*") {
      advance();
      advance();
      while (i < n && !(peek() === "*" && peek(1) === "/")) advance();
      if (i < n) {
        advance();
        advance();
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "\xAB") {
      const quote = ch === "\xAB" ? "\xBB" : ch;
      const startL2 = line, startC2 = col;
      advance();
      let raw = "";
      while (i < n && peek() !== quote) {
        if (peek() === "\\") {
          advance();
          const e = advance();
          raw += e === "n" ? "\n" : e === "t" ? "	" : e === '"' ? '"' : e === "'" ? "'" : e === "\\" ? "\\" : e;
        } else {
          raw += advance();
        }
      }
      if (i >= n) throw new LexError("unterminated string", startL2, startC2);
      advance();
      push("string", raw, startL2, startC2);
      toks[toks.length - 1].parts = splitInterpolation(raw);
      continue;
    }
    if (isDigit(ch) || ch === "." && isDigit(peek(1))) {
      const startL2 = line, startC2 = col;
      let num = "";
      if (ch === "0" && (peek(1) === "x" || peek(1) === "X")) {
        advance();
        advance();
        while (i < n && /[0-9a-fA-F_]/.test(peek())) num += advance();
        push("number", String(parseInt(num.replace(/_/g, ""), 16)), startL2, startC2);
        continue;
      }
      if (ch === "0" && (peek(1) === "b" || peek(1) === "B")) {
        advance();
        advance();
        while (i < n && /[01_]/.test(peek())) num += advance();
        push("number", String(parseInt(num.replace(/_/g, ""), 2)), startL2, startC2);
        continue;
      }
      while (i < n && (isDigit(peek()) || peek() === "." || peek() === "_")) {
        const c2 = peek();
        if (c2 === "." && !isDigit(peek(1))) break;
        num += advance();
      }
      if ((peek() === "e" || peek() === "E") && (isDigit(peek(1)) || (peek(1) === "+" || peek(1) === "-") && isDigit(peek(2)))) {
        num += advance();
        if (peek() === "+" || peek() === "-") num += advance();
        while (i < n && isDigit(peek())) num += advance();
      }
      push("number", num.replace(/_/g, ""), startL2, startC2);
      continue;
    }
    if (isIdStart(ch)) {
      const startL2 = line, startC2 = col;
      let id = "";
      while (i < n && isIdPart(peek())) id += advance();
      if (KEYWORDS[id]) push("keyword", KEYWORDS[id], startL2, startC2);
      else push("ident", id, startL2, startC2);
      continue;
    }
    const startL = line, startC = col;
    const three = ch + (peek(1) || "") + (peek(2) || "");
    if (PUNCT3.includes(three)) {
      advance();
      advance();
      advance();
      push("op", three, startL, startC);
      continue;
    }
    const two = ch + (peek(1) || "");
    if (PUNCT2.includes(two)) {
      advance();
      advance();
      push("op", two, startL, startC);
      continue;
    }
    if ("+-*/%<>=!&|^~?:".includes(ch)) {
      advance();
      push("op", ch, startL, startC);
      continue;
    }
    if ("(){}[],.;".includes(ch)) {
      advance();
      push("punct", ch, startL, startC);
      continue;
    }
    throw new LexError(`unexpected character ${JSON.stringify(ch)}`, startL, startC);
  }
  push("eof", "");
  return toks;
}
function splitInterpolation(raw) {
  const parts = [];
  let buf = "";
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === "$" && raw[i + 1] === "{") {
      if (buf) {
        parts.push({ text: buf });
        buf = "";
      }
      let depth = 1;
      i += 2;
      let expr = "";
      while (i < raw.length && depth > 0) {
        if (raw[i] === "{") depth++;
        else if (raw[i] === "}") {
          depth--;
          if (depth === 0) break;
        }
        expr += raw[i++];
      }
      i++;
      parts.push({ expr });
    } else {
      buf += raw[i++];
    }
  }
  if (buf) parts.push({ text: buf });
  return parts;
}

// src/compiler/parser.ts
var ParseError = class extends Error {
  constructor(msg, line, col) {
    super(`ParseError at ${line}:${col}: ${msg}`);
    this.line = line;
    this.col = col;
  }
};
function parse(src) {
  let toks;
  try {
    toks = tokenize(src);
  } catch (e) {
    if (e instanceof LexError) throw e;
    throw e;
  }
  let p = 0;
  const cur = () => toks[p];
  const at = (v) => cur().value === v && (cur().type === "keyword" || cur().type === "op" || cur().type === "punct");
  const atKw = (v) => cur().type === "keyword" && cur().value === v;
  const next = () => toks[p++];
  const skipNewlines = () => {
    while (cur().type === "newline") p++;
  };
  const skipSeparators = () => {
    while (cur().type === "newline" || at(";")) p++;
  };
  const expect = (v) => {
    if (!at(v)) throw new ParseError(`expected '${v}' but found '${cur().value || cur().type}'`, cur().line, cur().col);
    return next();
  };
  const expectIdent = () => {
    if (cur().type !== "ident") throw new ParseError(`expected identifier but found '${cur().value || cur().type}'`, cur().line, cur().col);
    return next().value;
  };
  function parseInlineExpr(code) {
    const sub = parse(code);
    const st = sub.body[0];
    if (st && st.kind === "ExprStmt") return st.expr;
    return { kind: "Ident", name: "nil" };
  }
  function parseType() {
    const mk = (name2) => ({
      kind: "Type",
      name: name2,
      args: [],
      ref: false,
      refMut: false,
      ptr: false,
      ptrMut: false,
      arrayLen: null
    });
    if (at("&")) {
      next();
      const mut = atKw("mut");
      if (mut) next();
      const inner = parseType();
      return { ...inner, ref: true, refMut: mut || inner.refMut };
    }
    if (at("*")) {
      next();
      let mut = false;
      if (atKw("mut")) {
        mut = true;
        next();
      } else if (atKw("const")) next();
      const inner = parseType();
      return { ...inner, ptr: true, ptrMut: mut };
    }
    if (at("[")) {
      next();
      const inner = parseType();
      expect(";");
      const len = Number(next().value);
      expect("]");
      return { ...inner, arrayLen: len };
    }
    if (at("(")) {
      next();
      const args = [];
      skipNewlines();
      while (!at(")")) {
        args.push(parseType());
        skipNewlines();
        if (at(",")) {
          next();
          skipNewlines();
        }
      }
      expect(")");
      const t2 = mk("(" + args.map((a) => a.name).join(",") + ")");
      t2.args = args;
      return t2;
    }
    if (cur().type !== "ident" && cur().type !== "keyword") {
      throw new ParseError(`expected type but found '${cur().value || cur().type}'`, cur().line, cur().col);
    }
    let name = next().value;
    while (at("::")) {
      next();
      name += "::" + next().value;
    }
    const t = mk(name);
    if (at("<")) {
      next();
      skipNewlines();
      while (!at(">")) {
        t.args.push(parseType());
        skipNewlines();
        if (at(",")) {
          next();
          skipNewlines();
        }
      }
      expect(">");
    }
    return t;
  }
  function parseGenericParams() {
    const params = [];
    if (at("<")) {
      next();
      skipNewlines();
      while (!at(">")) {
        params.push(expectIdent());
        skipNewlines();
        if (at(":")) {
          next();
          parseType();
        }
        if (at(",")) {
          next();
          skipNewlines();
        }
      }
      expect(">");
    }
    return params;
  }
  function parseFnSignature(name, isPub, isUnsafe, generics, isAsync) {
    expect("(");
    const params = [];
    skipNewlines();
    while (!at(")")) {
      if (at("&")) {
        next();
        const mut = atKw("mut");
        if (mut) next();
        const pname = atKw("self") ? next().value : expectIdent();
        params.push({ name: pname, type: null, mut, self: pname === "self" });
      } else if (atKw("mut")) {
        next();
        const pname = expectIdent();
        let ptype = null;
        if (at(":")) {
          next();
          ptype = parseType();
        }
        params.push({ name: pname, type: ptype, mut: true, self: false });
      } else {
        const pname = atKw("self") ? next().value : expectIdent();
        let ptype = null;
        if (at(":")) {
          next();
          ptype = parseType();
        }
        params.push({ name: pname, type: ptype, mut: false, self: pname === "self" });
      }
      skipNewlines();
      if (at(",")) {
        next();
        skipNewlines();
      }
    }
    expect(")");
    let ret = null;
    if (at("->")) {
      next();
      ret = parseType();
    }
    let body;
    if (at(";")) {
      next();
      body = { kind: "Block", body: [] };
    } else body = parseBlock();
    return { kind: "FnDecl", name, params, body, ret, pub: isPub, unsafe: isUnsafe, generics, isAsync };
  }
  function parseStruct(isPub, reprC, packed) {
    next();
    const name = expectIdent();
    const generics = parseGenericParams();
    if (at(";")) {
      next();
      return { kind: "StructDecl", name, fields: [], pub: isPub, reprC, packed };
    }
    expect("{");
    const fields = [];
    skipSeparators();
    while (!at("}") && cur().type !== "eof") {
      if (atKw("pub")) next();
      const fname = expectIdent();
      expect(":");
      const ftype = parseType();
      fields.push({ name: fname, type: ftype, mut: false, self: false });
      skipSeparators();
      if (at(",")) {
        next();
        skipSeparators();
      }
    }
    expect("}");
    return { kind: "StructDecl", name, fields, pub: isPub, reprC, packed };
  }
  function parseEnum(isPub) {
    next();
    const name = expectIdent();
    parseGenericParams();
    expect("{");
    const variants = [];
    skipSeparators();
    while (!at("}") && cur().type !== "eof") {
      const vname = expectIdent();
      const fields = [];
      if (at("(")) {
        next();
        skipNewlines();
        while (!at(")")) {
          fields.push(parseType());
          skipNewlines();
          if (at(",")) {
            next();
            skipNewlines();
          }
        }
        expect(")");
      } else if (at("{")) {
        next();
        skipSeparators();
        while (!at("}")) {
          expectIdent();
          expect(":");
          fields.push(parseType());
          skipSeparators();
          if (at(",")) {
            next();
            skipSeparators();
          }
        }
        expect("}");
      }
      variants.push({ name: vname, fields });
      skipSeparators();
      if (at(",")) {
        next();
        skipSeparators();
      }
    }
    expect("}");
    return { kind: "EnumDecl", name, variants, pub: isPub };
  }
  function parseTrait(isPub) {
    next();
    const name = expectIdent();
    parseGenericParams();
    expect("{");
    const methods = [];
    skipSeparators();
    while (!at("}") && cur().type !== "eof") {
      if (atKw("fn")) {
        next();
        methods.push(parseFnSignature(expectIdent(), false, false, [], false));
      } else next();
      skipSeparators();
    }
    expect("}");
    return { kind: "TraitDecl", name, methods, pub: isPub };
  }
  function parseImpl() {
    next();
    parseGenericParams();
    let traitName = null;
    let typeName = expectIdent();
    if (atKw("for")) {
      next();
      traitName = typeName;
      typeName = expectIdent();
    }
    expect("{");
    const methods = [];
    skipSeparators();
    while (!at("}") && cur().type !== "eof") {
      if (atKw("fn")) {
        next();
        methods.push(parseFnSignature(expectIdent(), false, false, [], false));
      } else next();
      skipSeparators();
    }
    expect("}");
    return { kind: "ImplBlock", traitName, typeName, methods };
  }
  function parseExtern() {
    next();
    let abi = "C";
    if (cur().type === "string") abi = next().value;
    expect("{");
    const items = [];
    skipSeparators();
    while (!at("}") && cur().type !== "eof") {
      if (atKw("fn")) {
        next();
        items.push(parseFnSignature(expectIdent(), false, false, [], false));
      } else next();
      skipSeparators();
    }
    expect("}");
    return { kind: "ExternBlock", abi, items };
  }
  function parseMatch() {
    next();
    const value = parseExpr();
    expect("{");
    const arms = [];
    skipSeparators();
    while (!at("}") && cur().type !== "eof") {
      let pattern = "_";
      const literals = [];
      if (at("_")) {
        next();
        pattern = "_";
      } else if (cur().type === "number" || cur().type === "string") {
        pattern = "literal";
        literals.push(cur().type === "number" ? { kind: "NumLit", value: Number(next().value) } : { kind: "StrLit", value: next().value });
        while (at("|")) {
          next();
          const tk = next();
          literals.push(tk.type === "number" ? { kind: "NumLit", value: Number(tk.value) } : { kind: "StrLit", value: tk.value });
        }
      } else {
        pattern = expectIdent();
        if (at("(")) {
          next();
          skipNewlines();
          while (!at(")")) {
            expectIdent();
            skipNewlines();
            if (at(",")) {
              next();
              skipNewlines();
            }
          }
          expect(")");
        }
      }
      if (at("=>")) next();
      else expect(":");
      const body = at("{") ? parseBlock() : { kind: "Block", body: [{ kind: "ExprStmt", expr: parseExpr() }] };
      arms.push({ pattern, literals, body });
      skipSeparators();
      if (at(",")) {
        next();
        skipSeparators();
      }
    }
    expect("}");
    return { kind: "MatchStmt", value, arms };
  }
  function parseProgram() {
    const body = [];
    const attributes = [];
    let noStd = false;
    skipSeparators();
    while (cur().type !== "eof") {
      if (at("#")) {
        next();
        if (at("!")) next();
        if (at("[")) {
          next();
          const attrName = expectIdent();
          if (attrName === "no_std") noStd = true;
          attributes.push(attrName);
          if (at("(")) {
            next();
            while (!at(")") && cur().type !== "eof") next();
            expect(")");
          }
          expect("]");
          skipSeparators();
          continue;
        }
      }
      body.push(parseStatement());
      skipSeparators();
    }
    return { kind: "Program", body, attributes, noStd };
  }
  function parseBlock() {
    expect("{");
    const body = [];
    skipSeparators();
    while (!at("}") && cur().type !== "eof") {
      body.push(parseStatement());
      skipSeparators();
    }
    expect("}");
    return { kind: "Block", body };
  }
  function parseStatement() {
    const t = cur();
    let isPub = false;
    if (atKw("pub")) {
      isPub = true;
      next();
    }
    let reprC = false, packed = false;
    while (at("#") && toks[p + 1] && toks[p + 1].value === "[") {
      next();
      next();
      const attr = expectIdent();
      if (attr === "repr") {
        if (at("(")) {
          next();
          const v = expectIdent();
          if (v === "C") reprC = true;
          else if (v === "packed") packed = true;
          expect(")");
        }
      }
      expect("]");
      skipSeparators();
    }
    if (atKw("let")) return parseVarDecl(false);
    if (atKw("const")) return parseVarDecl(true);
    if (atKw("static")) {
      next();
      if (atKw("mut")) next();
      return parseVarDecl(true);
    }
    if (atKw("struct")) return parseStruct(isPub, reprC, packed);
    if (atKw("enum")) return parseEnum(isPub);
    if (atKw("trait")) return parseTrait(isPub);
    if (atKw("impl")) return parseImpl();
    if (atKw("extern")) return parseExtern();
    if (atKw("match")) return parseMatch();
    if (atKw("use")) {
      next();
      let path = "";
      while (cur().type === "ident" || cur().type === "keyword" || at("::")) {
        path += next().value;
      }
      return { kind: "UseStmt", path };
    }
    if (atKw("mod")) {
      next();
      const name = expectIdent();
      if (at(";")) next();
      return { kind: "UseStmt", path: "mod " + name };
    }
    if (atKw("type")) {
      next();
      const name = expectIdent();
      if (at("=")) next();
      const ty = parseType();
      if (at(";")) next();
      return { kind: "TypeAlias", name, type: ty };
    }
    if (atKw("unsafe")) {
      next();
      if (atKw("fn")) {
        next();
        return parseFnSignature(expectIdent(), isPub, true, [], false);
      }
      const body = parseBlock();
      return { kind: "UnsafeBlock", body };
    }
    if (atKw("fn")) {
      next();
      const name = expectIdent();
      const generics = parseGenericParams();
      return parseFnSignature(name, isPub, false, generics, false);
    }
    if (atKw("class")) {
      next();
      const name = expectIdent();
      let parent = null;
      if (atKw("extends")) {
        next();
        parent = expectIdent();
      }
      expect("{");
      const members = [];
      skipSeparators();
      while (!at("}") && cur().type !== "eof") {
        if (atKw("let") || atKw("const")) {
          members.push(parseVarDecl(atKw("const")));
        } else {
          const mName = expectIdent();
          const params = parseLegacyParams();
          const body = parseBlock();
          members.push({ kind: "FnDecl", name: mName, params, body, ret: null, pub: false, unsafe: false, generics: [], isAsync: false });
        }
        skipSeparators();
      }
      expect("}");
      return { kind: "ClassDecl", name, parent, members };
    }
    if (atKw("contract")) {
      next();
      const name = expectIdent();
      const body = parseBlock();
      return { kind: "ContractDecl", name, body };
    }
    if (atKw("system") || atKw("platform")) {
      const target = next().value;
      const name = expectIdent();
      return { kind: "BuildStmt", target, args: [{ kind: "StrLit", value: name }] };
    }
    if (atKw("build")) {
      next();
      const parts = [];
      while (cur().type === "ident" || cur().type === "keyword") parts.push(next().value);
      const args = parts.length ? [{ kind: "StrLit", value: parts.join(" ") }] : [];
      return { kind: "BuildStmt", target: "build", args };
    }
    if (atKw("import")) {
      next();
      const name = expectIdent();
      return { kind: "ImportStmt", name };
    }
    if (atKw("return")) {
      next();
      let value = null;
      if (cur().type !== "newline" && !at("}") && !at(";") && cur().type !== "eof") value = parseExpr();
      return { kind: "ReturnStmt", value };
    }
    if (atKw("if")) return parseIf();
    if (atKw("while")) {
      next();
      const cond = parseExpr();
      const body = parseBlock();
      return { kind: "WhileStmt", cond, body };
    }
    if (atKw("loop")) {
      next();
      const body = parseBlock();
      return { kind: "WhileStmt", cond: { kind: "BoolLit", value: true }, body };
    }
    if (atKw("repeat")) {
      next();
      const count = parseExpr();
      if (atKw("times")) next();
      const body = parseBlock();
      return { kind: "RepeatStmt", count, body };
    }
    if (atKw("for")) {
      next();
      const varName = expectIdent();
      if (atKw("in")) next();
      const iter = parseExpr();
      const body = parseBlock();
      return { kind: "ForStmt", varName, iter, body };
    }
    if (atKw("print")) {
      next();
      let value;
      if (at("(")) {
        next();
        value = parseExpr();
        expect(")");
      } else value = parseExpr();
      return { kind: "PrintStmt", value };
    }
    if (atKw("break")) {
      next();
      return { kind: "BreakStmt" };
    }
    if (atKw("continue")) {
      next();
      return { kind: "ContinueStmt" };
    }
    if (atKw("throw")) {
      next();
      return { kind: "ThrowStmt", value: parseExpr() };
    }
    if (atKw("try")) return parseTry();
    if (at("{")) return parseBlock();
    const expr = parseExpr();
    return { kind: "ExprStmt", expr };
  }
  function parseLegacyParams() {
    expect("(");
    const params = [];
    skipNewlines();
    while (!at(")")) {
      const name = expectIdent();
      let type = null;
      if (at(":")) {
        next();
        type = parseType();
      }
      params.push({ name, type, mut: false, self: name === "self" });
      skipNewlines();
      if (at(",")) {
        next();
        skipNewlines();
      }
    }
    expect(")");
    return params;
  }
  function parseVarDecl(isConst) {
    next();
    let mut = false;
    if (atKw("mut")) {
      mut = true;
      next();
    }
    const name = expectIdent();
    let type = null;
    if (at(":")) {
      next();
      type = parseType();
    }
    let init = null;
    if (at("=")) {
      next();
      init = parseExpr();
    }
    return isConst ? { kind: "ConstDecl", name, init, mut, type } : { kind: "VarDecl", name, init, mut, type };
  }
  function parseParams() {
    expect("(");
    const params = [];
    skipNewlines();
    while (!at(")")) {
      const name = expectIdent();
      let type = null;
      if (at(":")) {
        next();
        type = parseType();
      }
      params.push({ name, type, mut: false, self: name === "self" });
      skipNewlines();
      if (at(",")) {
        next();
        skipNewlines();
      }
    }
    expect(")");
    return params;
  }
  function parseIf() {
    next();
    const cond = parseExpr();
    const then = parseBlock();
    let els = null;
    skipSeparators();
    if (atKw("else")) {
      next();
      skipSeparators();
      if (atKw("if")) els = parseIf();
      else els = parseBlock();
    }
    return { kind: "IfStmt", cond, then, else: els };
  }
  function parseTry() {
    next();
    const body = parseBlock();
    skipSeparators();
    let param = "err";
    let handler = { kind: "Block", body: [] };
    if (atKw("catch")) {
      next();
      if (at("(")) {
        next();
        param = expectIdent();
        expect(")");
      }
      handler = parseBlock();
      skipSeparators();
    }
    let finalizer = null;
    if (atKw("finally")) {
      next();
      finalizer = parseBlock();
    }
    return { kind: "TryStmt", body, param, handler, finalizer };
  }
  function parseExpr() {
    return parseAssign();
  }
  function parseAssign() {
    const left = parseTernary();
    if (["=", "+=", "-=", "*=", "/=", "%="].includes(cur().value) && cur().type === "op") {
      const op = next().value;
      const value = parseAssign();
      return { kind: "Assign", op, target: left, value };
    }
    return left;
  }
  function parseTernary() {
    const cond = parseOr();
    if (at("?")) {
      next();
      const then = parseExpr();
      expect(":");
      const els = parseExpr();
      return { kind: "Ternary", cond, then, else: els };
    }
    return cond;
  }
  function parseOr() {
    let left = parseAnd();
    while (at("||") || atKw("or")) {
      next();
      const right = parseAnd();
      left = { kind: "BinOp", op: "||", left, right };
    }
    return left;
  }
  function parseAnd() {
    let left = parseEquality();
    while (at("&&") || atKw("and")) {
      next();
      const right = parseEquality();
      left = { kind: "BinOp", op: "&&", left, right };
    }
    return left;
  }
  function parseEquality() {
    let left = parseComparison();
    while (at("==") || at("!=")) {
      const op = next().value;
      left = { kind: "BinOp", op, left, right: parseComparison() };
    }
    return left;
  }
  function parseComparison() {
    let left = parseRange();
    while (at("<") || at(">") || at("<=") || at(">=")) {
      const op = next().value;
      left = { kind: "BinOp", op, left, right: parseRange() };
    }
    return left;
  }
  function parseRange() {
    let left = parseAdditive();
    if (at("..") || at("..=")) {
      const inclusive = cur().value === "..=";
      next();
      if (at(")") || at("]") || at(",") || at("{") || cur().type === "newline" || cur().type === "eof") {
        return { kind: "RangeExpr", start: left, end: null, inclusive };
      }
      const right = parseAdditive();
      return { kind: "RangeExpr", start: left, end: right, inclusive };
    }
    return left;
  }
  function parseAdditive() {
    let left = parseMultiplicative();
    while (at("+") || at("-")) {
      const op = next().value;
      left = { kind: "BinOp", op, left, right: parseMultiplicative() };
    }
    return left;
  }
  function parseMultiplicative() {
    let left = parsePower();
    while (at("*") || at("/") || at("%")) {
      const op = next().value;
      left = { kind: "BinOp", op, left, right: parsePower() };
    }
    return left;
  }
  function parsePower() {
    const left = parseUnary();
    if (at("**")) {
      next();
      const right = parsePower();
      return { kind: "BinOp", op: "**", left, right };
    }
    return left;
  }
  function parseUnary() {
    if (at("&")) {
      next();
      const mut = atKw("mut");
      if (mut) next();
      return { kind: "RefExpr", value: parseUnary(), mut };
    }
    if (at("*")) {
      next();
      return { kind: "Deref", value: parseUnary() };
    }
    if (at("!") || at("-") || at("+") || at("~") || atKw("not")) {
      const raw = next().value;
      const op = raw === "not" ? "!" : raw;
      return { kind: "UnaryOp", op, operand: parseUnary() };
    }
    return parsePostfix();
  }
  function parsePostfix() {
    let node = parsePrimary();
    for (; ; ) {
      if (at("(")) {
        next();
        const args = [];
        skipNewlines();
        while (!at(")")) {
          args.push(parseExpr());
          skipNewlines();
          if (at(",")) {
            next();
            skipNewlines();
          }
        }
        expect(")");
        node = { kind: "Call", callee: node, args };
      } else if (at("[")) {
        next();
        const index = parseExpr();
        expect("]");
        node = { kind: "Index", object: node, index };
      } else if (at(".")) {
        next();
        const prop = cur().type === "ident" || cur().type === "keyword" ? next().value : (() => {
          throw new ParseError("expected property name", cur().line, cur().col);
        })();
        node = { kind: "Member", object: node, property: prop };
      } else if (atKw("as")) {
        next();
        const type = parseType();
        node = { kind: "Cast", value: node, type };
      } else break;
    }
    return node;
  }
  function parsePrimary() {
    const t = cur();
    if (t.type === "number") {
      next();
      return { kind: "NumLit", value: Number(t.value) };
    }
    if (t.type === "string") {
      next();
      const parts = t.parts || [];
      if (parts.length === 1 && parts[0].text !== void 0) return { kind: "StrLit", value: parts[0].text };
      return {
        kind: "InterpStr",
        parts: parts.map((pp) => pp.expr !== void 0 ? { expr: parseInlineExpr(pp.expr) } : { text: pp.text })
      };
    }
    if (atKw("true")) {
      next();
      return { kind: "BoolLit", value: true };
    }
    if (atKw("false")) {
      next();
      return { kind: "BoolLit", value: false };
    }
    if (atKw("nil")) {
      next();
      return { kind: "NilLit" };
    }
    if (atKw("fn")) {
      next();
      const params = parseParams();
      let ret = null;
      if (at("->")) {
        next();
        ret = parseType();
      }
      const body = parseBlock();
      return { kind: "Lambda", params: params.map((pp) => pp.name), body, ret };
    }
    if (atKw("new")) {
      next();
      const className = expectIdent();
      const args = [];
      if (at("(")) {
        next();
        skipNewlines();
        while (!at(")")) {
          args.push(parseExpr());
          skipNewlines();
          if (at(",")) {
            next();
            skipNewlines();
          }
        }
        expect(")");
      }
      return { kind: "NewExpr", className, args };
    }
    if (at("(")) {
      next();
      const e = parseExpr();
      expect(")");
      return e;
    }
    if (at("[")) {
      next();
      const items = [];
      skipNewlines();
      while (!at("]")) {
        items.push(parseExpr());
        skipNewlines();
        if (at(",")) {
          next();
          skipNewlines();
        }
      }
      expect("]");
      return { kind: "ArrayLit", items };
    }
    if (at("{")) {
      next();
      const entries = [];
      skipNewlines();
      while (!at("}")) {
        let key;
        if (cur().type === "string" || cur().type === "ident" || cur().type === "keyword") key = next().value;
        else throw new ParseError("expected object key", cur().line, cur().col);
        expect(":");
        const value = parseExpr();
        entries.push({ key, value });
        skipNewlines();
        if (at(",")) {
          next();
          skipNewlines();
        }
      }
      expect("}");
      return { kind: "ObjectLit", entries };
    }
    if (t.type === "ident" || atKw("this") || atKw("self") || atKw("Self")) {
      if (atKw("this")) {
        next();
        return { kind: "Ident", name: "this" };
      }
      next();
      let name = t.value;
      while (at("::")) {
        next();
        name += "::" + (cur().type === "ident" || cur().type === "keyword" ? next().value : expectIdent());
      }
      if (at("{") && name !== "this") {
        const save = p;
        next();
        skipNewlines();
        const isStructLit = (cur().type === "ident" || cur().type === "keyword") && toks[p + 1] && (toks[p + 1].value === ":" || toks[p + 1].value === ",");
        p = save;
        if (isStructLit) {
          next();
          const entries = [];
          skipNewlines();
          while (!at("}")) {
            const key = cur().type === "string" || cur().type === "ident" || cur().type === "keyword" ? next().value : expectIdent();
            expect(":");
            entries.push({ key, value: parseExpr() });
            skipNewlines();
            if (at(",")) {
              next();
              skipNewlines();
            }
          }
          expect("}");
          return { kind: "ObjectLit", entries, typeName: name };
        }
      }
      if ((name === "pi" || name === "PI") && cur().value === "(") {
        next();
        const arg = parseExpr();
        expect(")");
        return { kind: "Transcendental", symbol: "pi", op: "mul", arg };
      }
      if (name === "pi" || name === "PI") return { kind: "Ident", name: "PI" };
      if (name === "e" && cur().value === "(") {
        next();
        const arg = parseExpr();
        expect(")");
        return { kind: "Transcendental", symbol: "e", op: "log", arg };
      }
      return { kind: "Ident", name };
    }
    throw new ParseError(`unexpected token '${t.value || t.type}'`, t.line, t.col);
  }
  return parseProgram();
}

// src/compiler/llvm.ts
var SUBSTRATES = ["electron", "photon", "qubit", "fluidic", "vacuum", "holographic", "plasma", "energy", "generic"];
var TARGETS = {
  "x86_64-linux": { name: "x86_64-linux", triple: "x86_64-unknown-linux-gnu", cpu: "", march: "", features: "", freestanding: false, ptrBits: 64 },
  "aarch64-linux": { name: "aarch64-linux", triple: "aarch64-unknown-linux-gnu", cpu: "", march: "", features: "", freestanding: false, ptrBits: 64 },
  "armv7m-none-eabi": { name: "armv7m-none-eabi", triple: "thumbv7m-none-eabi", cpu: "cortex-m3", march: "armv7-m", features: "", freestanding: true, ptrBits: 32, substrate: "electron" },
  "cortex-m4": { name: "cortex-m4", triple: "thumbv7em-none-eabi", cpu: "cortex-m4", march: "armv7e-m", features: "", freestanding: true, ptrBits: 32, substrate: "electron" },
  "riscv32-none-elf": { name: "riscv32-none-elf", triple: "riscv32-none-elf", cpu: "", march: "rv32imac", features: "", freestanding: true, ptrBits: 32, substrate: "electron" },
  "riscv64-none-elf": { name: "riscv64-none-elf", triple: "riscv64-none-elf", cpu: "", march: "rv64imac", features: "", freestanding: true, ptrBits: 64, substrate: "electron" },
  wasm32: { name: "wasm32", triple: "wasm32-unknown-unknown", cpu: "generic", march: "", features: "", freestanding: true, ptrBits: 32, substrate: "electron" },
  bpfel: { name: "bpfel", triple: "bpfel-unknown-none", cpu: "generic", march: "", features: "", freestanding: true, ptrBits: 64, objectOnly: true, substrate: "electron" },
  // --- non-electron substrates: same SAIR, different physics.
  // Photonic/quantum/fluidic/vacuum/holographic/plasma/energy logic all lowers to
  // a real clang architecture today (RISC-V, ARM, wasm); the DNA header records
  // which physical substrate the image is destined for.
  "photon-riscv": { name: "photon-riscv", triple: "riscv64-unknown-none-elf", cpu: "", march: "rv64imac", features: "", freestanding: true, ptrBits: 64, substrate: "photon" },
  "qubit-riscv": { name: "qubit-riscv", triple: "riscv32-unknown-none-elf", cpu: "", march: "rv32imac", features: "", freestanding: true, ptrBits: 32, substrate: "qubit" },
  "fluidic-riscv": { name: "fluidic-riscv", triple: "riscv32-unknown-none-elf", cpu: "", march: "rv32imac", features: "", freestanding: true, ptrBits: 32, substrate: "fluidic" },
  "vacuum-riscv": { name: "vacuum-riscv", triple: "riscv64-unknown-none-elf", cpu: "", march: "rv64imac", features: "", freestanding: true, ptrBits: 64, substrate: "vacuum" },
  "holographic-wasm": { name: "holographic-wasm", triple: "wasm32-unknown-unknown", cpu: "generic", march: "", features: "", freestanding: true, ptrBits: 32, substrate: "holographic" },
  "plasma-arm": { name: "plasma-arm", triple: "thumbv7em-none-eabi", cpu: "cortex-m4", march: "armv7e-m", features: "", freestanding: true, ptrBits: 32, substrate: "plasma" },
  "energy-riscv": { name: "energy-riscv", triple: "riscv32-unknown-none-elf", cpu: "", march: "rv32imac", features: "", freestanding: true, ptrBits: 32, substrate: "energy" }
};
var LlvmError = class extends Error {
};
var I64 = { name: "i64", llvm: "i64", kind: "int", bits: 64, signed: true };
var I32 = { name: "i32", llvm: "i32", kind: "int", bits: 32, signed: true };
var F64 = { name: "f64", llvm: "double", kind: "float", bits: 64 };
var VOID = { name: "void", llvm: "void", kind: "void" };
var BOOL = { name: "bool", llvm: "i1", kind: "bool" };
var STR = { name: "str", llvm: "ptr", kind: "str" };
var PTR = { name: "ptr", llvm: "ptr", kind: "ptr" };
function intType(bits, signed) {
  return { name: `${signed ? "i" : "u"}${bits}`, llvm: `i${bits}`, kind: "int", bits, signed };
}
var PRIM = {
  i8: intType(8, true),
  u8: intType(8, false),
  char: intType(8, false),
  i16: intType(16, true),
  u16: intType(16, false),
  i32: intType(32, true),
  u32: intType(32, false),
  i64: intType(64, true),
  u64: intType(64, false),
  int: I64,
  isize: I64,
  usize: I64,
  long: I64,
  f32: { name: "f32", llvm: "float", kind: "float", bits: 32 },
  f64: F64,
  float: F64,
  bool: BOOL,
  str: STR,
  string: STR,
  void: VOID
};
function emitLlvm(program, opts) {
  const target = TARGETS[opts.target];
  if (!target) throw new LlvmError(`unknown target '${opts.target}' (available: ${Object.keys(TARGETS).join(", ")})`);
  const gen = new LlvmGen(program, target, opts.optLevel ?? 2, opts.entry ?? "main");
  return { ir: gen.generate(), target };
}
var LlvmGen = class {
  constructor(program, target, optLevel, entry) {
    this.program = program;
    this.target = target;
    this.optLevel = optLevel;
    this.entry = entry;
    this.structs = /* @__PURE__ */ new Map();
    this.enums = /* @__PURE__ */ new Map();
    this.fns = /* @__PURE__ */ new Map();
    this.lines = [];
    this.strings = [];
    this.strCounter = 0;
    this.regCounter = 0;
    this.labelCounter = 0;
    this.currentRet = VOID;
    this.locals = /* @__PURE__ */ new Map();
    this.loopStack = [];
    this.declares = [];
    this.rangeEnd = null;
    this.selfStruct = null;
    this.globals = /* @__PURE__ */ new Map();
  }
  /** Evaluate a compile-time constant expression to an LLVM constant string. */
  constEval(node, ty) {
    switch (node.kind) {
      case "NumLit":
        return ty.kind === "float" ? this.floatLit(node.value) : String(Math.trunc(node.value));
      case "BoolLit":
        return node.value ? "1" : "0";
      case "StrLit": {
        const s = this.internString(node.value);
        return this.ptrToStrConst(s.name);
      }
      case "UnaryOp": {
        const v = this.constEval(node.operand, ty);
        if (v === null) return null;
        if (node.op === "-") return ty.kind === "float" ? `-${v}` : String(-Number(v));
        return v;
      }
      case "BinOp": {
        const l = this.constEval(node.left, ty), r = this.constEval(node.right, ty);
        if (l === null || r === null) return null;
        if (ty.kind === "float") {
          const a2 = Number(l), b2 = Number(r);
          return String(node.op === "+" ? a2 + b2 : node.op === "-" ? a2 - b2 : node.op === "*" ? a2 * b2 : node.op === "/" ? a2 / b2 : 0);
        }
        const a = Number(l), b = Number(r);
        const ops = { "+": a + b, "-": a - b, "*": a * b, "/": Math.trunc(a / b), "%": a % b, "<<": a << b, ">>": a >> b, "&": a & b, "|": a | b, "^": a ^ b };
        return ops[node.op] !== void 0 ? String(ops[node.op]) : null;
      }
      case "Ident": {
        const g2 = this.globals.get(node.name);
        return null;
      }
      default:
        return null;
    }
  }
  ptrToStrConst(name) {
    return `getelementptr inbounds ([1 x i8], ptr ${name}, i64 0, i64 0)`;
  }
  genGlobal(node) {
    const ty = node.type ? this.resolveType(node.type) : this.inferType(node.init);
    this.globals.set(node.name, ty);
    const isConst = node.kind === "ConstDecl";
    const init = node.init ? this.constEval(node.init, ty) : null;
    const value = init !== null ? init : this.zero(ty);
    this.declares.push(`@${node.name} = ${isConst ? "constant" : "global"} ${ty.llvm} ${value}`);
  }
  reg() {
    return `%t${this.regCounter++}`;
  }
  label(p = "L") {
    return `${p}.${this.labelCounter++}`;
  }
  emit(line) {
    this.lines.push("  " + line);
  }
  emitRaw(line) {
    this.lines.push(line);
  }
  internString(s) {
    const idx = this.strCounter++;
    const name = `@.str.${idx}`;
    const bytes = [...new TextEncoder().encode(s)];
    const esc = bytes.map((b) => {
      if (b === 34) return "\\22";
      if (b === 92) return "\\5C";
      if (b >= 32 && b < 127) return String.fromCharCode(b);
      return "\\" + b.toString(16).toUpperCase().padStart(2, "0");
    }).join("");
    this.strings.push(`${name} = private unnamed_addr constant [${bytes.length + 1} x i8] c"${esc}\\00", align 1`);
    return { name, len: bytes.length };
  }
  gepStr(name) {
    const r = this.reg();
    this.emit(`${r} = getelementptr inbounds i8, ptr ${name}, i64 0`);
    return r;
  }
  // ---------- type resolution ----------
  resolveType(t) {
    if (!t) return I64;
    if (t.ptr || t.ref) return PTR;
    if (t.arrayLen !== null && t.arrayLen !== void 0) {
      const elem = this.resolveType({ ...t, arrayLen: null });
      return { name: `[${t.arrayLen} x ${elem.name}]`, llvm: `[${t.arrayLen} x ${elem.llvm}]`, kind: "array", elem, len: t.arrayLen };
    }
    const base = PRIM[t.name];
    if (base) return base;
    if (t.name.startsWith("(")) return I64;
    if (this.structs.has(t.name)) return this.structs.get(t.name);
    if (this.enums.has(t.name)) return I64;
    return I64;
  }
  fieldIndex(structName, field) {
    const st = this.structs.get(structName);
    if (!st || !st.fields) return null;
    for (let i = 0; i < st.fields.length; i++) if (st.fields[i].name === field) return { idx: i, ty: st.fields[i].ty };
    return null;
  }
  // ---------- program ----------
  generate() {
    this.collectTypes();
    this.collectFns();
    const bodyLines = [];
    for (const node of this.program.body) {
      if (node.kind === "FnDecl") bodyLines.push(this.genFunction(node));
      else if (node.kind === "ImplBlock") {
        for (const m of node.methods) bodyLines.push(this.genFunction(m, `${node.typeName}.${m.name}`));
      } else if (node.kind === "ConstDecl" || node.kind === "VarDecl" && node.type) {
        this.genGlobal(node);
      }
    }
    if (this.target.freestanding && this.fns.has(`@${this.entry}`)) {
      bodyLines.push(`define void @_start() {
entry:
  call ${this.fns.get(`@${this.entry}`).ret.llvm} @${this.entry}()
  ret void
}
`);
    }
    const header = [];
    header.push(`; SidAli -> LLVM IR`);
    header.push(`source_filename = "sidali"`);
    header.push(`target triple = "${this.target.triple}"`);
    header.push("");
    header.push("declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)");
    header.push("declare double @llvm.log.f64(double)");
    header.push("declare double @llvm.pow.f64(double, double)");
    if (this.target.freestanding) {
      const builtins = [
        ["sid_write", "declare void @sid_write(ptr, i64)"],
        ["sid_read", "declare i64 @sid_read()"],
        ["sid_mmio_write", "declare void @sid_mmio_write(i64, i64)"],
        ["sid_mmio_read", "declare i64 @sid_mmio_read(i64)"]
      ];
      for (const [fn, decl] of builtins) if (!this.fns.has(`@${fn}`)) header.push(decl);
    }
    header.push("");
    header.push(...this.declares);
    header.push("");
    header.push(...this.strings);
    header.push("");
    const fnDecls = [...this.fns.entries()].filter(([, v]) => v.extern).map(([name, v]) => `declare ${v.ret.llvm} ${name}(${v.params.map((p) => p.llvm).join(", ")}${v.variadic ? v.params.length ? ", ..." : "..." : ""})`);
    header.push(...fnDecls);
    header.push("");
    return [...header, ...bodyLines].join("\n") + "\n";
  }
  collectTypes() {
    for (const node of this.program.body) {
      if (node.kind === "StructDecl") {
        const fields = [];
        for (const f of node.fields) fields.push({ name: f.name, ty: this.resolveType(f.type) });
        this.structs.set(node.name, { name: node.name, llvm: `%struct.${node.name}`, kind: "struct", fields });
      } else if (node.kind === "EnumDecl") {
        this.enums.set(node.name, node.variants.map((v) => v.name));
      }
    }
    for (const [name, st] of this.structs) {
      const body = (st.fields || []).map((f) => f.ty.llvm).join(", ");
      this.declares.push(`%struct.${name} = type { ${body} }`);
    }
  }
  collectFns() {
    for (const node of this.program.body) {
      if (node.kind === "FnDecl") {
        this.fns.set(`@${node.name}`, { params: node.params.map((p) => this.resolveType(p.type)), ret: this.resolveType(node.ret), variadic: false, extern: false });
      } else if (node.kind === "ExternBlock") {
        for (const fn of node.items) {
          this.fns.set(`@${fn.name}`, { params: fn.params.map((p) => this.resolveType(p.type)), ret: this.resolveType(fn.ret), variadic: false, extern: true });
        }
      } else if (node.kind === "ImplBlock") {
        for (const m of node.methods) {
          this.fns.set(`@${node.typeName}.${m.name}`, { params: m.params.map((p) => this.resolveType(p.type)), ret: this.resolveType(m.ret), variadic: false, extern: false });
        }
      }
    }
    if (!this.target.freestanding) {
      if (!this.fns.has("@printf")) this.fns.set("@printf", { params: [PTR], ret: I32, variadic: true, extern: true });
      if (!this.fns.has("@snprintf")) this.fns.set("@snprintf", { params: [PTR, I64, PTR], ret: I32, variadic: true, extern: true });
      if (!this.fns.has("@puts")) this.fns.set("@puts", { params: [PTR], ret: I32, variadic: false, extern: true });
    }
  }
  genFunction(fn, mangled) {
    const name = mangled || fn.name;
    const ret = this.resolveType(fn.ret);
    const params = fn.params;
    const paramTys = params.map((p) => this.resolveType(p.type));
    const selfType = mangled ? this.structs.get(mangled.split(".")[0]) : void 0;
    const savedLines = this.lines, savedLocals = this.locals, savedReg = this.regCounter, savedLabel = this.labelCounter, savedRet = this.currentRet, savedSelf = this.selfStruct;
    this.lines = [];
    this.locals = /* @__PURE__ */ new Map();
    this.regCounter = 0;
    this.labelCounter = 0;
    this.currentRet = ret;
    this.selfStruct = selfType ? selfType.name : null;
    const argNames = [];
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p.self) {
        argNames.push(`ptr %self`);
        continue;
      }
      argNames.push(`${paramTys[i].llvm} %${p.name}`);
    }
    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      if (p.self) {
        const selfTy = selfType || PTR;
        this.locals.set("self", { ptr: "%self", ty: selfTy, mut: false });
        this.locals.set("this", { ptr: "%self", ty: selfTy, mut: false });
        continue;
      }
      const slot = `%${p.name}.addr`;
      this.emit(`${slot} = alloca ${paramTys[i].llvm}`);
      this.emit(`store ${paramTys[i].llvm} %${p.name}, ptr ${slot}`);
      this.locals.set(p.name, { ptr: slot, ty: paramTys[i], mut: true });
    }
    this.genBlock(fn.body);
    if (ret.llvm === "void") this.emit("ret void");
    else if (ret.kind === "float") this.emit(`ret ${ret.llvm} 0.0`);
    else if (ret.llvm === "ptr") this.emit("ret ptr null");
    else if (ret.kind === "struct") this.emit(`ret ${ret.llvm} zeroinitializer`);
    else this.emit(`ret ${ret.llvm} 0`);
    const body = this.lines;
    this.lines = savedLines;
    this.locals = savedLocals;
    this.regCounter = savedReg;
    this.labelCounter = savedLabel;
    this.currentRet = savedRet;
    this.selfStruct = savedSelf;
    return [`define ${ret.llvm} @${name}(${argNames.join(", ")}) {`, "entry:", ...body, "}", ""].join("\n");
  }
  genBlock(block) {
    for (const st of block.body) this.genStmt(st);
  }
  // ---------- statements ----------
  genStmt(node) {
    switch (node.kind) {
      case "VarDecl":
      case "ConstDecl": {
        const decl = node;
        const ty = decl.type ? this.resolveType(decl.type) : decl.init ? this.inferType(decl.init) : I64;
        const slot = `%${decl.name}.addr.${this.regCounter}`;
        this.emit(`${slot} = alloca ${ty.llvm}`);
        if (decl.init) {
          const v = this.coerce(this.genExpr(decl.init, ty), ty);
          this.emit(`store ${ty.llvm} ${v.val}, ptr ${slot}`);
        } else {
          this.emit(`store ${ty.llvm} ${this.zero(ty)}, ptr ${slot}`);
        }
        this.locals.set(decl.name, { ptr: slot, ty, mut: !!decl.mut });
        break;
      }
      case "ExprStmt": {
        this.genExpr(node.expr);
        break;
      }
      case "PrintStmt": {
        this.genPrint(node);
        break;
      }
      case "ReturnStmt": {
        if (node.value) {
          const v = this.coerce(this.genExpr(node.value, this.currentRet), this.currentRet);
          this.emit(`ret ${this.currentRet.llvm} ${v.val}`);
        } else if (this.currentRet.llvm === "void") this.emit("ret void");
        else if (this.currentRet.kind === "float") this.emit(`ret ${this.currentRet.llvm} 0.0`);
        else this.emit(`ret ${this.currentRet.llvm} 0`);
        break;
      }
      case "IfStmt": {
        const c = this.toBool(this.genExpr(node.cond, BOOL));
        const thenL = this.label("if.then"), elseL = this.label("if.else"), endL = this.label("if.end");
        this.emit(`br i1 ${c.val}, label %${thenL}, label %${node.else ? elseL : endL}`);
        this.emitRaw(`${thenL}:`);
        this.genBlock(node.then);
        this.emit(`br label %${endL}`);
        if (node.else) {
          this.emitRaw(`${elseL}:`);
          if (node.else.kind === "IfStmt") this.genStmt(node.else);
          else this.genBlock(node.else);
          this.emit(`br label %${endL}`);
        }
        this.emitRaw(`${endL}:`);
        break;
      }
      case "WhileStmt": {
        const condL = this.label("while.cond"), bodyL = this.label("while.body"), endL = this.label("while.end");
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
      case "RepeatStmt": {
        const count = this.genExpr(node.count, I64);
        const slot = `%rep.n.${this.regCounter}`;
        this.emit(`${slot} = alloca i64`);
        this.emit(`store i64 ${count.val}, ptr ${slot}`);
        const idx = `%rep.i.${this.regCounter}`;
        this.emit(`${idx} = alloca i64`);
        this.emit(`store i64 0, ptr ${idx}`);
        const condL = this.label("rep.cond"), bodyL = this.label("rep.body"), endL = this.label("rep.end");
        this.emit(`br label %${condL}`);
        this.emitRaw(`${condL}:`);
        const i0 = this.reg();
        this.emit(`${i0} = load i64, ptr ${idx}`);
        const n0 = this.reg();
        this.emit(`${n0} = load i64, ptr ${slot}`);
        const cmp = this.reg();
        this.emit(`${cmp} = icmp slt i64 ${i0}, ${n0}`);
        this.emit(`br i1 ${cmp}, label %${bodyL}, label %${endL}`);
        this.emitRaw(`${bodyL}:`);
        this.loopStack.push({ brk: endL, cont: condL });
        this.genBlock(node.body);
        this.loopStack.pop();
        const i1 = this.reg();
        this.emit(`${i1} = load i64, ptr ${idx}`);
        const i2 = this.reg();
        this.emit(`${i2} = add i64 ${i1}, 1`);
        this.emit(`store i64 ${i2}, ptr ${idx}`);
        this.emit(`br label %${condL}`);
        this.emitRaw(`${endL}:`);
        break;
      }
      case "ForStmt": {
        this.genFor(node);
        break;
      }
      case "BreakStmt": {
        const l = this.loopStack[this.loopStack.length - 1];
        if (l) this.emit(`br label %${l.brk}`);
        break;
      }
      case "ContinueStmt": {
        const l = this.loopStack[this.loopStack.length - 1];
        if (l) this.emit(`br label %${l.cont}`);
        break;
      }
      case "UnsafeBlock": {
        this.genBlock(node.body);
        break;
      }
      case "MatchStmt": {
        this.genMatch(node);
        break;
      }
      case "Block": {
        this.genBlock(node);
        break;
      }
      case "ContractDecl": {
        this.genBlock(node.body);
        break;
      }
      case "TryStmt": {
        this.genBlock(node.body);
        if (node.finalizer) this.genBlock(node.finalizer);
        break;
      }
      default: {
        this.genExpr(node);
      }
    }
  }
  zero(ty) {
    if (ty.kind === "float") return "0.0";
    if (ty.llvm === "ptr") return "null";
    if (ty.kind === "array" || ty.kind === "struct") return "zeroinitializer";
    return "0";
  }
  genFor(node) {
    const iter = this.genExpr(node.iter);
    if (iter.ty.kind === "array" && iter.ty.elem) {
      const elemTy = iter.ty.elem;
      const arrSlot = `%for.arr.${this.regCounter}`;
      this.emit(`${arrSlot} = alloca ptr`);
      this.emit(`store ptr ${iter.val}, ptr ${arrSlot}`);
      const idx = `%for.i.${this.regCounter}`;
      this.emit(`${idx} = alloca i64`);
      this.emit(`store i64 0, ptr ${idx}`);
      const slot2 = `%${node.varName}.addr.${this.regCounter}`;
      this.emit(`${slot2} = alloca ${elemTy.llvm}`);
      this.locals.set(node.varName, { ptr: slot2, ty: elemTy, mut: false });
      const condL2 = this.label("for.cond"), bodyL2 = this.label("for.body"), endL2 = this.label("for.end");
      this.emit(`br label %${condL2}`);
      this.emitRaw(`${condL2}:`);
      const i02 = this.reg();
      this.emit(`${i02} = load i64, ptr ${idx}`);
      const c2 = this.reg();
      this.emit(`${c2} = icmp slt i64 ${i02}, ${iter.ty.len}`);
      this.emit(`br i1 ${c2}, label %${bodyL2}, label %${endL2}`);
      this.emitRaw(`${bodyL2}:`);
      const p = this.reg();
      this.emit(`${p} = load ptr, ptr ${arrSlot}`);
      const ep = this.reg();
      this.emit(`${ep} = getelementptr inbounds ${elemTy.llvm}, ptr ${p}, i64 ${i02}`);
      const ev = this.reg();
      this.emit(`${ev} = load ${elemTy.llvm}, ptr ${ep}`);
      this.emit(`store ${elemTy.llvm} ${ev}, ptr ${slot2}`);
      this.loopStack.push({ brk: endL2, cont: condL2 });
      this.genBlock(node.body);
      this.loopStack.pop();
      const i12 = this.reg();
      this.emit(`${i12} = load i64, ptr ${idx}`);
      const i22 = this.reg();
      this.emit(`${i22} = add i64 ${i12}, 1`);
      this.emit(`store i64 ${i22}, ptr ${idx}`);
      this.emit(`br label %${condL2}`);
      this.emitRaw(`${endL2}:`);
      return;
    }
    const startV = iter;
    const endV = this.rangeEnd ?? "0";
    this.rangeEnd = null;
    const slot = `%${node.varName}.addr.${this.regCounter}`;
    this.emit(`${slot} = alloca i64`);
    this.emit(`store i64 ${startV.val}, ptr ${slot}`);
    this.locals.set(node.varName, { ptr: slot, ty: I64, mut: false });
    const limit = `%for.lim.${this.regCounter}`;
    this.emit(`${limit} = alloca i64`);
    this.emit(`store i64 ${endV}, ptr ${limit}`);
    const condL = this.label("for.cond"), bodyL = this.label("for.body"), endL = this.label("for.end");
    this.emit(`br label %${condL}`);
    this.emitRaw(`${condL}:`);
    const i0 = this.reg();
    this.emit(`${i0} = load i64, ptr ${slot}`);
    const n0 = this.reg();
    this.emit(`${n0} = load i64, ptr ${limit}`);
    const c = this.reg();
    this.emit(`${c} = icmp slt i64 ${i0}, ${n0}`);
    this.emit(`br i1 ${c}, label %${bodyL}, label %${endL}`);
    this.emitRaw(`${bodyL}:`);
    this.loopStack.push({ brk: endL, cont: condL });
    this.genBlock(node.body);
    this.loopStack.pop();
    const i1 = this.reg();
    this.emit(`${i1} = load i64, ptr ${slot}`);
    const i2 = this.reg();
    this.emit(`${i2} = add i64 ${i1}, 1`);
    this.emit(`store i64 ${i2}, ptr ${slot}`);
    this.emit(`br label %${condL}`);
    this.emitRaw(`${endL}:`);
  }
  genMatch(node) {
    const val = this.genExpr(node.value);
    const slot = `%match.${this.regCounter}`;
    this.emit(`${slot} = alloca ${val.ty.llvm}`);
    this.emit(`store ${val.ty.llvm} ${val.val}, ptr ${slot}`);
    const endL = this.label("match.end");
    for (const arm of node.arms) {
      if (arm.pattern === "_") {
        this.genBlock(arm.body);
        this.emit(`br label %${endL}`);
        continue;
      }
      const cur = this.reg();
      this.emit(`${cur} = load ${val.ty.llvm}, ptr ${slot}`);
      let condVal;
      if (arm.pattern === "literal") {
        let acc = null;
        for (const lit of arm.literals) {
          const lv = this.coerce(this.genExpr(lit, val.ty), val.ty);
          const cmp = this.reg();
          if (val.ty.kind === "float") this.emit(`${cmp} = fcmp oeq ${val.ty.llvm} ${cur}, ${lv.val}`);
          else this.emit(`${cmp} = icmp eq ${val.ty.llvm} ${cur}, ${lv.val}`);
          if (acc === null) acc = cmp;
          else {
            const orr = this.reg();
            this.emit(`${orr} = or i1 ${acc}, ${cmp}`);
            acc = orr;
          }
        }
        condVal = acc;
      } else {
        const enumName = this.enumForVariant(arm.pattern);
        const ord = enumName ? this.enums.get(enumName).indexOf(arm.pattern) : 0;
        const cmp = this.reg();
        this.emit(`${cmp} = icmp eq ${val.ty.llvm} ${cur}, ${ord}`);
        condVal = cmp;
      }
      const hitL = this.label("match.hit"), nextL = this.label("match.next");
      this.emit(`br i1 ${condVal}, label %${hitL}, label %${nextL}`);
      this.emitRaw(`${hitL}:`);
      this.genBlock(arm.body);
      this.emit(`br label %${endL}`);
      this.emitRaw(`${nextL}:`);
    }
    this.emitRaw(`${endL}:`);
  }
  enumForVariant(variant) {
    for (const [name, variants] of this.enums) if (variants.includes(variant)) return name;
    return null;
  }
  // ---------- expressions ----------
  inferType(node) {
    switch (node.kind) {
      case "NumLit":
        return Number.isInteger(node.value) ? I64 : F64;
      case "StrLit":
      case "InterpStr":
        return STR;
      case "BoolLit":
        return BOOL;
      case "ArrayLit": {
        const elem = node.items.length ? this.inferType(node.items[0]) : I64;
        return { name: `[${node.items.length} x ${elem.name}]`, llvm: `[${node.items.length} x ${elem.llvm}]`, kind: "array", elem, len: node.items.length };
      }
      case "ObjectLit":
        return node.typeName && this.structs.has(node.typeName) ? this.structs.get(node.typeName) : PTR;
      case "BinOp": {
        if (["==", "!=", "<", ">", "<=", ">=", "&&", "||"].includes(node.op)) return BOOL;
        const l = this.inferType(node.left), r = this.inferType(node.right);
        if (l.kind === "float" || r.kind === "float") return F64;
        if (l.kind === "str") return l;
        if (r.kind === "str") return r;
        return l.kind === "int" ? l : r;
      }
      case "UnaryOp":
        return node.op === "!" ? BOOL : this.inferType(node.operand);
      case "Call": {
        if (node.callee.kind === "Ident") {
          const f = this.fns.get(`@${node.callee.name}`);
          if (f) return f.ret;
        }
        if (node.callee.kind === "Member") {
          const objTy = this.inferType(node.callee.object);
          const f = this.fns.get(`@${objTy.name}.${node.callee.property}`);
          if (f) return f.ret;
        }
        return I64;
      }
      case "Cast":
        return this.resolveType(node.type);
      case "Ident": {
        const l = this.locals.get(node.name);
        return l ? l.ty : I64;
      }
      case "RefExpr":
        return PTR;
      case "Ternary":
        return this.inferType(node.then);
      default:
        return I64;
    }
  }
  toBool(v) {
    if (v.ty.kind === "bool") return v;
    const r = this.reg();
    if (v.ty.kind === "int") this.emit(`${r} = icmp ne ${v.ty.llvm} ${v.val}, 0`);
    else if (v.ty.kind === "float") this.emit(`${r} = fcmp one ${v.ty.llvm} ${v.val}, 0.0`);
    else this.emit(`${r} = icmp ne ptr ${v.val}, null`);
    return { ty: BOOL, val: r };
  }
  coerce(v, to) {
    if (v.ty.llvm === to.llvm) return v;
    if (to.kind === "bool") return this.toBool(v);
    if (to.kind === "int" && v.ty.kind === "int") {
      const from = v.ty.bits ?? 64, toB = to.bits ?? 64;
      if (from === toB) return v;
      const r = this.reg();
      if (from < toB) this.emit(`${r} = sext i${from} ${v.val} to i${toB}`);
      else this.emit(`${r} = trunc i${from} ${v.val} to i${toB}`);
      return { ty: to, val: r };
    }
    if (to.kind === "float" && v.ty.kind === "int") {
      const r = this.reg();
      this.emit(`${r} = sitofp ${v.ty.llvm} ${v.val} to ${to.llvm}`);
      return { ty: to, val: r };
    }
    if (to.kind === "int" && v.ty.kind === "float") {
      const r = this.reg();
      this.emit(`${r} = fptosi ${v.ty.llvm} ${v.val} to ${to.llvm}`);
      return { ty: to, val: r };
    }
    if (to.llvm === "ptr" && v.ty.kind === "int") {
      const r = this.reg();
      this.emit(`${r} = inttoptr ${v.ty.llvm} ${v.val} to ptr`);
      return { ty: PTR, val: r };
    }
    if (to.kind === "int" && v.ty.llvm === "ptr") {
      const r = this.reg();
      this.emit(`${r} = ptrtoint ptr ${v.val} to ${to.llvm}`);
      return { ty: to, val: r };
    }
    if (to.llvm === "ptr" && v.ty.llvm === "ptr") return { ty: PTR, val: v.val };
    if (to.llvm === "ptr") {
      const r = this.reg();
      this.emit(`${r} = inttoptr i64 ${v.val} to ptr`);
      return { ty: PTR, val: r };
    }
    return v;
  }
  genExpr(node, hint) {
    switch (node.kind) {
      case "NumLit": {
        const ty = hint && hint.kind === "float" ? hint : Number.isInteger(node.value) ? hint && hint.kind === "int" ? hint : I64 : F64;
        const lit = ty.kind === "float" ? this.floatLit(node.value) : String(Math.trunc(node.value));
        return { ty, val: lit };
      }
      case "StrLit": {
        const s = this.internString(node.value);
        return { ty: STR, val: this.gepStr(s.name) };
      }
      case "BoolLit":
        return { ty: BOOL, val: node.value ? "1" : "0" };
      case "NilLit":
        return { ty: PTR, val: "null" };
      case "InterpStr":
        return this.genInterp(node);
      case "Ident":
        return this.genIdent(node);
      case "ArrayLit":
        return this.genArrayLit(node);
      case "ObjectLit":
        return this.genObjectLit(node);
      case "BinOp":
        return this.genBinOp(node);
      case "UnaryOp":
        return this.genUnary(node);
      case "Assign":
        return this.genAssign(node);
      case "Call":
        return this.genCall(node);
      case "Cast":
        return this.coerce(this.genExpr(node.value), this.resolveType(node.type));
      case "RefExpr": {
        const lv = this.lvaluePtr(node.value);
        if (lv) return { ty: PTR, val: lv.ptr };
        const v = this.genExpr(node.value);
        const slot = `%ref.${this.regCounter}`;
        this.emit(`${slot} = alloca ${v.ty.llvm}`);
        this.emit(`store ${v.ty.llvm} ${v.val}, ptr ${slot}`);
        return { ty: PTR, val: slot };
      }
      case "Deref": {
        const v = this.genExpr(node.value);
        const r = this.reg();
        this.emit(`${r} = load i64, ptr ${v.val}`);
        return { ty: I64, val: r };
      }
      case "Ternary": {
        const c = this.toBool(this.genExpr(node.cond, BOOL));
        const ty = hint || this.inferType(node.then);
        const a = this.coerce(this.genExpr(node.then, ty), ty);
        const b = this.coerce(this.genExpr(node.else, ty), ty);
        const r = this.reg();
        this.emit(`${r} = select i1 ${c.val}, ${ty.llvm} ${a.val}, ${ty.llvm} ${b.val}`);
        return { ty, val: r };
      }
      case "RangeExpr": {
        const start = node.start ? this.coerce(this.genExpr(node.start, I64), I64) : { ty: I64, val: "0" };
        const end = node.end ? this.coerce(this.genExpr(node.end, I64), I64) : { ty: I64, val: "0" };
        if (node.inclusive) {
          const e = this.reg();
          this.emit(`${e} = add i64 ${end.val}, 1`);
          this.rangeEnd = e;
        } else {
          this.rangeEnd = end.val;
        }
        return { ty: I64, val: start.val };
      }
      case "Member":
        return this.genMember(node);
      case "Index":
        return this.genIndex(node);
      case "NewExpr":
        return this.genNew(node);
      case "Lambda":
        return { ty: PTR, val: "null" };
      case "Transcendental": {
        const arg = this.coerce(this.genExpr(node.arg), F64);
        const r = this.reg();
        if (node.symbol === "pi") this.emit(`${r} = fmul double ${arg.val}, 0x400921FB54442D18`);
        else this.emit(`${r} = call double @llvm.log.f64(double ${arg.val})`);
        return { ty: F64, val: r };
      }
      default:
        throw new LlvmError(`cannot lower '${node.kind}' to LLVM IR`);
    }
  }
  floatLit(n) {
    if (!isFinite(n)) return n > 0 ? "0x7FF0000000000000" : "0xFFF0000000000000";
    return n.toString();
  }
  genIdent(node) {
    const l = this.locals.get(node.name);
    if (l) {
      const r = this.reg();
      this.emit(`${r} = load ${l.ty.llvm}, ptr ${l.ptr}`);
      return { ty: l.ty, val: r };
    }
    if (node.name === "PI") return { ty: F64, val: "0x400921FB54442D18" };
    if (node.name === "E") return { ty: F64, val: "0x4005BF0A8B145769" };
    if (node.name === "true") return { ty: BOOL, val: "1" };
    if (node.name === "false") return { ty: BOOL, val: "0" };
    if (node.name === "nil") return { ty: PTR, val: "null" };
    if (this.globals.has(node.name)) {
      const gty = this.globals.get(node.name);
      const r = this.reg();
      this.emit(`${r} = load ${gty.llvm}, ptr @${node.name}`);
      return { ty: gty, val: r };
    }
    if (this.fns.has(`@${node.name}`)) return { ty: PTR, val: `@${node.name}` };
    throw new LlvmError(`undefined variable '${node.name}'`);
  }
  genArrayLit(node) {
    const elemTy = node.items.length ? this.inferType(node.items[0]) : I64;
    const arrTy = { name: `[${node.items.length} x ${elemTy.name}]`, llvm: `[${node.items.length} x ${elemTy.llvm}]`, kind: "array", elem: elemTy, len: node.items.length };
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
  genObjectLit(node) {
    if (!node.typeName) return { ty: PTR, val: "null" };
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
    const r = this.reg();
    this.emit(`${r} = load ${st.llvm}, ptr ${slot}`);
    return { ty: st, val: r };
  }
  genMember(node) {
    if (node.object.kind === "Ident" && this.enums.has(node.object.name)) {
      const variants = this.enums.get(node.object.name);
      const ord = variants.indexOf(node.property);
      if (ord >= 0) return { ty: I64, val: String(ord) };
    }
    const lv = this.lvaluePtr(node.object);
    if (lv && lv.ty.kind === "struct") {
      const fi = this.fieldIndex(lv.ty.name, node.property);
      if (fi) {
        const fp = this.reg();
        this.emit(`${fp} = getelementptr inbounds ${lv.ty.llvm}, ptr ${lv.ptr}, i32 0, i32 ${fi.idx}`);
        const r = this.reg();
        this.emit(`${r} = load ${fi.ty.llvm}, ptr ${fp}`);
        return { ty: fi.ty, val: r };
      }
    }
    const obj = this.genExpr(node.object);
    if (obj.ty.kind === "struct" && obj.ty.fields) {
      const fi = this.fieldIndex(obj.ty.name, node.property);
      if (fi) {
        const base = `%fld.${this.regCounter}`;
        this.emit(`${base} = alloca ${obj.ty.llvm}`);
        this.emit(`store ${obj.ty.llvm} ${obj.val}, ptr ${base}`);
        const fp = this.reg();
        this.emit(`${fp} = getelementptr inbounds ${obj.ty.llvm}, ptr ${base}, i32 0, i32 ${fi.idx}`);
        const r = this.reg();
        this.emit(`${r} = load ${fi.ty.llvm}, ptr ${fp}`);
        return { ty: fi.ty, val: r };
      }
    }
    if (node.property === "len" || node.property === "length") {
      if (obj.ty.kind === "array") return { ty: I64, val: String(obj.ty.len) };
    }
    return { ty: I64, val: "0" };
  }
  genIndex(node) {
    const lv = this.lvaluePtr(node.object);
    const idx = this.coerce(this.genExpr(node.index, I64), I64);
    if (lv && lv.ty.kind === "array" && lv.ty.elem) {
      const ep = this.reg();
      this.emit(`${ep} = getelementptr inbounds ${lv.ty.llvm}, ptr ${lv.ptr}, i64 0, i64 ${idx.val}`);
      const r = this.reg();
      this.emit(`${r} = load ${lv.ty.elem.llvm}, ptr ${ep}`);
      return { ty: lv.ty.elem, val: r };
    }
    const obj = this.genExpr(node.object);
    if (obj.ty.kind === "array" && obj.ty.elem) {
      const ep = this.reg();
      this.emit(`${ep} = getelementptr inbounds ${obj.ty.llvm}, ptr ${obj.val}, i64 0, i64 ${idx.val}`);
      const r = this.reg();
      this.emit(`${r} = load ${obj.ty.elem.llvm}, ptr ${ep}`);
      return { ty: obj.ty.elem, val: r };
    }
    if (obj.ty.llvm === "ptr") {
      const ep = this.reg();
      this.emit(`${ep} = getelementptr inbounds i64, ptr ${obj.val}, i64 ${idx.val}`);
      const r = this.reg();
      this.emit(`${r} = load i64, ptr ${ep}`);
      return { ty: I64, val: r };
    }
    return { ty: I64, val: "0" };
  }
  genNew(node) {
    const st = this.structs.get(node.className);
    if (st) return this.genObjectLit({ kind: "ObjectLit", entries: [], typeName: node.className });
    return { ty: PTR, val: "null" };
  }
  genBinOp(node) {
    const op = node.op;
    if (op === "&&" || op === "||") {
      const l2 = this.toBool(this.genExpr(node.left, BOOL));
      const r2 = this.toBool(this.genExpr(node.right, BOOL));
      const res = this.reg();
      this.emit(`${res} = ${op === "&&" ? "and" : "or"} i1 ${l2.val}, ${r2.val}`);
      return { ty: BOOL, val: res };
    }
    const l = this.genExpr(node.left);
    let ty = l.ty;
    const r0 = this.genExpr(node.right, l.ty.kind === "float" ? l.ty : void 0);
    let lv = l, rv = r0;
    if (l.ty.kind === "float" || r0.ty.kind === "float") {
      const fty = l.ty.kind === "float" ? l.ty : r0.ty.kind === "float" ? r0.ty : F64;
      lv = this.coerce(l, fty);
      rv = this.coerce(r0, fty);
      ty = fty;
    } else if (l.ty.kind === "str" || r0.ty.kind === "str") {
      ty = STR;
    } else if (l.ty.kind === "int") {
      ty = l.ty;
      rv = this.coerce(r0, l.ty);
    } else {
      ty = r0.ty;
      lv = this.coerce(l, r0.ty);
    }
    const r = this.reg();
    const isCmp = ["==", "!=", "<", ">", "<=", ">="].includes(op);
    if (ty.kind === "float") {
      const fop = { "==": "oeq", "!=": "one", "<": "olt", ">": "ogt", "<=": "ole", ">=": "oge" };
      if (fop[op]) {
        this.emit(`${r} = fcmp ${fop[op]} ${ty.llvm} ${lv.val}, ${rv.val}`);
        return { ty: BOOL, val: r };
      }
      if (op === "+") this.emit(`${r} = fadd ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === "-") this.emit(`${r} = fsub ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === "*") this.emit(`${r} = fmul ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === "/") this.emit(`${r} = fdiv ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === "%") this.emit(`${r} = frem ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === "**") this.emit(`${r} = call double @llvm.pow.f64(double ${lv.val}, double ${rv.val})`);
      return { ty, val: r };
    }
    if (ty.kind === "str") {
      if (op === "+") {
        return l;
      }
      if (isCmp) {
        this.emit(`${r} = icmp eq ptr ${lv.val}, ${rv.val}`);
        return { ty: BOOL, val: r };
      }
      return l;
    }
    const signed = ty.signed !== false;
    const cmpOp = {
      "==": "eq",
      "!=": "ne",
      "<": signed ? "slt" : "ult",
      ">": signed ? "sgt" : "ugt",
      "<=": signed ? "sle" : "ule",
      ">=": signed ? "sge" : "uge"
    };
    if (cmpOp[op]) {
      this.emit(`${r} = icmp ${cmpOp[op]} ${ty.llvm} ${lv.val}, ${rv.val}`);
      return { ty: BOOL, val: r };
    }
    if (op === "+") this.emit(`${r} = add ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "-") this.emit(`${r} = sub ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "*") this.emit(`${r} = mul ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "/") this.emit(`${r} = ${signed ? "sdiv" : "udiv"} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "%") this.emit(`${r} = ${signed ? "srem" : "urem"} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "**") {
      const fl = this.reg(), fr = this.reg(), fp = this.reg(), fi = this.reg();
      this.emit(`${fl} = sitofp ${ty.llvm} ${lv.val} to double`);
      this.emit(`${fr} = sitofp ${ty.llvm} ${rv.val} to double`);
      this.emit(`${fp} = call double @llvm.pow.f64(double ${fl}, double ${fr})`);
      this.emit(`${fi} = fptosi double ${fp} to ${ty.llvm}`);
      return { ty, val: fi };
    } else if (op === "&") this.emit(`${r} = and ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "|") this.emit(`${r} = or ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "^") this.emit(`${r} = xor ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "<<") this.emit(`${r} = shl ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === ">>") this.emit(`${r} = ${signed ? "ashr" : "lshr"} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else return l;
    return { ty, val: r };
  }
  genUnary(node) {
    const v = this.genExpr(node.operand);
    const r = this.reg();
    if (node.op === "!") {
      const b = this.toBool(v);
      this.emit(`${r} = xor i1 ${b.val}, true`);
      return { ty: BOOL, val: r };
    }
    if (node.op === "-") {
      if (v.ty.kind === "float") this.emit(`${r} = fneg ${v.ty.llvm} ${v.val}`);
      else this.emit(`${r} = sub ${v.ty.llvm} 0, ${v.val}`);
      return { ty: v.ty, val: r };
    }
    if (node.op === "+") return v;
    if (node.op === "~") {
      this.emit(`${r} = xor ${v.ty.llvm} ${v.val}, -1`);
      return { ty: v.ty, val: r };
    }
    return v;
  }
  genAssign(node) {
    const lv = this.lvaluePtr(node.target);
    if (!lv) throw new LlvmError(`cannot assign to this expression`);
    let v;
    if (node.op === "=") v = this.coerce(this.genExpr(node.value, lv.ty), lv.ty);
    else {
      const binOp = node.op[0];
      const cur = this.reg();
      this.emit(`${cur} = load ${lv.ty.llvm}, ptr ${lv.ptr}`);
      const rhs = this.coerce(this.genExpr(node.value, lv.ty), lv.ty);
      v = this.genBinOpValues(binOp, { ty: lv.ty, val: cur }, rhs);
    }
    this.emit(`store ${lv.ty.llvm} ${v.val}, ptr ${lv.ptr}`);
    return v;
  }
  genBinOpValues(op, l, r0) {
    let ty = l.ty;
    let lv = l;
    let rv = r0;
    if (l.ty.kind === "float" || r0.ty.kind === "float") {
      const fty = l.ty.kind === "float" ? l.ty : r0.ty.kind === "float" ? r0.ty : F64;
      lv = this.coerce(l, fty);
      rv = this.coerce(r0, fty);
      ty = fty;
    } else if (l.ty.kind === "int") {
      ty = l.ty;
      rv = this.coerce(r0, l.ty);
    }
    const r = this.reg();
    const cmpOp = {
      "==": "eq",
      "!=": "ne",
      "<": ty.signed !== false ? "slt" : "ult",
      ">": ty.signed !== false ? "sgt" : "ugt",
      "<=": ty.signed !== false ? "sle" : "ule",
      ">=": ty.signed !== false ? "sge" : "uge"
    };
    if (ty.kind === "float") {
      const fop = { "==": "oeq", "!=": "one", "<": "olt", ">": "ogt", "<=": "ole", ">=": "oge" };
      if (fop[op]) {
        this.emit(`${r} = fcmp ${fop[op]} ${ty.llvm} ${lv.val}, ${rv.val}`);
        return { ty: BOOL, val: r };
      }
      if (op === "+") this.emit(`${r} = fadd ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === "-") this.emit(`${r} = fsub ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === "*") this.emit(`${r} = fmul ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === "/") this.emit(`${r} = fdiv ${ty.llvm} ${lv.val}, ${rv.val}`);
      else if (op === "%") this.emit(`${r} = frem ${ty.llvm} ${lv.val}, ${rv.val}`);
      return { ty, val: r };
    }
    if (cmpOp[op]) {
      this.emit(`${r} = icmp ${cmpOp[op]} ${ty.llvm} ${lv.val}, ${rv.val}`);
      return { ty: BOOL, val: r };
    }
    if (op === "+") this.emit(`${r} = add ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "-") this.emit(`${r} = sub ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "*") this.emit(`${r} = mul ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "/") this.emit(`${r} = ${ty.signed !== false ? "sdiv" : "udiv"} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "%") this.emit(`${r} = ${ty.signed !== false ? "srem" : "urem"} ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "&") this.emit(`${r} = and ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "|") this.emit(`${r} = or ${ty.llvm} ${lv.val}, ${rv.val}`);
    else if (op === "^") this.emit(`${r} = xor ${ty.llvm} ${lv.val}, ${rv.val}`);
    else return lv;
    return { ty, val: r };
  }
  lvaluePtr(node) {
    if (node.kind === "Ident") {
      const l = this.locals.get(node.name);
      if (l) return { ptr: l.ptr, ty: l.ty };
      return null;
    }
    if (node.kind === "Member") {
      const base = this.lvaluePtr(node.object);
      if (base && base.ty.kind === "struct") {
        const fi = this.fieldIndex(base.ty.name, node.property);
        if (fi) {
          const fp = this.reg();
          this.emit(`${fp} = getelementptr inbounds ${base.ty.llvm}, ptr ${base.ptr}, i32 0, i32 ${fi.idx}`);
          return { ptr: fp, ty: fi.ty };
        }
      }
      return null;
    }
    if (node.kind === "Index") {
      const base = this.lvaluePtr(node.object);
      const idx = this.coerce(this.genExpr(node.index, I64), I64);
      if (base && base.ty.kind === "array" && base.ty.elem) {
        const ep = this.reg();
        this.emit(`${ep} = getelementptr inbounds ${base.ty.llvm}, ptr ${base.ptr}, i64 0, i64 ${idx.val}`);
        return { ptr: ep, ty: base.ty.elem };
      }
      if (base && base.ty.llvm === "ptr") {
        const ep = this.reg();
        this.emit(`${ep} = getelementptr inbounds i64, ptr ${base.ptr}, i64 ${idx.val}`);
        return { ptr: ep, ty: I64 };
      }
      return null;
    }
    if (node.kind === "Deref") {
      const v = this.genExpr(node.value);
      return { ptr: v.val, ty: I64 };
    }
    return null;
  }
  genCall(node) {
    const args = node.args.map((a) => this.genExpr(a));
    let name = null;
    if (node.callee.kind === "Ident") name = node.callee.name;
    else if (node.callee.kind === "Member") name = node.callee.property;
    if (name === "str" || name === "toStr") return this.toStrValue(args[0]);
    if (name === "len" || name === "length") {
      if (args[0] && args[0].ty.kind === "array") return { ty: I64, val: String(args[0].ty.len) };
      return { ty: I64, val: "0" };
    }
    if (name === "mmio_write") {
      const addr = this.coerce(args[0], I64), val = this.coerce(args[1], I64);
      if (this.target.freestanding) this.emit(`call void @sid_mmio_write(i64 ${addr.val}, i64 ${val.val})`);
      else {
        const p = this.reg();
        this.emit(`${p} = inttoptr i64 ${addr.val} to ptr`);
        this.emit(`store volatile i64 ${val.val}, ptr ${p}`);
      }
      return { ty: VOID, val: "0" };
    }
    if (name === "mmio_read") {
      const addr = this.coerce(args[0], I64);
      const r = this.reg();
      if (this.target.freestanding) this.emit(`${r} = call i64 @sid_mmio_read(i64 ${addr.val})`);
      else {
        const p = this.reg();
        this.emit(`${p} = inttoptr i64 ${addr.val} to ptr`);
        this.emit(`${r} = load volatile i64, ptr ${p}`);
      }
      return { ty: I64, val: r };
    }
    if (name === "nop") {
      this.emit('call void asm sideeffect "", ""()');
      return { ty: VOID, val: "0" };
    }
    if (name && this.fns.has(`@${name}`)) {
      const sig = this.fns.get(`@${name}`);
      const coerced = args.map((a, i) => sig.params[i] ? this.coerce(a, sig.params[i]) : a);
      const r = this.reg();
      if (sig.ret.llvm === "void") {
        this.emit(`call void @${name}(${coerced.map((c, i) => `${(sig.params[i] || c.ty).llvm} ${c.val}`).join(", ")})`);
        return { ty: VOID, val: "0" };
      }
      this.emit(`${r} = call ${sig.ret.llvm} @${name}(${coerced.map((c, i) => `${(sig.params[i] || c.ty).llvm} ${c.val}`).join(", ")})`);
      return { ty: sig.ret, val: r };
    }
    if (node.callee.kind === "Member") {
      const objPtr = this.lvaluePtr(node.callee.object);
      const objTy = objPtr ? objPtr.ty : this.inferType(node.callee.object);
      const methodName = `${objTy.name}.${node.callee.property}`;
      if (this.fns.has(`@${methodName}`)) {
        const sig = this.fns.get(`@${methodName}`);
        const callArgs = [`ptr ${objPtr ? objPtr.ptr : args[0]?.val}`];
        for (let i = 0; i < args.length; i++) callArgs.push(`${args[i].ty.llvm} ${args[i].val}`);
        const r = this.reg();
        if (sig.ret.llvm === "void") {
          this.emit(`call void @${methodName}(${callArgs.join(", ")})`);
          return { ty: VOID, val: "0" };
        }
        this.emit(`${r} = call ${sig.ret.llvm} @${methodName}(${callArgs.join(", ")})`);
        return { ty: sig.ret, val: r };
      }
      if (node.callee.property === "sqrt") {
        const a = this.coerce(args[0], F64);
        const r = this.reg();
        this.emit(`${r} = call double @llvm.sqrt.f64(double ${a.val})`);
        return { ty: F64, val: r };
      }
      if (node.callee.property === "abs") {
        const a = args[0];
        const r = this.reg();
        if (a.ty.kind === "float") {
          this.emit(`${r} = call double @llvm.fabs.f64(double ${a.val})`);
          return { ty: F64, val: r };
        }
        const c = this.reg();
        this.emit(`${c} = icmp slt ${a.ty.llvm} ${a.val}, 0`);
        const n = this.reg();
        this.emit(`${n} = sub ${a.ty.llvm} 0, ${a.val}`);
        const s = this.reg();
        this.emit(`${s} = select i1 ${c}, ${a.ty.llvm} ${n}, ${a.ty.llvm} ${a.val}`);
        return { ty: a.ty, val: s };
      }
    }
    throw new LlvmError(`call to undefined function '${name ?? "<expr>"}'`);
  }
  toStrValue(v) {
    const buf = `%tostr.${this.regCounter}`;
    this.emit(`${buf} = alloca [32 x i8]`);
    if (this.target.freestanding) return { ty: STR, val: buf };
    const fmtStr = v.ty.kind === "float" ? "%g" : "%lld";
    const f = this.internString(fmtStr);
    const fp = this.gepStr(f.name);
    const arg = v.ty.kind === "float" ? v : this.coerce(v, I64);
    const argTy = v.ty.kind === "float" ? F64 : I64;
    this.emit(`call i32 (ptr, i64, ptr, ...) @snprintf(ptr ${buf}, i64 32, ptr ${fp}, ${argTy.llvm} ${arg.val})`);
    return { ty: STR, val: buf };
  }
  genInterp(node) {
    const buf = `%istr.${this.regCounter}`;
    this.emit(`${buf} = alloca [256 x i8]`);
    this.emit(`store [256 x i8] zeroinitializer, ptr ${buf}`);
    let off = 0;
    for (const part of node.parts) {
      if (part.text !== void 0) {
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
        const fmtStr = v.ty.kind === "float" ? "%g" : v.ty.kind === "int" ? "%lld" : "%s";
        const f = this.internString(fmtStr);
        const fp = this.gepStr(f.name);
        const arg = v.ty.kind === "float" ? v : v.ty.kind === "int" ? this.coerce(v, I64) : v;
        const argTy = v.ty.kind === "float" ? F64 : v.ty.kind === "int" ? I64 : PTR;
        this.emit(`call i32 (ptr, i64, ptr, ...) @snprintf(ptr ${dp}, i64 64, ptr ${fp}, ${argTy.llvm} ${arg.val})`);
        off += 24;
      }
    }
    return { ty: STR, val: buf };
  }
  genPrint(node) {
    const v = this.genExpr(node.value);
    if (this.target.freestanding) {
      if (v.ty.kind === "str" || v.ty.llvm === "ptr") {
        const sig = this.fns.get("@sid_write");
        if (sig && sig.params[0]) {
          const a = this.coerce(v, sig.params[0]);
          this.emit(`call void @sid_write(${sig.params[0].llvm} ${a.val}, i64 0)`);
        } else {
          this.emit(`call void @sid_write(ptr ${v.val}, i64 0)`);
        }
      }
      return;
    }
    const fmt = v.ty.kind === "float" ? "%g\n" : v.ty.kind === "bool" ? "%lld\n" : v.ty.kind === "int" ? "%lld\n" : "%s\n";
    const s = this.internString(fmt);
    const fp = this.gepStr(s.name);
    if (v.ty.kind === "str" || v.ty.llvm === "ptr") {
      this.emit(`call i32 (ptr, ...) @printf(ptr ${fp}, ptr ${v.val})`);
    } else if (v.ty.kind === "bool") {
      const ext = this.reg();
      this.emit(`${ext} = zext i1 ${v.val} to i64`);
      this.emit(`call i32 (ptr, ...) @printf(ptr ${fp}, i64 ${ext})`);
    } else if (v.ty.kind === "float") {
      this.emit(`call i32 (ptr, ...) @printf(ptr ${fp}, double ${v.val})`);
    } else {
      const c = this.coerce(v, I64);
      this.emit(`call i32 (ptr, ...) @printf(ptr ${fp}, i64 ${c.val})`);
    }
  }
};

// src/std/blake3.ts
var IV = new Uint32Array([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
var MSG_PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];
var CHUNK_START = 1 << 0;
var CHUNK_END = 1 << 1;
var ROOT = 1 << 3;
function rotr(x, n) {
  return (x >>> n | x << 32 - n) >>> 0;
}
function g(state, a, b, c, d, mx, my) {
  state[a] = state[a] + state[b] + mx >>> 0;
  state[d] = rotr(state[d] ^ state[a], 16);
  state[c] = state[c] + state[d] >>> 0;
  state[b] = rotr(state[b] ^ state[c], 12);
  state[a] = state[a] + state[b] + my >>> 0;
  state[d] = rotr(state[d] ^ state[a], 8);
  state[c] = state[c] + state[d] >>> 0;
  state[b] = rotr(state[b] ^ state[c], 7);
}
function compress(cv, block, counter, blockLen, flags) {
  const state = new Uint32Array(16);
  state.set(cv, 0);
  state.set(IV.subarray(0, 4), 8);
  state[12] = counter >>> 0;
  state[13] = Math.floor(counter / 4294967296) >>> 0;
  state[14] = blockLen >>> 0;
  state[15] = flags >>> 0;
  let m = Uint32Array.from(block);
  for (let r = 0; r < 7; r++) {
    g(state, 0, 4, 8, 12, m[0], m[1]);
    g(state, 1, 5, 9, 13, m[2], m[3]);
    g(state, 2, 6, 10, 14, m[4], m[5]);
    g(state, 3, 7, 11, 15, m[6], m[7]);
    g(state, 0, 5, 10, 15, m[8], m[9]);
    g(state, 1, 6, 11, 12, m[10], m[11]);
    g(state, 2, 7, 8, 13, m[12], m[13]);
    g(state, 3, 4, 9, 14, m[14], m[15]);
    if (r < 6) {
      const p = new Uint32Array(16);
      for (let i = 0; i < 16; i++) p[i] = m[MSG_PERM[i]];
      m = p;
    }
  }
  const out = new Uint32Array(16);
  for (let i = 0; i < 8; i++) out[i] = (state[i] ^ state[i + 8]) >>> 0;
  for (let i = 0; i < 8; i++) out[i + 8] = (state[i + 8] ^ cv[i]) >>> 0;
  return out;
}
function bytesToWords(bytes, offset) {
  const w = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4;
    w[i] = ((bytes[j] || 0) | (bytes[j + 1] || 0) << 8 | (bytes[j + 2] || 0) << 16 | (bytes[j + 3] || 0) << 24) >>> 0;
  }
  return w;
}
function blake3Bytes(input) {
  let cv = Uint32Array.from(IV);
  const blocks = Math.max(1, Math.ceil(input.length / 64));
  let lastOut = null;
  for (let b = 0; b < blocks; b++) {
    const offset = b * 64;
    const blockLen = Math.min(64, input.length - offset);
    const flags = (b === 0 ? CHUNK_START : 0) | (b === blocks - 1 ? CHUNK_END : 0) | (blocks === 1 ? ROOT : 0);
    const words = bytesToWords(input, offset);
    const out2 = compress(cv, words, b, blockLen < 0 ? 0 : blockLen, flags);
    lastOut = out2;
    cv = out2.slice(0, 8);
  }
  const out = lastOut;
  const digest = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    digest[i * 4] = out[i] & 255;
    digest[i * 4 + 1] = out[i] >>> 8 & 255;
    digest[i * 4 + 2] = out[i] >>> 16 & 255;
    digest[i * 4 + 3] = out[i] >>> 24 & 255;
  }
  return digest;
}
function hex(bytes) {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

// src/compiler/dna.ts
var DNA_START = "[START";
var DNA_END = "[END]";
var START = DNA_START;
var END = DNA_END;
function formatDnaHeader(h) {
  return `${START}:SUBSTRATE=${h.substrate}:ARCH=${h.arch}:VERSION=${h.version}:BLAKE3=${h.blake3}]`;
}
function buildDnaHeader(substrate, arch, payload, version = 1) {
  return { substrate, arch, version, blake3: hex(blake3Bytes(payload)) };
}
function withDnaHeader(payload, substrate, arch, version = 1) {
  const header = formatDnaHeader(buildDnaHeader(substrate, arch, payload, version));
  const hb = new TextEncoder().encode(header);
  const out = new Uint8Array(hb.length + payload.length + END.length);
  out.set(hb, 0);
  out.set(payload, hb.length);
  out.set(new TextEncoder().encode(END), hb.length + payload.length);
  return out;
}
function readDnaHeader(image) {
  const text = new TextDecoder().decode(image.subarray(0, Math.min(image.length, 256)));
  if (!text.startsWith(START)) return null;
  const close = text.indexOf("]");
  if (close < 0) return null;
  const fields = {};
  for (const part of text.slice(START.length + 1, close).split(":")) {
    const eq = part.indexOf("=");
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return {
    substrate: fields.SUBSTRATE || "generic",
    arch: fields.ARCH || "unknown",
    version: Number(fields.VERSION || 1),
    blake3: fields.BLAKE3 || "",
    payloadOffset: close + 1
  };
}
function verifyDna(image) {
  const front = readDnaHeader(image);
  if (front) {
    let end = image.length;
    const tail = new TextDecoder().decode(image.subarray(Math.max(0, image.length - END.length)));
    if (tail === END) end = image.length - END.length;
    return hex(blake3Bytes(image.subarray(front.payloadOffset, end))) === front.blake3;
  }
  const text = new TextDecoder().decode(image.subarray(Math.max(0, image.length - 512)));
  const i = text.lastIndexOf(START);
  if (i < 0) return false;
  const cut = Math.max(0, image.length - 512) + i;
  let payloadEnd = cut;
  if (payloadEnd > 0 && image[payloadEnd - 1] === 10) payloadEnd -= 1;
  const trailer = readDnaTrailer(image);
  if (!trailer) return false;
  return hex(blake3Bytes(image.subarray(0, payloadEnd))) === trailer.blake3;
}
function stripDna(image) {
  const h = readDnaHeader(image);
  if (!h) return image;
  let end = image.length;
  const tail = new TextDecoder().decode(image.subarray(Math.max(0, image.length - END.length)));
  if (tail === END) end = image.length - END.length;
  return image.subarray(h.payloadOffset, end);
}
function readDnaTrailer(image) {
  const win = image.subarray(Math.max(0, image.length - 512));
  const text = new TextDecoder().decode(win);
  const i = text.lastIndexOf(START);
  if (i < 0) return null;
  const close = text.indexOf("]", i);
  if (close < 0) return null;
  const fields = {};
  for (const part of text.slice(i + START.length + 1, close).split(":")) {
    const eq = part.indexOf("=");
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (!fields.SUBSTRATE) return null;
  return {
    substrate: fields.SUBSTRATE,
    arch: fields.ARCH || "unknown",
    version: Number(fields.VERSION || 1),
    blake3: fields.BLAKE3 || ""
  };
}
function findDna(image) {
  return readDnaHeader(image) || readDnaTrailer(image);
}

// src/compiler/native.ts
var FAT_SUBSTRATES = [
  "x86_64-linux",
  "aarch64-linux",
  "riscv64-none-elf",
  "wasm32",
  "photon-riscv",
  "qubit-riscv",
  "fluidic-riscv",
  "vacuum-riscv",
  "holographic-wasm",
  "plasma-arm",
  "energy-riscv"
];
function which(cmd) {
  const r = spawnSync("bash", ["-lc", `command -v ${cmd}`], { encoding: "utf8" });
  const p = (r.stdout || "").trim();
  return p || null;
}
function clangPath() {
  for (const c of ["clang-19", "clang", "clang-18", "clang-17"]) {
    const p = which(c);
    if (p) return p;
  }
  return "clang";
}
var HAL_RUNTIME_C = `/* SidAli HAL runtime \u2014 freestanding primitives the compiler lowers to. */
typedef unsigned long long sid_u64;

#ifndef SID_UART_BASE
#define SID_UART_BASE 0x40011000UL
#endif

static inline void sid_uart_putc(unsigned char c) {
  volatile unsigned int *sr = (volatile unsigned int *)(SID_UART_BASE + 0x00);
  volatile unsigned int *dr = (volatile unsigned int *)(SID_UART_BASE + 0x04);
  while (!((*sr) & (1u << 7))) { }
  *dr = c;
}

void sid_write(const char *s, sid_u64 len) {
  if (!s) return;
  if (len == 0) {
    for (const char *p = s; *p; p++) sid_uart_putc((unsigned char)*p);
  } else {
    for (sid_u64 i = 0; i + 1 < len; i++) sid_uart_putc((unsigned char)s[i]);
  }
}

sid_u64 sid_read(void) { return (sid_u64)-1; }

void sid_mmio_write(sid_u64 addr, sid_u64 val) {
  *(volatile sid_u64 *)addr = val;
}

sid_u64 sid_mmio_read(sid_u64 addr) {
  return *(volatile sid_u64 *)addr;
}
`;
function buildNative(source, opts = {}) {
  const targetName = opts.target || "x86_64-linux";
  const target = TARGETS[targetName];
  const stages = [];
  const outDir = opts.outDir || join(process.cwd(), "dist-native");
  mkdirSync(outDir, { recursive: true });
  const outName = opts.outName || "a";
  if (!target) {
    return { ok: false, target: TARGETS["x86_64-linux"], stdout: "", stderr: `unknown target ${targetName}`, stages };
  }
  let program;
  try {
    program = parse(source);
    stages.push({ name: "parse", ok: true, detail: `${program.body.length} top-level items` });
  } catch (e) {
    stages.push({ name: "parse", ok: false, detail: e.message });
    return { ok: false, target, stdout: "", stderr: e.message, stages };
  }
  let ir;
  try {
    ir = emitLlvm(program, { target: targetName, optLevel: opts.optLevel ?? 2, entry: opts.entry ?? "main" }).ir;
    stages.push({ name: "llvm", ok: true, detail: `${ir.split("\n").length} lines of IR` });
  } catch (e) {
    stages.push({ name: "llvm", ok: false, detail: e.message });
    return { ok: false, target, stdout: "", stderr: e.message, stages };
  }
  const irPath = join(outDir, `${outName}.ll`);
  writeFileSync(irPath, ir);
  if (opts.emit === "ir") {
    return { ok: true, artifact: irPath, ir, target, stdout: "", stderr: "", stages };
  }
  const clang = clangPath();
  const args = [irPath, "-o", join(outDir, outName)];
  args.push(`--target=${target.triple}`, `-O${opts.optLevel ?? 2}`);
  if (target.cpu) args.push(`-mcpu=${target.cpu}`);
  if (target.march) args.push(`-march=${target.march}`);
  if (target.features) args.push(`-mattr=${target.features}`);
  if (opts.emit === "asm") args.push("-S");
  else if (opts.emit === "obj") args.push("-c");
  else if (target.objectOnly) {
    args.push("-c");
  } else if (target.freestanding) {
    args.push("-ffreestanding", "-nostdlib", "-fno-stack-protector", "-Wl,-e,_start");
    const halPath = join(outDir, `${outName}.hal.c`);
    writeFileSync(halPath, HAL_RUNTIME_C);
    args.push(halPath);
  }
  const res = spawnSync(clang, args, { encoding: "utf8" });
  const ok = res.status === 0 && existsSync(args[args.indexOf("-o") + 1]);
  stages.push({ name: "clang", ok, detail: ok ? `clang ${args.join(" ")}` : (res.stderr || "").slice(0, 400) });
  if (!ok) return { ok: false, target, stdout: res.stdout || "", stderr: res.stderr || "", stages, ir };
  const artifact = args[args.indexOf("-o") + 1];
  const substrate = target.substrate || "electron";
  if (!opts.noDna) {
    const bytes = readFileSync(artifact);
    const header = formatDnaHeader(buildDnaHeader(substrate, target.triple, bytes));
    writeFileSync(artifact, Buffer.concat([bytes, Buffer.from("\n" + header + DNA_END + "\n")]));
    writeFileSync(`${artifact}.dna`, header + DNA_END + "\n");
  }
  return { ok: true, artifact, ir, target, stdout: res.stdout || "", stderr: res.stderr || "", stages };
}
function buildFat(source, opts = {}) {
  const stages = [];
  const outDir = opts.outDir || join(process.cwd(), "dist-native");
  mkdirSync(outDir, { recursive: true });
  const outName = opts.outName || "a";
  const targets = opts.target ? [opts.target] : [...FAT_SUBSTRATES];
  const payloads = [];
  const tmpDir = join(outDir, `.fat-${outName}`);
  mkdirSync(tmpDir, { recursive: true });
  for (const t of targets) {
    if (!TARGETS[t]) {
      stages.push({ name: `target:${t}`, ok: false, detail: "unknown target" });
      continue;
    }
    const r = buildNative(source, { ...opts, target: t, outDir: tmpDir, outName: `part-${t}`, emit: "obj", noDna: true });
    if (r.ok && r.artifact && existsSync(r.artifact)) {
      payloads.push({ target: TARGETS[t], bytes: readFileSync(r.artifact) });
      stages.push({ name: `target:${t}`, ok: true, detail: `${readFileSync(r.artifact).length} bytes` });
    } else {
      stages.push({ name: `target:${t}`, ok: false, detail: (r.stderr || "compile failed").slice(0, 120) });
    }
  }
  rmSync(tmpDir, { recursive: true, force: true });
  if (!payloads.length) {
    return { ok: false, target: TARGETS["x86_64-linux"], stdout: "", stderr: "no substrate compiled", stages };
  }
  const manifest = [`[SIDALI-FAT:VERSION=1:SECTIONS=${payloads.length}]`];
  let offset = 0;
  for (const p of payloads) {
    const substrate = p.target.substrate || "electron";
    const blake = hex(blake3Bytes(new Uint8Array(p.bytes)));
    manifest.push(`[SUBSTRATE=${substrate}:ARCH=${p.target.triple}:OFFSET=${offset}:LEN=${p.bytes.length}:BLAKE3=${blake}]`);
    offset += p.bytes.length;
  }
  manifest.push(DNA_END);
  const manifestBytes = new TextEncoder().encode(manifest.join("\n") + "\n");
  const total = manifestBytes.length + offset;
  const out = Buffer.alloc(total);
  out.set(manifestBytes, 0);
  let pos = manifestBytes.length;
  for (const p of payloads) {
    out.set(p.bytes, pos);
    pos += p.bytes.length;
  }
  const artifact = join(outDir, `${outName}.sda`);
  writeFileSync(artifact, out);
  stages.push({ name: "fat", ok: true, detail: `${payloads.length} substrates, ${total} bytes` });
  return { ok: true, artifact, target: TARGETS["x86_64-linux"], stdout: "", stderr: "", stages };
}
function runNative(binary, timeoutMs = 5e3) {
  const res = spawnSync(binary, [], { encoding: "utf8", timeout: timeoutMs });
  return { stdout: res.stdout || "", stderr: res.stderr || "", status: res.status ?? -1 };
}
export {
  DNA_END,
  DNA_START,
  FAT_SUBSTRATES,
  SUBSTRATES,
  TARGETS,
  buildDnaHeader,
  buildFat,
  buildNative,
  clangPath,
  findDna,
  formatDnaHeader,
  readDnaHeader,
  readDnaTrailer,
  runNative,
  stripDna,
  verifyDna,
  withDnaHeader
};
