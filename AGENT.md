# Takos AI Agent ガイド

このドキュメントは、Takosプロジェクトの開発において、AIエージェントが効率的に作業するためのガイドラインです。

## 📋 プロジェクト概要

**Takos**は、ActivityPubプロトコルをベースとした分散型ソーシャルネットワークソフトウェアです。独自の拡張機能システム「Takopack」により、VSCodeのような安全で柔軟な機能拡張が可能です。

### 🏗️ アーキテクチャ

```
takos/
├── app/
│   ├── api/           # バックエンドAPI (Hono + Deno)
│   ├── client/        # フロントエンド (Solid.js + Tauri)
│   ├── registry/      # 拡張機能レジストリ
│   └── registry_ui/   # レジストリUI
├── packages/          # 共通パッケージ
├── examples/          # サンプル拡張機能
└── docs/             # ドキュメント
```

### 🔧 技術スタック

- **ランタイム**: Deno (TypeScript)
- **バックエンド**: Hono
- **フロントエンド**: Solid.js + Tauri
- **データベース**: MongoDB (Mongoose)
- **プロトコル**: ActivityPub + 独自拡張

## 🎯 重要なコンポーネント

### 1. Takopack Extension System
- **場所**: `packages/builder/`, `packages/runtime/`, `packages/unpack/`
- **目的**: 安全な権限ベースの拡張機能システム
- **特徴**: VSCode風のAPIデザイン、サンドボックス実行

#### 🏛️ Takopackアーキテクチャ

Takopackは以下の3つの実行環境を持つマルチランタイムアーキテクチャを採用しています：

```
Takopack Architecture
├── Server Environment
│   ├── Runtime: Deno on Server
│   ├── Worker: 実行時に動的作成
│   └── Lifecycle: リクエスト単位で生成・破棄
├── Client Environment  
│   ├── Runtime: Service Worker(web) kotlin in rust in deno(tauri)
│   ├── Worker: 実行時に動的作成
│   └── Lifecycle: 必要時に生成・破棄
└── UI Environment
    ├── Runtime: iframe (サンドボックス)
    ├── Isolation: 完全に分離された実行環境
    └── Communication: postMessage API
```

##### 🖥️ Server Environment
- **実行場所**: サーバーサイド（Deno）
- **Worker作成**: 実行時のみにWorkerを動的作成
- **用途**: API処理、データベース操作、外部サービス連携
- **ライフサイクル**: リクエスト処理時に作成し、処理完了後に破棄
- **セキュリティ**: Denoの権限システムによる制御

##### 👤 Client Environment
- **実行場所**: Service Worker
- **Worker作成**: 実行時のみにWorkerを動的作成
- **用途**: バックグラウンド処理、キャッシュ管理、オフライン対応
- **ライフサイクル**: 必要時に作成し、アイドル時に破棄
- **セキュリティ**: Service Workerのサンドボックス環境

##### 🎨 UI Environment
- **実行場所**: iframe内
- **分離レベル**: 完全に分離されたサンドボックス環境
- **用途**: ユーザーインターフェース、DOM操作
- **通信**: postMessage APIによる安全な通信
- **セキュリティ**: Same-Origin PolicyとCSPによる保護

### 2. ActivityPub Implementation
- **場所**: `app/api/types/activitypub.ts`, `app/api/utils/activitypub.ts`
- **目的**: 標準ActivityPubとカスタムオブジェクトの実装
- **拡張**: Community、Group、Message等の独自オブジェクト

### 3. Event System
- **場所**: `app/api/events/`, `app/api/eventManager.ts`
- **目的**: リアルタイムイベント配信とWebSocket通信

## 🛠️ 開発ワークフロー

### 環境セットアップ

```bash
# バックエンド開発
cd app/api
deno task dev

# フロントエンド開発
cd app/client
deno task dev

# 拡張機能ビルド
deno run --allow-all build.ts build
```

### ファイル編集時の注意点

1. **Import Paths**: 相対パスまたは`deno.json`のimportマップを使用
2. **権限**: Denoの権限システムを考慮（`-A`フラグは開発時のみ）
3. **Type Safety**: TypeScript型定義を活用

### 主要なファイルパターン

#### API Routes (`app/api/`)
- `index.ts`: メインサーバーエントリーポイント
- `hono.ts`: Honoアプリケーション設定
- `events/*.ts`: イベントハンドラー
- `models/*.ts`: データモデル定義

#### Extensions (`examples/*/`)
- `takopack.config.ts`: 拡張機能設定
- `src/server.ts`: サーバーサイドロジック
- `src/client.ts`: クライアントサイドロジック
- `src/index.html`: UI定義

## 🔍 デバッグとトラブルシューティング

### よくある問題

1. **Import Error**: `deno.json`のimportマップを確認
2. **Permission Denied**: 必要な権限フラグを追加
3. **Type Error**: 型定義ファイルの整合性を確認

### ログの確認方法

```bash
# APIサーバーログ
cd app/api && deno task dev

# 拡張機能ログ
# コンソールまたはWebSocketイベントで確認
```

## 📚 参考ドキュメント

- **[Takopack仕様](./docs/takopack/)**: 拡張機能開発ガイド
- **[takos-web API](./docs/takos-web/)**: Web API仕様
- **[ActivityPub拡張](./docs/activityPub/)**: カスタムオブジェクト仕様

## 🤖 AI Agent 向けのヒント

### コード理解のポイント

1. **イベントドリブン設計**: `eventManager.ts`を中心とした非同期処理
2. **型安全性**: ZodスキーマとTypeScript型の活用
3. **モジュラー設計**: 各機能が独立したモジュールとして実装

### 編集時の推奨事項

1. **既存パターンに従う**: 既存のコードスタイルとアーキテクチャを維持
2. **型安全性を保つ**: 新しいコードでも型定義を適切に追加
3. **テストを考慮**: 変更時はテスト可能性を念頭に置く

### 新機能追加の流れ

1. **型定義**: `types/`または`models/`で型を定義
2. **イベント**: 必要に応じて`events/`にイベントハンドラーを追加
3. **API**: `api/`にエンドポイントを実装
4. **フロントエンド**: `client/`でUI実装
5. **ドキュメント**: `docs/`で仕様を記述

---

**最終更新**: 2025年6月25日
