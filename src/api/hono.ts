import { Hono } from "hono";
import { Env } from "./index.ts";
import sessionsApp from "./sessions.ts";
import accountsApp from "./account.ts"; // accountsAppをインポート
import eventApp from "./eventRouter.ts";  // 追加
import activityPubApp from "./activitypub.ts"; // ActivityPub機能
import activityPubApiApp from "./activitypubApi.ts"; // ActivityPub API
import extensionsApp from "./extensions.ts"; // 拡張機能管理
import cdnApp from "./cdn.ts"; // CDN アセット配信
import "./events/accounts.ts"; // イベントハンドラーを登録

export const app = new Hono<{
  Bindings: Env;
}>();

// 拡張機能システムの初期化（アプリ起動時に一度だけ実行）
let extensionsInitialized = false;

app.use("*", async (_c, next) => {
  if (!extensionsInitialized) {
    try {
      const { extensionHookManager } = await import("./extensionHookManager.ts");
      await extensionHookManager.initialize();
      extensionsInitialized = true;
      console.log("Extension system initialized");
    } catch (error) {
      console.error("Failed to initialize extensions:", error);
    }
  }
  await next();
});

// sessions.ts で定義したルート群を統合
app.route("/", sessionsApp);
// eventRouter.ts で定義したルート群を統合
app.route("/", eventApp);               // 追加：/api/event を処理
// account.ts で定義したルート群を統合
app.route("/api/accounts", accountsApp);
// ActivityPub コア機能
app.route("/", activityPubApp);         // /.well-known/webfinger, /users/:username など
// ActivityPub API
app.route("/api/activitypub", activityPubApiApp);
// 拡張機能管理
app.route("/api/extensions", extensionsApp);
// CDN アセット配信
app.route("/cdn", cdnApp);

export default app;
