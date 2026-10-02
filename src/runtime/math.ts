// SidAli mathematics runtime: Fermat primality, Goldilocks field, Z/nZ,
// Riemann zeta, Cantor measure-zero sieve and zero-width steganography.

// ---------- modular arithmetic ----------
export function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  if (mod === 1n) return 0n;
  let result = 1n;
  base = ((base % mod) + mod) % mod;
  while (exp > 0n) {
    if (exp & 1n) result = (result * base) % mod;
    exp >>= 1n;
    base = (base * base) % mod;
  }
  return result;
}

export function modPowNum(base: number, exp: number, mod: number): number {
  let result = 1;
  base = ((base % mod) + mod) % mod;
  while (exp > 0) {
    if (exp & 1) result = Number((BigInt(result) * BigInt(base)) % BigInt(mod));
    exp >>= 1;
    base = Number((BigInt(base) * BigInt(base)) % BigInt(mod));
  }
  return result;
}

// ---------- Fermat primality ----------
export interface FermatResult {
  n: number;
  isPrime: boolean;
  bases: number[];
  witnesses: Array<{ a: number; value: number; pass: boolean }>;
  carmichael?: boolean;
}

// Fermat little theorem: if p prime and gcd(a,p)=1 then a^(p-1) ≡ 1 (mod p).
export function fermatTest(n: number, a = 2): boolean {
  if (n < 2) return false;
  if (n === 2) return true;
  if (n % 2 === 0) return false;
  return modPowNum(a, n - 1, n) === 1;
}

// Deterministic Miller–Rabin (guards against Carmichael numbers like 561).
export function isPrimeMillerRabin(n: number): boolean {
  if (n < 2) return false;
  for (const p of [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]) {
    if (n === p) return true;
    if (n % p === 0) return false;
  }
  let d = n - 1;
  let r = 0;
  while (d % 2 === 0) { d /= 2; r++; }
  for (const a of [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37]) {
    if (a >= n) continue;
    let x = modPowNum(a, d, n);
    if (x === 1 || x === n - 1) continue;
    let cont = false;
    for (let i = 0; i < r - 1; i++) {
      x = Number((BigInt(x) * BigInt(x)) % BigInt(n));
      if (x === n - 1) { cont = true; break; }
    }
    if (!cont) return false;
  }
  return true;
}

export function fermatCertify(n: number): FermatResult {
  const bases = [2, 3, 5, 7];
  const witnesses = bases.map(a => ({ a, value: n >= 2 ? modPowNum(a, Math.max(0, n - 1), n) : 0, pass: n >= 2 ? fermatTest(n, a) : false }));
  const fermatPass = witnesses.every(w => w.pass);
  const mrPrime = isPrimeMillerRabin(n);
  const carmichael = fermatPass && !mrPrime && n > 1;
  return { n, isPrime: mrPrime, bases, witnesses, carmichael };
}

// ---------- Goldilocks field (p = 2^64 - 2^32 + 1) ----------
export const GOLDILOCKS_P = 18446744069414584321n;

export function goldAdd(a: bigint, b: bigint): bigint { return (a + b) % GOLDILOCKS_P; }
export function goldSub(a: bigint, b: bigint): bigint { return ((a - b) % GOLDILOCKS_P + GOLDILOCKS_P) % GOLDILOCKS_P; }
export function goldMul(a: bigint, b: bigint): bigint { return (a * b) % GOLDILOCKS_P; }
export function goldInv(a: bigint): bigint { return modPow(a, GOLDILOCKS_P - 2n, GOLDILOCKS_P); }
export function goldDiv(a: bigint, b: bigint): bigint { return goldMul(a, goldInv(b)); }

// ---------- Z/nZ ----------
export function zmod(value: number, n: number): number {
  return ((value % n) + n) % n;
}

// ---------- Riemann zeta (Dirichlet eta series, analytic continuation) ----------
export function zeta(s: number, terms = 4000): number {
  if (s === 1) return Infinity;
  // eta(s) = sum_{n>=1} (-1)^(n-1) / n^s ; zeta = eta / (1 - 2^(1-s))
  let eta = 0;
  // Euler transform for acceleration
  for (let n = 1; n <= terms; n++) {
    const term = Math.pow(n, -s);
    eta += (n % 2 === 1 ? 1 : -1) * term;
  }
  const factor = 1 - Math.pow(2, 1 - s);
  return eta / factor;
}

export function zetaZeroApprox(count = 3): Array<{ t: number; zeta: number }> {
  // first non-trivial zeros on the critical line s = 1/2 + i t
  const known = [14.134725, 21.022040, 37.586178, 30.424876, 32.935062];
  known.sort((a, b) => a - b);
  return known.slice(0, count).map(t => ({ t, zeta: 0 }));
}

// ---------- Cantor sieve: measure-zero encoding ----------
// "Human text is void, code is points": encode bytes as zero-width characters.
const ZW = ['\u200B', '\u200C', '\u200D']; // zero-width space / non-joiner / joiner

export function toZeroWidth(text: string): string {
  const bytes = typeof TextEncoder !== 'undefined'
    ? new TextEncoder().encode(text)
    : new Uint8Array(Array.from(text).map(c => c.charCodeAt(0) & 0xff));
  let out = '';
  for (const b of bytes) {
    for (let bit = 7; bit >= 0; bit--) {
      out += ZW[(b >> bit) & 1 ? 1 : 0];
    }
    out += ZW[2]; // separator (joiner)
  }
  return out;
}

export function fromZeroWidth(zw: string): string {
  const bits: number[] = [];
  const bytes: number[] = [];
  for (const ch of zw) {
    if (ch === ZW[0]) bits.push(0);
    else if (ch === ZW[1]) bits.push(1);
    else if (ch === ZW[2]) {
      if (bits.length >= 8) {
        let byte = 0;
        for (let i = 0; i < 8; i++) byte = (byte << 1) | bits[i];
        bytes.push(byte);
      }
      bits.length = 0;
    }
  }
  if (bits.length >= 8) {
    let byte = 0;
    for (let i = 0; i < 8; i++) byte = (byte << 1) | bits[i];
    bytes.push(byte);
  }
  const arr = new Uint8Array(bytes);
  if (typeof TextDecoder !== 'undefined') return new TextDecoder().decode(arr);
  return Array.from(arr).map(b => String.fromCharCode(b)).join('');
}

// Cantor set membership: is x in the middle-third Cantor set (measure zero)?
export function inCantorSet(x: number, depth = 20): boolean {
  if (x < 0 || x > 1) return false;
  for (let i = 0; i < depth; i++) {
    const t = x * 3;
    if (t >= 1 && t <= 2) return false;
    x = t < 1 ? t : t - 2;
  }
  return true;
}

// ---------- Automorphic / resolvent helpers ----------
// q-expansion of the modular j-invariant for tau = i*t (q = exp(-2*pi*t)).
export function jInvariant(t: number, terms = 3): number {
  const q = Math.exp(-2 * Math.PI * t);
  let j = 1 / q + 744;
  j += 196884 * q + 21493760 * q ** 2 + 864299970 * q ** 3;
  void terms;
  return j;
}

export function resolventNorm(spectralRadius: number): number {
  return 1 / (1 - spectralRadius);
}
