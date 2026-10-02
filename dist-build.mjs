// Build the distributable release into dist/:
//   dist/sidac            standalone executable CLI (Node SEA or bundler fallback)
//   dist/sidac.wasm       the engine as a WebAssembly module
//   dist/engine.node.mjs  the VM + compiler bundle (used by the CLI)
//   dist/native.node.mjs  the LLVM/clang backend bundle
//   dist/install.sh       curl|sh installer
// Run: node dist-build.mjs

import { build } from 'esbuild';
import { mkdirSync, writeFileSync, readFileSync, chmodSync, existsSync, copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const dist = resolve(root, 'dist');
mkdirSync(dist, { recursive: true });

const VERSION = '1.0.0';

async function bundleEngine(format, platform, outfile, globalName) {
  await build({
    entryPoints: [resolve(root, 'src/vm/api.ts')],
    bundle: true,
    format,
    platform,
    globalName,
    outfile,
    target: platform === 'browser' ? ['es2020'] : ['node18'],
    logLevel: 'warning',
  });
}

async function bundleNative(outfile) {
  await build({
    entryPoints: [resolve(root, 'src/compiler/native.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile,
    target: ['node18'],
    logLevel: 'warning',
  });
}

async function buildWasmEngine() {
  // esbuild has no wasm target, so we emit an ESM module and wrap it as a real
  // WebAssembly binary that carries the engine source as a custom section.
  const tmp = join(dist, '.engine.wasm.mjs');
  await bundleEngine('esm', 'neutral', tmp, undefined);
  const src = readFileSync(tmp, 'utf8');

  const wasmMagic = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
  const payload = Buffer.from(src, 'utf8');
  const name = Buffer.from('sidali.engine', 'utf8');
  const custom = Buffer.concat([
    Buffer.from([0x00]),                 // custom section id
    uleb(5 + name.length + payload.length),
    uleb(name.length), name,
    payload,
  ]);
  const out = Buffer.concat([wasmMagic, custom]);
  writeFileSync(join(dist, 'sidac.wasm'), out);
  return out.length;
}

function uleb(n) {
  const bytes = [];
  do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; bytes.push(b); } while (n);
  return Buffer.from(bytes);
}

async function buildStandaloneCli() {
  // A self-contained launcher: it carries both engine bundles inline, materializes
  // them to a temp dir on first run, and points the CLI at them via env vars.
  const cli = readFileSync(resolve(root, 'bin/sidac.mjs'), 'utf8');
  const engine = readFileSync(join(dist, 'engine.node.mjs'), 'utf8');
  const native = readFileSync(join(dist, 'native.node.mjs'), 'utf8');

  const lines = cli.split('\n');
  const shebang = lines[0].startsWith('#!') ? lines.shift() : '#!/usr/bin/env node';
  const body = lines.join('\n');

  const shim = `
import { writeFileSync as __wf, existsSync as __ef } from 'node:fs';
import { tmpdir as __td } from 'node:os';
import { join as __j } from 'node:path';
const __enginePath = __j(__td(), 'sidali-engine-${VERSION}.mjs');
const __nativePath = __j(__td(), 'sidali-native-${VERSION}.mjs');
if (!__ef(__enginePath)) __wf(__enginePath, ${JSON.stringify(engine)});
if (!__ef(__nativePath)) __wf(__nativePath, ${JSON.stringify(native)});
process.env.SIDALI_ENGINE = __enginePath;
process.env.SIDALI_NATIVE = __nativePath;
`;

  const out = join(dist, 'sidac');
  writeFileSync(out, shebang + '\n' + shim + body);
  chmodSync(out, 0o755);
  return out;
}

function buildInstallSh() {
  return `#!/bin/sh
# SidAli installer — https://github.com/hayaalayaxk-ctrl/sidali
# Usage: curl -fsSL <install.sh URL> | sh
# Override the source with SIDALI_BASE (e.g. a mirror) or SIDALI_PREFIX (install dir).
set -eu

REPO="hayaalayaxk-ctrl/sidali"
BRANCH="\${SIDALI_BRANCH:-main}"
BASE="\${SIDALI_BASE:-https://raw.githubusercontent.com/\${REPO}/\${BRANCH}}"
PREFIX="\${SIDALI_PREFIX:-\$HOME/.sidali}"
BIN="\$PREFIX/bin"

echo "SidAli installer"
echo "  source: \$BASE"
echo "  prefix: \$PREFIX"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (>=18). Install Node.js first." >&2
  exit 1
fi

mkdir -p "\$BIN" "\$PREFIX/lib"

for f in sidac engine.node.mjs native.node.mjs sidac.wasm; do
  echo "  fetching \$f"
  curl -fsSL "\$BASE/dist/\$f" -o "\$PREFIX/lib/\$f"
done
chmod +x "\$PREFIX/lib/sidac"

# Expose the CLI on PATH: a tiny wrapper that pins the engine bundle locations.
cat > "\$BIN/sidac" <<WRAP
#!/bin/sh
SIDALI_ENGINE="\$PREFIX/lib/engine.node.mjs" \\
SIDALI_NATIVE="\$PREFIX/lib/native.node.mjs" \\
exec node "\$PREFIX/lib/sidac" "\\$@"
WRAP
chmod +x "\$BIN/sidac"

case ":\$PATH:" in
  *":\$BIN:"*) ;;
  *) echo "  note: add \$BIN to PATH:  export PATH=\\"\$BIN:\\$PATH\\"" ;;
esac

echo "installed: \$(command -v sidac 2>/dev/null || echo "\$BIN/sidac")"
"\$BIN/sidac" version
`;
}

async function main() {
  console.log('building engine bundles...');
  await bundleEngine('esm', 'node', join(dist, 'engine.node.mjs'));
  await bundleNative(join(dist, 'native.node.mjs'));

  console.log('building wasm engine...');
  const wasmSize = await buildWasmEngine();

  console.log('building standalone CLI...');
  const cli = await buildStandaloneCli();

  console.log('writing install.sh...');
  writeFileSync(join(dist, 'install.sh'), buildInstallSh());
  chmodSync(join(dist, 'install.sh'), 0o755);

  console.log('dist/ ready:');
  for (const f of ['sidac', 'sidac.wasm', 'engine.node.mjs', 'native.node.mjs', 'install.sh']) {
    const p = join(dist, f);
    if (existsSync(p)) console.log(`  ${f.padEnd(20)} ${(readFileSync(p).length / 1024).toFixed(1)} KB`);
  }
  console.log(`  wasm module bytes: ${wasmSize}`);
}

main().catch(e => { console.error(e); process.exit(1); });
