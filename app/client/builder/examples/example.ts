#!/usr/bin/env deno run --allow-all

/**
 * 🐙 新しい統一API での Takopack 拡張機能の例
 *
 * この例では、改訂された Takopack builder API を使用します：
 * - 統一されたイベント定義フォーマット (source/target)
 * - 権限の一括記述
 * - ActivityPub API の単一化
 * - 型安全性とバリデーション
 */

import FunctionBasedTakopack from "../main.ts";
import { z } from "zod";

// ========================================
// 型定義
// ========================================

interface ActivityPubObject {
  type: string;
  object?: {
    type: string;
    content?: string;
  };
}

interface EventPayload {
  message?: string;
  timestamp?: number;
  type?: string;
}

interface MetricsData {
  totalPosts?: number;
  avgResponseTime?: number;
  successRate?: number;
  activeConnections?: number;
}

const PostSchema = z.object({
  content: z.string()
    .min(1, "コンテンツは必須です")
    .max(2000, "コンテンツは2000文字以内である必要があります"),
  hashtags: z.array(
    z.string().regex(
      /^[a-zA-Z0-9_]+$/,
      "ハッシュタグは英数字とアンダースコアのみ",
    ),
  ).optional(),
  visibility: z.enum(["public", "unlisted", "followers", "private"]).default(
    "public",
  ),
});

// UserSettingsSchemaは将来の機能拡張用に定義（現在は未使用）
const _UserSettingsSchema = z.object({
  displayName: z.string().min(1).max(100),
  theme: z.enum(["light", "dark", "auto"]).default("auto"),
  language: z.string().length(2).default("ja"),
});

// ========================================
// UI設計
// ========================================

