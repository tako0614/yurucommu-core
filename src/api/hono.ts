import { Hono } from "hono";
import { Env } from "./index.ts";
import sessionsApp from "./sessions.ts";
import accountsApp from "./account.ts"; // accountsAppをインポート

// Mongooseセットアップ

export const app = new Hono<{
  Bindings: Env;
}>();

// sessions.ts で定義したルート群を統合
app.route("/", sessionsApp);
// account.ts で定義したルート群を統合
app.route("/api/accounts", accountsApp);

export default app;
