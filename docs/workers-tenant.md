# テナント配信用 Cloudflare Worker 構成（ORIGIN_URL 廃止）

ポータル(Host)用 Worker とテナント配信用 Worker を分離し、どちらも Cloudflare Workers 上で実行します。静的アセットは Workers [assets] から配信し、動的 API は Workers 内で直接処理します（ORIGIN_URL は不要）。

- Host Worker: ルートドメイン（`takos.jp`, `www.takos.jp`）。`app/takos_host/client/dist` を配信。
- Tenant Worker: サブドメイン（`*.takos.jp`）。`app/client/dist` を配信しつつ、takos コア（`createTakosApp`）を Workers 上で実行。

## Tenant Worker

- エントリ: `app/takos_host/tenant_core_worker.ts`
- 設定: `wrangler.tenant.toml`

例:

```toml
name = "takos-worker-tenant"
main = "app/takos_host/tenant_core_worker.ts"
routes = ["*.takos.jp/*"]

[assets]
directory = "app/client/dist"
binding = "ASSETS"
html_handling = "auto-trailing-slash"

[vars]
OBJECT_STORAGE_PROVIDER = "r2"
R2_BUCKET = "takos_host_r2"

[[d1_databases]]
binding = "TAKOS_HOST_DB"         # Host Worker と同一の D1 を共有
database_id = "<same-as-host>"

[[r2_buckets]]
binding = "takos_host_r2"
bucket_name = "takos-host"
```

ビルド・デプロイ:

```sh
cd app/client
deno task build
wrangler dev --config wrangler.tenant.toml
wrangler deploy --config wrangler.tenant.toml
```

Host 側（`wrangler.toml`）は `routes = ["takos.jp/*", "www.takos.jp/*"]`、Tenant 側（`wrangler.tenant.toml`）は `routes = ["*.takos.jp/*"]` を設定してください。両 Worker に同一の D1/R2 バインディングを設定すると、同じ DB/ストレージを共有できます。

