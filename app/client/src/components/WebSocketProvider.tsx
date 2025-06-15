// WebSocket接続管理コンポーネント
import { createSignal, createEffect, onMount, Show, For, JSX } from "solid-js";
import { createWebSocket, createEventListener } from "../utils/websocket.ts";

interface WebSocketProviderProps {
  children: JSX.Element;
  serverUrl?: string;
  token?: string;
}

export function WebSocketProvider(props: WebSocketProviderProps) {
  const serverUrl = props.serverUrl || `ws://localhost:3001/ws/events`;
  
  const ws = createWebSocket(serverUrl, props.token);
  const [error, setError] = createSignal<string | null>(null);
  const [retryCount, setRetryCount] = createSignal(0);

  // 自動接続
  onMount(async () => {
    try {
      await ws.connect();
      console.log("WebSocket connected successfully");
    } catch (err) {
      console.error("Failed to connect WebSocket:", err);
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  });

  // 接続状態の監視
  createEffect(() => {
    const state = ws.connectionState();
    console.log("WebSocket state:", state);
    
    if (state === "CLOSED" && retryCount() < 3) {
      // 自動再接続
      setTimeout(async () => {
        try {
          setRetryCount(prev => prev + 1);
          await ws.connect();
          setError(null);
          setRetryCount(0);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Reconnection failed");
        }
      }, 2000 * (retryCount() + 1)); // 指数バックオフ
    }
  });

  return (
    <div>
      <Show when={error()}>
        <div class="websocket-error" style={{
          position: "fixed",
          top: "10px",
          right: "10px",
          background: "#ff4444",
          color: "white",
          padding: "10px",
          "border-radius": "5px",
          "z-index": "1000"
        }}>
          WebSocket Error: {error()}
          <button 
            onClick={() => setError(null)}
            style={{
              "margin-left": "10px",
              background: "transparent",
              border: "1px solid white",
              color: "white",
              cursor: "pointer"
            }}
          >
            ×
          </button>
        </div>
      </Show>
      
      <div class="websocket-status" style={{
        position: "fixed",
        bottom: "10px",
        right: "10px",
        background: ws.isConnected() ? "#44ff44" : "#ffaa44",
        color: "black",
        padding: "5px 10px",
        "border-radius": "3px",
        "font-size": "12px",
        "z-index": "999"
      }}>
        WS: {ws.connectionState()}
      </div>

      {props.children}
    </div>
  );
}

// WebSocket接続状態を表示するコンポーネント
export function WebSocketStatus() {
  const ws = createWebSocket(`ws://localhost:3001/ws/events`);
  
  return (
    <div class="websocket-status-panel" style={{
      padding: "10px",
      border: "1px solid #ccc",
      "border-radius": "5px",
      margin: "10px 0"
    }}>
      <h3>WebSocket Status</h3>
      <p>Connection: <strong>{ws.connectionState()}</strong></p>
      <p>Connected: <strong>{ws.isConnected() ? "Yes" : "No"}</strong></p>
      
      <Show when={ws.lastMessage()}>
        <details>
          <summary>Last Message</summary>
          <pre style={{
            background: "#f5f5f5",
            padding: "10px",
            "border-radius": "3px",
            "font-size": "12px",
            overflow: "auto"
          }}>
            {JSON.stringify(ws.lastMessage(), null, 2)}
          </pre>
        </details>
      </Show>
    </div>
  );
}

// リアルタイムイベントを表示するデバッグコンポーネント
export function EventDebugPanel() {
  const ws = createWebSocket(`ws://localhost:3001/ws/events`);
  const [events, setEvents] = createSignal<any[]>([]);

  createEffect(() => {
    const client = ws.client();
    if (!client) return;

    // 全イベントを監視
    client.subscribe(["*"]);
    
    const handler = (data: any) => {
      setEvents(prev => [{
        timestamp: new Date().toISOString(),
        data
      }, ...prev.slice(0, 49)]); // 最新50件を保持
    };

    client.on("*", handler);
  });

  return (
    <div class="event-debug-panel" style={{
      padding: "10px",
      border: "1px solid #ccc",
      "border-radius": "5px",
      margin: "10px 0",
      "max-height": "300px",
      overflow: "auto"
    }}>
      <h3>Real-time Events</h3>
      <button onClick={() => setEvents([])}>Clear</button>
        <div style={{ "margin-top": "10px" }}>
        <For each={events()}>
          {(event, index) => (
            <div style={{
              padding: "5px",
              border: "1px solid #eee",
              "border-radius": "3px",
              margin: "5px 0",
              "font-size": "12px"
            }}>
              <div style={{ "font-weight": "bold" }}>{event.timestamp}</div>
              <pre style={{
                margin: "5px 0",
                background: "#f9f9f9",
                padding: "5px",
                "border-radius": "2px"
              }}>
                {JSON.stringify(event.data, null, 2)}
              </pre>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}
