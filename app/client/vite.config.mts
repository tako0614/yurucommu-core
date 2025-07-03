import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
  ],

  clearScreen: false,

  server: {
    host: "0.0.0.0",
    port: 1420,
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
        target: "http://localhost:8000",
        changeOrigin: true,
      },

      "/.well-known": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/users": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/inbox": {
        target: "http://localhost:8000",
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
