// GraphemeDecomposer + AlpPolicy + CNL compiler.
// Turns spoken/typed plain English into compilable SidAli source.
// This is a deterministic grammar-driven decomposer (not a website widget).

export interface DecomposeResult {
  code: string;
  intent: string;
  confidence: number;
  rta: number; // Arta defect reduction metric (higher is better)
  notes: string[];
}

// AlpPolicy: increase multiplicity / reduce Arta defects.
export interface AlpPolicyState {
  multiplicity: number;
  artaDefects: number;
  policy: 'INCREASE_MULTIPLICITY' | 'REDUCE_ARTA' | 'NONE';
}

export function alpPolicy(multiplicity: number, artaDefects: number): AlpPolicyState {
  let policy: AlpPolicyState['policy'] = 'NONE';
  if (artaDefects > 0) policy = 'REDUCE_ARTA';
  else if (multiplicity < 3) policy = 'INCREASE_MULTIPLICITY';
  return { multiplicity, artaDefects, policy };
}

// RtaMetric: residual-transcendental alignment quality in [0,1].
export function rtaMetric(confidence: number, artaDefects: number): number {
  return Math.max(0, Math.min(1, confidence - artaDefects * 0.1));
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, hundred: 100, thousand: 1000,
};

function wordsToNumbers(text: string): string {
  return text.replace(/\b(zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|thousand)\b/gi,
    (m) => String(NUMBER_WORDS[m.toLowerCase()] ?? m));
}

// Convert "add x and y", "multiply a by b", "x plus y", etc.
function rewriteArithmetic(s: string): string {
  let out = s;
  out = out.replace(/\b(add|sum|plus)\s+([A-Za-z_$][\w$]*)\s+(?:and|to|\+)\s+([A-Za-z_$][\w$]*)/gi,
    (_m, _v, a, b) => `${a} + ${b}`);
  out = out.replace(/\b(subtract|minus)\s+([A-Za-z_$][\w$]*)\s+(?:from|and|-)\s+([A-Za-z_$][\w$]*)/gi,
    (_m, _v, a, b) => `${a} - ${b}`);
  out = out.replace(/\b(multiply|times|product of)\s+([A-Za-z_$][\w$]*)\s+(?:by|and|\*)\s+([A-Za-z_$][\w$]*)/gi,
    (_m, _v, a, b) => `${a} * ${b}`);
  out = out.replace(/\b(divide)\s+([A-Za-z_$][\w$]*)\s+(?:by|and|\/)\s+([A-Za-z_$][\w$]*)/gi,
    (_m, _v, a, b) => `${a} / ${b}`);
  return out;
}

function rewriteComparisons(s: string): string {
  return s
    .replace(/\bis greater than\b/gi, '>')
    .replace(/\bis less than\b/gi, '<')
    .replace(/\bgreater than or equal to\b/gi, '>=')
    .replace(/\bless than or equal to\b/gi, '<=')
    .replace(/\bequals?\b(?!\s+to)/gi, '==');
}

