import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import process from "node:process";

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    VitePWA({ registerType: "autoUpdate" }),
  ],

  resolve: {
    alias: [
      { find: /^@noble\/ciphers(.*)$/, replacement: "@noble/hashes$1" },
    ],
  },

  optimizeDeps: {
    // avoid pre-bundling the problematic package so Vite doesn't try to resolve deep exports
    exclude: ["@noble/ciphers", "ts-mls"],
  },

  ssr: {
    // mark as external for SSR/dev to skip resolution by Vite's optimizer
    external: ["@noble/ciphers"],
  },


  clearScreen: false,

  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
  },

  envPrefix: ["VITE_", "TAURI_"],

  build: {
    target: process.env.TAURI_PLATFORM ? "es2021" : "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
