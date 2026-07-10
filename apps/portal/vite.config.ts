/// <reference types="vitest" />
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// @portal/shared is consumed as TS source in dev/test (esbuild transpiles it) and
// as built JS for the production Rollup build (the `build` script builds it first).
const sharedSrc = fileURLToPath(
  new URL("../../packages/shared/src/index.ts", import.meta.url),
);
const sharedDist = fileURLToPath(
  new URL("../../packages/shared/dist/index.js", import.meta.url),
);

export default defineConfig(({ command }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      "@portal/shared": command === "build" ? sharedDist : sharedSrc,
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5174 },
  test: {
    globals: true,
    environment: "jsdom",
    css: false,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
}));
