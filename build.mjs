// Build script: bundles the TS engine into a single self-contained index.html
// (no runtime network dependencies) and emits a node bundle for tests.

import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

async function buildEngine(format, outfile, platform) {
  await build({
    entryPoints: [resolve(root, 'src/vm/api.ts')],
    bundle: true,
    format,
    platform,
    outfile,
    target: platform === 'browser' ? ['es2020'] : ['node18'],
    logLevel: 'warning',
  });
}

function buildHtml(bundleJs, examples) {
  const shell = readFileSync(resolve(root, 'ui/shell.html'), 'utf8');
  const css = readFileSync(resolve(root, 'ui/style.css'), 'utf8');
  const app = readFileSync(resolve(root, 'ui/app.js'), 'utf8');
  const html = shell
    .replace('/*__STYLE__*/', () => css)
    .replace('/*__ENGINE__*/', () => bundleJs)
    .replace('/*__EXAMPLES__*/', () => JSON.stringify(examples))
    .replace('/*__APP__*/', () => app);
  writeFileSync(resolve(root, 'index.html'), html);
}

function loadExamples() {
  const dir = resolve(root, 'examples');
  return readdirSync(dir)
    .filter(f => f.endsWith('.sidali'))
    .sort()
    .map(f => ({ name: f, source: readFileSync(resolve(dir, f), 'utf8') }));
}

async function main() {
  if (!existsSync(resolve(root, 'dist'))) mkdirSync(resolve(root, 'dist'));
  // node bundle for tests
  await buildEngine('esm', resolve(root, 'dist/engine.node.mjs'), 'node');
  // node bundle exposing the native/LLVM pipeline for tests and the CLI
  await build({
    entryPoints: [resolve(root, 'src/compiler/native.ts')],
    bundle: true,
    format: 'esm',
    platform: 'node',
    outfile: resolve(root, 'dist/native.node.mjs'),
    target: ['node18'],
    logLevel: 'warning',
  });
  // browser bundle (IIFE) inlined into index.html
  const res = await build({
    entryPoints: [resolve(root, 'src/vm/api.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'SidAli',
    platform: 'browser',
    target: ['es2020'],
    write: false,
    logLevel: 'warning',
  });
  const js = res.outputFiles[0].text;
  buildHtml(js, loadExamples());
  console.log('Built index.html (', (js.length / 1024).toFixed(1), 'KB engine )');
}

main().catch(e => { console.error(e); process.exit(1); });
