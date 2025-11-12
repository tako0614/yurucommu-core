# takos

Cloudflare Workers ベースのマルチテナント SNS バックエンドテンプレートです。

- `backend` … テナント用ワーカー。認証・コミュニティ・投稿・Stories・ActivityPub を提供。
- `shared` … Story エディタなどの共通モジュール群。

## Quick Start

```bash
git clone https://github.com/your-org/takos.git
cd takos
npm install
```

### セットアップ

1. Cloudflare にログイン:
   ```bash
   npx wrangler login
   ```

2. D1 データベースを作成:
   ```bash
   cd backend
   npx wrangler d1 create your-app-db
   ```
   出力された `database_id` をメモします。

3. R2 バケットを作成:
   ```bash
   npx wrangler r2 bucket create your-media-bucket
   ```

4. 設定ファイルをコピー:
   ```bash
   cp example.wrangler.toml wrangler.toml
   ```
   `wrangler.toml` を編集して、`database_id`、`bucket_name`、`INSTANCE_DOMAIN` などを設定します。

5. マイグレーションを適用:
   ```bash
   npx wrangler d1 migrations apply your-app-db --local
   ```

6. 認証関連の環境変数を設定:
   ```bash
   npx wrangler var set HOST_ORIGIN=https://yourdomain.com
   # optional: テナントAPIの基底パターンを変更する場合
   # npx wrangler var set ACCOUNT_SERVICE_ORIGIN=https://{handle}.example.com
   ```

7. Push 通知の設定（任意）:

   **方法1: FCM直接配信（本番環境推奨）**
   ```bash
   npx wrangler secret put FCM_SERVER_KEY
   ```
   Firebase Cloud Messaging のサーバーキーを設定します。
   [Firebase Console](https://console.firebase.google.com/) でプロジェクトを作成し、
   プロジェクト設定 → Cloud Messaging からサーバーキーを取得してください。

   **方法2: 独自Push Gateway経由**
   ```bash
   npx wrangler secret put PUSH_GATEWAY_URL
   npx wrangler secret put PUSH_WEBHOOK_SECRET
   ```
   独自のPush Gatewayサーバーを使用する場合に設定します。

   **方法3: デフォルトPushサービス（フォールバック）**
   FCMまたは独自Gatewayが設定されていない場合、デフォルトサービスが使用されます。
   カスタマイズする場合は `wrangler.toml` で `DEFAULT_PUSH_SERVICE_URL` を設定してください。

   **通知タイトルのカスタマイズ（任意）:**
   ```bash
   npx wrangler secret put PUSH_NOTIFICATION_TITLE
   ```

### 開発

```bash
npm run dev
```

ローカル開発サーバーが `http://127.0.0.1:8787` で起動します。

### デプロイ

```bash
npm run deploy
```

カスタムドメインを使う場合は、`wrangler.toml` の `routes` を設定してください。

## アーキテクチャ

このワーカーは、サブドメインベースのマルチテナント構成を想定しています：

- `user1.yourdomain.com` → user1 のデータ
- `user2.yourdomain.com` → user2 のデータ

各テナントは独立した ActivityPub アクターとして動作し、他のテナントや外部の ActivityPub サーバーと連携できます。

詳細は `backend/README.md` を参照してください。

## takos-private との関係

このリポジトリは OSS 版です。実運用版の `takos-private` では、以下の追加コンポーネントがあります：

- `services/host-backend` … ルートドメイン用ワーカー（SPA 配信・テナントディスカバリ・プッシュ通知）
- `frontend` … SolidJS フロントエンド
- `app` … Expo モバイルアプリ

OSS 版は `backend` のみを提供し、独自のフロントエンド・モバイルアプリから API を利用できます。
