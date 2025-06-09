import { Hono } from "hono";
import { Env } from "./index.ts";
import eventApp from "./eventRouter.ts"; // 追加
import extensionsRouter from "./extensionsRouter.ts";
import activityPubApp from "./activitypub.ts"; // ActivityPub機能
import "./events/accounts.ts"; // イベントハンドラーを登録
import "./events/sessions.ts"; // セッション関連イベント
import "./events/activitypub.ts"; // ActivityPub 関連イベント
import "./events/extensions.ts"; // Takopack 拡張機能イベント
import "./events/kv.ts";
import "./events/cdn.ts";

export const app = new Hono<{
  Bindings: Env;
}>();
// eventRouter.ts で定義したルート群を統合
app.route("/", eventApp); // 追加：/api/event を処理
app.route("/", extensionsRouter);
// ActivityPub コア機能
app.route("/", activityPubApp); // /.well-known/webfinger, /users/:username など
export default app;