export class GraphemeDecomposer {
  decompose(input: string): DecomposeResult {
    const notes: string[] = [];
    const raw = input.trim();
    const lower = raw.toLowerCase();
    let code = '';
    let intent = 'expression';
    let confidence = 0.6;

    // ---- structured build intents ----
    const buildIntent = this.matchBuildIntent(lower);
    if (buildIntent) {
      return {
        code: buildIntent.code,
        intent: buildIntent.intent,
        confidence: 0.92,
        rta: rtaMetric(0.92, 0),
        notes: [`matched build intent: ${buildIntent.intent}`],
      };
    }

    // ---- normalize English into SidAli ----
    let text = raw;
    text = rewriteArithmetic(text);
    text = rewriteComparisons(text);
    text = wordsToNumbers(text);

    // print/say/show
    text = text.replace(/^\s*(print|say|show|display|output)\s+(?:the\s+)?(?:value\s+of\s+)?(.+)$/i, 'print $1');
    // "repeat N times: print X" / "loop N times ..."
    const repeatMatch = text.match(/^\s*(?:repeat|loop)\s+(\d+)\s+times?\s*[:,]?\s*(.*)$/i);
    if (repeatMatch) {
      const n = repeatMatch[1];
      const inner = repeatMatch[2].trim() || 'print "hello"';
      const innerCode = this.decomposeInline(inner);
      return {
        code: `repeat ${n} {\n  ${innerCode}\n}`,
        intent: 'repeat-loop',
        confidence: 0.9,
        rta: rtaMetric(0.9, 0),
        notes: ['repeat loop'],
      };
    }
    // "create/set/let X equal to N" / "X is N"
    text = text.replace(/^\s*(?:create|make|set|define|declare)\s+(?:a\s+)?(?:variable\s+)?([A-Za-z_$][\w$]*)\s+(?:equal to|to|as|=)\s+(.+)$/i, 'let $1 = $2');
    text = text.replace(/^\s*(?:let|set)\s+([A-Za-z_$][\w$]*)\s+(?:be|=)\s+(.+)$/i, 'let $1 = $2');
    text = text.replace(/^\s*([A-Za-z_$][\w$]*)\s+is\s+(.+)$/i, 'let $1 = $2');
    // "compute/calculate Z as add x and y" -> let z = x + y
    text = text.replace(/^\s*(?:compute|calculate)\s+([A-Za-z_$][\w$]*)\s+(?:as|equals?|=)\s+(.+)$/i, 'let $1 = $2');
    // "if Z > 10 print big"
    const ifMatch = text.match(/^\s*if\s+(.+?)\s+(?:then\s+)?(?:print|say|show)\s+(.+)$/i);
    if (ifMatch) {
      const cond = ifMatch[1].trim();
      const body = ifMatch[2].trim();
      const bodyCode = this.decomposeInline(body);
      return {
        code: `if ${cond} {\n  ${bodyCode}\n}`,
        intent: 'conditional',
        confidence: 0.88,
        rta: rtaMetric(0.88, 0),
        notes: ['conditional'],
      };
    }
    // "define a function square of n that returns n*n"
    const fnMatch = text.match(/^\s*(?:define|create|make)?\s*(?:a\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:of|with|taking)?\s*\(?([A-Za-z_$][\w$]*)?\)?\s*(?:that\s+)?(?:returns?|gives?|is)\s+(.+)$/i);
    if (fnMatch) {
      const name = fnMatch[1];
      const param = fnMatch[2] || 'n';
      const body = fnMatch[3].trim();
      return {
        code: `function ${name}(${param}) {\n  return ${body}\n}`,
        intent: 'function',
        confidence: 0.9,
        rta: rtaMetric(0.9, 0),
        notes: ['function definition'],
      };
    }

    // If it already parses as SidAli-ish, keep it.
    code = text;
    confidence = 0.7;

    // split into statements on " and then ", newlines, semicolons
    const statements = text.split(/\s+and then\s+|;\s*|\n+/).map(s => s.trim()).filter(Boolean);
    if (statements.length > 1) {
      code = statements.map(s => this.decomposeInline(s)).join('\n');
      intent = 'program';
      confidence = 0.8;
    } else {
      code = this.decomposeInline(text);
      intent = /^print\b/.test(code) ? 'print' : /^let\b/.test(code) ? 'assignment' : 'expression';
    }

    notes.push('normalized English → SidAli');
    return { code, intent, confidence, rta: rtaMetric(confidence, 0), notes };
  }

  private decomposeInline(s: string): string {
    let t = s.trim();
    t = rewriteArithmetic(t);
    t = rewriteComparisons(t);
    t = wordsToNumbers(t);
    t = t.replace(/^\s*(?:print|say|show|display|output)\s+(?:the\s+)?(?:value\s+of\s+)?(.+)$/i, 'print $1');
    t = t.replace(/^\s*(?:create|make|set|define|declare)\s+(?:a\s+)?(?:variable\s+)?([A-Za-z_$][\w$]*)\s+(?:equal to|to|as|=)\s+(.+)$/i, 'let $1 = $2');
    t = t.replace(/^\s*([A-Za-z_$][\w$]*)\s+is\s+(.+)$/i, 'let $1 = $2');
    // quote bare words after print if they're not numbers/identifiers
    t = t.replace(/^print\s+([A-Za-z_][\w$]*)$/i, (m, w) => {
      if (['true', 'false', 'nil'].includes(w.toLowerCase())) return `print ${w.toLowerCase()}`;
      return `print "${w}"`;
    });
    return t;
  }

