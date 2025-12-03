/**
 * WebSocket Adapter for Cross-Runtime Support
 *
 * Provides WebSocket support for different runtimes:
 * - Cloudflare Workers: Uses native WebSocket upgrade
 * - Node.js: Uses ws package
 * - Bun/Deno: Uses native WebSocket
 */

import type { Context } from "hono";
import type { RuntimeType } from "./index";
import { detectRuntime } from "./index";

export interface WebSocketHandler {
  onOpen?: (ws: WebSocketAdapter, event: Event) => void | Promise<void>;
  onMessage?: (ws: WebSocketAdapter, event: MessageEvent) => void | Promise<void>;
  onClose?: (ws: WebSocketAdapter, event: CloseEvent) => void | Promise<void>;
  onError?: (ws: WebSocketAdapter, event: Event) => void | Promise<void>;
}

export interface WebSocketAdapter {
  send(data: string | ArrayBuffer | Blob): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  readonly bufferedAmount: number;
}

export interface WebSocketUpgradeResult {
  response: Response;
  websocket?: WebSocketAdapter;
}

const WEBSOCKET_STATES = {
  CONNECTING: 0,
  OPEN: 1,
  CLOSING: 2,
  CLOSED: 3,
} as const;

/**
 * Cloudflare Workers WebSocket wrapper
 */
class CloudflareWebSocketAdapter implements WebSocketAdapter {
  private ws: WebSocket;

  constructor(ws: WebSocket) {
    this.ws = ws;
  }

  send(data: string | ArrayBuffer | Blob): void {
    this.ws.send(data);
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  get bufferedAmount(): number {
    return (this.ws as any).bufferedAmount || 0;
  }
}

/**
 * Node.js WebSocket wrapper (using ws package)
 */
class NodeWebSocketAdapter implements WebSocketAdapter {
  private ws: any; // ws.WebSocket

  constructor(ws: any) {
    this.ws = ws;
  }

  send(data: string | ArrayBuffer | Blob): void {
    if (this.ws.readyState === WEBSOCKET_STATES.OPEN) {
      this.ws.send(data);
    }
  }

  close(code?: number, reason?: string): void {
    this.ws.close(code, reason);
  }

  get readyState(): number {
    return this.ws.readyState;
  }

  get bufferedAmount(): number {
    return this.ws.bufferedAmount || 0;
  }
}

/**
 * Upgrade HTTP request to WebSocket connection
 */
export async function upgradeWebSocket(
  c: Context,
  handler: WebSocketHandler,
): Promise<WebSocketUpgradeResult> {
  const runtime = detectRuntime();

  switch (runtime) {
    case "cloudflare-workers":
      return upgradeCloudflareWebSocket(c, handler);
    case "node":
      return upgradeNodeWebSocket(c, handler);
    case "bun":
      return upgradeBunWebSocket(c, handler);
    case "deno":
      return upgradeDenoWebSocket(c, handler);
    default:
      throw new Error(`WebSocket upgrade not supported for runtime: ${runtime}`);
  }
}

async function upgradeCloudflareWebSocket(
  c: Context,
  handler: WebSocketHandler,
): Promise<WebSocketUpgradeResult> {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return {
      response: new Response("Expected Upgrade: websocket", { status: 426 }),
    };
  }

  // Create WebSocket pair
  const webSocketPair = new (globalThis as any).WebSocketPair();
  const [client, server] = Object.values(webSocketPair) as [WebSocket, WebSocket];

  const adapter = new CloudflareWebSocketAdapter(server);

  // Accept the WebSocket connection
  server.accept();

  // Set up event handlers
  if (handler.onOpen) {
    handler.onOpen(adapter, new Event("open"));
  }

  server.addEventListener("message", (event: MessageEvent) => {
    if (handler.onMessage) {
      handler.onMessage(adapter, event);
    }
  });

  server.addEventListener("close", (event: CloseEvent) => {
    if (handler.onClose) {
      handler.onClose(adapter, event);
    }
  });

  server.addEventListener("error", (event: Event) => {
    if (handler.onError) {
      handler.onError(adapter, event);
    }
  });

  return {
    response: new Response(null, {
      status: 101,
      webSocket: client,
    } as any),
    websocket: adapter,
  };
}

async function upgradeNodeWebSocket(
  c: Context,
  handler: WebSocketHandler,
): Promise<WebSocketUpgradeResult> {
  // For Node.js, we need to handle WebSocket upgrade at the server level
  // This function returns a placeholder response that the server should intercept

  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return {
      response: new Response("Expected Upgrade: websocket", { status: 426 }),
    };
  }

  // Return a special response that indicates WebSocket upgrade is needed
  // The actual upgrade is handled by the server (e.g., @hono/node-server with ws)
  const response = new Response(null, {
    status: 101,
    headers: {
      "X-WebSocket-Upgrade": "pending",
    },
  });

  // Store handler in response metadata for server to use
  (response as any).__websocketHandler = handler;
  (response as any).__nodeWebSocketAdapterFactory = (ws: any) => new NodeWebSocketAdapter(ws);

  return { response };
}

async function upgradeBunWebSocket(
  c: Context,
  handler: WebSocketHandler,
): Promise<WebSocketUpgradeResult> {
  // Bun has native WebSocket support similar to Cloudflare
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return {
      response: new Response("Expected Upgrade: websocket", { status: 426 }),
    };
  }

  // Bun server handles WebSocket upgrade
  const response = new Response(null, {
    status: 101,
    headers: {
      "X-WebSocket-Upgrade": "bun",
    },
  });

  (response as any).__websocketHandler = handler;
  (response as any).__nodeWebSocketAdapterFactory = (ws: any) => new NodeWebSocketAdapter(ws);

  return { response };
}

async function upgradeDenoWebSocket(
  c: Context,
  handler: WebSocketHandler,
): Promise<WebSocketUpgradeResult> {
  // Deno has native WebSocket upgrade via Deno.upgradeWebSocket
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return {
      response: new Response("Expected Upgrade: websocket", { status: 426 }),
    };
  }

  try {
    const { socket, response } = (globalThis as any).Deno.upgradeWebSocket(c.req.raw);
    const adapter = new NodeWebSocketAdapter(socket);

    socket.onopen = (event: Event) => {
      if (handler.onOpen) handler.onOpen(adapter, event);
    };

    socket.onmessage = (event: MessageEvent) => {
      if (handler.onMessage) handler.onMessage(adapter, event);
    };

    socket.onclose = (event: CloseEvent) => {
      if (handler.onClose) handler.onClose(adapter, event);
    };

    socket.onerror = (event: Event) => {
      if (handler.onError) handler.onError(adapter, event);
    };

    return { response, websocket: adapter };
  } catch (error) {
    return {
      response: new Response(`WebSocket upgrade failed: ${error}`, { status: 500 }),
    };
  }
}

/**
 * Create a WebSocket-enabled middleware for Hono
 */
export function createWebSocketMiddleware(handler: WebSocketHandler) {
  return async (c: Context, next: () => Promise<void>) => {
    const upgradeHeader = c.req.header("Upgrade");

    if (upgradeHeader?.toLowerCase() === "websocket") {
      const result = await upgradeWebSocket(c, handler);
      return result.response;
    }

    await next();
  };
}

/**
 * Helper to check if WebSocket is supported in current runtime
 */
export function isWebSocketSupported(): boolean {
  const runtime = detectRuntime();
  return ["cloudflare-workers", "node", "bun", "deno"].includes(runtime);
}

export { WEBSOCKET_STATES };
