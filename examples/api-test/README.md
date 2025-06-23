# 🐙 Takos API Test Extension

Takos API Test Extensionは、Takosプラットフォームのすべての主要APIを包括的にテストするための拡張機能です。ActivityPub、KVストレージ、CDN、イベントシステム、拡張機能API、レイヤー間通信など、すべての機能を簡単にテストできます。

## 🎯 機能

### ActivityPub API
- **Note送信**: ActivityPubプロトコルでNoteオブジェクトを作成・送信
- **アクティビティ一覧**: 送信済みアクティビティの一覧取得
- **アクター操作**: アクター情報の読み取りと更新
- **プラグインアクター**: 拡張機能専用アクターの作成と管理
- **受信フック**: ActivityPubオブジェクト受信時の自動処理

### ストレージAPI
- **サーバーKV**: サーバーサイドキー/値ストレージのテスト
- **クライアントKV**: クライアントサイド（IndexedDB）ストレージのテスト
- **CDN**: ファイルアップロード、ダウンロード、リスト取得のテスト

### ネットワークAPI
- **サーバーFetch**: サーバーサイドHTTP通信のテスト
- **クライアントFetch**: クライアントサイド（制限付き）HTTP通信のテスト

### イベントAPI
- **レイヤー間通信**: Server ↔ Client ↔ UI 間のイベント通信
- **イベントハンドラー**: 各レイヤーでのイベント受信処理
- **Push通知**: FCM経由のプッシュ通知テスト（オプション）

### 拡張機能API
- **拡張機能一覧**: インストール済み拡張機能の取得
- **拡張機能呼び出し**: 他の拡張機能の関数実行
- **相互運用**: 異なる拡張機能間での連携テスト

## 🛠️ セットアップ

### 1. 依存関係の確認

この拡張機能をビルドするには、以下が必要です：

- Deno (最新版)
- Takos プラットフォーム
- Takos builder パッケージ

### 2. ビルド

```bash
# 本番用ビルド
deno task build

# 開発用ビルド（minify無効）
deno task dev

# ビルド成果物をクリア
deno task clean
```

### 3. インストール

ビルド後、`dist/`フォルダ内に生成された`.takopack`ファイルをTakosプラットフォームにインストールしてください。

## 📋 使用方法

### Web UI

拡張機能をインストール後、Takos Web UIから以下のエンドポイントにアクセス：

```
/api/extensions/jp.takos.api-test/ui
```

### 主なテスト項目

#### 🌐 ActivityPub API
- **Send Note**: テスト用Noteの送信
- **List Activities**: アクティビティ履歴の確認
- **Actor Test**: アクター情報の読み取り・更新
- **Plugin Actor**: 拡張機能アクターの作成

#### 💾 Storage APIs
- **Server KV**: サーバーサイドKVストレージのCRUD操作
- **Client KV**: クライアントサイドKVストレージのCRUD操作
- **CDN Test**: ファイルの保存・取得・削除

#### 🌐 Network APIs
- **Fetch API**: HTTP通信のテスト
- **Client Fetch**: クライアントサイド通信（制限付き）

#### 📡 Events API
- **Events Test**: レイヤー間イベント通信
- **UI → Server**: UIからサーバーへのイベント送信
- **UI → Client**: UIからクライアントへのイベント送信

#### 🔧 Extensions API
- **Extensions List**: 拡張機能の一覧取得
- **Client Extensions**: クライアントサイド拡張機能操作
- **Invoke Test**: 拡張機能の関数呼び出し

#### 🔄 Layer Communication
- **UI → Server Call**: UIからサーバー関数の直接呼び出し
- **UI → Client Call**: UIからクライアント関数の呼び出し
- **All Layers**: 全レイヤー間通信テスト

### 一括テスト

**全APIテスト実行**ボタンをクリックすると、すべてのAPIテストを自動実行します。

## 🔧 API リファレンス

### サーバーサイド関数

#### `apiTestServer(testType: string, params?: any)`
汎用サーバーテスト関数

