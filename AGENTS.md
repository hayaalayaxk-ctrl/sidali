# SidAli — repository guide

SidAli (formerly VOID-0) is a real programming language with two execution paths:
a hand-written **lexer → recursive-descent parser → AST → bytecode compiler → stack VM**,
and a **native backend** that lowers the same AST to **LLVM IR** for `clang` to
compile to machine code (cross-compilation + freestanding bare-metal included).
No `eval` is used anywhere in the language pipeline.

## Layout

- `src/compiler/lexer.ts` — tokenizer (English + Arabic keyword aliases)
- `src/compiler/parser.ts` — recursive descent → AST (`Node` union)
- `src/compiler/bytecode.ts` — AST → `Chunk` bytecode (stack VM instructions)
- `src/compiler/translator.ts` — GraphemeDecomposer: plain English → SidAli source
- `src/compiler/llvm.ts` — AST → LLVM IR; `TARGETS` cross-compile profiles
- `src/compiler/native.ts` — `buildNative` / `runNative` pipeline (IR → clang → exe)
- `src/vm/interpreter.ts` — the VM (`Interpreter`, switch-dispatch on opcodes)
- `src/vm/api.ts` — public API surface (bundle entry for both browser + node)
- `src/std/*` — real subsystems: `blake3`, `math` (Fermat/Goldilocks/ζ/Cantor/ZWS),
  `sedenion` (S16 dual manifold + 64 opcodes), `dilithium` (ring `Z_q[X]/(X^256+1)`),
  `governance` (ACE, sigma kernel, Kani, Lean obligations, ledger, CRDT)
- `src/vm/machine.ts` — 32MB RAM, SectorForth MBR, Pi-Lattice, DNA export/import
- `src/hal/runtime.c` — bare-metal HAL (`sid_write`, `sid_mmio_write`, UART)
- `bin/sidac.mjs` — the compiler driver (`run` / `build` / `emit-ir` / `targets`)
- `examples/*.sidali` — runnable programs (OS, social CRDT, zk, ghost/ZWS, math)
- `ui/` — the playground shell, styles, and app logic
- `build.mjs` — bundles the engine and inlines it into a single `index.html`

## Commands

```bash
npm run build     # esbuild bundles engine -> single self-contained index.html
npm run dev       # vite dev server on 0.0.0.0:12000
npm test          # node --test over test/*.test.mjs (47 tests)
npm run typecheck # tsc --noEmit -p tsconfig.json
npm run sidac -- build hello.sidali --target=wasm32 --emit=obj
```

## Conventions / invariants

- **No `eval`.** All execution goes through the VM in `interpreter.ts` (or LLVM IR).
- **Real computation.** Tests assert numeric results (`x+y=15`, `fib(55)`,
  `factorial(5)=120`, `square(7)=49`), not string echoes.
- **Native backend parity.** `test/native.test.mjs` compiles a systems program
  (structs, methods, `for i in 1..=N`, bool returns) and asserts the same numbers
  the VM produces. Keep the two backends in sync.
- **Inclusive ranges.** `a..=b` lowers to `add b, 1` as the loop limit in `llvm.ts`.
- **Struct returns.** Default `ret` for struct types must be `zeroinitializer`, not `0`.
- **Method return types.** `inferType` resolves `obj.method()` via `Type.method`
  in the `fns` table — plain `method` lookup is wrong.
- **Ring arithmetic safety.** `dilithium.polyMul` reduces products *before*
  accumulating; never accumulate raw products into an `Int32Array` (overflow).
- `index.html` is a build artifact — edit `ui/*` and `src/*`, then `npm run build`.
- `vite.config.js` sets `allowedHosts: true` so the proxied dev host works.

## VM opcode notes

- `NEW` takes class name in `a` and arg count in `b`.
- `CALL_METHOD` takes method name in `a`, arg count in `b`.
- Loops emit `LOOP_ENTER(continuePc, breakPc)` / `LOOP_END` for `break`/`continue`.
- `TRY_ENTER(handlerPc)` / `TRY_LEAVE` / `CATCH_BIND(name)` implement exceptions.
