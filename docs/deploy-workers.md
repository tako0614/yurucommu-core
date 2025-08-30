# Cloudflare Workers へのデプロイ（エッジ・プロキシ構成）

Takos のバックエンドは MongoDB などに依存しており、Cloudflare Workers の実行環境（TCP 不可）へ直接移植するのは困難です。そこで本リポジトリでは、以下の構成を用意しました。

- 静的フロント（`app/takos_host/client/dist`）は Workers Assets から配信
- 動的 API（`/auth/*`, `/user/*` など）は既存の Deno ホストへプロキシ

これにより、Cloudflare Workers 側はエッジ CDN として機能し、既存サーバーの前段に置く形で動作します。

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

出力は `app/takos_host/client/dist` に生成されます（Workers Assets が参照）。

## 3. ORIGIN_URL を設定

Workers から動的 API を転送する既存 Deno サーバーの URL を設定します。

```sh
cp .dev.vars.example .dev.vars
# エディタで ORIGIN_URL を既存サーバーに合わせて変更
```

または `wrangler.toml` の `[vars]` で指定しても構いません。

既存サーバー（オリジン）は通常次のように起動します:

```sh
deno run -A app/takos_host/main.ts
# または必要に応じて deno task dev など
```

## 4. ローカルで起動

```sh
wrangler dev
```

`/user` と `/auth` は静的 SPA を配信し、`/user/*` と主要な `/auth/*` API は ORIGIN_URL へプロキシされます。

### app/dev からのマルチテナント検証（Workers 経由）

dev 用の 2 つのホスト（`host1.local`, `host2.local`）を Workers で模擬できます。`TENANT_HOST` により `x-forwarded-host` を強制します。

```sh
# 既存 Deno サーバーを起動（単一プロセスで OK。テナントはヘッダで切替）
deno run -A app/takos_host/main.ts

# Workers 側（タブ1）
deno task --cwd app/dev workers:host1

# Workers 側（タブ2）
deno task --cwd app/dev workers:host2
```

どちらも同じオリジン（`ORIGIN_URL`）へ転送しますが、`TENANT_HOST` により `host1.local` / `host2.local` としてテナント解決されます。

## 5. デプロイ

```sh
wrangler deploy
```

## ルーティングの概要

- GET `/user` → `index.html`（Assets）
- GET `/user/*` → 先に Assets（`/user` を剥がして配信）／404 なら ORIGIN へ
- GET `/auth` → `index.html`（Assets）
- GET `/auth/*` → 先に Assets（`/auth` を剥がして配信）／404 なら ORIGIN へ
- 非 GET/HEAD は全て ORIGIN へ（`/user/*` はパスを剥がして転送）
- `/oauth*`, `/actor`, `/inbox`, `/outbox`, `/.well-known/*` は ORIGIN 優先
- 上記以外の GET → 先に Assets／404 なら ORIGIN → さらに 404 なら `index.html`

必要に応じて `app/takos_host/worker.ts` を拡張してください（例: 他の API をプロキシへ追加）。

補足: Worker はオリジンへ転送する際に `x-forwarded-host` と `x-forwarded-proto` を付与します。サーバー側は `x-forwarded-host` を優先してテナント解決を行います（`app/takos_host/utils/host_context.ts:78` 付近の `getRealHost` を参照）。
