import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  server: {
    port: 3000, // ここでポートを指定
    strictPort: true, // 既に使われているポートならエラーにする
    host: true, // ホスト名を解決可能にする
    allowedHosts: ["dev.takos.jp", "localhost"],
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
        secure: false,
        timeout: 5000,
        configure: (proxy, _options) => {
          proxy.on("error", (err, _req, _res) => {
            console.log("プロキシエラー:", err.message);
          });
        },
      },
    },
  },
  css: {
    devSourcemap: false, // CSS ソースマップを無効化
  },
  build: {
    sourcemap: false, // ビルド時のソースマップを無効化
  },
  plugins: [
    solid(),
    tailwindcss(),
  ],
});
