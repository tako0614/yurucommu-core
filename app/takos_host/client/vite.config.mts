import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  base: "/",
  plugins: [solid()],
  server: {
    host: "0.0.0.0",
    port: 1421,
    strictPort: true,
    proxy: {
      "/auth": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
      "/admin": {
        target: "http://localhost:8001",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
