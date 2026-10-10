import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Rendering + reading back a two-page PDF takes a moment on a cold run.
    testTimeout: 30_000,
  },
});
