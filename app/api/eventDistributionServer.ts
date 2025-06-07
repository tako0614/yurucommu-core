// WebSocket サーバーによるリアルタイムイベント配信
import { WebSocketServer } from "npm:ws"; // Changed from "ws"

export interface ClientConnection {
  id: string;
  socket: WebSocket;
  userId?: string;
  subscriptions: Set<string>;
  lastActivity: Date;
}

export class WebSocketEventServer {
  private static instance: WebSocketEventServer | null = null;
  private wss: WebSocketServer | null = null;
  private clients = new Map<string, ClientConnection>();
  private eventQueue = new Map<string, Record<string, unknown>[]>(); // ユーザーごとのイベントキュー
  private port: number;

  constructor(port: number = 3002) {
    this.port = port;
  }

  static getInstance(): WebSocketEventServer | null {
    return WebSocketEventServer.instance;
  }

  // WebSocketサーバーを開始
  start(): void {
    this.wss = new WebSocketServer({
      port: this.port,
      path: "/ws/events",
    });

    WebSocketEventServer.instance = this;
    this.wss.on("connection", (ws: WebSocket, _request: Request) => {
      const connectionId = this.generateConnectionId();
      const connection: ClientConnection = {
        id: connectionId,
        socket: ws,
        subscriptions: new Set(),
        lastActivity: new Date(),
      };

      this.clients.set(connectionId, connection);
      console.log(`Client connected: ${connectionId}`); // メッセージハンドリング
      ws.addEventListener("message", async (event) => {
        try {
          const data = event.data;
          const message = JSON.parse(data.toString());
          await this.handleClientMessage(connectionId, message);
        } catch (error) {
          console.error("Invalid message from client:", error);
          ws.send(JSON.stringify({
            type: "error",
            message: "Invalid message format",
          }));
        }
      });

      // 接続終了時の処理
      ws.addEventListener("close", () => {
        this.clients.delete(connectionId);
        console.log(`Client disconnected: ${connectionId}`);
      });

      // エラーハンドリング
      ws.addEventListener("error", (event) => {
        console.error(`WebSocket error for client ${connectionId}:`, event);
        this.clients.delete(connectionId);
      });

      // 接続確認メッセージ送信
      ws.send(JSON.stringify({
        type: "connected",
        connectionId,
        timestamp: new Date().toISOString(),
      }));
    });

    // 定期的なヘルスチェック
    setInterval(() => {
      this.performHealthCheck();
    }, 30000); // 30秒ごと

    console.log("WebSocket event distribution server initialized");
  }
  // クライアントメッセージの処理
  private async handleClientMessage(
    connectionId: string,
    message: {
      type: string;
      token?: string;
      events?: string[];
      [key: string]: unknown;
    },
  ) {
    const connection = this.clients.get(connectionId);
    if (!connection) return;

    connection.lastActivity = new Date();

    switch (message.type) {
      case "authenticate":
        if (message.token) {
          await this.authenticateClient(connectionId, message.token);
        }
        break;

      case "subscribe":
        this.subscribeToEvents(connectionId, message.events || []);
        break;

      case "unsubscribe":
        this.unsubscribeFromEvents(connectionId, message.events || []);
        break;

      case "ping":
        connection.socket.send(JSON.stringify({
          type: "pong",
          timestamp: new Date().toISOString(),
        }));
        break;

      default:
        connection.socket.send(JSON.stringify({
          type: "error",
          message: `Unknown message type: ${message.type}`,
        }));
    }
  }

  // クライアント認証
  private async authenticateClient(connectionId: string, token: string) {
    const connection = this.clients.get(connectionId);
    if (!connection) return;

    try {
      // セッション検証
      const { Session } = await import("./models/sessions.ts");
      const session = await Session.findOne({ sessionId: token });

      if (session && session.expiresAt > new Date()) {
        connection.userId = session.userId;

        // 認証成功
        connection.socket.send(JSON.stringify({
          type: "authenticated",
          userId: session.userId,
          timestamp: new Date().toISOString(),
        }));

        // 保留中のイベントを送信
        await this.sendQueuedEvents(connectionId);
      } else {
        connection.socket.send(JSON.stringify({
          type: "auth_failed",
          message: "Invalid or expired token",
        }));
      }
    } catch (error) {
      console.error("Authentication error:", error);
      connection.socket.send(JSON.stringify({
        type: "auth_failed",
        message: "Authentication error",
      }));
    }
  }

  // イベント購読
  private subscribeToEvents(connectionId: string, events: string[]) {
    const connection = this.clients.get(connectionId);
    if (!connection) return;

    events.forEach((event) => {
      connection.subscriptions.add(event);
    });

    connection.socket.send(JSON.stringify({
      type: "subscribed",
      events,
      totalSubscriptions: connection.subscriptions.size,
    }));
  }

