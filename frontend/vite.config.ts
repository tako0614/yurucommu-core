import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(() => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@platform": path.resolve(__dirname, "../platform/src"),
    },
  },
  server: {
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
  },
}));
