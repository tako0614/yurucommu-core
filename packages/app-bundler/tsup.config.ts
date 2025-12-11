import { defineConfig } from "tsup";

export default defineConfig([
  // Library entries (ESM + CJS)
  {
    entry: {
      index: "src/index.ts",
      vite: "src/vite.ts",
      validator: "src/validator.ts"
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    external: []
  },
  // CLI entry (ESM only)
  {
    entry: {
      cli: "src/cli.ts"
    },
    format: ["esm"],
    dts: false,
    sourcemap: false,
    clean: false,
    banner: {
      js: "#!/usr/bin/env node"
    }
  }
]);
