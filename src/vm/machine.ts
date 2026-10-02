// SidAli VM substrate: 32MB RAM (Uint8Array), Pi-Lattice loading, SectorForth
// 512-byte MBR bootloader simulation, ghost logic / semantic volume, and the
// Immortal Kernel DNA export/import ([START]...[END]).

import { blake3, blake3Bytes, utf8Encode, hex } from '../std/blake3';

export const RAM_SIZE = 32 * 1024 * 1024; // 32MB
export const PAGE_SIZE = 4096;
export const SECTOR = 512;

export class Machine {
  ram: Uint8Array;
  lattice: Map<number, number> = new Map();
  regs: Int32Array = new Int32Array(32);
  pc = 0;
  running = false;
  ring = 0; // privilege ring (0 = kernel)
  mbr: Uint8Array;
  booted = false;
  log: string[] = [];

  constructor(size = RAM_SIZE) {
    this.ram = new Uint8Array(size);
    this.mbr = new Uint8Array(SECTOR);
  }

  // Write a 512-byte MBR (SectorForth-style boot sector) into RAM at 0x7C00.
  writeMBR(program: string): number {
    const bytes = utf8Encode(program).subarray(0, SECTOR - 2);
    this.mbr = new Uint8Array(SECTOR);
    this.mbr.set(bytes, 0);
    this.mbr[510] = 0x55; // boot signature
    this.mbr[511] = 0xaa;
    const base = 0x7c00;
    this.ram.set(this.mbr, base);
    return base;
  }

  boot(): { ok: boolean; ring: number; message: string } {
    const sig = this.ram[0x7c00 + 510] === 0x55 && this.ram[0x7c00 + 511] === 0xaa;
    this.booted = sig;
    this.ring = sig ? 0 : 3;
    const message = sig ? 'SectorForth booted into Ring 0' : 'boot signature invalid';
    this.log.push(message);
    return { ok: sig, ring: this.ring, message };
  }

  // Pi-Lattice: load a program image into RAM (Immutable Resurrection).
  loadLattice(program: string, base = PAGE_SIZE): number {
    const bytes = utf8Encode(program);
    this.ram.set(bytes.subarray(0, this.ram.length - base), base);
    for (let i = 0; i < bytes.length; i++) {
      this.lattice.set(base + i, bytes[i]);
    }
    this.log.push(`Pi-Lattice loaded ${bytes.length} bytes at 0x${base.toString(16)}`);
    return bytes.length;
  }

  read(addr: number, len: number): Uint8Array {
    return this.ram.subarray(addr, addr + len);
  }

  write(addr: number, bytes: Uint8Array) {
    this.ram.set(bytes, addr);
  }

  // Export the whole RAM as invisible DNA between [START] and [END].
  exportDNA(limit = 1024): string {
    const used = Math.min(limit, this.ram.length);
    const slice = this.ram.subarray(0, used);
    // Base64 via manual encoder (no btoa dependency in node)
    const b64 = base64Encode(slice);
    return `[START]${b64}[END]`;
  }

  importDNA(dna: string): boolean {
    const m = dna.match(/\[START\]([\s\S]*?)\[END\]/);
    if (!m) return false;
    const bytes = base64Decode(m[1]);
    this.ram.set(bytes.subarray(0, this.ram.length), 0);
    this.log.push(`Immortal Resurrection: restored ${bytes.length} bytes`);
    return true;
  }

  dnaFingerprint(dna: string): string {
    return blake3(dna);
  }
}

// ---------- Ghost logic / Semantic Volume ----------
export interface GhostAnalysis {
  semanticVolume: number;
  voidRatio: number;
  points: number;
  measure: number;
  ghost: boolean;
}

// Human text occupies "void"; executable tokens are measure-zero "points".
export function ghostLogic(source: string): GhostAnalysis {
  const total = source.length || 1;
  let points = 0;
  for (const ch of source) {
    if (/[A-Za-z0-9_{}()\[\]=+\-*/%<>!&|;:.]/.test(ch)) points++;
  }
  const voidChars = total - points;
  return {
    semanticVolume: points / total,
    voidRatio: voidChars / total,
    points,
    measure: 0, // points form a measure-zero set
    ghost: voidChars / total > 0.15,
  };
}

// ---------- base64 (portable) ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64Encode(bytes: Uint8Array): string {
  if (typeof btoa !== 'undefined') {
    let s = '';
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[(b2 ?? 0) & 63] : '=';
  }
  return out;
}

export function base64Decode(s: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const clean = s.replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0, bits = 0;
  for (const ch of clean) {
    const v = B64.indexOf(ch);
    if (v < 0) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

export { blake3Bytes, utf8Encode, hex };
