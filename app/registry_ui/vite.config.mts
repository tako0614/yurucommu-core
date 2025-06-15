import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import "solid-js";

export default defineConfig({
  plugins: [solid(), tailwindcss()],
  build: {
    outDir: "../registry/public",
    emptyOutDir: true,
    target: "esnext",
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
      "/_takopack": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
    port: 3001,
  },
});
