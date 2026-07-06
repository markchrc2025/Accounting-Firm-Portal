/**
 * Jest config for API unit tests (*.spec.ts under src/).
 * ts-jest transpiles both the app's TS and the @portal/shared workspace source
 * (mapped to its src entry, and allowed through transformIgnorePatterns).
 */
/** @type {import('jest').Config} */
module.exports = {
  rootDir: ".",
  testEnvironment: "node",
  testMatch: ["<rootDir>/src/**/*.spec.ts"],
  moduleFileExtensions: ["ts", "js", "json"],
  transform: {
    "^.+\\.ts$": ["ts-jest", { tsconfig: "<rootDir>/tsconfig.json" }],
  },
  moduleNameMapper: {
    "^@portal/shared$": "<rootDir>/../../packages/shared/src/index.ts",
  },
  transformIgnorePatterns: ["/node_modules/(?!(.pnpm/)?(zod)/)"],
  collectCoverageFrom: ["src/**/*.ts", "!src/main.ts", "!src/**/*.module.ts"],
};
