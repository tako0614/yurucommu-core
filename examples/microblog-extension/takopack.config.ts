import { defineConfig } from "../../packages/builder/mod.ts";

export default defineConfig({
  manifest: {
    name: "Microblog Extension",
    identifier: "jp.takos.microblog",
    version: "1.0.0",
    description: "簡単なTwitter風マイクロブログ拡張",
    permissions: [
      "kv:read",
      "kv:write",
      "events:publish",
    ],
  },

  entries: {
    server: ["src/server/posts.ts"],
    client: ["src/client/main.ts"],
    ui: ["src/ui/index.html"],
  },

  build: {
    target: "es2022",
    dev: false,
    analysis: true,
    outDir: "dist",
  },
});
