import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [
    solid(),
    tailwindcss(),
  ],

  // Tauri開発向けの設定
  // 1. Rustのエラーを見やすくするため、画面をクリアしない
  clearScreen: false,
  // 2. Tauriは固定ポートを期待するため、利用できない場合はエラーにする
  server: {
    port: 1420,
    strictPort: true,
  },
  // 3. `TAURI_DEBUG` などの環境変数を利用するため
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    // Tauriはes2021をサポート
    target: process.env.TAURI_PLATFORM ? "es2021" : "esnext",
    // デバッグビルドでない場合はminifyする
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // デバッグビルドの場合はソースマップを有効にする
    sourcemap: !!process.env.TAURI_DEBUG,
  },
});