  // イベント購読解除
  private unsubscribeFromEvents(connectionId: string, events: string[]) {
    const connection = this.clients.get(connectionId);
    if (!connection) return;

    events.forEach((event) => {
      connection.subscriptions.delete(event);
    });

    connection.socket.send(JSON.stringify({
      type: "unsubscribed",
      events,
      totalSubscriptions: connection.subscriptions.size,
    }));
  }
  // イベントの配信
  distributeEvent(eventName: string, payload: unknown, targetUserId?: string) {
    const event = {
      type: "event",
      eventName,
      payload,
      timestamp: new Date().toISOString(),
    };

    let targetClients: ClientConnection[];

    if (targetUserId) {
      // 特定ユーザーに送信
      targetClients = Array.from(this.clients.values())
        .filter((client) => client.userId === targetUserId);
    } else {
      // 全ユーザーに送信
      targetClients = Array.from(this.clients.values())
        .filter((client) => client.userId); // 認証済みクライアントのみ
    }

    // イベントを購読しているクライアントに送信
    targetClients
      .filter((client) =>
        client.subscriptions.has(eventName) || client.subscriptions.has("*")
      )
      .forEach((client) => {
        try {
          if (client.socket.readyState === 1) { // WebSocket.OPEN
            client.socket.send(JSON.stringify(event));
          }
        } catch (error) {
          console.error(`Failed to send event to client ${client.id}:`, error);
        }
      });

    // オフラインユーザーのためにイベントをキューに保存
    if (targetUserId) {
      const isUserOnline = targetClients.some((client) =>
        client.userId === targetUserId && client.socket.readyState === 1
      );

      if (!isUserOnline) {
        this.queueEventForUser(targetUserId, event);
      }
    }
  }
  // ユーザー用のイベントキュー
  private queueEventForUser(userId: string, event: Record<string, unknown>) {
    if (!this.eventQueue.has(userId)) {
      this.eventQueue.set(userId, []);
    }

    const userQueue = this.eventQueue.get(userId)!;
    userQueue.push(event);

    // キューサイズ制限（最新100件）
    if (userQueue.length > 100) {
      userQueue.splice(0, userQueue.length - 100);
    }
  }
  // 保留中イベントの送信
  private sendQueuedEvents(connectionId: string) {
    const connection = this.clients.get(connectionId);
    if (!connection || !connection.userId) return;

    const userQueue = this.eventQueue.get(connection.userId);
    if (!userQueue || userQueue.length === 0) return;

    // キューのイベントを送信
    userQueue.forEach((event) => {
      try {
        if (connection.socket.readyState === 1) {
          connection.socket.send(JSON.stringify({
            ...event,
            queued: true,
          }));
        }
      } catch (error) {
        console.error(`Failed to send queued event:`, error);
      }
    });

    // キューをクリア
    this.eventQueue.delete(connection.userId);
  }

  // ヘルスチェック
  private performHealthCheck() {
    const now = new Date();
    const inactiveThreshold = 5 * 60 * 1000; // 5分

    for (const [connectionId, connection] of this.clients.entries()) {
      const timeSinceActivity = now.getTime() -
        connection.lastActivity.getTime();

      if (timeSinceActivity > inactiveThreshold) {
        console.log(`Removing inactive client: ${connectionId}`);
        connection.socket.close();
        this.clients.delete(connectionId);
      } else if (connection.socket.readyState === 1) {
        // Ping送信
        connection.socket.send(JSON.stringify({
          type: "ping",
          timestamp: now.toISOString(),
        }));
      }
    }
  }

  // 接続ID生成
  private generateConnectionId(): string {
    return `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // アクティブな接続数を取得
  getActiveConnectionCount(): number {
    return this.clients.size;
  }

  // 特定ユーザーの接続数を取得
  getUserConnectionCount(userId: string): number {
    return Array.from(this.clients.values())
      .filter((client) => client.userId === userId).length;
  }

  // サーバー統計情報
  getServerStats() {
    const totalConnections = this.clients.size;
    const authenticatedConnections = Array.from(this.clients.values())
      .filter((client) => client.userId).length;
    const totalSubscriptions = Array.from(this.clients.values())
      .reduce((sum, client) => sum + client.subscriptions.size, 0);

    return {
      totalConnections,
      authenticatedConnections,
      totalSubscriptions,
      queuedEventsCount: Array.from(this.eventQueue.values())
        .reduce((sum, queue) => sum + queue.length, 0),
    };
  }
}
