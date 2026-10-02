# SidAli — repository guide

SidAli (formerly VOID-0) is a real programming language: hand-written
**lexer → recursive-descent parser → AST → bytecode compiler → stack VM**.
No `eval` is used anywhere in the language pipeline.

## Layout

- `src/lang/lexer.ts` — tokenizer (English + Arabic keyword aliases)
- `src/lang/parser.ts` — recursive descent → AST (`Node` union)
- `src/lang/compiler.ts` — AST → `Chunk` bytecode (stack VM instructions)
- `src/lang/translator.ts` — GraphemeDecomposer: plain English → SidAli source
- `src/engine/interpreter.ts` — the VM (`Interpreter`, switch-dispatch on opcodes)
- `src/engine/api.ts` — public API surface (bundle entry for both browser + node)
- `src/runtime/*` — real subsystems: `blake3`, `math` (Fermat/Goldilocks/ζ/Cantor/ZWS),
  `sedenion` (S16 dual manifold + 64 opcodes), `dilithium` (ring `Z_q[X]/(X^256+1)`),
  `governance` (ACE, sigma kernel, Kani, Lean obligations, ledger, CRDT), `vm` (32MB RAM, DNA)
- `examples/*.sidali` — runnable programs (OS, social CRDT, zk, ghost/ZWS, math)
- `ui/` — the playground shell, styles, and app logic
- `build.mjs` — bundles the engine and inlines it into a single `index.html`

## Commands

```bash
npm run build     # esbuild bundles engine -> single self-contained index.html
npm run dev       # vite dev server on 0.0.0.0:12000
npm test          # node --test over test/*.test.mjs
npm run typecheck # tsc --noEmit
```

## Conventions / invariants

- **No `eval`.** All execution goes through the VM in `interpreter.ts`.
- **Real computation.** Tests assert numeric results (`x+y=15`, `fib(55)`,
  `factorial(5)=120`, `square(7)=49`), not string echoes.
- **Ring arithmetic safety.** `dilithium.polyMul` reduces products *before*
  accumulating; never accumulate raw products into an `Int32Array` (overflow).
- `index.html` is a build artifact — edit `ui/*` and `src/*`, then `npm run build`.
- `vite.config.js` sets `allowedHosts: true` so the proxied dev host works.

## VM opcode notes

- `NEW` takes class name in `a` and arg count in `b`.
- `CALL_METHOD` takes method name in `a`, arg count in `b`.
- Loops emit `LOOP_ENTER(continuePc, breakPc)` / `LOOP_END` for `break`/`continue`.
- `TRY_ENTER(handlerPc)` / `TRY_LEAVE` / `CATCH_BIND(name)` implement exceptions.
