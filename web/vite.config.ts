import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  root: __dirname,
  plugins: [solid(), tailwindcss()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
  server: {
    // Wave M-C: LAN listen for hostname-based dev access (= takosumi
    // local-substrate Caddy が yurucommu.test → host.docker.internal:5173
    // で TLS 終端 + reverse proxy する前提)。 localhost access も影響受けない。
    host: true,
    allowedHosts: ["yurucommu.test"],
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
