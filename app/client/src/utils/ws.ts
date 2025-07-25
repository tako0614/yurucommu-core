import { apiUrl } from "./config.ts";

let socket: WebSocket | null = null;
const handlers: ((data: unknown) => void)[] = [];
let currentUser: string | null = null;

export function connectWebSocket(): WebSocket {
  if (socket) return socket;
  const url = apiUrl("/api/ws").replace(/^http/, "ws");
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
