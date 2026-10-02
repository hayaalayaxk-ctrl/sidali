// Dilithium-profile post-quantum lattice signature.
// Real arithmetic in R_q = Z_q[X]/(X^256 + 1), q = 8380417 (CRYSTALS-Dilithium
// prime). Keygen / sign / verify use genuine ring multiplication, small-coefficient
// sampling and a Fiat–Shamir challenge derived from BLAKE3. Educational parameters.

import { blake3Bytes, utf8Encode, seededBytes, concat, u32le } from './blake3';

export const Q = 8380417;
export const N = 256;
const BOUND = 130994; // rejection bound on ||z||_inf

export type Poly = Int32Array;

export interface DilithiumKeyPair {
  publicKey: { a: number[]; t: number[] };
  privateKey: { s1: number[]; s2: number[]; a: number[] };
}

function mod(x: number): number {
  return ((x % Q) + Q) % Q;
}

// Polynomial multiplication in Z_q[X]/(X^N + 1).
// Products ai*bj are exact in float64 (< 2^53) and are reduced before accumulation
// so the running sum stays well inside the safe-integer range.
export function polyMul(a: number[] | Int32Array, b: number[] | Int32Array): number[] {
  const acc = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const ai = a[i];
    if (ai === 0) continue;
    for (let j = 0; j < N; j++) {
      const bj = b[j];
      if (bj === 0) continue;
      const prod = (ai * bj) % Q;
      const k = i + j;
      if (k < N) acc[k] += prod;
      else acc[k - N] -= prod; // X^N = -1
    }
  }
  const out = new Array(N);
  for (let i = 0; i < N; i++) out[i] = mod(acc[i]);
  return out;
}

function polyAdd(a: number[], b: number[]): number[] {
  return a.map((v, i) => mod(v + b[i]));
}

function sampleUniform(seed: Uint8Array, tag: number): number[] {
  const bytes = seededBytes(concat(seed, u32le(tag)), N * 4);
  const p = new Array(N);
  for (let i = 0; i < N; i++) {
    const v = (bytes[i * 4] | (bytes[i * 4 + 1] << 8) | (bytes[i * 4 + 2] << 16) | (bytes[i * 4 + 3] << 24)) >>> 0;
    p[i] = v % Q;
  }
  return p;
}

function sampleSmall(seed: Uint8Array, tag: number, eta = 2): number[] {
  const bytes = seededBytes(concat(seed, u32le(tag)), N);
  const p = new Array(N);
  for (let i = 0; i < N; i++) p[i] = (bytes[i] % (2 * eta + 1)) - eta;
  return p;
}

function challengeFromHash(hash: Uint8Array): number[] {
  const c = new Array(N).fill(0);
  let weight = 0;
  for (let i = 0; i < N && weight < 60; i++) {
    if (hash[i % hash.length] & 1) { c[i] = hash[(i + 7) % hash.length] & 1 ? 1 : -1; weight++; }
  }
  return c;
}

export function keygen(seedStr: string): DilithiumKeyPair {
  const seed = blake3Bytes(utf8Encode(seedStr));
  const a = sampleUniform(seed, 1);
  const s1 = sampleSmall(seed, 2);
  const s2 = sampleSmall(seed, 3);
  const t = polyAdd(polyMul(a, s1), s2);
  return { publicKey: { a, t }, privateKey: { s1, s2, a } };
}

export interface DilithiumSignature {
  z: number[];
  h: number[];
  c: number[];
  hash: string;
}

export function sign(message: string, kp: DilithiumKeyPair, nonce = 0): DilithiumSignature {
  const { s1, s2, a } = kp.privateKey;
  const y = sampleSmall(blake3Bytes(utf8Encode(message + ':' + nonce)), 10, 1);
  const w = polyMul(a, y);
  const cHash = blake3Bytes(utf8Encode(JSON.stringify(w.slice(0, 8)) + message));
  const c = challengeFromHash(cHash);
  // z = y + c*s1 ; h = c*s2  =>  A*z - c*t + h = A*y  (ring is commutative)
  const z = polyAdd(y, polyMul(c, s1)).map(center);
  const h = polyMul(c, s2).map(center);
  const hash = hexOf(blake3Bytes(concat(cHash, utf8Encode(JSON.stringify(z.slice(0, 8))))));
  return { z, h, c, hash };
}

function center(v: number): number {
  let x = mod(v);
  if (x > Q / 2) x -= Q;
  return mod(x);
}

export function verify(message: string, sig: DilithiumSignature, kp: DilithiumKeyPair): boolean {
  const { a, t } = kp.publicKey;
  const az = polyMul(a, sig.z);
  const ct = polyMul(sig.c, t);
  const wPrime = az.map((v, i) => mod(v - ct[i] + sig.h[i]));
  const cHash = blake3Bytes(utf8Encode(JSON.stringify(wPrime.slice(0, 8)) + message));
  const c = challengeFromHash(cHash);
  let match = true;
  for (let i = 0; i < N; i++) if (c[i] !== sig.c[i]) { match = false; break; }
  const norm = Math.max(...sig.z.map(v => { let x = mod(v); return x > Q / 2 ? Q - x : x; }));
  return match && norm <= BOUND;
}

function hexOf(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}
