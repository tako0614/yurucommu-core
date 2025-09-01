# Workers Assets の挙動と takos クライアントの配信について

このメモは Cloudflare Workers の `[assets]` 設定による挙動と、本リポジトリの配信構成の意図を整理したものです。

- `wrangler.toml` の `[assets]` は、今回は takos host の静的 UI（`app/takos_host/client/dist`）のみを対象にしています。
- デフォルトでは HTML へのアクセスがディレクトリにリダイレクトされる（例: `/index.html` → `/`）場合があります。SPA でこれが「どのパスでもルートへリダイレクト」に見えることがあります。
- リダイレクトを避けるには、`wrangler.toml` の `[assets]` に `html_handling = "rewrite"` を追加してください（本リポジトリでは追加済み）。

また、`takos` 本体クライアント（`app/client/dist`）のアセットは本 Worker には含めていません。以下のいずれかで配信してください。

- 既存の Deno サーバ（オリジン）で配信し、Workers 側のルート設定は `takos.jp/*` のみを担当させる
- 別の Worker/Pages を用意し、`[assets] directory = "app/client/dist"` で `*.takos.jp/*` を担当させる

単一の Worker で複数の Assets ルートを同時に持つことはできないため、host 用 UI と本体クライアントの配信はルート（ドメイン/サブドメイン）を分ける設計がシンプルです。

