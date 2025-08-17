import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";
import type { WSContext } from "hono/ws";

export type WsState = Record<string, unknown>;
export type MessageHandler = (
  payload: unknown,
  ws: WSContext<WebSocket>,
  state: WsState,
) => void | Promise<void>;
export type LifecycleHandler = (
  ws: WSContext<WebSocket>,
  state: WsState,
) => void | Promise<void>;

const messageHandlers = new Map<string, MessageHandler>();
let binaryHandler: MessageHandler | null = null;
const openHandlers: LifecycleHandler[] = [];
const closeHandlers: LifecycleHandler[] = [];
const errorHandlers: LifecycleHandler[] = [];

const userSockets = new Map<string, Set<WSContext<WebSocket>>>();

export function sendToUser(user: string, data: unknown) {
  const sockets = userSockets.get(user);
  if (!sockets) return;
  const message = typeof data === "string" ? data : JSON.stringify(data);
  for (const s of sockets) {
    s.send(message);
  }
}

export function broadcast(data: unknown) {
  const message = typeof data === "string" ? data : JSON.stringify(data);
  for (const set of userSockets.values()) {
    for (const s of set) {
      s.send(message);
    }
  }
}

export function registerMessageHandler(
  type: string,
  handler: MessageHandler,
) {
  messageHandlers.set(type, handler);
}

export function registerBinaryHandler(handler: MessageHandler) {
  binaryHandler = handler;
}

export function registerOpenHandler(handler: LifecycleHandler) {
  openHandlers.push(handler);
}

export function registerCloseHandler(handler: LifecycleHandler) {
  closeHandlers.push(handler);
}

export function registerErrorHandler(handler: LifecycleHandler) {
  errorHandlers.push(handler);
}

registerMessageHandler("register", (payload, ws, state) => {
  const user = (payload as { user?: string }).user;
  if (!user) return;
  state.user = user;
  let set = userSockets.get(user);
  if (!set) {
    set = new Set();
    userSockets.set(user, set);
  }
  set.add(ws);
});

registerCloseHandler((ws, state) => {
  const user = state.user as string | undefined;
  if (!user) return;
  const set = userSockets.get(user);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) userSockets.delete(user);
});

const app = new Hono();

app.get(
  "/ws",
  upgradeWebSocket((c) => {
    const state: WsState = { context: c };
    return {
      onOpen(_evt, ws) {
        for (const h of openHandlers) h(ws, state);
      },
      onMessage(evt, ws) {
        // WebSocket は通知目的に限定する:
        // - 文字列メッセージは JSON を期待。type フィールドによりハンドラを呼ぶ。
        // - ただしタイプ "handshake" は受け付けない（クライアントは REST を使うこと）。
        // - バイナリペイロード（MLS ワイヤフォーマット想定）は一切受け付けずエラー応答する。
        if (typeof evt.data === "string") {
          try {
            const msg = JSON.parse(evt.data);
            if (msg && msg.type === "handshake") {
              // ハンドシェイク本体は REST (/rooms/:room/handshakes) へ移行済み
              // ログを追加して、どの接続・ユーザーから来たかを追跡可能にする（リプレイや誤送信の確認用）
              try {
                const user = state.user as string | undefined;
                console.warn("websocket: rejected handshake message", {
                  user: user ?? "unknown",
                  origin: (ws as any)?.context?.req?.headers?.get?.("origin") ?? null,
                });
              } catch (e) {
                console.warn("websocket: rejected handshake (failed to read state)", e);
              }
              ws.send(JSON.stringify({
                error: "handshake_not_allowed_on_websocket",
                message: "Use REST /rooms/:room/handshakes for MLS handshakes",
              }));
              return;
            }
            const handler = messageHandlers.get(msg.type);
            handler?.(msg.payload, ws, state);
          } catch {
            ws.send(JSON.stringify({ error: "invalid message" }));
          }
        } else {
          // バイナリデータは MLS ハンドシェイク等を含む可能性があるため拒否する
          ws.send(JSON.stringify({ error: "binary_payload_not_allowed", message: "Binary payloads (MLS) are not allowed over websocket; use REST APIs" }));
        }
      },
      async onClose(_evt, ws) {
        for (const h of closeHandlers) await h(ws, state);
      },
      onError(_evt, ws) {
        for (const h of errorHandlers) h(ws, state);
      },
    };
  }),
);

export default app;
