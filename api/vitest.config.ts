import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@takos/ap-utils": resolve(projectRoot, "../packages/ap-utils/dist/index.js"),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./src/test-setup.ts"],
  },
  server: {
    fs: {
      allow: [resolve(projectRoot, "..")],
    },
  },
});
