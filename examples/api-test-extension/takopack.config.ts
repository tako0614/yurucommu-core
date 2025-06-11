import { defineConfig } from "../../packages/builder/mod.ts";

export default defineConfig({
  manifest: {
    name: "API Test Extension",
    identifier: "test.api",
    version: "1.0.0",
    icon: "./icon.png",
    description: "docs/takopack/v3.mdのAPIを検証する拡張機能",
    permissions: [
      "kv:read",
      "kv:write",
      "cdn:read",
      "cdn:write",
      "fetch:net",
      "events:publish",
      "events:subscribe",
      "activitypub:send",
      "activitypub:read",
      "activitypub:receive:hook",
      "activitypub:actor:read",
      "activitypub:actor:write",
      "plugin-actor:create",
      "plugin-actor:read",
      "plugin-actor:write",
      "plugin-actor:delete",
      "extensions:invoke",
      "extensions:export",
    ],
    exports: { server: ["ping", "testAll"] },
  },

  entries: {
    server: ["src/server/api.ts"],
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
