# Yurucommu

Yurucommu はセルフホスト型・一人用の ActivityPub プロダクトです。

自分のドメイン、自分のデータ、小さなコミュニティ単位のつながりを前提に設計されています。
Takos では bundled 1st-party InstallableApp (新規 space 作成時に auto-install
される user-facing convenience) として扱われます。通常の AppInstallation entry
なので uninstall 可能ですが、この repository は独立 product root
として管理します。

この repo 単体で、runtime model、ローカル開発、deploy
の大枠が追える状態を保つことを目指します。

## 特徴

- セルフホスト前提で、Cloudflare ベースの低コスト運用を目指す
- ActivityPub 互換で、Mastodon や Misskey 系との相互接続を意識する
- アルゴリズムよりも小さなコミュニティや趣味単位のつながりを重視する

## 目指す方向

- recommendation feed より human-scale な関係性
- mass-audience timeline より community-sized な場
- identity、domain、data を自分で持てる self-hosted 性
- ActivityPub による standards-based federation

## 技術スタック

- Runtime: Cloudflare Workers
- Database: Cloudflare D1
- Storage: Cloudflare R2
- Backend: Hono
- Web UI: SolidJS + Vite
- Protocol: ActivityPub

## Repository Map

- `src/backend`: Hono route、middleware、runtime code、backend test
- `src/db`: schema と database 関連コード
- `src/plugin`: 再利用可能な plugin surface
- `src/runtime`: runtime helper
- `web/`: Vite ベースの web UI
- `site/`: プロジェクトサイト用の静的ファイル
- `migrations/`: database migration
- `wrangler.toml`、`wrangler.tenant2.toml`、`wrangler.local.toml`、`wrangler.site.toml`:
  deploy / environment 別設定

## Quickstart

```bash
cd yurucommu
deno task dev
```

これは `wrangler.local.toml` を使った Cloudflare Worker
前提のローカル開発フローを起動します。

web UI の開発:

```bash
cd yurucommu
deno task dev:web
```

テスト・lint:

```bash
cd yurucommu
deno task test
deno task lint
```

database helper:

```bash
cd yurucommu
deno task db:generate
deno task db:push
deno task db:studio
```

## Deploy

アプリ本体:

```bash
cd yurucommu
deno task deploy
```

Takos 向け bundle:

```bash
cd yurucommu
deno task build:takos-worker
```

Takos bundled app packaging は `.takosumi/app.yml` と `.takosumi/manifest.yml`
にあります。

`.takosumi/manifest.yml` は `dist/takos-worker.js` を deploy artifact
として扱います。 この bundle は web UI を worker に内包するため、Takos 側で
`ASSETS` が無くても 画面は配信できます。`/healthz` は liveness probe で、binding
欠落がある場合も 通常は `degraded` を 200 で返します。runtime binding の strict
確認には `/readyz` を使い、Takos bundled app manifest の readiness も `/readyz`
を使います。 `YURUCOMMU_STRICT_READINESS=1` を設定すると `/healthz` も binding
欠落時に 503 を返します。

ただし canonical ActivityPub identity を固定する production では `APP_URL` を
deploy env / manifest override で明示してください。runtime binding は
`.takosumi/manifest.yml` の provider metadata で `DB` / `MEDIA` / `KV` /
`DELIVERY_QUEUE` / `DELIVERY_DLQ` として宣言済みです。queue consumer は同
manifest の Cloudflare provider metadata で `DELIVERY_QUEUE` を primary
consumer、 `DELIVERY_DLQ` を dead-letter queue かつ DLQ reconciliation consumer
として 宣言します。manifest は `DELIVERY_QUEUE_NAME=yurucommu-delivery` と
`DELIVERY_DLQ_NAME=yurucommu-delivery-dlq` も明示し、Takos resource 名と runtime
dispatch 名を一致させます。

Takosumi install/deploy の目安:

```bash
cd yurucommu

# 1. InstallableApp metadata と manifest resources / bindings / queue consumers を検証する
takosumi-git install . --ref <pinned-tag> --mode shared-cell

# 2. D1 migration を適用する
deno task takos:migrate

# 3. strict readiness を確認し、必要なら takosumi-git / Takosumi Accounts 経由で再 apply する
deno task check
```

queue 名を変えた環境では `DELIVERY_QUEUE_NAME` / `DELIVERY_DLQ_NAME` を worker
env に設定してください。未設定時は `yurucommu-delivery` /
`yurucommu-delivery-dlq` を consumer queue 名として扱います。

Takosumi Git URL install:

```bash
cd yurucommu
takosumi-git install preview --cwd .
```

`.takosumi/app.yml` は Git URL install 用 metadata です。OIDC binding、media
object-store binding、domain binding、Takos resource AppGrant を宣言し、
shared-cell / dedicated / self-hosted runtime modes を明示します。
`.takosumi/manifest.yml` は `dist/takos-worker.js` を host Worker resource
として 扱います。D1 / KV / Queue は現行 Takosumi portable binding catalog にまだ
first-class type がないため、manifest metadata に Cloudflare provider specific
requirement として記録しています。

静的サイト:

```bash
cd yurucommu
deno run -A npm:wrangler deploy --config wrangler.site.toml
```

### デプロイ設定の例 (example operator deployment 値)

リポジトリに同梱されている `wrangler*.toml` は **example operator deployment**
の値を含みます。 hostname は operator-deployment choice であり、yurucommu 自体の
identity ではありません (`docs/reference/design-principles.md` §0.6, §7 参照)。
自分のデプロイでは以下の値を実際の hostname / tenant に置き換えてから deploy
してください。

- `wrangler.toml`: 本体 Worker 設定 (`APP_URL`、`[[routes]].pattern`、Takos
  連携を 使う場合は `TAKOS_URL` を canonical hostname に合わせる)
- `wrangler.tenant2.toml`: 別 tenant 向けの設定例
- `.env.example` の `APP_URL` は self-host 用の例であり、checked-in
  `wrangler*.toml` の値とは独立して上書きしてください

## 設定メモ

- ローカル設定は `.env.example` を起点にする
- tracked config は OSS に安全な値だけを置き、secret や本番専用 ID は commit
  しない
- public behavior を変えたら、コードと一緒に `README.md` や example も更新する

## ドキュメント方針

現状の Yurucommu は、README と in-repo config example を public entrypoint
の中心にしています。 今後 docs を増やしても、この README は短い overview と
navigation の役割を維持します。

## ライセンスと貢献

ライセンスは GNU AGPL v3 です。詳細は `LICENSE` を参照してください。

貢献方針は `CONTRIBUTING.md`、脆弱性報告は `SECURITY.md` を参照してください。
