# takos — Open Source SNS Backend

## 🌟 コンセプト

takos は **「1人1台、24時間稼働のパーソナルサーバー + 専用ドメイン」** を提供する分散型 SNS プラットフォームです。

従来の SNS のように巨大なサーバーをみんなで共有するのではなく、**各ユーザーに小さな「パーソナルサーバー」を割り当て**、それぞれが独立したサービスとして振る舞います。ActivityPub プロトコルで相互接続することで、分散型のソーシャルネットワークを形成します。

**4つのコア機能**:
- 🐦 **Microblog** — Mastodon 的な短文投稿タイムライン
- 💬 **Chat** — DM・少人数会話
- 👥 **Community** — Lemmy 的な掲示板・グループ
- 📖 **Story** — 座標配置型ビジュアルコンテンツ

---

## 📦 プロジェクト構成

takos は **ActivityPub 対応の SNS バックエンドおよび共通モジュール群**をまとめた、完全独立したオープンソースプロジェクトです。

このパッケージ単体で **1 つの takos インスタンス** を構築できます。複数テナントをホスティングする場合は別パッケージの `takos-private` を利用してください（OSS 版はシングルインスタンス専用）。

## モジュール構成

- **`backend`** … Cloudflare Workers で動作する API ワーカー。認証・ユーザー管理・コミュニティ・Stories・ActivityPub フェデレーション。**単一インスタンス専用**（マルチテナントは takos-private 側で提供）。
- **`platform`** … backend / frontend で共有するドメインロジック。ユーザー、投稿、コミュニティ、ActivityPub エンティティなどの抽象化層。複数の UI やクライアントで再利用可能。
- **`frontend`** … SolidJS + Vite で実装されたリファレンス UI。好きなフレームワークに置き換え可能。
- **`docs`** … ActivityPub 拡張仕様と REST API リファレンス。

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

### 設定テンプレートの生成

```bash
npm run init:config
```

ルートに `takos-profile.json` と `takos-config.json` のコメント付き雛形を生成します。
生の JSON が欲しい場合は `npm run init:config -- --no-comments` を、既存ファイルを上書きする場合は `--force` を付けてください。

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

takos の `backend` ワーカーは **単一インスタンス** を前提にしています。複数テナントやサブドメイン運用は `takos-private` に実装されています。

```
Domain: example.com
│
└─ example.com/* → Cloudflare Worker
   ├─ /api/... → REST API（この 1 インスタンスのユーザー）
   ├─ /.well-known/... → WebFinger, ActivityPub Actor
   └─ /static/... → メディア・静的ファイル
```

このモードでは、ドメイン全体が 1 つのインスタンスとなり、`@user@example.com` が ActivityPub アクターになります。

## takos-private との関係

**takos（このリポジトリ）** は、完全独立したオープンソースプロジェクトです。ライセンスに従っていかなる人でも自由に利用・改変・デプロイできます。

**takos-private** は、takos を **SaaS 化・ホスティングサービス化**した別パッケージです。特徴は：

- **複数テナント管理** … 顧客ごとに `customer-name.app.example.com` のようなサブドメインを割り当て。
- **ホストワーカー** (`services/host-backend`) … ルートドメイン上のメインフロントエンド SPA 配信、テナント情報管理、プッシュ通知集約ゲートウェイ。
- **運用・課金** … テナントプロビジョニング、サブスクリプション管理、監視・ロギング、カスタマーサポート。
- **ブランディング** … ホワイトラベル対応、カスタムドメイン設定。

### 共有部分

| モジュール | takos OSS | takos-private |
|-----------|----------|--------------|
| `backend` | ✅ 単一インスタンス用 / マルチテナント用 | ✅ テナント毎の Account Backend として動作 |
| `platform` | ✅ 共有ドメインロジック | ✅ 同一コード（共有） |
| `frontend` | ✅ リファレンス UI | ✅ Host Backend 経由で配信 |
| `services/host-backend` | ❌ 不要 | ✅ テナント集約・SPA 配信 |
| 課金・テナント管理 | ❌ 自分で実装 | ✅ 組み込み |

### 使い分け

- **takos OSS を選ぶ場合** … 自分で運用するインスタンス、プライベートコミュニティ、開発・実験、カスタマイズが必要な場合。
- **takos-private を選ぶ場合** … 複数ユーザーを管理したい、SaaS のように運用したい、テナント管理機能が必要な場合。
