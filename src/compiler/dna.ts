// SidAli DNA header — a universal physics-level binary envelope.
//
// Every SidAli image (electron, photon, qubit, fluid, vacuum, hologram, plasma,
// energy) is prefixed with an ASCII header of the form
//
//   [START:SUBSTRATE=photon:ARCH=riscv64:VERSION=1:BLAKE3=<hex>]<payload>[END]
//
// The payload is the real machine code (ELF / wasm / object). A loader reads the
// header, checks BLAKE3, and dispatches on SUBSTRATE. This is the SidAli analogue
// of the WASM magic, but substrate-agnostic.
//
// `withDnaHeader` is the emitter side; `readDnaHeader` is the loader side.

import { blake3Bytes, hex } from '../std/blake3';

export interface DnaHeader {
  substrate: string;
  arch: string;
  version: number;
  blake3: string;
}

export const DNA_START = '[START';
export const DNA_END = '[END]';
const START = DNA_START;
const END = DNA_END;

export function formatDnaHeader(h: DnaHeader): string {
  return `${START}:SUBSTRATE=${h.substrate}:ARCH=${h.arch}:VERSION=${h.version}:BLAKE3=${h.blake3}]`;
}

export function buildDnaHeader(substrate: string, arch: string, payload: Uint8Array, version = 1): DnaHeader {
  return { substrate, arch, version, blake3: hex(blake3Bytes(payload)) };
}

/** Prefix a machine-code payload with its DNA header. */
export function withDnaHeader(payload: Uint8Array, substrate: string, arch: string, version = 1): Uint8Array {
  const header = formatDnaHeader(buildDnaHeader(substrate, arch, payload, version));
  const hb = new TextEncoder().encode(header);
  const out = new Uint8Array(hb.length + payload.length + END.length);
  out.set(hb, 0);
  out.set(payload, hb.length);
  out.set(new TextEncoder().encode(END), hb.length + payload.length);
  return out;
}

/** Parse a DNA header off the front of an image, verifying nothing yet. */
export function readDnaHeader(image: Uint8Array): (DnaHeader & { payloadOffset: number }) | null {
  const text = new TextDecoder().decode(image.subarray(0, Math.min(image.length, 256)));
  if (!text.startsWith(START)) return null;
  const close = text.indexOf(']');
  if (close < 0) return null;
  const fields: Record<string, string> = {};
  for (const part of text.slice(START.length + 1, close).split(':')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return {
    substrate: fields.SUBSTRATE || 'generic',
    arch: fields.ARCH || 'unknown',
    version: Number(fields.VERSION || 1),
    blake3: fields.BLAKE3 || '',
    payloadOffset: close + 1,
  };
}

/** Verify the BLAKE3 recorded in a DNA header against the actual payload. */
export function verifyDna(image: Uint8Array): boolean {
  const front = readDnaHeader(image);
  if (front) {
    let end = image.length;
    const tail = new TextDecoder().decode(image.subarray(Math.max(0, image.length - END.length)));
    if (tail === END) end = image.length - END.length;
    return hex(blake3Bytes(image.subarray(front.payloadOffset, end))) === front.blake3;
  }
  // Trailer form: the payload is everything before the appended header.
  const text = new TextDecoder().decode(image.subarray(Math.max(0, image.length - 512)));
  const i = text.lastIndexOf(START);
  if (i < 0) return false;
  const cut = Math.max(0, image.length - 512) + i;
  // Strip the newline separator the builder inserts before the header.
  let payloadEnd = cut;
  if (payloadEnd > 0 && image[payloadEnd - 1] === 0x0a) payloadEnd -= 1;
  const trailer = readDnaTrailer(image);
  if (!trailer) return false;
  return hex(blake3Bytes(image.subarray(0, payloadEnd))) === trailer.blake3;
}

export function stripDna(image: Uint8Array): Uint8Array {
  const h = readDnaHeader(image);
  if (!h) return image;
  let end = image.length;
  const tail = new TextDecoder().decode(image.subarray(Math.max(0, image.length - END.length)));
  if (tail === END) end = image.length - END.length;
  return image.subarray(h.payloadOffset, end);
}

/** Scan the trailing bytes of an image for an embedded DNA header. */
export function readDnaTrailer(image: Uint8Array): DnaHeader | null {
  const win = image.subarray(Math.max(0, image.length - 512));
  const text = new TextDecoder().decode(win);
  const i = text.lastIndexOf(START);
  if (i < 0) return null;
  const close = text.indexOf(']', i);
  if (close < 0) return null;
  const fields: Record<string, string> = {};
  for (const part of text.slice(i + START.length + 1, close).split(':')) {
    const eq = part.indexOf('=');
    if (eq > 0) fields[part.slice(0, eq)] = part.slice(eq + 1);
  }
  if (!fields.SUBSTRATE) return null;
  return {
    substrate: fields.SUBSTRATE,
    arch: fields.ARCH || 'unknown',
    version: Number(fields.VERSION || 1),
    blake3: fields.BLAKE3 || '',
  };
}

/**
 * Locate a DNA header anywhere: at the front (SidAli container), or in the
 * trailer (raw ELF/object, where the OS loader needs magic at byte 0).
 */
export function findDna(image: Uint8Array): DnaHeader | null {
  return readDnaHeader(image) || readDnaTrailer(image);
}
