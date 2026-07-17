# Yurucommu Core

English: [README.en.md](README.en.md)

Yurucommu Core は、yurucommu family の製品 (yurucommu / yurumeet など) が共通で使う
**ActivityPub / API / DB / runtime エンジンのライブラリ** です。分散 SNS の連合・サーバー API・
データベース層を 1 か所に実装しておくことで、各製品は UI に集中できます。

これはインストールできる製品の repo ではなく、OpenTofu Capsule (Git URL から取り込む
1 つのアプリ/インフラ単位) も持ちません。deploy できる製品は別の repo にあります。

- `yurucommu` — フィード / ストーリー / プロフィールの fullstack product。`yurucommu.com`・
  Worker artifact・OpenTofu Capsule を持ちます
- `yurumeet` — トーク中心の fullstack product。`yurume` は discovery と push 登録で使う
  短い client id / 略称です

## できること

- **ActivityPub 連合** — フォロー・投稿・ブースト・いいね・返信をサーバーをまたいで行い、
  コミュニティとつながりを結びます。HTTP-signature の検証、SSRF 対策済みの fetch、
  actor / ドメインのブロックリストを備えます
- **サーバー API** — actor・投稿・ストーリー・DM・コミュニティ・メディア・通知・
  モバイル push の route を提供します
- **クライアント契約** — yurucommu・yurumeet・モバイル・代替クライアント向けの型付き SDK と
  discovery の型を提供します
- **検索・通知・レコメンド** — 人とコンテンツを見つけられます
- **認証** — パスワード、Google / X OAuth、Takosumi Accounts の OIDC クライアントに対応します
- **二言語 UI** — 日本語 / 英語に対応します

## 使い方の境界

この repo を Capsule としてインストールしないでください。代わりに `yurucommu` または
`yurumeet` をインストールします。これらの製品 repo が、自分の UI とこのサーバーエンジンを束ね、
自分の Worker artifact を公開し、自分の plain OpenTofu module を持ちます。

クライアント実装は `@takosjp/yurucommu-api` を使ってください。製品の Worker artifact は
`@takosjp/yurucommu-core/server` で Hono backend を作成し、
`@takosjp/yurucommu-core/migrations` で D1 migration を有効化します。この checkout の
未公開 source path を import してはいけません。

## 開発者向け

```bash
cd yurucommu-core
bun install
bun run check   # tsc --noEmit
bun test        # bun:test suite
bun run lint    # type check
bun run fmt     # prettier
```

backend エンジンの source は `src/backend` (Hono routes、ActivityPub 連合、配送 pipeline)、
共有 npm API package は `packages/api`、データベースの schema と migration は
`src/db/schema` と `migrations/` にあります。

API package のコマンド:

```bash
bun run build:api  # build @takosjp/yurucommu-api
bun run pack:api   # npm pack --dry-run for the API package
```

### 通知機能を含む 3.1.0 の release 順序

ブラウザ通知の public API と `0019_notification_push_delivery.sql` は core / API `3.1.0` からの契約です。
まずこの repo で両 package を同じ `v3.1.0` tag から npm に公開し、packaged consumer gate が通ることを確認します。
その公開が registry から取得できるようになった後にだけ、`yurucommu` / `yurumeet` の dependency range と
`bun.lock` を registry package から更新し、各 repo の `bun run check:core-release` を通してから製品版 Worker を
release します。`file:` / `workspace:` / Git dependency で未公開 source を代用してはいけません。

Yurumeet とモバイルクライアントは別 repo にあります。これらは `@takosjp/yurucommu-api` に依存し、
Capsule の output または `/.well-known/social-server` でサーバーを見つけ、自分の静的/runtime
artifact を Takosumi・Cloudflare・self-host の実行環境で deploy します。デバッグ用に
`clients/` の下へローカル checkout を置けますが、このディレクトリは意図的に git 管理外に
してあり、サーバー repo を小さく保ちます。

クライアントが別 origin で動く場合、yurucommu サーバー側の CORS / CSRF の許可リストに
その origin を含める必要があります。

## 製品としての境界

Yurucommu は ActivityPub 連合・コンテンツ配送・ユーザー identity をすべてアプリ層で自前実装して
います。Takos core のサービスにも、プラットフォーム層の連合の仕組みにも依存しません。Takosumi 経由で
インストールされた場合もユーザーが削除できる通常の Capsule であり、Takos core に取り込まれることは
ありません。詳しい境界は [`AGENTS.md`](AGENTS.md) を参照してください。

## ドキュメント

- [Deployment guide](https://yurucommu.com/help/deployment.html)
- [Getting started](https://yurucommu.com/help/getting-started.html)
- [Help site](https://yurucommu.com/help/)
