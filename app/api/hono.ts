import { Hono } from "hono";
import { Env } from "./index.ts";
import eventApp from "./eventRouter.ts"; // 追加
import activityPubApp from "./activitypub.ts"; // ActivityPub機能
import activityPubApiApp from "./activitypubApi.ts"; // ActivityPub API
import "./events/accounts.ts"; // イベントハンドラーを登録
import "./events/sessions.ts"; // セッション関連イベント

export const app = new Hono<{
  Bindings: Env;
}>();
// eventRouter.ts で定義したルート群を統合
app.route("/", eventApp); // 追加：/api/event を処理
// ActivityPub コア機能
app.route("/", activityPubApp); // /.well-known/webfinger, /users/:username など
// ActivityPub API
app.route("/api/activitypub", activityPubApiApp);
export default app;
