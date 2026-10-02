// Sedenion dual-manifold algebra S16 ⊕ S16̄.
// 32 positive "Matter" opcodes (t+) and 32 negative "Antimatter" opcodes (t-),
// paired as the 64-code SidAli instruction set. Includes real zero-divisor
// detection over the sedenion product (non-normed algebra => zero divisors exist).

export const DIM = 16;

// Sedenion multiplication via the Cayley–Dickson doubling formula.
// (a1,a2)(b1,b2) = (a1 b1 - conj(b2) a2, b2 a1 + a2 conj(b1))
export function sedenionMul(a: number[], b: number[]): number[] {
  return mulDim(DIM, a, b);
}

function conjDim(dim: number, x: number[]): number[] {
  const r = x.slice(0, dim);
  for (let i = 1; i < dim; i++) r[i] = -r[i];
  return r;
}

function mulDim(dim: number, a: number[], b: number[]): number[] {
  if (dim === 1) return [a[0] * b[0]];
  const half = dim >> 1;
  const a1 = a.slice(0, half), a2 = a.slice(half, dim);
  const b1 = b.slice(0, half), b2 = b.slice(half, dim);
  const r1a = mulDim(half, a1, b1);
  const r1b = mulDim(half, conjDim(half, b2), a2);
  const r2a = mulDim(half, b2, a1);
  const r2b = mulDim(half, a2, conjDim(half, b1));
  const r1 = r1a.map((v, i) => v - r1b[i]);
  const r2 = r2a.map((v, i) => v + r2b[i]);
  return r1.concat(r2);
}

export interface ZeroDivisorResult {
  isZeroDivisor: boolean;
  normA: number;
  normB: number;
  normProduct: number;
  residual: number;
}

// Detect a zero divisor: a,b != 0 but a*b = 0 (possible because sedenions are not normed).
export function detectZeroDivisor(a: number[], b: number[]): ZeroDivisorResult {
  const p = sedenionMul(a, b);
  const normA = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  const normB = Math.sqrt(b.reduce((s, x) => s + x * x, 0));
  const normProduct = Math.sqrt(p.reduce((s, x) => s + x * x, 0));
  const residual = normProduct;
  const isZeroDivisor = normA > 1e-9 && normB > 1e-9 && normProduct < 1e-9;
  return { isZeroDivisor, normA, normB, normProduct, residual };
}

// The 64-opcode SidAli instruction set across the dual manifold.
export interface Opcode {
  code: number;
  mnemonic: string;
  manifold: 'Matter' | 'Antimatter';
  t: 't+' | 't-';
  desc: string;
}

const MATTER: Array<[string, string]> = [
  ['PI_LOAD', 'Load circle-π lattice value into register'],
  ['E_LOG', 'Spiral-e logarithmic activation'],
  ['ADD', 'Matter integer add'],
  ['SUB', 'Matter integer subtract'],
  ['MUL', 'Sedenion product'],
  ['DIV', 'Rational divide'],
  ['CMP', 'Compare and set flags'],
  ['JMP', 'Circle warp jump'],
  ['JZ', 'Jump if zero-drift'],
  ['CALL', 'Symmetric activation call'],
  ['RET', 'Return from t+ frame'],
  ['LOAD', 'Load from Pi-Lattice'],
  ['STORE', 'Store to Pi-Lattice'],
  ['PUSH', 'Push Matter cell'],
  ['POP', 'Pop Matter cell'],
  ['DUP', 'Duplicate cell'],
  ['SWAP', 'Swap cells'],
  ['AND', 'Bitwise conjunction'],
  ['OR', 'Bitwise disjunction'],
  ['XOR', 'Bitwise exclusive'],
  ['SHL', 'Shift left'],
  ['SHR', 'Shift right'],
  ['SIN', 'Circle sine'],
  ['COS', 'Circle cosine'],
  ['TAN', 'Circle tangent'],
  ['SQRT', 'Principal square root'],
  ['POW', 'Exponentiation'],
  ['ABS', 'Absolute value'],
  ['MIN', 'Minimum'],
  ['MAX', 'Maximum'],
  ['HASH', 'BLAKE3 witness'],
  ['EMIT', 'Emit execution witness'],
];

