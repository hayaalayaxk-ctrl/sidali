// Public API surface for the SidAli engine (used by the playground UI and tests).

export { runSource, Interpreter, RuntimeError, fmtNum, toStr } from './interpreter';
export type { RunResult } from './interpreter';

export { blake3, blake3Bytes, utf8Encode, hex, seededBytes } from '../std/blake3';
export {
  fermatTest, fermatCertify, isPrimeMillerRabin, modPowNum, zeta, zetaZeroApprox,
  goldMul, goldAdd, goldSub, goldInv, goldDiv, GOLDILOCKS_P, zmod,
  toZeroWidth, fromZeroWidth, inCantorSet, jInvariant, resolventNorm,
} from '../std/math';
export {
  sedenionMul, detectZeroDivisor, opcodeTable, executeOpcode, DIM,
} from '../std/sedenion';
export { keygen as dilithiumKeygen, sign as dilithiumSign, verify as dilithiumVerify, polyMul as dilithiumPolyMul, Q as DILITHIUM_Q } from '../std/dilithium';
export {
  ACEEnvelope, Ledger, CRDT, K_MAX, TAU_R, sigmaKernel, rhoGuard, tierPolicy,
  kaniVerify, leanProve, proofAnchor, zeroDivisorVault,
} from '../std/governance';
export { Machine, RAM_SIZE, ghostLogic, base64Encode, base64Decode } from './machine';
export { GraphemeDecomposer, alpPolicy, rtaMetric } from '../compiler/translator';
export type { DecomposeResult, AlpPolicyState } from '../compiler/translator';
export { tokenize } from '../compiler/lexer';
export { parse } from '../compiler/parser';
export { compile } from '../compiler/bytecode';
export { emitLlvm, TARGETS } from '../compiler/llvm';
export type { TargetProfile } from '../compiler/llvm';
