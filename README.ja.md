# Yurucommu

English: [README.md](README.md)

Yurucommu はセルフホスト型・一人用の ActivityPub プロダクトです。

自分のドメイン、自分のデータ、小さなコミュニティ単位のつながりを前提に設計されています。

この repo 単体で、runtime model、ローカル開発、deploy の大枠が追える状態を保つことを目指します。

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
- `wrangler.toml`、`wrangler.local.toml`、`wrangler.site.toml`: deploy / environment 別設定

## Quickstart

```bash
cd yurucommu
deno task dev
```

これは Cloudflare Worker 前提のローカル開発フローを起動します。

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

静的サイト:

```bash
cd yurucommu
deno run -A npm:wrangler deploy --config wrangler.site.toml
```

## 設定メモ

- ローカル設定は `.env.example` を起点にする
- tracked config は OSS に安全な値だけを置き、secret や本番専用 ID は commit しない
- public behavior を変えたら、コードと一緒に `README.md` や example も更新する

## ドキュメント方針

現状の Yurucommu は、README と in-repo config example を public entrypoint の中心にしています。
今後 docs を増やしても、この README は短い overview と navigation の役割を維持します。

## ライセンスと貢献

ライセンスは GNU AGPL v3 です。詳細は `LICENSE` を参照してください。

貢献方針は `CONTRIBUTING.md`、脆弱性報告は `SECURITY.md` を参照してください。
