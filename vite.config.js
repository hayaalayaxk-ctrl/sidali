import { defineConfig } from 'vite';

// SidAli ships as a single self-contained index.html (engine inlined).
// Vite is used only as the dev/preview server for that artifact.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 12000,
    strictPort: false,
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 12000,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist-site',
  },
});
