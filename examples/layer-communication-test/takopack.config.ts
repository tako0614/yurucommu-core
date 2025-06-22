import { defineConfig } from "../../packages/builder/mod.ts";

export default defineConfig({
  manifest: {
    name: "Layer Communication Test",
    identifier: "jp.takos.layer-communication-test",
    version: "1.0.0",
    description: "Tests inter-layer function calls between UI, Server, and Client layers.",    permissions: [
      "events:publish",
      "extensions:invoke",
      "extensions:export",
      "kv:read",
      "kv:write",
      "deno:read",
      "deno:write",
      "deno:net",
      "deno:env",
    ],
    icon: "./icon.png",
    exports: ["serverFunction", "clientFunction", "uiFunction"],
  },  entries: {
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
