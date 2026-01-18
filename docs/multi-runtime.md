# Yurucommu マルチランタイムサポート

Yurucommuは複数のJavaScriptランタイムで動作します。

## サポートされるランタイム

| ランタイム | ステータス | データベース | ストレージ | 備考 |
|-----------|----------|------------|---------|-----|
| Cloudflare Workers | ✅ Production | D1 | R2 | 本番環境推奨 |
| workerd (local) | ✅ Production | D1 (SQLite) | R2 (local) | ローカルテスト用 |
| Node.js | ✅ Production | better-sqlite3 | ファイルシステム | セルフホスト向け |
| Bun | ✅ Production | bun:sqlite | ファイルシステム | 高速なセルフホスト |
| Deno | ⚠️ Experimental | x/sqlite3 | ファイルシステム | 実験的サポート |

## 起動方法

### Cloudflare Workers (本番環境)

```bash
# ビルド＆デプロイ
npm run deploy

# 開発環境
npm run dev
```

### workerd (ローカル)

```bash
# wranglerを使用してローカルでworkerdを起動
npm run start:workerd

# または、設定ファイルを指定
wrangler dev --config wrangler.local.toml
```

### Node.js

```bash
# 開発環境 (ホットリロード)
npm run dev:node

# 本番環境
npm run start:node
```

### Bun

```bash
# 開発/本番環境
npm run dev:bun
# または
bun run src/backend/server-bun.ts
```

### Deno

```bash
# 開発/本番環境
npm run dev:deno
# または
deno run --allow-net --allow-read --allow-write --allow-env src/backend/server-deno.ts
```

## 環境変数

すべてのランタイムで共通の環境変数を使用します：

| 変数名 | 説明 | デフォルト |
|-------|-----|----------|
| `PORT` | サーバーポート | 3000 (workerd: 8787) |
| `DATABASE_PATH` | SQLiteデータベースパス | `./data/yurucommu.db` |
| `STORAGE_PATH` | ファイルストレージパス | `./data/storage` |
| `ASSETS_PATH` | 静的ファイルパス | `./dist` |
| `MIGRATIONS_PATH` | マイグレーションディレクトリ | `./migrations` |
| `APP_URL` | アプリケーションURL | `http://localhost:PORT` |
| `AUTH_PASSWORD` | パスワード認証（任意） | - |
| `GOOGLE_CLIENT_ID` | Google OAuth ID（任意） | - |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Secret（任意） | - |
| `X_CLIENT_ID` | X OAuth ID（任意） | - |
| `X_CLIENT_SECRET` | X OAuth Secret（任意） | - |
| `TAKOS_URL` | Takos API URL（任意） | - |
| `TAKOS_CLIENT_ID` | Takos OAuth ID（任意） | - |
| `TAKOS_CLIENT_SECRET` | Takos OAuth Secret（任意） | - |

## アーキテクチャ

```
src/backend/
├── index.ts              # メインアプリケーション（Hono）
├── types.ts              # 型定義（CloudflareEnv, RuntimeEnv）
├── server.ts             # Node.js エントリポイント
├── server-bun.ts         # Bun エントリポイント
├── server-deno.ts        # Deno エントリポイント
└── runtime/
    ├── index.ts          # ランタイム検出・ファクトリ
    ├── types.ts          # ランタイム抽象化インターフェース
    ├── cloudflare.ts     # Cloudflare Workers アダプター
    ├── node.ts           # Node.js アダプター
    ├── bun.ts            # Bun アダプター
    ├── deno.ts           # Deno アダプター
    ├── compat.ts         # Node.js Cloudflare互換レイヤー
    └── compat-bun.ts     # Bun Cloudflare互換レイヤー
```

## 互換性レイヤー

各ランタイムはCloudflare Workers APIをエミュレートする互換性レイヤーを提供します：

- `D1CompatDatabase` - D1Database互換のSQLite実装
- `R2CompatBucket` - R2Bucket互換のファイルシステム実装
- `KVCompatNamespace` - KVNamespace互換のインメモリ実装
- `AssetsCompatFetcher` - Fetcher互換の静的ファイルサーバー

これにより、メインアプリケーション（`index.ts`）はCloudflare Workers APIを使用しながら、
他のランタイムでも同じコードが動作します。

## 推奨環境

### 開発環境
- **workerd** (`wrangler dev`): 本番環境に最も近い環境
- **Node.js**: デバッグしやすい、IDE統合が良い
- **Bun**: 起動が高速

### 本番環境
- **Cloudflare Workers**: グローバルCDN、自動スケーリング、低レイテンシ
- **Node.js/Bun**: VPSやコンテナでのセルフホスト
