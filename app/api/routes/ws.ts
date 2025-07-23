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
        if (typeof evt.data === "string") {
          try {
            const msg = JSON.parse(evt.data);
            const handler = messageHandlers.get(msg.type);
            handler?.(msg.payload, ws, state);
          } catch {
            ws.send(JSON.stringify({ error: "invalid message" }));
          }
        } else if (binaryHandler) {
          binaryHandler(evt.data, ws, state);
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
