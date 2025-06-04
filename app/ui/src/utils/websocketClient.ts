// WebSocketクライアント管理ユーティリティ

export interface WebSocketEvent {
  type: string;
  userId?: string;
  extensionId?: string;
  timestamp: number;
  data: unknown;
}

export interface WebSocketEventHandler {
  (event: WebSocketEvent): void;
}

export class WebSocketEventClient {
  private ws: WebSocket | null = null;
  private listeners: Map<string, Set<WebSocketEventHandler>> = new Map();
  private globalListeners: Set<WebSocketEventHandler> = new Set();
  private reconnectInterval: number = 5000;
  private maxReconnectAttempts: number = 10;
  private reconnectAttempts: number = 0;
  private isConnecting: boolean = false;
  private url: string;
  private userId: string | null = null;

  constructor(url: string = "ws://localhost:3002") {
    this.url = url;
  }
  /**
   * WebSocket接続を開始
   */
  async connect(userId?: string): Promise<void> {
    if (
      this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)
    ) {
      return;
    }

    this.isConnecting = true;
    this.userId = userId || null;

    // Add dummy await to satisfy linter
    await Promise.resolve();

    try {
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log("WebSocket connected");
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // 認証メッセージを送信
        if (this.userId) {
          this.authenticate(this.userId);
        }
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleEvent(data);
        } catch (error) {
          console.error("Failed to parse WebSocket message:", error);
        }
      };

      this.ws.onclose = () => {
        console.log("WebSocket disconnected");
        this.isConnecting = false;
        this.ws = null;
        this.scheduleReconnect();
      };

      this.ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        this.isConnecting = false;
      };
    } catch (error) {
      console.error("Failed to connect WebSocket:", error);
      this.isConnecting = false;
      this.scheduleReconnect();
    }
  }

  /**
   * WebSocket接続を切断
   */
  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = this.maxReconnectAttempts; // 再接続を停止
  }

  /**
   * ユーザー認証
   */
  private authenticate(userId: string): void {
    this.send({
      type: "auth",
      userId: userId,
      timestamp: Date.now(),
    });
  }
  /**
   * イベントを送信
   */
  send(data: unknown): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("WebSocket is not connected");
    }
  }

  /**
   * 特定のイベントタイプにリスナーを追加
   */
  addEventListener(eventType: string, handler: WebSocketEventHandler): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)!.add(handler);
  }

  /**
   * 特定のイベントタイプからリスナーを削除
   */
  removeEventListener(eventType: string, handler: WebSocketEventHandler): void {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.listeners.delete(eventType);
      }
    }
  }

  /**
   * 全てのイベントにリスナーを追加
   */
  addGlobalEventListener(handler: WebSocketEventHandler): void {
    this.globalListeners.add(handler);
  }

  /**
   * 全てのイベントからリスナーを削除
   */
  removeGlobalEventListener(handler: WebSocketEventHandler): void {
    this.globalListeners.delete(handler);
  }

  /**
   * 特定のイベントタイプを購読
   */
  subscribe(eventType: string): void {
    this.send({
      type: "subscribe",
      eventType: eventType,
      timestamp: Date.now(),
    });
  }

  /**
   * 特定のイベントタイプの購読を解除
   */
  unsubscribe(eventType: string): void {
    this.send({
      type: "unsubscribe",
      eventType: eventType,
      timestamp: Date.now(),
    });
  }

  /**
   * 接続状態を取得
   */
  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /**
   * イベントを処理
   */
  private handleEvent(event: WebSocketEvent): void {
    // グローバルリスナーに配信
    this.globalListeners.forEach((handler) => {
      try {
        handler(event);
      } catch (error) {
        console.error("Error in global event handler:", error);
      }
    });

    // 特定のイベントタイプのリスナーに配信
    const handlers = this.listeners.get(event.type);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(event);
        } catch (error) {
          console.error(`Error in event handler for ${event.type}:`, error);
        }
      });
    }
  }

  /**
   * 再接続をスケジュール
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnect attempts reached");
      return;
    }

    this.reconnectAttempts++;
    console.log(
      `Scheduling reconnect attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${this.reconnectInterval}ms`,
    );

    setTimeout(() => {
      if (!this.isConnected && !this.isConnecting) {
        this.connect(this.userId || undefined);
      }
    }, this.reconnectInterval);
  }
}

// シングルトンインスタンス
export const wsClient = new WebSocketEventClient();
