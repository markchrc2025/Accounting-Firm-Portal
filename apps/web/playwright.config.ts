import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright E2E config. Boots the Vite dev server and runs specs in e2e/.
 * Not part of the default `pnpm test`; run explicitly with `pnpm --filter web test:e2e`.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    // Allow pointing at a pre-installed Chromium (e.g. cloud dev envs) via
    // PW_EXECUTABLE_PATH; otherwise Playwright uses its managed browser.
    launchOptions: process.env.PW_EXECUTABLE_PATH
      ? { executablePath: process.env.PW_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: "pnpm dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
