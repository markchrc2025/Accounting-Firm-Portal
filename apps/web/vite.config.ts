/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @portal/shared ships a `build` (dist + declarations). For the production
// Rollup build we consume that JS (its TS barrel of value+type re-exports isn't
// statically traceable by Rollup); for dev/test we consume the TS source, which
// esbuild transpiles on the fly. The web `build` script builds shared first.
const sharedSrc = fileURLToPath(
  new URL("../../packages/shared/src/index.ts", import.meta.url),
);
const sharedDist = fileURLToPath(
  new URL("../../packages/shared/dist/index.js", import.meta.url),
);
// PB7: the recurring-project dates from @portal/projects-core. Only its recurrence module: the
// package's index also exports server-only helpers (node:crypto, node:fs) a browser cannot load.
// The module is pure TypeScript with no imports, so both dev and the production build use it.
const projectsCoreRecurrence = fileURLToPath(
  new URL("../../packages/projects-core/src/recurrence.ts", import.meta.url),
);

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@portal/shared": command === "build" ? sharedDist : sharedSrc,
      "@portal/projects-core/recurrence": projectsCoreRecurrence,
    },
  },
  server: {
    port: 5173,
    // Proxy API calls to the NestJS backend during local dev.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/setupTests.ts"],
    css: false,
    // Unit tests live under src/; e2e/ is Playwright's and must be excluded.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
}));
