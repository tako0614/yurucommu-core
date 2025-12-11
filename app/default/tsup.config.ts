import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom", "@takos/app-sdk"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  }
});
