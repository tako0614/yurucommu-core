// WebSocket クライアント用のユーティリティ (SolidJS対応)
import { createSignal, createEffect, onCleanup } from "solid-js";

export class TakosWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private token: string | null = null;
  private subscriptions = new Set<string>();
  private eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;

  constructor(url: string) {
    this.url = url;
  }

  // WebSocket接続を開始
  connect(token?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);
        this.token = token || null;

        this.ws.onopen = () => {
          console.log("WebSocket connected");
          this.reconnectAttempts = 0;
          
          // 認証トークンがある場合は認証
          if (this.token) {
            this.authenticate(this.token);
          }
          
          // 既存の購読を再開
          if (this.subscriptions.size > 0) {
            this.subscribe(Array.from(this.subscriptions));
          }
          
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            this.handleMessage(data);
          } catch (error) {
            console.error("Failed to parse WebSocket message:", error);
          }
        };

        this.ws.onclose = () => {
          console.log("WebSocket disconnected");
          this.ws = null;
          
          // 自動再接続
          if (!this.isReconnecting && this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          }
        };

        this.ws.onerror = (error) => {
          console.error("WebSocket error:", error);
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  // WebSocket接続を切断
  disconnect(): void {
    this.isReconnecting = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  // 認証
  private authenticate(token: string): void {
    this.send({
      type: "authenticate",
      token
    });
  }

  // イベント購読
  subscribe(events: string[]): void {
    events.forEach(event => this.subscriptions.add(event));
    
    if (this.isConnected()) {
      this.send({
        type: "subscribe",
        events
      });
    }
  }

  // イベント購読解除
  unsubscribe(events: string[]): void {
    events.forEach(event => this.subscriptions.delete(event));
    
    if (this.isConnected()) {
      this.send({
        type: "unsubscribe",
        events
      });
    }
  }

  // イベントハンドラーを追加
  on(eventName: string, handler: (payload: unknown) => void): void {
    if (!this.eventHandlers.has(eventName)) {
      this.eventHandlers.set(eventName, new Set());
    }
    this.eventHandlers.get(eventName)!.add(handler);
  }

  // イベントハンドラーを削除
  off(eventName: string, handler: (payload: unknown) => void): void {
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.eventHandlers.delete(eventName);
      }
    }
  }

  // メッセージ送信
  private send(message: Record<string, unknown>): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn("WebSocket is not connected");
    }
  }

  // メッセージハンドリング
  private handleMessage(data: any): void {
    switch (data.type) {
      case "connected":
        console.log("WebSocket connection confirmed:", data.connectionId);
        break;
        
      case "authenticated":
        console.log("WebSocket authenticated for user:", data.userId);
        break;
        
      case "auth_failed":
        console.error("WebSocket authentication failed:", data.message);
        break;
        
      case "subscribed":
        console.log("Subscribed to events:", data.events);
        break;
        
      case "unsubscribed":
        console.log("Unsubscribed from events:", data.events);
        break;
        
      case "event":
        this.handleEvent(data.eventName, data.payload);
        break;
        
      case "ping":
        // Pongで応答
        this.send({ type: "pong", timestamp: new Date().toISOString() });
        break;
        
      case "pong":
        // Ping応答を受信
        break;
        
      case "error":
        console.error("WebSocket error:", data.message);
        break;
        
      default:
        console.warn("Unknown message type:", data.type);
    }
  }

  // イベントハンドリング
  private handleEvent(eventName: string, payload: unknown): void {
    // 特定のイベントハンドラー
    const handlers = this.eventHandlers.get(eventName);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(payload);
        } catch (error) {
          console.error(`Error in event handler for ${eventName}:`, error);
        }
      });
    }

    // 全イベントハンドラー
    const allHandlers = this.eventHandlers.get("*");
    if (allHandlers) {
      allHandlers.forEach(handler => {
        try {
          handler({ eventName, payload });
        } catch (error) {
          console.error(`Error in wildcard event handler:`, error);
        }
      });
    }
  }

  // 再接続試行
  private attemptReconnect(): void {
    this.isReconnecting = true;
    this.reconnectAttempts++;
    
    console.log(`Attempting to reconnect... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    
    setTimeout(() => {
      this.connect(this.token || undefined)
        .then(() => {
          this.isReconnecting = false;
        })
        .catch(() => {
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.attemptReconnect();
          } else {
            console.error("Max reconnection attempts reached");
            this.isReconnecting = false;
          }
        });
    }, this.reconnectDelay * this.reconnectAttempts);
  }

  // 接続状態確認
  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  // 接続状態取得
  getConnectionState(): string {
    if (!this.ws) return "DISCONNECTED";
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING: return "CONNECTING";
      case WebSocket.OPEN: return "OPEN";
      case WebSocket.CLOSING: return "CLOSING";
      case WebSocket.CLOSED: return "CLOSED";
      default: return "UNKNOWN";
    }
  }
}

// グローバルインスタンス
let globalWsClient: TakosWebSocketClient | null = null;

// WebSocketクライアントの初期化
export function initWebSocketClient(url: string): TakosWebSocketClient {
  if (globalWsClient) {
    globalWsClient.disconnect();
  }
  
  globalWsClient = new TakosWebSocketClient(url);
  return globalWsClient;
}

// グローバルWebSocketクライアントの取得
export function getWebSocketClient(): TakosWebSocketClient | null {
  return globalWsClient;
}

// SolidJS用のWebSocketフック
export function createWebSocket(url: string, token?: string) {
  const [connectionState, setConnectionState] = createSignal<string>("DISCONNECTED");
  const [isConnected, setIsConnected] = createSignal(false);
  const [lastMessage, setLastMessage] = createSignal<any>(null);
  const [client, setClient] = createSignal<TakosWebSocketClient | null>(null);

  const connect = async () => {
    try {
      const wsClient = new TakosWebSocketClient(url);
      
      // 接続状態の監視
      const updateConnectionState = () => {
        const state = wsClient.getConnectionState();
        setConnectionState(state);
        setIsConnected(state === "OPEN");
      };

      // メッセージハンドラー
      wsClient.on("*", (data) => {
        setLastMessage(data);
      });

      await wsClient.connect(token);
      setClient(wsClient);
      
      // 定期的に接続状態を更新
      const interval = setInterval(updateConnectionState, 1000);
      
      onCleanup(() => {
        clearInterval(interval);
        wsClient.disconnect();
      });

      return wsClient;
    } catch (error) {
      console.error("WebSocket connection failed:", error);
      throw error;
    }
  };

  return {
    connectionState,
    isConnected,
    lastMessage,
    client,
    connect,
    disconnect: () => client()?.disconnect(),
    subscribe: (events: string[]) => client()?.subscribe(events),
    unsubscribe: (events: string[]) => client()?.unsubscribe(events),
    on: (eventName: string, handler: (payload: unknown) => void) => 
      client()?.on(eventName, handler),
    off: (eventName: string, handler: (payload: unknown) => void) => 
      client()?.off(eventName, handler),
  };
}

// リアクティブなイベントリスナー
export function createEventListener<T = unknown>(
  wsClient: () => TakosWebSocketClient | null,
  eventName: string
) {
  const [eventData, setEventData] = createSignal<T | null>(null);

  createEffect(() => {
    const client = wsClient();
    if (!client) return;

    const handler = (payload: unknown) => {
      setEventData(() => payload as T);
    };

    client.on(eventName, handler);

    onCleanup(() => {
      client.off(eventName, handler);
    });
  });

  return eventData;
}
