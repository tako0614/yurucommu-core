import { Hono } from "hono";
import { Env } from "./index.ts";
import eventApp from "./eventRouter.ts"; // 追加
import extensionsRouter from "./extensionsRouter.ts";
import activityPubApp from "./activitypub.ts"; // ActivityPub機能
import { WebSocketManager } from "./websocketHandler.ts"; // WebSocket ハンドラー
import "./events/accounts.ts"; // イベントハンドラーを登録
import "./events/sessions.ts"; // セッション関連イベント
import "./events/activitypub.ts"; // ActivityPub 関連イベント
import "./events/extensions.ts"; // Takopack 拡張機能イベント
import "./events/kv.ts";
import "./events/cdn.ts";

export const app = new Hono<{
  Bindings: Env;
}>();

// WebSocketマネージャーのインスタンスを取得
const wsManager = WebSocketManager.getInstance();

// WebSocketエンドポイント
app.get("/ws/events", wsManager.getUpgradeHandler());

// WebSocket統計情報エンドポイント
app.get("/api/ws/stats", (c) => {
  const stats = wsManager.getServerStats();
  return c.json(stats);
});

app.get("/api/firebase-config", (c) => {
  const cfg = c.env["GOOGLE_SERVICE_JSON"];
  if (!cfg) return c.json({});
  try {
    return c.json(JSON.parse(cfg));
  } catch {
    return c.json({});
  }
});

// eventRouter.ts で定義したルート群を統合
app.route("/", eventApp); // 追加：/api/event を処理
app.route("/", extensionsRouter);
// ActivityPub コア機能
app.route("/", activityPubApp); // /.well-known/webfinger, /users/:username など
export default app;
