# Yurucommu

Yurucommu はセルフホスト型・一人用の ActivityPub プロダクトです。

自分のドメイン、自分のデータ、小さなコミュニティ単位のつながりを前提に設計されています。
Takos では bundled 1st-party app (新規 space 作成時に auto-install される
user-facing convenience) として扱われます。通常の Installation なので uninstall
可能ですが、この repository は独立 product root として管理します。

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
deno task build:worker
```

Takos bundled app packaging は `.takosumi.yml` AppSpec にあります。

`.takosumi.yml` は operator-resolved worker component の `spec.entrypoint`
として prepared source 内の `dist/worker.js` を指し、worker が `web.http` を
publish し、gateway component が public listener / route intent
を宣言します。build command は `.takosumi.build.yml` にあり、
`deno task build:worker` で `dist/worker.js` を 生成します。`/healthz` は
liveness probe で、binding 欠落がある場合も通常は `degraded` を 200
で返します。runtime binding の strict 確認には `/readyz` を 使います。
`YURUCOMMU_STRICT_READINESS=1` を設定すると `/healthz` も binding 欠落時に 503
を返します。

ただし canonical ActivityPub identity を固定する production では `APP_URL` を
deploy env で明示してください。`.takosumi.yml` は postgres component の
`db.connection`、object-store component の `media.bucket` を local publication
として publish し、worker はそれらと `operator.identity.oidc` external
publication を listen します。KV / delivery queue bindings が必要な operator
distribution では、AppSpec 外の deploy config で `KV` / `DELIVERY_QUEUE` /
`DELIVERY_DLQ` と queue 名 env を供給してください。

Takosumi install/deploy の目安。Git URL dry-run は catalog discovery / metadata
lint 用です。`dist/worker.js` は Git source に含めず `.takosumi.build.yml`
で生成するため、actual dry-run/apply は build service / CI が作った prepared
source を使います。local `--source .` は build 後に `dist/worker.js`
が存在する場合だけ使います。

```bash
cd yurucommu

# 1. AppSpec metadata / components / publication-listen wiring を検証する
takosumi install dry-run --source git:https://github.com/tako0614/yurucommu.git#<pinned-tag> --space <space-id>

# 2. build service / CI が prepared source を作り、Installer API に source.kind=prepared と archive payload source.digest を渡す
deno task build:worker

# 3. Takosumi が provision した database に migration を適用する
deno task takos:migrate

# 4. strict readiness を確認し、必要なら Takosumi installer / Accounts 経由で再 apply する
deno task check
```

queue 名を変えた環境では `DELIVERY_QUEUE_NAME` / `DELIVERY_DLQ_NAME` を worker
env に設定してください。未設定時は `yurucommu-delivery` /
`yurucommu-delivery-dlq` を consumer queue 名として扱います。

ローカル checkout の AppSpec shape だけを確認する場合:

```bash
cd yurucommu
takosumi install dry-run --source . --space <space-id>
```

`.takosumi.yml` は Installer API に渡す AppSpec です。operator-resolved worker
component、gateway component、postgres component、media object-store
component、worker の `publish.http`、gateway の listener / route intent、OIDC /
database / media の publication-listen wiring を宣言します。permissions、build
command、provider metadata は AppSpec に含めません。

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
  連携を使う場合は `TAKOS_URL` を canonical hostname に合わせる)
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
の中心にしています。今後 docs を増やしても、この README は短い overview と
navigation の役割を維持します。

## ライセンスと貢献

ライセンスは GNU AGPL v3 です。詳細は `LICENSE` を参照してください。

貢献方針は `CONTRIBUTING.md`、脆弱性報告は `SECURITY.md` を参照してください。
