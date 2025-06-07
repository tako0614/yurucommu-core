import { Hono } from "hono";
import { Env } from "./index.ts";
import sessionsApp from "./sessions.ts";
import accountsApp from "./account.ts"; // accountsAppをインポート
import eventApp from "./eventRouter.ts"; // 追加
import activityPubApp from "./activitypub.ts"; // ActivityPub機能
import activityPubApiApp from "./activitypubApi.ts"; // ActivityPub API
import "./events/accounts.ts"; // イベントハンドラーを登録

export const app = new Hono<{
  Bindings: Env;
}>();

// sessions.ts で定義したルート群を統合
app.route("/", sessionsApp);
// eventRouter.ts で定義したルート群を統合
app.route("/", eventApp); // 追加：/api/event を処理
// account.ts で定義したルート群を統合
app.route("/api/accounts", accountsApp);
// ActivityPub コア機能
app.route("/", activityPubApp); // /.well-known/webfinger, /users/:username など
// ActivityPub API
app.route("/api/activitypub", activityPubApiApp);
export default app;
