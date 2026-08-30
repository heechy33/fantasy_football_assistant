import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Pinned so the dev origin never drifts (Vite silently auto-increments past a busy port
    // otherwise). The ESPN extension's content-script match pattern (`http://localhost/*` in
    // extension/manifest.json) ignores the port, but the app's session persistence
    // (state/persistence.ts) is origin-scoped `localStorage` — a drifted port is a different
    // origin with an empty store, which read as "the bridge stopped syncing" on 2026-08-15.
    // strictPort fails loudly on a busy 5173 instead of silently moving.
    port: 5173,
    strictPort: true,
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
    // Pin the auth vendor for the test run. Vitest loads `.env.local` like any Vite mode, so a
    // developer's local `VITE_AUTH_PROVIDER=clerk` (fine for `npm run dev`) would otherwise leak
    // into the suite: the Clerk adapter never resolves in jsdom and every RequireAuth-gated test
    // hangs at "Loading your account…" forever. Tests use the mock adapter, always.
    env: { VITE_AUTH_PROVIDER: 'mock' },
    // `*.bench.ts` files here use plain `describe`/`it` (gated opt-in, like
    // benchmarkAvailability.bench.ts), not Vitest's separate `bench()` benchmarking API — so they
    // must be picked up by `vitest run`, not routed to the distinct `vitest bench` command.
    include: ['**/*.{test,spec}.?(c|m)[jt]s?(x)', '**/*.bench.ts'],
  },
});
