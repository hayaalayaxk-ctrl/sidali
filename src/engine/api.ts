// Public API surface for the SidAli engine (used by the playground UI and tests).

export { runSource, Interpreter, RuntimeError, fmtNum, toStr } from './interpreter';
export type { RunResult } from './interpreter';

export { blake3, blake3Bytes, utf8Encode, hex, seededBytes } from '../runtime/blake3';
export {
  fermatTest, fermatCertify, isPrimeMillerRabin, modPowNum, zeta, zetaZeroApprox,
  goldMul, goldAdd, goldSub, goldInv, goldDiv, GOLDILOCKS_P, zmod,
  toZeroWidth, fromZeroWidth, inCantorSet, jInvariant, resolventNorm,
} from '../runtime/math';
export {
  sedenionMul, detectZeroDivisor, opcodeTable, executeOpcode, DIM,
} from '../runtime/sedenion';
export { keygen as dilithiumKeygen, sign as dilithiumSign, verify as dilithiumVerify, polyMul as dilithiumPolyMul, Q as DILITHIUM_Q } from '../runtime/dilithium';
export {
  ACEEnvelope, Ledger, CRDT, K_MAX, TAU_R, sigmaKernel, rhoGuard, tierPolicy,
  kaniVerify, leanProve, proofAnchor, zeroDivisorVault,
} from '../runtime/governance';
export { Machine, RAM_SIZE, ghostLogic, base64Encode, base64Decode } from '../runtime/vm';
export { GraphemeDecomposer, alpPolicy, rtaMetric } from '../lang/translator';
export type { DecomposeResult, AlpPolicyState } from '../lang/translator';
export { tokenize } from '../lang/lexer';
export { parse } from '../lang/parser';
export { compile } from '../lang/compiler';
