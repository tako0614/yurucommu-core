# テナント配信用 Cloudflare Worker 構成

本構成では、ポータル(Host)用Workerとテナント配信用Workerを分離し、
それぞれ別の静的アセットを配信しつつ、同一の D1/R2 バインディングを共有します。

- Host Worker: ルートドメイン(`takos.jp`, `www.takos.jp`)を担当。`app/takos_host/client/dist` を配信。
- Tenant Worker: サブドメイン(`*.takos.jp`)を担当。`app/client/dist` を配信し、動的APIは既存Denoサーバーへプロキシ。

## Tenant Worker

- エントリ: `app/takos_host/tenant_asset_worker.ts`
- 設定: `wrangler.tenant.toml`

抜粋:

```toml
name = "takos-worker-tenant"
main = "app/takos_host/tenant_asset_worker.ts"
routes = ["*.takos.jp/*"]

[assets]
directory = "app/client/dist"
binding = "ASSETS"

[vars]
ORIGIN_URL = "https://api.takos.jp" # 既存Denoサーバー

[[d1_databases]]
binding = "TAKOS_HOST_DB"         # Host Worker と同じ database_id を指定
database_id = "<same-as-host>"

[[r2_buckets]]
binding = "takos_host_r2"
bucket_name = "takos-host"
```

ビルド/デプロイ:

```sh
cd app/client
deno task build
wrangler dev --config wrangler.tenant.toml
wrangler deploy --config wrangler.tenant.toml
```

Host 側(`wrangler.toml`)は `routes = ["takos.jp/*", "www.takos.jp/*"]` のみ、
Tenant 側(`wrangler.tenant.toml`)は `routes = ["*.takos.jp/*"]` を設定してください。

両Workerに同一の D1/R2 バインディングを設定することで、同じDB/ストレージを共有できます。