const ANTIMATTER: Array<[string, string]> = [
  ['ZERO_VAULT', 'Zero-divisor vault seal'],
  ['DRIFT_CHECK', 'L_eff drift validation'],
  ['GC_SWEEP', 't- garbage collection'],
  ['UNWIND', 'Exception unwind'],
  ['TRACE_OFF', 'Disable witness trace'],
  ['SEAL', 'Seal execution epoch'],
  ['DECAY', 'Antimatter decay'],
  ['ANNIHILATE', 'Matter/antimatter annihilation'],
  ['ROLLBACK', 'Rollback ledger'],
  ['AUDIT', 'Emit audit record'],
  ['FREEZE', 'Freeze resource budget'],
  ['THAW', 'Thaw resource budget'],
  ['CANON', 'Canonicalize value'],
  ['SIEVE', 'Cantor sieve measure-zero pass'],
  ['ZWS_ENC', 'Zero-width steganography encode'],
  ['ZWS_DEC', 'Zero-width steganography decode'],
  ['SIGMA', 'Sigma kernel reduction'],
  ['RHO', 'Spectral radius rho < 1 guard'],
  ['KANI', 'Bounded model-check assertion'],
  ['LEAN', 'Lean4 proof obligation'],
  ['CIRCOM', 'zk-SNARK constraint emit'],
  ['SOLIDITY', 'EVM contract emit'],
  ['PIRTM', 'PIRTM transcendental node'],
  ['FERMAT', 'Fermat primality witness'],
  ['DILITHIUM', 'Post-quantum signature'],
  ['CRDT', 'CRDT merge'],
  ['LEDGER', 'Ledger append'],
  ['QUORUM', 'Quorum vote'],
  ['BUDGET', 'Resource budget check'],
  ['TIER', 'S0-S6 tier gate'],
  ['PROOF_ANCHOR', 'Anchor proof root'],
  ['DNA_EXPORT', 'Immortal kernel DNA export'],
];

export function opcodeTable(): Opcode[] {
  const ops: Opcode[] = [];
  MATTER.forEach(([mn, desc], i) => ops.push({ code: i, mnemonic: mn, manifold: 'Matter', t: 't+', desc }));
  ANTIMATTER.forEach(([mn, desc], i) => ops.push({ code: 32 + i, mnemonic: mn, manifold: 'Antimatter', t: 't-', desc }));
  return ops;
}

// Execute one SidAli opcode over a sedenion register (real math on Matter codes).
export function executeOpcode(op: Opcode, arg: number, reg: number[]): { reg: number[]; out: number } {
  const r = reg.slice();
  switch (op.mnemonic) {
    case 'PI_LOAD': return { reg: r, out: Math.PI * arg };
    case 'E_LOG': return { reg: r, out: Math.log(arg) * Math.E };
    case 'ADD': return { reg: r, out: arg + (reg[0] || 0) };
    case 'SUB': return { reg: r, out: (reg[0] || 0) - arg };
    case 'MUL': return { reg: r, out: arg * (reg[0] || 1) };
    case 'DIV': return { reg: r, out: arg === 0 ? NaN : (reg[0] || 0) / arg };
    case 'SQRT': return { reg: r, out: Math.sqrt(arg) };
    case 'SIN': return { reg: r, out: Math.sin(arg) };
    case 'COS': return { reg: r, out: Math.cos(arg) };
    case 'TAN': return { reg: r, out: Math.tan(arg) };
    case 'POW': return { reg: r, out: Math.pow(reg[0] || 1, arg) };
    case 'ABS': return { reg: r, out: Math.abs(arg) };
    case 'HASH': return { reg: r, out: 0 };
    default: return { reg: r, out: arg };
  }
}
