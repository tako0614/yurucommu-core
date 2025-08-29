import { apiUrl } from "./config.ts";

let socket: WebSocket | null = null;
const handlers: ((data: unknown) => void)[] = [];
let currentUser: string | null = null;

function buildWsUrl(): string {
  const href = apiUrl("/api/ws");
  // 絶対 URL(http/https) の場合は ws/wss に置換
  if (/^https?:\/\//.test(href)) {
    return href.replace(/^http/, "ws");
  }
  // 相対パスの場合は location から組み立て
  const { location } = globalThis as unknown as { location?: Location };
  const isHttps = location?.protocol === "https:";
  const proto = isHttps ? "wss" : "ws";
  const host = location?.host ?? "";
  const path = href.startsWith("/") ? href : `/${href}`;
  return `${proto}://${host}${path}`;
}

let reconnectTimer: number | null = null;
const RECONNECT_DELAY_MS = 3000;

function scheduleReconnect() {
  if (reconnectTimer !== null) return;
  // deno/solid でも setTimeout は number を返す環境が多い想定
  reconnectTimer = globalThis.setTimeout(() => {
    reconnectTimer = null;
    try {
      connectWebSocket();
    } catch {
      // 次回に期待
    }
  }, RECONNECT_DELAY_MS) as unknown as number;
}

export function connectWebSocket(): WebSocket {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return socket;
  const url = buildWsUrl();
  socket = new WebSocket(url);
  socket.onopen = () => {
    if (currentUser) {
      socket?.send(
        JSON.stringify({ type: "register", payload: { user: currentUser } }),
      );
    }
  };
  socket.onmessage = (evt) => {
    try {
      const msg = JSON.parse(evt.data);
      for (const h of handlers) h(msg);
    } catch (err) {
      console.error("ws message error", err);
    }
  };
  socket.onclose = () => {
    // 自動再接続を少し待って試す
    scheduleReconnect();
  };
  socket.onerror = () => {
    // エラー時も再接続を試みる
    try { socket?.close(); } catch { /* ignore */ }
    scheduleReconnect();
  };
  return socket;
}

export function registerUser(user: string) {
  currentUser = user;
  if (!socket) {
    connectWebSocket();
    return;
  }
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(
      JSON.stringify({ type: "register", payload: { user } }),
    );
  }
}

export function addMessageHandler(handler: (data: unknown) => void) {
  handlers.push(handler);
}

export function removeMessageHandler(handler: (data: unknown) => void) {
  const idx = handlers.indexOf(handler);
  if (idx >= 0) handlers.splice(idx, 1);
}

export function getWebSocket(): WebSocket | null {
  return socket;
}
