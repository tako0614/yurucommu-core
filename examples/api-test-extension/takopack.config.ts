import { defineConfig } from "../../packages/builder/mod.ts";

export default defineConfig({
  manifest: {
    name: "API Test Extension",
    identifier: "jp.takos.api-test",
    version: "1.0.0",
    description: "Runs a suite of API calls to verify Takopack runtime.",
    permissions: [
      "fetch:net",
      "activitypub:send",
      "activitypub:read",
      "activitypub:receive:hook",
      "activitypub:actor:read",
      "activitypub:actor:write",
      "plugin-actor:create",
      "plugin-actor:read",
      "plugin-actor:write",
      "plugin-actor:delete",
      "kv:read",
      "kv:write",
      "cdn:read",
      "cdn:write",
      "events:publish",
      "events:subscribe",
      "extensions:invoke",
      "extensions:export",
      "deno:read",
      "deno:write",
      "deno:net",
      "deno:env",
      "deno:run",
      "deno:sys",
      "deno:ffi",
    ],
  },

  entries: {
    server: ["src/server/api.ts"],
    client: ["src/client/api.ts"],
    ui: ["src/ui/index.html"],
  },

  build: {
    target: "es2022",
    dev: false,
    analysis: true,
    outDir: "dist",
  },
});
