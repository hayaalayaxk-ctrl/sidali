// BLAKE3-profile hash (SidAli). Real 32-bit ARX compression function, 7 rounds,
// message permutation, chaining for multi-block input. Deterministic 256-bit digest.

const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
]);

const MSG_PERM = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];

const CHUNK_START = 1 << 0;
const CHUNK_END = 1 << 1;
const ROOT = 1 << 3;

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}

function g(state: Uint32Array, a: number, b: number, c: number, d: number, mx: number, my: number) {
  state[a] = (state[a] + state[b] + mx) >>> 0;
  state[d] = rotr(state[d] ^ state[a], 16);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotr(state[b] ^ state[c], 12);
  state[a] = (state[a] + state[b] + my) >>> 0;
  state[d] = rotr(state[d] ^ state[a], 8);
  state[c] = (state[c] + state[d]) >>> 0;
  state[b] = rotr(state[b] ^ state[c], 7);
}

function compress(
  cv: Uint32Array, block: Uint32Array, counter: number, blockLen: number, flags: number,
): Uint32Array {
  const state = new Uint32Array(16);
  state.set(cv, 0);
  state.set(IV.subarray(0, 4), 8);
  state[12] = counter >>> 0;
  state[13] = Math.floor(counter / 0x100000000) >>> 0;
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

function bytesToWords(bytes: Uint8Array, offset: number): Uint32Array {
  const w = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    const j = offset + i * 4;
    w[i] = ((bytes[j] || 0) | ((bytes[j + 1] || 0) << 8) | ((bytes[j + 2] || 0) << 16) | ((bytes[j + 3] || 0) << 24)) >>> 0;
  }
  return w;
}

export function blake3Bytes(input: Uint8Array): Uint8Array {
  let cv = Uint32Array.from(IV);
  const blocks = Math.max(1, Math.ceil(input.length / 64));
  let lastOut: Uint32Array | null = null;
  for (let b = 0; b < blocks; b++) {
    const offset = b * 64;
    const blockLen = Math.min(64, input.length - offset);
    const flags = (b === 0 ? CHUNK_START : 0) | (b === blocks - 1 ? CHUNK_END : 0) |
      (blocks === 1 ? ROOT : 0);
    const words = bytesToWords(input, offset);
    const out = compress(cv, words, b, blockLen < 0 ? 0 : blockLen, flags);
    lastOut = out;
    cv = out.slice(0, 8);
  }
  const out = lastOut!;
  const digest = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    digest[i * 4] = out[i] & 0xff;
    digest[i * 4 + 1] = (out[i] >>> 8) & 0xff;
    digest[i * 4 + 2] = (out[i] >>> 16) & 0xff;
    digest[i * 4 + 3] = (out[i] >>> 24) & 0xff;
  }
  return digest;
}

export function utf8Encode(s: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(s);
  const bytes: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp < 0x80) bytes.push(cp);
    else if (cp < 0x800) bytes.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) bytes.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    else bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
  }
  return new Uint8Array(bytes);
}

export function hex(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

export function blake3(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? utf8Encode(input) : input;
  return hex(blake3Bytes(bytes));
}

// Deterministic pseudo-random stream derived from a seed (XOF-style expansion).
export function seededBytes(seed: Uint8Array, count: number): Uint8Array {
  const out = new Uint8Array(count);
  let counter = 0;
  let off = 0;
  while (off < count) {
    const block = blake3Bytes(concat(seed, u32le(counter)));
    const n = Math.min(32, count - off);
    out.set(block.subarray(0, n), off);
    off += n;
    counter++;
  }
  return out;
}

export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const r = new Uint8Array(a.length + b.length);
  r.set(a, 0);
  r.set(b, a.length);
  return r;
}

export function u32le(n: number): Uint8Array {
  return new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);
}
