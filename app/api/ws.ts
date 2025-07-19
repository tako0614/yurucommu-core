import { Hono } from "hono";
import { upgradeWebSocket } from "hono/deno";

export type WsState = Record<string, unknown>;
export type MessageHandler = (
  payload: unknown,
  ws: WebSocket,
  state: WsState,
) => void | Promise<void>;
export type LifecycleHandler = (
  ws: WebSocket,
  state: WsState,
) => void | Promise<void>;

const messageHandlers = new Map<string, MessageHandler>();
let binaryHandler: MessageHandler | null = null;
const openHandlers: LifecycleHandler[] = [];
const closeHandlers: LifecycleHandler[] = [];
const errorHandlers: LifecycleHandler[] = [];

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

const app = new Hono();

app.get("/ws", (c) => {
  const state: WsState = { context: c };
  return upgradeWebSocket(c, {
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
  });
});

export default app;
