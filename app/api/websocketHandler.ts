import { upgradeWebSocket } from "hono/deno";
import type { Context } from "hono";
import type { WSContext } from "hono/ws";

export interface ClientConnection {
  id: string;
  userId?: string;
  subscriptions: Set<string>;
  lastActivity: Date;
}

export class WebSocketManager {
  private static instance: WebSocketManager | null = null;
  private clients = new Map<string, ClientConnection & { ws: WSContext }>();
  private eventQueue = new Map<string, Record<string, unknown>[]>();

  constructor() {
    // 定期的なヘルスチェック
    setInterval(() => {
      this.performHealthCheck();
    }, 30000); // 30秒ごと
  }

  static getInstance(): WebSocketManager {
    if (!WebSocketManager.instance) {
      WebSocketManager.instance = new WebSocketManager();
    }
    return WebSocketManager.instance;
  }

  // WebSocketアップグレードハンドラー
  getUpgradeHandler() {
    return upgradeWebSocket((c: Context) => {
      const connectionId = this.generateConnectionId();
      
      return {
        onOpen: (event, ws) => {
          const connection = {
            id: connectionId,
            ws,
            subscriptions: new Set<string>(),
            lastActivity: new Date(),
          };

          this.clients.set(connectionId, connection);
          console.log(`WebSocket client connected: ${connectionId}`);

          // 接続確認メッセージ送信
          ws.send(JSON.stringify({
            type: "connected",
            connectionId,
            timestamp: new Date().toISOString(),
          }));
        },

        onMessage: async (event, ws) => {
          try {
            const data = typeof event.data === 'string' ? event.data : event.data.toString();
            const message = JSON.parse(data);
            await this.handleClientMessage(connectionId, message, ws);
          } catch (error) {
            console.error("Invalid message from client:", error);
            ws.send(JSON.stringify({
              type: "error",
              message: "Invalid message format",
            }));
          }
        },

        onClose: () => {
          this.clients.delete(connectionId);
          console.log(`WebSocket client disconnected: ${connectionId}`);
        },

        onError: (event) => {
          console.error(`WebSocket error for client ${connectionId}:`, event);
          this.clients.delete(connectionId);
        },
      };
    });
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
    ws: WSContext,
  ) {
    const connection = this.clients.get(connectionId);
    if (!connection) return;

    connection.lastActivity = new Date();

    switch (message.type) {
      case "authenticate":
        if (message.token) {
          await this.authenticateClient(connectionId, message.token, ws);
        }
        break;

      case "subscribe":
        this.subscribeToEvents(connectionId, message.events || [], ws);
        break;

      case "unsubscribe":
        this.unsubscribeFromEvents(connectionId, message.events || [], ws);
        break;

      case "ping":
        ws.send(JSON.stringify({
          type: "pong",
          timestamp: new Date().toISOString(),
        }));
        break;

      default:
        ws.send(JSON.stringify({
          type: "error",
          message: `Unknown message type: ${message.type}`,
        }));
    }
  }
  // クライアント認証
  private async authenticateClient(connectionId: string, token: string, ws: WSContext) {
    const connection = this.clients.get(connectionId);
    if (!connection) return;

    try {
      // セッション検証
      const { Session } = await import("./models/sessions.ts");
      const session = await Session.findOne({ sessionId: token });

      if (session && session.expiresAt > new Date()) {
        connection.userId = session.userId;

        // 認証成功
        ws.send(JSON.stringify({
          type: "authenticated",
          userId: session.userId,
          timestamp: new Date().toISOString(),
        }));

        // 保留中のイベントを送信
        await this.sendQueuedEvents(connectionId);
      } else {
        ws.send(JSON.stringify({
          type: "auth_failed",
          message: "Invalid or expired token",
        }));
      }
    } catch (error) {
      console.error("Authentication error:", error);
      ws.send(JSON.stringify({
        type: "auth_failed",
        message: "Authentication error",
      }));
    }
  }
  // イベント購読
  private subscribeToEvents(connectionId: string, events: string[], ws: WSContext) {
    const connection = this.clients.get(connectionId);
    if (!connection) return;

    events.forEach((event) => {
      connection.subscriptions.add(event);
    });

    ws.send(JSON.stringify({
      type: "subscribed",
      events,
      totalSubscriptions: connection.subscriptions.size,
    }));
  }
  // イベント購読解除
  private unsubscribeFromEvents(connectionId: string, events: string[], ws: WSContext) {
    const connection = this.clients.get(connectionId);
    if (!connection) return;

    events.forEach((event) => {
      connection.subscriptions.delete(event);
    });

    ws.send(JSON.stringify({
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
    };    let targetClients: (ClientConnection & { ws: WSContext })[];

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
          // HonoのWSContextには常にsendメソッドが使用可能
          client.ws.send(JSON.stringify(event));
        } catch (error) {
          console.error(`Failed to send event to client ${client.id}:`, error);
        }
      });

    // オフラインユーザーのためにイベントをキューに保存
    if (targetUserId) {
      const isUserOnline = targetClients.some((client) =>
        client.userId === targetUserId
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
        connection.ws.send(JSON.stringify({
          ...event,
          queued: true,
        }));
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
      const timeSinceActivity = now.getTime() - connection.lastActivity.getTime();

      if (timeSinceActivity > inactiveThreshold) {
        console.log(`Removing inactive client: ${connectionId}`);
        connection.ws.close();
        this.clients.delete(connectionId);
      } else {
        // Ping送信
        connection.ws.send(JSON.stringify({
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