#### `testActivityPubSend()`
ActivityPub Note送信テスト

#### `testActivityPubList()`
ActivityPubアクティビティ一覧取得テスト

#### `testActivityPubActor()`
ActivityPubアクター操作テスト

#### `testPluginActor()`
プラグインアクター作成・操作テスト

#### `testKVOperations()`
サーバーサイドKVストレージテスト

#### `testCDNOperations()`
CDN操作テスト

#### `testFetchAPI()`
サーバーサイドFetch APIテスト

#### `testEventsAPI()`
イベントAPI送信テスト

#### `testExtensionsAPI()`
拡張機能API操作テスト

#### `runAllTests()`
すべてのサーバーサイドテストを実行

### クライアントサイド関数

#### `apiTestClient(testType: string, params?: any)`
汎用クライアントテスト関数

#### `testClientKV()`
クライアントサイドKVストレージテスト

#### `testClientEvents()`
クライアントサイドイベントテスト

#### `testClientExtensions()`
クライアントサイド拡張機能テスト

#### `testClientFetch()`
クライアントサイドFetch APIテスト

#### `runClientTests()`
すべてのクライアントサイドテストを実行

### UI関数

#### `apiTestUI(testType: string, params?: any)`
汎用UIテスト関数

### イベントハンドラー

#### `onActivityPubReceive(activity: any)`
ActivityPubオブジェクト受信時の処理

#### `onTestEvent(payload: any)`
テストイベント受信時の処理

#### `onServerToClient(payload: any)`
サーバーからクライアントへのイベント処理

#### `onUIToServer(payload: any)`
UIからサーバーへのイベント処理

## 🧪 テスト詳細

### 成功条件

各テストは以下の条件で成功と判定されます：

- **ActivityPub API**: 正常なレスポンスの受信
- **KV Storage**: データの読み書き・削除が正常に実行
- **CDN**: ファイルの保存・取得が正常に実行
- **Fetch API**: HTTPレスポンスの正常受信
- **Events API**: イベントの送受信が正常に実行
- **Extensions API**: 拡張機能の取得・実行が正常に実行

### エラーハンドリング

- すべてのAPIテストは例外をキャッチし、詳細なエラー情報を提供
- テスト失敗時は具体的なエラーメッセージを表示
- 権限不足やネットワークエラーも適切に処理

## 📊 ログとエクスポート

### ログレベル
- **All**: すべてのログを表示
- **Success**: 成功ログのみ表示
- **Error**: エラーログのみ表示

### エクスポート機能
テスト結果をJSON形式でエクスポート可能。以下の情報が含まれます：

```json
{
  "timestamp": "2025-06-23T...",
  "testResults": [...],
  "extension": "jp.takos.api-test",
  "version": "1.0.0"
}
```

## 🔒 権限

この拡張機能は以下の権限を要求します：

```json
{
  "permissions": [
    "activitypub:send",
    "activitypub:read",
    "activitypub:receive:hook",
    "activitypub:actor:read",
    "activitypub:actor:write",
    "plugin-actor:create",
    "plugin-actor:read",
    "plugin-actor:write",
    "plugin-actor:delete",
    "kv:read",
    "kv:write",
    "cdn:read",
    "cdn:write",
    "fetch:net",
    "events:publish",
    "extensions:invoke",
    "extensions:export",
    "deno:read",
    "deno:write",
    "deno:net",
    "deno:env"
  ]
}
```

## 🛡️ セキュリティ

- すべてのAPIテストは権限ベースのアクセス制御に従う
- 外部ネットワーク通信はJSONPlaceholder等の安全なテストAPIのみを使用
- ユーザーデータの漏洩や破損を防ぐため、テスト専用のキーとパスを使用

## 📝 ライセンス

このプロジェクトは Takos プラットフォームの一部として提供されます。

## 🤝 貢献

バグ報告や機能要求は、Takosプロジェクトのメインリポジトリにお願いします。

---

**作成者**: Takos Development Team  
**バージョン**: 1.0.0  
**最終更新**: 2025年6月23日