  private matchBuildIntent(lower: string): { code: string; intent: string } | null {
    const has = (...ws: string[]) => ws.some(w => lower.includes(w));
    if (has('operating system', 'an os', 'mini os', 'system that reads')) {
      return { intent: 'build-os', code: OS_EXAMPLE };
    }
    if (has('social', 'social network', 'social media', 'community platform', 'social platform')) {
      return { intent: 'build-social', code: SOCIAL_EXAMPLE };
    }
    if (has('zk', 'zero knowledge', 'zero-knowledge', 'snark', 'smart contract', 'blockchain')) {
      return { intent: 'build-zk', code: ZK_EXAMPLE };
    }
    if (has('ghost logic', 'zero-width', 'zero width', 'steganography', 'zws')) {
      return { intent: 'build-ghost', code: GHOST_EXAMPLE };
    }
    if (has('fibonacci', 'factorial', 'math suite')) {
      return { intent: 'build-math', code: MATH_EXAMPLE };
    }
    if (has('build a language', 'compiler', 'programming language')) {
      return { intent: 'build-language', code: LANGUAGE_EXAMPLE };
    }
    return null;
  }
}

export const OS_EXAMPLE = `// SidAli mini operating system: file read/write over the RAM machine
let m = newMachine()
m.writeMBR("SECTORFORTH init")
let boot = m.boot()
print "ring " + boot.ring
fsWrite("/etc/motd", "welcome to SidAli OS")
fsWrite("/home/user.txt", "hello from ring 0")
let data = fsRead("/home/user.txt")
print "read: " + data
print "files: " + len(fsList())`;

export const SOCIAL_EXAMPLE = `// SidAli social platform: CRDT convergence + append-only ledger
let feed = newCRDT()
let l = newLedger()
feed.set("post:1", "hello world", 1, "node-a")
feed.set("post:2", "sidali is live", 2, "node-b")
feed.set("post:1", "hello world (edited)", 3, "node-a")
l.append("post", "post:1")
l.append("post", "post:2")
print "feed size " + feed.size
print feed.get("post:1")
print "ledger valid " + l.verify()
print "ledger height " + l.size`;

export const ZK_EXAMPLE = `// SidAli zk-SNARK style contract with post-quantum Dilithium signatures
let kp = dilithiumKeygen("contract-seed")
let l = newLedger()
l.append("deploy", "verifier")
l.append("commit", blake3("state=42"))
let sig = dilithiumSign("transfer 10 to bob", kp)
print "sig ok " + dilithiumVerify("transfer 10 to bob", sig, kp)
print "tampered ok " + dilithiumVerify("transfer 999 to bob", sig, kp)
print "proof anchor " + proofAnchor(["state=42", "bob"])
print "chain " + l.verify()`;

export const GHOST_EXAMPLE = `// SidAli ghost logic + zero-width steganography (Cantor sieve)
let secret = "sidali-void"
let hidden = zwsEncode(secret)
print "encoded length " + len(hidden)
print "decoded " + zwsDecode(hidden)
let g = ghost("let x=5")
print "semantic volume " + g.semanticVolume
print "measure " + g.measure`;

export const MATH_EXAMPLE = `// SidAli real math suite
print "fib 55 " + fib(55)
print "factorial 5 " + factorial(5)
let square = function(n) { return n * n }
print "square 7 " + square(7)
let x = 5
let y = 10
print "sum " + (x + y)
print "primes " + isPrime(97)
print "zeta 2 " + zeta(2)`;

export const LANGUAGE_EXAMPLE = `// SidAli builds languages: transcendental AST + 64 sedenion opcodes
let ops = opcodes()
print "opcodes " + len(ops)
let a = [0,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0]
let b = [0,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0]
let zd = zeroDivisor(a, b)
print "norm product " + zd.normProduct
print "pi node " + pi(2)`;