const modernUI = `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>🐙 新 Takopack 拡張機能</title>
    <style>
        :root {
            --primary-color: #667eea;
            --secondary-color: #764ba2;
            --accent-color: #f093fb;
            --text-color: #2d3748;
            --bg-color: #f7fafc;
            --card-bg: #ffffff;
            --border-color: #e2e8f0;
            --success-color: #48bb78;
            --error-color: #f56565;
            --warning-color: #ed8936;
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, var(--primary-color) 0%, var(--secondary-color) 100%);
            color: var(--text-color);
            min-height: 100vh;
            padding: 20px;
        }

        .container {
            max-width: 800px;
            margin: 0 auto;
            background: var(--card-bg);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
        }

        .header {
            text-align: center;
            margin-bottom: 30px;
        }

        .header h1 {
            font-size: 2.5rem;
            font-weight: 700;
            background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }

        .card {
            background: var(--card-bg);
            border: 1px solid var(--border-color);
            border-radius: 15px;
            padding: 25px;
            margin-bottom: 20px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            margin-bottom: 8px;
            font-weight: 600;
            color: var(--text-color);
        }

        input, textarea, select {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid var(--border-color);
            border-radius: 10px;
            font-size: 16px;
            transition: all 0.3s ease;
            background: var(--bg-color);
        }

        input:focus, textarea:focus, select:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
        }

        button {
            background: linear-gradient(135deg, var(--primary-color), var(--secondary-color));
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.3s ease;
            margin-right: 10px;
            margin-bottom: 10px;
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(102, 126, 234, 0.3);
        }

        .metrics {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin: 20px 0;
        }

        .metric-card {
            background: var(--bg-color);
            padding: 20px;
            border-radius: 10px;
            text-align: center;
            border: 1px solid var(--border-color);
        }

        .metric-value {
            font-size: 2rem;
            font-weight: 700;
            color: var(--primary-color);
        }

        .status {
            padding: 10px 15px;
            border-radius: 8px;
            margin: 10px 0;
            font-weight: 500;
        }

        .status.success {
            background: #c6f6d5;
            color: #22543d;
            border: 1px solid #9ae6b4;
        }

        .status.error {
            background: #fed7d7;
            color: #742a2a;
            border: 1px solid #fc8181;
        }

        .status.info {
            background: #bee3f8;
            color: #2a4365;
            border: 1px solid #90cdf4;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🐙 新 Takopack 拡張機能</h1>
            <p>統一されたイベント定義と権限管理のデモンストレーション</p>
        </div>

        <!-- 投稿作成 -->
        <div class="card">
            <h2>📝 投稿作成</h2>
            <div class="form-group">
                <label for="postContent">コンテンツ</label>
                <textarea id="postContent" rows="4" placeholder="何を共有しますか？"></textarea>
            </div>
            <div class="form-group">
                <label for="visibility">表示設定</label>
                <select id="visibility">
                    <option value="public">パブリック</option>
                    <option value="unlisted">未収載</option>
                    <option value="followers">フォロワーのみ</option>
                    <option value="private">プライベート</option>
                </select>
            </div>
            <button onclick="createPost()">投稿する</button>
        </div>

        <!-- ActivityPub テスト -->
        <div class="card">
            <h2>🌐 ActivityPub テスト</h2>
            <p>新しい統一APIでのActivityPub接続をテストします。</p>
            <button onclick="testActivityPub()">接続テスト</button>
            <div id="activitypub-status"></div>
        </div>

        <!-- パフォーマンスメトリクス -->
        <div class="card">
            <h2>📊 パフォーマンスメトリクス</h2>
            <div class="metrics" id="metrics">
                <div class="metric-card">
                    <div class="metric-value" id="totalPosts">0</div>
                    <div>総投稿数</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="avgResponseTime">0ms</div>
                    <div>平均応答時間</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="successRate">100%</div>
                    <div>成功率</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value" id="activeConnections">1</div>
                    <div>アクティブ接続</div>
                </div>
            </div>
            <button onclick="refreshMetrics()">メトリクス更新</button>
        </div>

        <!-- イベントテスト -->
        <div class="card">
            <h2>⚡ イベントシステムテスト</h2>
            <p>新しい source/target 形式のイベント定義をテストします。</p>
            <button onclick="testClientToServer()">Client → Server イベント</button>
            <button onclick="testUIToBackground()">UI → Background イベント</button>
            <div id="event-status"></div>
        </div>

        <!-- ログ表示 -->
        <div class="card">
            <h2>📋 ログ</h2>
            <div id="logs" style="max-height: 200px; overflow-y: auto; background: #f8f9fa; padding: 15px; border-radius: 8px; font-family: monospace; font-size: 14px;"></div>
        </div>
    </div>

    <script>
        // ログ表示関数
        function addLog(message, type = 'info') {
            const logs = document.getElementById('logs');
            const timestamp = new Date().toLocaleTimeString();
            const logEntry = document.createElement('div');
            logEntry.innerHTML = \`[\${timestamp}] \${message}\`;
            logEntry.className = \`status \${type}\`;
            logs.appendChild(logEntry);
            logs.scrollTop = logs.scrollHeight;
        }

        // 投稿作成
        async function createPost() {
            const content = document.getElementById('postContent').value;
            const visibility = document.getElementById('visibility').value;
            
            if (!content.trim()) {
                addLog('コンテンツを入力してください', 'error');
                return;
            }

            try {
                addLog('投稿を作成中...', 'info');
                const result = await takos.server.createPost({
                    content,
                    visibility
                });
                addLog(\`投稿が作成されました: \${result.message}\`, 'success');
                document.getElementById('postContent').value = '';
                refreshMetrics();
            } catch (error) {
                addLog(\`投稿作成エラー: \${error.message}\`, 'error');
            }
        }

        // ActivityPub テスト
        async function testActivityPub() {
            try {
                addLog('ActivityPub接続をテスト中...', 'info');
                const result = await takos.server.testActivityPubConnection();
                addLog(\`ActivityPub テスト成功: \${result.message}\`, 'success');
                document.getElementById('activitypub-status').innerHTML = \`
                    <div class="status success">
                        ✅ 接続成功<br>
                        対応タイプ: \${result.supportedTypes?.join(', ') || 'N/A'}
                    </div>
                \`;
            } catch (error) {
                addLog(\`ActivityPub テストエラー: \${error.message}\`, 'error');
                document.getElementById('activitypub-status').innerHTML = \`
                    <div class="status error">❌ 接続失敗</div>
                \`;
            }
        }

        // メトリクス更新
        async function refreshMetrics() {
            try {
                const metrics = await takos.server.getPerformanceMetrics();
                document.getElementById('totalPosts').textContent = metrics.totalPosts || 0;
                document.getElementById('avgResponseTime').textContent = \`\${metrics.avgResponseTime || 0}ms\`;
                document.getElementById('successRate').textContent = \`\${metrics.successRate || 100}%\`;
                document.getElementById('activeConnections').textContent = metrics.activeConnections || 1;
                addLog('メトリクスを更新しました', 'info');
            } catch (error) {
                addLog(\`メトリクス取得エラー: \${error.message}\`, 'error');
            }
        }

        // Client → Server イベントテスト
        function testClientToServer() {
            try {
                takos.events.publish('testMessage', { message: 'Hello from client!', timestamp: Date.now() });
                addLog('Client → Server イベントを送信しました', 'success');
            } catch (error) {
                addLog(\`イベント送信エラー: \${error.message}\`, 'error');
            }
        }

        // UI → Background イベントテスト
        function testUIToBackground() {
            try {
                takos.events.publish('uiNotification', { 
                    type: 'test', 
                    message: 'UI から Background への通知テスト',
                    timestamp: Date.now()
                });
                addLog('UI → Background イベントを送信しました', 'success');
            } catch (error) {
                addLog(\`イベント送信エラー: \${error.message}\`, 'error');
            }
        }

        // 初期化
        document.addEventListener('DOMContentLoaded', function() {
            addLog('🐙 新 Takopack 拡張機能が初期化されました', 'success');
            refreshMetrics();
        });

        // イベントリスナー設定
        if (typeof takos !== 'undefined' && takos.events) {
            // events.subscribe is removed; metricsUpdated will invoke handlers directly
        }
    </script>
</body>
</html>`;

