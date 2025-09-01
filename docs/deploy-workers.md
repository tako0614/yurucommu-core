# Cloudflare Workers へのデプロイ（ORIGIN_URL 廃止版）

Takos は Cloudflare Workers 上で直接実行できます。静的フロントは Workers [assets] から配信し、動的 API は Workers 内で処理します（ORIGIN_URL は不要）。

## 1. 前提
- Deno v1.28 以上（本リポジトリの開発前提）
- Wrangler（Cloudflare Workers CLI）
```sh
npm i -g wrangler
```

## 2. フロントをビルド
```sh
cd app/takos_host/client
deno task build
```
出力は `app/takos_host/client/dist` に生成されます（Workers [assets] が参照）。

## 3. ORIGIN_URL は不要
すべて Workers 内で完結するため ORIGIN_URL の設定は不要です。

## 4. ローカルで起動
```sh
wrangler dev -c wrangler.toml
wrangler dev -c wrangler.tenant.toml
```

`/user` と `/auth` は静的 SPA を配信し、`/user/*` と主要な `/auth/*` API は Workers 内で処理されます。
### app/dev からのマルチテナント検証（Workers 経由）
`host1.local`, `host2.local` を Workers で模擬可能です。`TENANT_HOST` により `x-forwarded-host` を強制します。

## 5. デプロイ
```sh
wrangler deploy -c wrangler.toml
wrangler deploy -c wrangler.tenant.toml
```

## ルーティングの概要
- Host Worker（takos.jp, www.takos.jp）: Host UI と Host API（D1+R2）を提供
- Tenant Worker（*.takos.jp）: クライアント配信（assets）+ takos コア API を Workers 内で実行（D1+R2）

