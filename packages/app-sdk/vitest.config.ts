import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    environmentMatchGlobs: [
      // Use jsdom for client/index tests
      ["src/index.test.tsx", "jsdom"],
      ["src/client/**/*.test.tsx", "jsdom"],
      // Use node for server tests (default)
      ["src/server/**/*.test.ts", "node"],
    ],
  },
});
