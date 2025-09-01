# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with
code in this repository.

## プロジェクト概要

takosは、ActivityPubプロトコルを実装したソーシャルWebアプリケーションです。1人のユーザーが複数のアカウント（サブアカウント）を持ち、他のユーザーとコミュニケーションを取ることができる分散型ソーシャルプラットフォームです。

## 技術スタック

- ランタイム: Deno / Cloudflare Workers (一部)
- バックエンド: Hono (Web framework)
- フロントエンド: Solid.js, Tauri (デスクトップアプリ)
- データベース:
  - takos 本体: 既存の実装に依存（アプリごとに切替可能）
  - takos host: D1(SQLite互換) + R2（Prisma Edge + adapter）
- 通信プロトコル: ActivityPub
- 言語: TypeScript

## 開発コマンド

### バックエンド (app/takos)

```bash
# 開発サーバー起動
cd app/takos
deno task dev --env path/to/.env

# 本番サーバー起動
deno run -A index.ts --env path/to/.env

# テスト実行
deno test -A utils/activitypub_test.ts
```

### フロントエンド (app/client)

```bash
# 開発サーバー起動
cd app/client
deno task dev

# ビルド
deno task build

# Tauriアプリケーション起動
deno task tauri
```

### 初期設定（CLIで自動生成）

```bash
# ルートから対話的に .env を生成（手動編集不要）
deno task setup

# サーバー/ホストを個別に生成
deno task setup:takos
deno task setup:host

# 非対話で一括生成の例
deno run -A scripts/setup_env.ts --target takos --force --yes \
  --domain dev.takos.local \
  --password yourpass
```

## アーキテクチャ

### ディレクトリ構造

- `app/core/` - データベースに依存しないサーバーコア
  - `routes/` - API エンドポイント定義
  - `services/` - ビジネスロジック層
  - `utils/` - ユーティリティ関数
  - `activity_handlers.ts` - ActivityPub アクティビティハンドラー
- `app/takos/` - 単体運用向けの起動コード
  - `db/` - アプリ固有の DB 実装
- `app/takos_host/` - マルチテナント向けホスティングサービス
  - `db/` - ホスト環境向け DB 実装（Prisma + D1/R2）
- `app/client/` - フロントエンドアプリケーション
  - `src/` - Solid.js コンポーネント
  - `src-tauri/` - Tauri デスクトップアプリ設定
  - `public/` - 静的アセット
- `app/shared/` - クライアント・サーバー共有コード
- `docs/` - プロジェクトドキュメント
- `scripts/` - ユーティリティスクリプト

### 主要なAPIエンドポイント

#### ActivityPub

- `/.well-known/webfinger` - WebFinger検索
- `/users/:username` - アクター情報
- `/users/:username/inbox` - 受信ボックス
- `/users/:username/outbox` - 送信ボックス
- `/inbox` - 共有受信ボックス

#### REST API

- `/api/posts` - 投稿CRUD操作
- `/api/follow` - フォロー管理
- `/api/accounts` - アカウント管理
- `/api/users/:user/messages` - メッセージング
- `/api/search` - 検索機能
- `/api/trends` - トレンド情報

### データモデル

- **テナント分離**: すべてのドキュメントに `tenant_id`
  フィールドを持ち、ドメインごとにデータを分離
- **コレクション分割**: 投稿データは `notes`、`messages`、`stories`
  に分類して保存
- **セッション管理**: TTLインデックスによる自動削除（7日間）

## 環境変数

必須の環境変数（`.env`ファイル）：

- `ACTIVITYPUB_DOMAIN` - 公開ドメイン名（外部からアクセスされるドメイン）
- `SERVER_HOST` - サーバーバインドアドレス（省略時: 0.0.0.0）
- `SERVER_PORT` - サーバーポート（省略時: 80）

オプション：

- `SERVER_CERT`/`SERVER_KEY` - HTTPS証明書
- `OAUTH_HOST`/`OAUTH_CLIENT_ID`/`OAUTH_CLIENT_SECRET` - OAuth認証設定
- `FILE_MAX_SIZE` - ファイルアップロード最大サイズ
- Firebase設定 - プッシュ通知用

## 開発時の注意事項

1. **環境変数の取得**: 常に `getEnv(c)`
   を使用してコンテキストから環境変数を取得すること
2. **テナント管理**: `tenant_id`
   はActivityPubドメインと同一で、自動的に付与される
3. **セキュリティ**: 秘密鍵や認証情報をコミットしないこと
4. **SSL開発環境**: 自己署名証明書使用時は
   `--unsafely-ignore-certificate-errors` フラグを使用
5. **初期設定**: 未設定時はブラウザで初期設定画面が表示される

## コード規約

- TypeScriptの型定義を活用する
- Honoフレームワークのミドルウェアパターンに従う
- Prisma モデル（D1/SQLite 互換）または既存のコア実装の規約に従う
- ActivityPubの仕様に準拠したJSONLD形式を使用
- エラーハンドリングを適切に実装する
