// SidAli Lexer — hand-written tokenizer. No eval, no external parser generators.
// Keywords accept both English and Arabic spellings.

export type TokType =
  | 'number' | 'string' | 'ident' | 'keyword' | 'op' | 'punct' | 'newline' | 'eof';

export interface Token {
  type: TokType;
  value: string;
  line: number;
  col: number;
  parts?: Array<{ text?: string; expr?: string }>;
}

export const KEYWORDS: Record<string, string> = {
  // English canonical keywords
  'let': 'let', 'const': 'const', 'var': 'let', 'fn': 'fn', 'function': 'fn',
  'return': 'return', 'if': 'if', 'else': 'else', 'while': 'while',
  'repeat': 'repeat', 'times': 'times', 'for': 'for', 'in': 'in',
  'print': 'print', 'class': 'class', 'extends': 'extends', 'new': 'new', 'this': 'this',
  'try': 'try', 'catch': 'catch', 'finally': 'finally', 'throw': 'throw',
  'true': 'true', 'false': 'false', 'nil': 'nil', 'null': 'nil',
  'and': 'and', 'or': 'or', 'not': 'not', 'import': 'import',
  'build': 'build', 'contract': 'contract', 'system': 'system',
  'platform': 'platform', 'break': 'break', 'continue': 'continue',
  // Arabic source spellings -> canonical English keyword
  'متغير': 'let', 'ثابت': 'const', 'دالة': 'fn', 'ارجاع': 'return', 'إرجاع': 'return',
  'اذا': 'if', 'إذا': 'if', 'والا': 'else', 'وإلا': 'else', 'طالما': 'while',
  'كرر': 'repeat', 'لكل': 'for', 'في': 'in', 'اطبع': 'print', 'طباعة': 'print',
  'صنف': 'class', 'يمتد': 'extends', 'جديد': 'new', 'هذا': 'this',
  'محاولة': 'try', 'التقاط': 'catch', 'اخيرا': 'finally', 'أخيرا': 'finally',
  'ارفع': 'throw', 'صحيح': 'true', 'خطأ': 'false', 'لاشيء': 'nil', 'لا_شيء': 'nil',
  'و': 'and', 'او': 'or', 'أو': 'or', 'ليس': 'not',
  'عقد': 'contract', 'نظام': 'system', 'نظام_تشغيل': 'system', 'بناء': 'build',
  'منصة': 'platform', 'قاعدة': 'database', 'خادم': 'server', 'واجهة': 'interface',
  'زوج': 'pair', 'دع': 'let', 'عرف': 'let',
};

const PUNCT2 = ['==', '!=', '<=', '>=', '&&', '||', '->', '=>', '+=', '-=', '*=', '/=', '%=', '**', '..', '::'];

export class LexError extends Error {
  line: number;
  col: number;
  constructor(msg: string, line: number, col: number) {
    super(`LexError at ${line}:${col}: ${msg}`);
    this.line = line;
    this.col = col;
  }
}

export function tokenize(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  const n = src.length;

  const peek = (k = 0) => src[i + k];
  const advance = () => {
    const c = src[i++];
    if (c === '\n') { line++; col = 1; } else { col++; }
    return c;
  };
  const push = (type: TokType, value: string, l = line, c = col) =>
    toks.push({ type, value, line: l, col: c });

  const isIdStart = (ch: string) =>
    (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$' ||
    /[\u0600-\u06FF]/.test(ch);
  const isIdPart = (ch: string) => isIdStart(ch) || (ch >= '0' && ch <= '9');
  const isDigit = (ch: string) => ch >= '0' && ch <= '9';

  while (i < n) {
    const ch = peek();

    if (ch === '\n') {
      const l = line, c = col;
      advance();
      push('newline', '\n', l, c);
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') { advance(); continue; }

    if (ch === '/' && peek(1) === '/') {
      while (i < n && peek() !== '\n') advance();
      continue;
    }
    if (ch === '/' && peek(1) === '*') {
      advance(); advance();
      while (i < n && !(peek() === '*' && peek(1) === '/')) advance();
      if (i < n) { advance(); advance(); }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === '«') {
      const quote = ch === '«' ? '»' : ch;
      const startL = line, startC = col;
      advance();
      let raw = '';
      while (i < n && peek() !== quote) {
        if (peek() === '\\') {
          advance();
          const e = advance();
          raw += e === 'n' ? '\n' : e === 't' ? '\t' : e === '"' ? '"' : e === "'" ? "'" : e === '\\' ? '\\' : e;
        } else {
          raw += advance();
        }
      }
      if (i >= n) throw new LexError('unterminated string', startL, startC);
      advance();
      push('string', raw, startL, startC);
      toks[toks.length - 1].parts = splitInterpolation(raw);
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(peek(1)))) {
      const startL = line, startC = col;
      let num = '';
      if (ch === '0' && (peek(1) === 'x' || peek(1) === 'X')) {
        advance(); advance();
        while (i < n && /[0-9a-fA-F_]/.test(peek())) num += advance();
        push('number', String(parseInt(num.replace(/_/g, ''), 16)), startL, startC);
        continue;
      }
      if (ch === '0' && (peek(1) === 'b' || peek(1) === 'B')) {
        advance(); advance();
        while (i < n && /[01_]/.test(peek())) num += advance();
        push('number', String(parseInt(num.replace(/_/g, ''), 2)), startL, startC);
        continue;
      }
      while (i < n && (isDigit(peek()) || peek() === '.' || peek() === '_')) {
        const c2 = peek();
        if (c2 === '.' && !isDigit(peek(1))) break;
        num += advance();
      }
      if ((peek() === 'e' || peek() === 'E') && (isDigit(peek(1)) || ((peek(1) === '+' || peek(1) === '-') && isDigit(peek(2))))) {
        num += advance();
        if (peek() === '+' || peek() === '-') num += advance();
        while (i < n && isDigit(peek())) num += advance();
      }
      push('number', num.replace(/_/g, ''), startL, startC);
      continue;
    }

    if (isIdStart(ch)) {
      const startL = line, startC = col;
      let id = '';
      while (i < n && isIdPart(peek())) id += advance();
      if (KEYWORDS[id]) push('keyword', KEYWORDS[id], startL, startC);
      else push('ident', id, startL, startC);
      continue;
    }

    const startL = line, startC = col;
    const two = ch + (peek(1) || '');
    if (PUNCT2.includes(two)) {
      advance(); advance();
      push('op', two, startL, startC);
      continue;
    }
    if ('+-*/%<>=!&|^~?:'.includes(ch)) { advance(); push('op', ch, startL, startC); continue; }
    if ('(){}[],.;'.includes(ch)) { advance(); push('punct', ch, startL, startC); continue; }

    throw new LexError(`unexpected character ${JSON.stringify(ch)}`, startL, startC);
  }

  push('eof', '');
  return toks;
}

export function splitInterpolation(raw: string): Array<{ text?: string; expr?: string }> {
  const parts: Array<{ text?: string; expr?: string }> = [];
  let buf = '';
  let i = 0;
  while (i < raw.length) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      if (buf) { parts.push({ text: buf }); buf = ''; }
      let depth = 1;
      i += 2;
      let expr = '';
      while (i < raw.length && depth > 0) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') { depth--; if (depth === 0) break; }
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
