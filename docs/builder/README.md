# 🔧 **Takopack Builder API ドキュメント**

> **バージョン**: v2.0 **最終更新**: 2025-06-01

## 📚 **目次**

1. [概要](#概要)
2. [インストールと使用方法](#インストールと使用方法)
3. [基本的な使用方法](#基本的な使用方法)
4. [API リファレンス](#api-リファレンス)
5. [設定オプション](#設定オプション)
6. [関数ベース開発](#関数ベース開発)
7. [esbuildバンドル機能](#esbuildバンドル機能)
8. [開発モードとデバッグ](#開発モードとデバッグ)
9. [実例とサンプル](#実例とサンプル)
10. [トラブルシューティング](#トラブルシューティング)

---

## 1. 概要

Takopack
Builderは、関数ベースでtakos拡張機能を開発するためのビルドツールです。TypeScriptで開発し、自動的にバンドル・最小化してtakopackファイルを生成します。

### 特徴

- **🎯 関数ベース開発**: 個別の関数を登録し、自動的にserver.js/client.jsを生成
- **⚡ 自動バンドル**: esbuildによる高速バンドリングと最小化
- **🔒 型安全性**: TypeScript完全対応
- **🛠️ 開発モード**: ソースマップとデバッグ情報付きビルド
- **📦 統一API**: 権限管理とイベント定義の簡素化

---

## 2. インストールと使用方法

### 基本的なプロジェクト構成

```text
my-extension/
├── src/
│   ├── main.ts              # ビルド設定
│   ├── server/
│   │   └── handlers.ts      # サーバー関数
│   ├── client/
│   │   └── handlers.ts      # クライアント関数
│   └── ui/
│       └── index.html       # UI
├── dist/                    # ビルド出力
├── package.json
└── deno.json
```

### 実行方法

```bash
# 開発モード
deno run --allow-all src/main.ts

# 本番モード
deno run --allow-all src/main.ts --production
```

---

## 3. 基本的な使用方法

### 最小構成

```typescript
import FunctionBasedTakopack from "./builder/main.ts";

const extension = new FunctionBasedTakopack()
  .output("dist")
  .package("my-extension")
  .ui(`
    <!DOCTYPE html>
    <html>
      <head><title>My Extension</title></head>
      <body><h1>Hello, Takos!</h1></body>
    </html>
  `)
  .config({
    name: "My Extension",
    description: "A simple extension",
    version: "1.0.0",
    identifier: "com.example.myext",
    permissions: ["kv:read", "kv:write"],
  });

await extension.build();
```

### 関数を含む構成

```typescript
import FunctionBasedTakopack from "./builder/main.ts";

const extension = new FunctionBasedTakopack()
  .output("dist")
  .package("my-extension")
  // サーバー関数
  .serverFunction("getData", async (key: string) => {
    // KVから データを取得
    const data = await globalThis.takos.kv.read(key);
    return [200, { data }];
  })
  // クライアント関数
  .clientFunction("showAlert", async (message: string) => {
    console.log(`Alert: ${message}`);
  })
  // UI設定
  .ui(htmlContent)
  // 権限とマニフェスト設定
  .config({
    name: "My Extension",
    description: "Extension with server and client functions",
    version: "1.0.0",
    identifier: "com.example.myext",
    permissions: ["kv:read", "kv:write", "events:publish"],
  });

await extension.build();
```

---

## 4. API リファレンス

### 基本設定メソッド

#### `output(dir: string): this`

ビルド出力ディレクトリを設定します。

```typescript
.output("dist")          // dist/ フォルダに出力
.output("build/output")  // build/output/ フォルダに出力
```

#### `package(name: string): this`

パッケージ名を設定します（.takopackファイル名になります）。

```typescript
.package("my-extension")  // my-extension.takopack を生成
```

#### `config(config: ManifestConfig): this`

マニフェスト設定を行います。

```typescript
.config({
  name: "Extension Name",
  description: "Extension description",
  version: "1.0.0",
  identifier: "com.example.ext",
  permissions: ["kv:read", "activitypub:send"],
  apiVersion: "2.0"  // オプション（デフォルト: "2.0"）
})
```

#### `ui(htmlContent: string): this`

UI HTMLコンテンツを設定します。

```typescript
.ui(`
  <!DOCTYPE html>
  <html>
    <head><title>My Extension UI</title></head>
    <body>
      <div id="app">Extension UI</div>
      <script>
        // UIロジック
      </script>
    </body>
  </html>
`)
```

### 関数登録メソッド

#### `serverFunction<TArgs, TReturn>(name: string, fn: Function): this`

サーバー側で実行される関数を登録します。

```typescript
.serverFunction("processData", async (input: any) => {
  // サーバー処理
  const result = await processInput(input);
  return [200, { result }];  // [status, body] 形式で返却
})
```

#### `clientFunction<TArgs>(name: string, fn: Function): this`

クライアント側（バックグラウンド）で実行される関数を登録します。

```typescript
.clientFunction("handleNotification", async (data: any) => {
  // クライアント処理
  console.log("Notification received:", data);
})
```

### イベント関連メソッド

#### `addEvent(eventName: string, definition: EventDefinition, handler: Function): this`

カスタムイベントを定義します。

```typescript
.addEvent("customEvent", {
  source: "client",
  target: "server",
  handler: "handleCustomEvent"
}, async (payload: any) => {
  return [200, { processed: true }];
})
```

#### 便利メソッド

```typescript
// Client → Server
.addClientToServerEvent("userAction", async (action: string) => {
  return [200, { action: `Processed: ${action}` }];
})

// Server → Client
.addServerToClientEvent("statusUpdate", async (status: string) => {
  console.log("Status:", status);
})

// Background → UI
.addBackgroundToUIEvent("notification", async (message: string) => {
  // UI通知処理
})

// UI → Background
.addUIToBackgroundEvent("userInput", async (input: string) => {
  // バックグラウンド処理
})
```

### ActivityPub メソッド

#### `activityPub(config, canAccept?, hook?): this`

ActivityPubフック処理を設定します。

```typescript
.activityPub(
  {
    accepts: ["Note"],
    context: "https://www.w3.org/ns/activitystreams",
    hooks: {
      priority: 1,
      serial: false,
    },
  },
  // canAccept関数（オプション）
  (context: string, object: any) => {
    return object.type === "Create" && object.object?.type === "Note";
  },
  // onReceiveフック（オプション）
  async (context: string, object: any) => {
    console.log("Note received:", object);
    return { processed: true };
  },
)
```

---

## 5. 設定オプション

### BundleOptions

```typescript
.bundle({
  target: "es2020",          // JavaScript target version
  development: true,         // 開発モード（ソースマップ有効）
  analytics: true,           // ビルド分析有効
  strictValidation: true     // 厳密検証有効
})
```

### ManifestConfig

```typescript
interface ManifestConfig {
  name: string; // 拡張機能名
  description: string; // 説明
  version: string; // バージョン（SemVer形式）
  identifier: string; // 識別子（逆FQDN形式）
  apiVersion?: string; // API バージョン（デフォルト: "2.0"）
  permissions?: Permission[]; // 権限配列
}
```

### Permission 型

```typescript
type Permission =
  | "fetch:net"
  | "activitypub:send"
  | "activitypub:read"
  | "activitypub:receive:hook"
  | "activitypub:actor:read"
  | "activitypub:actor:write"
  | "plugin-actor:create"
  | "plugin-actor:read"
  | "plugin-actor:write"
  | "plugin-actor:delete"
  | "kv:read"
  | "kv:write"
  | "cdn:read"
  | "cdn:write"
  | "events:publish"
  | "events:subscribe"
  | "deno:read" // 特権権限
  | "deno:write" // 特権権限
  | "deno:net" // 特権権限
  | "deno:env" // 特権権限
  | "deno:run" // 特権権限
  | "deno:sys" // 特権権限
  | "deno:ffi"; // 特権権限
```

---

## 6. 関数ベース開発

### サーバー関数の書き方

```typescript
// 基本的なサーバー関数
.serverFunction("getUserData", async (userId: string) => {
  try {
    const user = await globalThis.takos.activitypub.actor.read(userId);
    return [200, { user }];
  } catch (error) {
    return [500, { error: error.message }];
  }
})

// KVを使用する関数
.serverFunction("saveUserPreference", async (userId: string, key: string, value: any) => {
  await globalThis.takos.kv.write(`user:${userId}:${key}`, value);
  return [200, { saved: true }];
})
```

### クライアント関数の書き方

```typescript
// 通知処理
.clientFunction("showNotification", async (title: string, message: string) => {
  console.log(`[${title}] ${message}`);
  // 実際の通知API呼び出し
})

// UI更新処理
.clientFunction("updateUI", async (data: any) => {
  await globalThis.takos.events.publishToUI("dataUpdate", data);
})
```

### イベントハンドラーの書き方

```typescript
// サーバーイベントハンドラー（戻り値: [status, body]）
.addClientToServerEvent("submitForm", async (formData: any) => {
  if (!formData.name) {
    return [400, { error: "Name is required" }];
  }
  
  // データ処理
  await processFormData(formData);
  return [200, { success: true }];
})

// クライアントイベントハンドラー（戻り値: void）
.addServerToClientEvent("dataChanged", async (newData: any) => {
  console.log("Data updated:", newData);
  // UIに通知
  await globalThis.takos.events.publishToUI("refresh", newData);
})
```

### インスタンスベース開発

Takopack Builder 3.0 では、`ServerExtension` や `ClientExtension` を
インスタンス化してメソッドを追加するスタイルを推奨しています。 JSDoc
タグを付与することでイベントや ActivityPub フックを定義できます。

```typescript
import { ServerExtension } from "@takopack/builder";

export const MyServer = new ServerExtension();

/** @event("userLogin", { source: "client", target: "server" }) */
MyServer.onUserLogin = (data: { username: string }) => {
  console.log("login", data);
  return [200, { ok: true }];
};

export { MyServer };
```

インスタンス名とメソッド名の組み合わせから `MyServer_onUserLogin`
のようなラッパー関数が自動生成され、manifest の `handler` として利用されます。

### アプリコンテナ API

複数の拡張機能インスタンスをまとめて登録したい場合は `TakoPack`
クラスを利用できます。

```typescript
import { ClientExtension, ServerExtension, TakoPack } from "@takopack/builder";

export const MyServer = new ServerExtension();
MyServer.onHello = (name: string) => {
  return [200, { greeting: name }];
};

export const MyClient = new ClientExtension();
MyClient.greet = () => {
  console.log("Hello from client");
};

const app = new TakoPack()
  .useServer(MyServer)
  .useClient(MyClient);

export const functions = app.functions;
```

---

## 7. esbuildバンドル機能

### 自動バンドル

Builder は自動的に以下を行います：

1. **TypeScript→JavaScript変換**
2. **依存関係の解決とバンドル**
3. **コード最小化**（本番モード）
4. **ソースマップ生成**（開発モード）

### 開発モード設定

```typescript
const extension = new FunctionBasedTakopack()
  .bundle({
    development: true, // ソースマップ有効、最小化無効
    analytics: true, // ビルド分析表示
    target: "es2020", // ターゲット指定
  });
// ...その他設定

await extension.build();
```

### 本番モード設定

```typescript
const extension = new FunctionBasedTakopack()
  .bundle({
    development: false, // 最小化有効
    analytics: false, // 分析無効
    target: "es2018", // 古いブラウザサポート
  });
// ...その他設定

await extension.build();
```

---

## 8. 開発モードとデバッグ

### ビルド分析

```typescript
.bundle({ analytics: true })
```

分析有効時、以下の情報が表示されます：

```
📊 Build metrics:
  - Server functions: 5
  - Client functions: 3
  - Events: 4
  - ActivityPub configs: 1
  - Build time: 125.43ms
  - Bundle sizes: server.js (2.1KB), client.js (1.8KB)
```

### デバッグ情報

開発モード時、生成されるコードにはデバッグ用コメントが含まれます：

```javascript
// @type event-handler
// @returns [status: number, body: object]
async function onUserAction(action) {
  // 元の関数のロジック
}
```

### エラーハンドリング

Builder は以下のエラーを検出します：

- **設定不備**: 必須項目の未設定
- **型エラー**: TypeScript型チェックエラー
- **バンドルエラー**: esbuildエラー
- **権限不一致**: 使用APIと権限の不一致

---

## 9. 実例とサンプル

### シンプルなメモ拡張機能

```typescript
import FunctionBasedTakopack from "./builder/main.ts";

const memoExtension = new FunctionBasedTakopack()
  .output("dist")
  .package("simple-memo")
  // メモ保存
  .serverFunction("saveMemo", async (memo: string) => {
    const id = `memo_${Date.now()}`;
    await globalThis.takos.kv.write(id, memo);
    return [200, { id, saved: true }];
  })
  // メモ一覧取得
  .serverFunction("getMemos", async () => {
    const keys = await globalThis.takos.kv.list();
    const memos = [];
    for (const key of keys.filter((k) => k.startsWith("memo_"))) {
      const memo = await globalThis.takos.kv.read(key);
      memos.push({ id: key, content: memo });
    }
    return [200, { memos }];
  })
  // UI
  .ui(`
    <!DOCTYPE html>
    <html>
      <head><title>Simple Memo</title></head>
      <body>
        <div>
          <h1>Simple Memo</h1>
          <textarea id="memo" placeholder="Enter your memo..."></textarea>
          <button onclick="saveMemo()">Save</button>
          <div id="memos"></div>
        </div>
        <script>
          async function saveMemo() {
            const memo = document.getElementById('memo').value;
            await takos.events.publishToBackground('saveMemo', memo);
          }
        </script>
      </body>
    </html>
  `)
  .config({
    name: "Simple Memo",
    description: "A simple memo-taking extension",
    version: "1.0.0",
    identifier: "com.example.simplememo",
    permissions: ["kv:read", "kv:write", "events:publish", "events:subscribe"],
  });

await memoExtension.build();
```

### ActivityPub 拡張機能

```typescript
const activityPubExtension = new FunctionBasedTakopack()
  .output("dist")
  .package("note-processor")
  // ActivityPub Note処理
  .activityPub(
    {
      accepts: ["Note"],
      context: "https://www.w3.org/ns/activitystreams",
      hooks: {
        priority: 1,
      },
    },
    // canAccept: Noteの受信可否判定
    (context: string, object: any) => {
      return object.type === "Create" &&
        object.object?.type === "Note" &&
        object.object?.content;
    },
    // onReceive: Note処理
    async (context: string, object: any) => {
      const note = object.object;

      // キーワード抽出
      const keywords = extractKeywords(note.content);

      // 統計保存
      await globalThis.takos.kv.write(
        `note_stats_${Date.now()}`,
        { keywords, timestamp: new Date().toISOString() },
      );

      console.log("Note processed:", keywords);
      return { processed: true, keywords };
    },
  )
  .serverFunction("getStats", async () => {
    const keys = await globalThis.takos.kv.list();
    const statsKeys = keys.filter((k) => k.startsWith("note_stats_"));
    const stats = [];

    for (const key of statsKeys) {
      const stat = await globalThis.takos.kv.read(key);
      stats.push(stat);
    }

    return [200, { stats }];
  })
  .config({
    name: "Note Processor",
    description: "Processes ActivityPub Notes and extracts keywords",
    version: "1.0.0",
    identifier: "com.example.noteprocessor",
    permissions: [
      "activitypub:receive:hook",
      "kv:read",
      "kv:write",
    ],
  });

// キーワード抽出関数
function extractKeywords(content: string): string[] {
  return content
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 5);
}

await activityPubExtension.build();
```

---

## 10. トラブルシューティング

### よくある問題

#### ❌ ビルドエラー: "Manifest configuration is required"

```typescript
// 解決方法: .config() の呼び出しが必要
.config({
  name: "Extension Name",
  description: "Description",
  version: "1.0.0",
  identifier: "com.example.ext"
})
```

#### ❌ 型エラー: Cannot find name 'globalThis'

```typescript
// 解決方法: 型定義ファイルをインポート
/// <reference path="./types/takos-api.d.ts" />
```

#### ❌ 権限エラー: "Permission denied"

```typescript
// 解決方法: 必要な権限を追加
.config({
  permissions: [
    "kv:read",
    "kv:write",
    "activitypub:send"  // 使用するAPIに応じて追加
  ]
})
```

#### ❌ バンドルエラー: "Could not resolve"

```typescript
// 解決方法: 依存関係の確認
// package.json または deno.json で依存関係を確認
```

### デバッグのコツ

1. **開発モードでビルド**: ソースマップでエラー箇所を特定
2. **analytics 有効**: ビルド統計でボトルネックを確認
3. **段階的ビルド**: 最小構成から開始して徐々に機能追加
4. **権限チェック**: 使用APIと権限設定の確認

### サポート

問題が解決しない場合は、以下の情報と共にサポートにお問い合わせください：

- エラーメッセージ全文
- 使用したビルド設定
- 期待する動作と実際の動作
- 環境情報（Denoバージョンなど）
