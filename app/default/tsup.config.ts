import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    server: "src/server.ts",
    client: "src/client.tsx",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom", "react-router-dom", "@takos/app-sdk"],
  esbuildOptions(options) {
    options.jsx = "automatic";
  }
});
