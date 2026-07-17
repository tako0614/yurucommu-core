# AGENTS.md — yurucommu-core

`yurucommu-core` は yurucommu family の **ActivityPub / API / DB / runtime engine
library** です。 deploy される product / OpenTofu Capsule ではありません。
`yurucommu` repo は feed / story / profile 中心の fullstack product、`yurumeet`
repo は talk-first の fullstack product で、どちらもこの core library を npm package
として利用して Worker artifact と OpenTofu Capsule を自分のrepoで所有します。
`yurume` は Yurumeet の client id / 略称として使います。

思想は yurucommu family 共通です。個人が自分のドメイン / 自分のデータで立てる
self-hosted ActivityPub SNS を前提にし、到達範囲 (reach) はコミュニティ単位に保つ。
federation は目的ではなく、プラットフォーム非依存とコミュニティ・つながりを
サーバーをまたいで繋ぐための手段です。

## 責務

### 持つ

- ActivityPub federation (Mastodon / Misskey 系との相互接続)
- single-user federated social (self-hosted、 small-community focus)
- yurucommu social API engine (actor / post / story / DM / community / media / notification)
- DB schema / migrations / runtime adapters
- `@takosjp/yurucommu-api` npm package
- `@takosjp/yurucommu-core` server library exports used by product Worker artifacts

### 持たない

- OpenTofu Capsule module / product deploy ownership
- product-specific Worker artifact release workflow
- `yurucommu.com` / `yurumeet.com` UI or brand site ownership
- Takos core service との直接 implementation 連携 (consumer 側として通常の
  Capsule install flow を経由)
- Takosumi platform 層の federation 責任 (federation は yurucommu 自身が
  ActivityPub で実装する)
- Takos product 固有の chat / agent / memory primitive
- Takosumi-owned official client catalog / official app privilege

## 隣接 product との contract

- **Installable apps**: `yurucommu` / `yurumeet` が Takosumi 上でユーザーが明示的に追加する通常 Capsule
- **Upstream**: Takosumi Accounts OIDC consumer (operator-owned external
  publication / OIDC discovery で issuer を解決)、 Takos public API
- **Downstream**: ActivityPub federated network (他の Mastodon / Misskey
  instance と相互接続)
- **Product repos**: `yurucommu` repo は feed-first、 `yurumeet` (`yurume`) repo は talk-first。
  どちらも core library から actor / DM / community / ActivityPub API を組み込んで、自分の
  OpenTofu module と Worker artifact を持つ
- **Client SDK**: client / mobile repo は core repo の内部 path を import せず、
  `@takosjp/yurucommu-api` と product Capsule outputs / `/.well-known/social-server` を使う
- **Repo topology**: この repo は deployable repo ではなく、公式 yurucommu product、
  Yurumeet、mobile shell の source は別 repo に置く
- **Independence**: Takos core には吸収しない、 product root として独立を保つ

## Substitutability / Federation

- **App-level federation**: yurucommu 自身が ActivityPub で federation
  を実装する。 Takosumi platform 層で federate する仕組みは持たないため、
  instance 間の social network 形成は yurucommu の責務。 federation は
  fediverse 全体へリーチするためではなく、 プラットフォーム非依存と
  コミュニティ・つながりをサーバーをまたいで繋ぐための手段。
- **Takos との関係**: Takos と隣接する installable app だが、 Takos 専用化しない。単独でも
  self-host 可能 (Takos なしで使える)。

## Workflow

```bash
cd yurucommu-core
bun run check
bun test
bun run lint
bun run fmt
bun run build
bun run pack:core
bun run pack:api
```

## Version discipline

`@takosjp/yurucommu-core` and `@takosjp/yurucommu-api` are published npm
packages, so version bumps are release decisions, not a side effect of repo
reshaping. Patch/minor is the default. A future major publish must set
`YURUCOMMU_ALLOW_MAJOR_VERSION_BUMP=1` and
`YURUCOMMU_MAJOR_VERSION_REASON=<concrete reason>`; `prepublishOnly` rejects a
major bump without that explicit override.

## 関連 docs

- [`README.md`](README.md) — product の方向性と self-host instructions
