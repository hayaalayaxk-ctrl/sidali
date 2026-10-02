// Pluggable backends — the extension point of SidAli.
//
//   trait Backend   { name, substrate, emit(ir) -> Binary }   code generation
//   trait Substrate { name, compute(op, args), energy(op) }   execution physics
//
// Adding a new technology (photonic, quantum, fluidic, vacuum, holographic,
// plasma, energy, …) is ~100 lines: a Substrate that defines how an Op behaves
// in that physics, and a Backend that defines how SAIR becomes a binary. The six
// electron targets (armv7m, cortex-m4, riscv32, riscv64, wasm32, bpfel) and the
// seven new substrates are all registered below.

import { SairOp, SairProgram, OP_ENERGY, SubstrateLike } from '../ir/sair';
import { TARGETS } from '../compiler/llvm';

export interface Binary {
  bytes: Uint8Array;
  substrate: string;
  arch: string;
  /** DNA header string carried by the image. */
  dna: string;
}

export interface Backend {
  readonly name: string;
  readonly substrate: string;
  /** The clang triple this backend lowers to, when it targets real silicon. */
  readonly triple?: string;
  /** Object-only backends (eBPF) cannot be linked by the host. */
  readonly objectOnly?: boolean;
  emit(ir: SairProgram): Binary;
}

/** A backend that reuses the existing LLVM/clang pipeline for real machine code. */
export class ClangBackend implements Backend {
  readonly name: string;
  readonly substrate: string;
  readonly triple: string;
  readonly objectOnly: boolean;
  constructor(targetName: string) {
    const t = TARGETS[targetName];
    if (!t) throw new Error(`unknown target: ${targetName}`);
    this.name = targetName;
    this.substrate = t.substrate || 'electron';
    this.triple = t.triple;
    this.objectOnly = !!t.objectOnly;
  }
  emit(ir: SairProgram): Binary {
    // The heavy lifting (clang invocation) lives in compiler/native.ts; this
    // descriptor is what `emit=fat` and the registry dispatch on.
    const bytes = new TextEncoder().encode(JSON.stringify(ir.meta));
    return { bytes, substrate: this.substrate, arch: this.triple, dna: '' };
  }
}

/** Pure-JS reference substrate: exact IEEE-754 semantics, the "electron" baseline. */
export class ElectronSubstrate implements SubstrateLike {
  readonly name = 'electron';
  compute(op: SairOp, a: number[], imm: unknown): number {
    switch (op) {
      case 'add': return a[0] + a[1];
      case 'sub': return a[0] - a[1];
      case 'mul': return a[0] * a[1];
      case 'div': return a[1] === 0 ? 0 : a[0] / a[1];
      case 'mod': return a[1] === 0 ? 0 : a[0] % a[1];
      case 'pow': return a[0] ** a[1];
      case 'eq': return a[0] === a[1] ? 1 : 0;
      case 'ne': return a[0] !== a[1] ? 1 : 0;
      case 'lt': return a[0] < a[1] ? 1 : 0;
      case 'le': return a[0] <= a[1] ? 1 : 0;
      case 'gt': return a[0] > a[1] ? 1 : 0;
      case 'ge': return a[0] >= a[1] ? 1 : 0;
      case 'and': return a[0] && a[1] ? 1 : 0;
      case 'or': return a[0] || a[1] ? 1 : 0;
      case 'xor': return (a[0] ? 1 : 0) ^ (a[1] ? 1 : 0);
      case 'shl': return a[0] << a[1];
      case 'shr': return a[0] >> a[1];
      case 'neg': return -a[0];
      case 'not': return a[0] ? 0 : 1;
      default: return 0;
    }
  }
  energy(_op: SairOp, base: number): number { return base; }
}

/**
 * A physics-flavoured substrate. The arithmetic is intentionally still exact
 * (a compiler must be correct regardless of medium); what changes is the energy
 * model, which is the physically meaningful difference between media. Every
 * compute() result is the same as electrons — that is the point of SAIR.
 */
export class PhysicsSubstrate implements SubstrateLike {
  readonly name: string;
  private readonly factor: number;
  private readonly reference: ElectronSubstrate;
  constructor(name: string, energyFactor: number) {
    this.name = name;
    this.factor = energyFactor;
    this.reference = new ElectronSubstrate();
  }
  compute(op: SairOp, a: number[], imm: unknown): number {
    return this.reference.compute(op, a, imm);
  }
  energy(_op: SairOp, base: number): number {
    return Math.ceil(base * this.factor);
  }
}

/** Energy factor per substrate, relative to an electron transistor. */
export const SUBSTRATE_ENERGY: Record<string, number> = {
  electron: 1,
  photon: 0.5,      // light: lower switching energy
  qubit: 0.25,      // superposition: fewer transitions
  fluidic: 4,       // water valves: higher actuation cost
  vacuum: 6,        // space: hard-vacuum switching
  holographic: 3,   // voxel addressing
  plasma: 8,        // fire/arc: high energy
  energy: 0.1,      // energy-as-medium: near-lossless
  generic: 1,
};

export function makeSubstrate(name: string): SubstrateLike {
  if (name === 'electron') return new ElectronSubstrate();
  return new PhysicsSubstrate(name, SUBSTRATE_ENERGY[name] ?? 1);
}

/** The six original targets, each now an explicit Backend implementation. */
export const ELECTRON_TARGETS = ['armv7m-none-eabi', 'cortex-m4', 'riscv32-none-elf', 'riscv64-none-elf', 'wasm32', 'bpfel'] as const;

/** The seven new substrates added in Phase 1. */
export const NEW_SUBSTRATE_TARGETS = ['photon-riscv', 'qubit-riscv', 'fluidic-riscv', 'vacuum-riscv', 'holographic-wasm', 'plasma-arm', 'energy-riscv'] as const;

export class BackendRegistry {
  private backends = new Map<string, Backend>();
  private substrates = new Map<string, SubstrateLike>();

  register(b: Backend): void { this.backends.set(b.name, b); }
  registerSubstrate(s: SubstrateLike): void { this.substrates.set(s.name, s); }
  get(name: string): Backend | undefined { return this.backends.get(name); }
  substrate(name: string): SubstrateLike | undefined { return this.substrates.get(name); }
  list(): Backend[] { return [...this.backends.values()]; }
  listSubstrates(): SubstrateLike[] { return [...this.substrates.values()]; }
  bySubstrate(substrate: string): Backend[] { return this.list().filter(b => b.substrate === substrate); }
}

/** Build the default registry: all 13 targets + all 9 substrates. */
export function defaultRegistry(): BackendRegistry {
  const reg = new BackendRegistry();
  for (const name of [...ELECTRON_TARGETS, ...NEW_SUBSTRATE_TARGETS]) {
    reg.register(new ClangBackend(name));
  }
  for (const name of Object.keys(SUBSTRATE_ENERGY)) {
    reg.registerSubstrate(makeSubstrate(name));
  }
  return reg;
}

export function totalEnergy(ir: SairProgram, substrate: SubstrateLike): number {
  let e = 0;
  for (const f of ir.functions) for (const t of f.transitions) e += substrate.energy(t.op, t.energy || OP_ENERGY[t.op]);
  return e;
}
