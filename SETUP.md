# takos OSS セットアップガイド

このガイドは **takos OSS を単一インスタンスとしてデプロイ**するための手順です。

takos は以下の 2 つのデプロイモードをサポートしています：
- **単一インスタンス** … 1 つのドメイン上で自分のインスタンスを運用
- **マルチテナント** … 複数のサブドメインを使ってテナント分離（takos-private では大規模運用向けに拡張）

本ドキュメントは**単一インスタンス**の手順です。マルチテナントをホスティングしたい場合は、`takos-private` パッケージを参照してください。

## 1. 前提条件

- Node.js 18+ がインストールされている
- Cloudflare アカウントを持っている
- `wrangler` CLI で認証済み (`npx wrangler login`)

## 2. 初期セットアップ

### 2.1 リポジトリのクローン

```bash
git clone https://github.com/your-org/takos.git
cd takos
npm install
```

### 2.2 Cloudflare リソースの作成

#### D1 データベースの作成

```bash
cd backend
npx wrangler d1 create takos-db
```

出力された `database_id` をメモしてください。

#### R2 バケットの作成

```bash
npx wrangler r2 bucket create takos-media
```

### 2.3 設定ファイルの作成

```bash
cp example.wrangler.toml wrangler.toml
```

`wrangler.toml` を編集して、以下を設定:
- `name`: ワーカー名（例: `your-app-account`）
- `database_id`: 2.2で作成したD1のID
- `bucket_name`: R2バケット名（例: `takos-media`）
- `INSTANCE_DOMAIN`: あなたのインスタンスドメイン（例: `example.com`）

#### カスタムドメインを使用する場合

`routes` のコメントを外して設定:
```toml
routes = [{ pattern = "*.example.com/*", zone_name = "example.com" }]
workers_dev = false
```

#### workers.dev を使用する場合

`workers_dev = true` のままにしてください。

### 2.4 マイグレーションの適用

```bash
npx wrangler d1 migrations apply takos-db --local
npx wrangler d1 migrations apply takos-db --remote
```

### 2.5 シークレットの設定

#### 認証関連（必須）

```bash
npx wrangler var set HOST_ORIGIN=https://yourdomain.com
# optional: カスタムドメインや開発用途でテナントAPIのベースを変える場合
# npx wrangler var set ACCOUNT_SERVICE_ORIGIN=https://{handle}.dev.localhost
```

ホスト側でパスワード登録・ログインを提供する場合は、必要に応じて独自のユーザー管理を実装してください。

#### Push 通知（任意）

**方法1: FCM直接配信（本番環境推奨）**

Firebase Cloud Messaging を使用してプッシュ通知を配信します。

1. [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成
2. プロジェクト設定 → Cloud Messaging → サーバーキーをコピー
3. Wrangler でシークレットを設定:
   ```bash
   npx wrangler secret put FCM_SERVER_KEY
   ```

**方法2: 独自Push Gateway経由**

独自のPush Gatewayサーバーを構築している場合:

```bash
npx wrangler secret put PUSH_GATEWAY_URL
npx wrangler secret put PUSH_WEBHOOK_SECRET
```

**方法3: デフォルトPushサービス（フォールバック）**

FCMまたは独自Gatewayが設定されていない場合、デフォルトサービスが使用されます。
カスタマイズする場合は `wrangler.toml` で `DEFAULT_PUSH_SERVICE_URL` を設定してください。

**通知タイトルのカスタマイズ（任意）:**

```bash
npx wrangler secret put PUSH_NOTIFICATION_TITLE
```

デフォルトは "通知" です。

### 2.6 ホストアプリの設定（任意）

ホストワーカーが SPA を配信している場合、`HOST_ORIGIN` を設定してベースURLを共有できます:

```bash
npx wrangler var set HOST_ORIGIN=https://yourdomain.com
```

## 3. ローカル開発

```bash
npm run dev
```

http://127.0.0.1:8787 でアクセスできます。

### 開発用の環境変数

`.dev.vars` ファイルを作成して、ローカル開発用の変数を設定できます:

```bash
cd backend
cat > .dev.vars << EOF
HOST_ORIGIN="http://localhost:5173"
# ACCOUNT_SERVICE_ORIGIN="https://{handle}.dev.localhost"
EOF
```

## 4. デプロイ

```bash
npm run deploy
```

## 5. Push 通知の設定（モバイルアプリ向け）

モバイルアプリで Push 通知を使用する場合:

1. Firebase プロジェクトを作成
2. FCM サーバーキーを取得
3. `FCM_SERVER_KEY` シークレットを設定
4. アプリ側で FCM トークンを `/me/push-devices` エンドポイントに登録

## トラブルシューティング

### D1 マイグレーションが失敗する

```bash
# ローカルDBをリセット
rm -rf .wrangler/state/v3/d1
npx wrangler d1 migrations apply takos-db --local
```

### Workers.dev でカスタムドメインエラー

`wrangler.toml` の `routes` をコメントアウトし、`workers_dev = true` に設定。
