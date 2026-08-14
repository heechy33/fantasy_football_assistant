import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Local dev: Azure Functions Core Tools serves the API on :7071.
      // `swa start` (used for full local emulation, incl. /.auth/*) proxies
      // this itself, but running `vite` standalone still needs this.
      '/api': {
        target: 'http://localhost:7071',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test-setup.ts'],
    // `*.bench.ts` files here use plain `describe`/`it` (gated opt-in, like
    // benchmarkAvailability.bench.ts), not Vitest's separate `bench()` benchmarking API — so they
    // must be picked up by `vitest run`, not routed to the distinct `vitest bench` command.
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)', '**/*.bench.ts'],
  },
});
