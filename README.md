Takos リポジトリのルートから、開発・ビルド・本番実行を一括で操作できるようにしました。

## 前提

- Deno v1.28.0 以上（なるべく最新の安定版）
- 各サービスの接続情報は `.env` を用意（例: `app/takos/.env.example` と `app/takos_host/.env.example` を参照）

## 使い方（ルートで実行）

- 開発同時起動（takos + takos_host）

  - `deno task dev --env path/to/.env`
  - 片方ずつ別の env を使う: `deno task dev -- --env-takos path/to/takos.env --env-host path/to/host.env`

- ビルド（takos_host のクライアント + app/client）

  - `deno task build`

- 本番起動（watch 無し）

  - 両方: `deno task start --env path/to/.env`
  - 片方のみ: `deno task start -- --only takos` または `deno task start -- --only host`
  - 片方ずつ別の env を使う: `deno task start -- --env-takos path/to/takos.env --env-host path/to/host.env`

- セットアップ（.env 生成 CLI）

  - 対話モード（両方）: `deno task setup`
  - takosのみ: `deno task setup:takos`
  - hostのみ: `deno task setup:host`
  - 非対話/自動化例: `deno run -A scripts/setup_env.ts --target takos --force --yes --mongo mongodb://localhost:27017/takos-hono --domain dev.takos.jp --password yourpass`

## 個別実行（参考）

- `deno task dev:takos` / `deno task dev:host`
- `deno task build:host` / `deno task build:client`
- `deno task start:takos` / `deno task start:host`

詳細は `AGENTS.md` を参照してください。
