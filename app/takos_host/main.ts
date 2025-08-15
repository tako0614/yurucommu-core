import { initHostContext } from "./utils/host_context.ts";
import { buildRootApp } from "./utils/root_app.ts";

// Initialize core context and root app
const ctx = await initHostContext();
const root = buildRootApp(ctx);
const hostname = ctx.hostEnv["SERVER_HOST"];
const port = Number(ctx.hostEnv["SERVER_PORT"] ?? "80");
const cert = ctx.hostEnv["SERVER_CERT"]?.replace(/\\n/g, "\n");
const key = ctx.hostEnv["SERVER_KEY"]?.replace(/\\n/g, "\n");

if (cert && key) {
  try {
    Deno.serve({ hostname, port, cert, key }, root.fetch);
  } catch (e) {
    console.error("SSL証明書の設定に失敗しました:", e);
    Deno.serve({ hostname, port }, root.fetch);
  }
} else {
  Deno.serve({ hostname, port }, root.fetch);
}
