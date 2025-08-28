import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import process from "node:process";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    VitePWA({ registerType: "autoUpdate" }),
  ],

  server: {
    host: "0.0.0.0",
    port: 1420,
    strictPort: true,
    // HMR: when developing with a custom hostname (eg. tako.host1.local) you
    // may need to tune hmr.host/protocol/clientPort so the browser can reach
    // the Vite websocket server. Leave unset here to avoid hardcoding; see
    // vite docs if you need a custom value.
    // hmr: { protocol: 'wss', host: 'tako.host1.local', clientPort: 1420 },
  },
  build: {
    target: process.env.TAURI_PLATFORM ? "es2021" : "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
  resolve: {
    // Force resolution of solid-js to a single package location to avoid
    // multiple Solid instances when deps bring different copies.
    alias: {
      "solid-js": resolve(__dirname, "node_modules/solid-js"),
      "solid-js/web": resolve(__dirname, "node_modules/solid-js/web"),
      "solid-js/store": resolve(__dirname, "node_modules/solid-js/store"),
    },
  },
});
