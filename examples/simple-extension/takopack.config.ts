import { defineConfig } from "../../packages/builder/mod.ts";

export default defineConfig({
  manifest: {
    name: "Simple Test Extension",
    identifier: "test.simple",
    version: "1.0.0",
    icon: "./icon.png",
    description: "A simple test extension for Takopack Builder 3.0",
    permissions: ["kv:read", "kv:write", "activitypub:receive:hook"],
  },

  entries: {
    server: ["src/server/hello.ts", "src/server/activity/note.ts"],
    client: ["src/client/greet.ts"],
    ui: ["src/ui/index.html"],
  },

  build: {
    target: "es2022",
    dev: false,
    analysis: true,
    outDir: "dist",
  },
});