// ========================================
// 拡張機能の構築（新しいAPI使用）
// ========================================

console.log("🏗️  新しい統一API での Takopack 拡張機能をビルド中...");
console.log("=".repeat(60));

const extension = new FunctionBasedTakopack()
  .output("dist")
  .package("new-api-takos-extension")
  // === マニフェスト設定（権限は一括で記述） ===
  .config({
    name: "🐙 新 Takopack 拡張機能",
    description:
      "統一されたイベント定義、権限の一括管理、ActivityPub統一APIのデモンストレーション",
    version: "3.0.0",
    identifier: "com.takos.new.api.extension",
    apiVersion: "2.0",
    // 権限を一括で記述
    permissions: [
      "kv:read",
      "kv:write",
      "activitypub:send",
      "activitypub:receive:hook",
      "events:publish",
    ],
  })
  // === サーバー関数（権限引数なし） ===

  .serverFunction("createPost", async (postData: unknown) => {
    try {
      const validatedData = PostSchema.parse(postData);
      const startTime = performance.now();

      const postId = `post_${Date.now()}_${
        Math.random().toString(36).substr(2, 9)
      }`;

      // KVストレージに保存
      await globalThis.takos?.kv?.set(`posts:${postId}`, {
        ...validatedData,
        id: postId,
        createdAt: new Date().toISOString(),
        author: "current_user",
      });

      const duration = performance.now() - startTime;
      console.log(`投稿作成完了: ${duration}ms`);

      return [200, {
        id: postId,
        message: "投稿が正常に作成されました",
        content: validatedData.content,
      }];
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : "不明なエラー";
      if (error instanceof z.ZodError) {
        return [400, { error: "入力データが無効です", details: error.errors }];
      }
      return [500, {
        error: "投稿の作成に失敗しました",
        details: errorMessage,
      }];
    }
  })
  .serverFunction("getPerformanceMetrics", async () => {
    try {
      const metrics = await globalThis.takos?.kv?.get("metrics:summary") || {
        totalPosts: 5,
        avgResponseTime: 45,
        successRate: 98,
        activeConnections: 3,
      };

      return [200, metrics];
    } catch (_error) {
      return [500, { error: "メトリクスの取得に失敗しました" }];
    }
  })
  .serverFunction("testActivityPubConnection", () => {
    try {
      return [200, {
        message: "ActivityPub接続テスト成功",
        timestamp: new Date().toISOString(),
        supportedTypes: [
          "Note",
          "Create",
          "Update",
          "Delete",
          "Follow",
          "Like",
          "Announce",
        ],
      }];
    } catch (_error) {
      return [500, { error: "ActivityPub接続テストに失敗しました" }];
    }
  })
  // === 新しい ActivityPub API（単一メソッド） ===

  .activityPub(
    {
      objects: ["Note"],
    },
    async (_context: string, object: ActivityPubObject) => {
      console.log(`ActivityPub hook: 受信したNote: ${object.object?.content}`);

      const noteId = `incoming_${Date.now()}`;
      await globalThis.takos?.kv?.set(`notes:${noteId}`, {
        ...object.object,
        id: noteId,
        receivedAt: new Date().toISOString(),
      });

      z.object({
        id: z.string(),
        content: z.string().optional(),
        receivedAt: z.string(),
      }).parse({
        id: noteId,
        content: object.object?.content,
        receivedAt: new Date().toISOString(),
      });

      return { processed: true, noteId };
    },
  )
  // === クライアント関数 ===

  .clientFunction("notifyUser", (message: string, type: string = "info") => {
    console.log(`[通知 ${type}] ${message}`);

    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Takos 拡張機能", {
        body: message,
        icon: "/icon.png",
      });
    }
  })
  // === 新しいイベント定義方式（source/target形式） ===

  // Client → Server イベント（便利メソッド使用）
  .addClientToServerEvent("testMessage", (payload: EventPayload) => {
    console.log("Client → Server イベント受信:", payload);
    return [200, {
      message: "イベントを処理しました",
      receivedAt: new Date().toISOString(),
    }];
  })
  // Server → Client イベント（便利メソッド使用）
  .addServerToClientEvent("metricsUpdated", (metrics: MetricsData) => {
    console.log("Server → Client: メトリクスが更新されました:", metrics);
  })
  // UI → Background イベント（便利メソッド使用）
  .addUIToBackgroundEvent("uiNotification", (notification: EventPayload) => {
    console.log("UI → Background: 通知を受信:", notification);
  })
  // 手動でのイベント定義例
  .addEvent("customBidirectional", {
    source: "client",
    target: "server",
    handler: "handleCustomEvent",
  }, (payload: unknown) => {
    console.log("カスタムイベント処理:", payload);
    return [200, { processed: true, timestamp: Date.now() }];
  })
  // === UI設定 ===
  .ui(modernUI)
  // === ビルド設定 ===
  .bundle({
    target: "es2020",
    development: false,
    analytics: true,
  });

// ビルド実行
await extension.build();

console.log("\n🎉 新しい統一API での拡張機能ビルドが完了しました！");
console.log("📦 出力場所: examples/new-api-dist/");
console.log("🎯 パッケージ: new-api-takos-extension.takopack");
console.log("\n✨ 新しいAPI の特徴:");
console.log("  📋 統一されたイベント定義 (source/target形式)");
console.log("  🔒 権限の一括管理 (manifest内で一元化)");
console.log("  🌐 ActivityPub統一API (単一メソッド)");
console.log("  ⚡ 便利なイベントメソッド (addClientToServerEvent等)");
console.log("  🎯 型安全性とバリデーション");
console.log("  🚀 簡潔で直感的なAPI設計");
