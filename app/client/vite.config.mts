import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import process from "node:process";

const devPort = Number(process.env.VITE_DEV_PORT ?? "1420");
const apiPort = Number(process.env.VITE_API_PORT ?? "80");

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
    VitePWA({ registerType: "autoUpdate" }),
  ],

  clearScreen: false,

  server: {
    host: "0.0.0.0",
    port: devPort,
    strictPort: true,

    // 外部アクセスを許可
    // 追加：許可するホスト
    allowedHosts: ["dev.takos.jp"],

    // CORSでdev.takos.jpからのアクセスを許可
    cors: {
      origin: ["http://dev.takos.jp"],
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
    },

    proxy: {
      "/api": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },

      "/.well-known": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      "/users": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
      "/inbox": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },

  envPrefix: ["VITE_", "TAURI_"],

  build: {
    target: process.env.TAURI_PLATFORM ? "es2021" : "esnext",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
