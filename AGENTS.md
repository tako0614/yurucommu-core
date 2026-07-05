# AGENTS.md — yurucommu-core

`yurucommu-core` は **個人が自分のために立てる self-hosted ActivityPub SNS** の
server / ActivityPub / API / Capsule repo で、
自分のドメイン / 自分のデータ を前提に設計された独立 product。 アルゴリズムにも
プラットフォームにも依存しない、 個人運用のインスタンス。 到達範囲 (reach) の単位は
コミュニティ (グループ) であり、 fediverse 全体に届くことを目的とはしない。
community (+ follow graph) は到達範囲を広げる手段で、 範囲はコミュニティ単位に
保たれる (大規模 SNS の薄い繋がりではなく濃い繋がり)。 federation は目的ではなく
手段 / substrate で、 (a) プラットフォーム非依存 (凍結・サービス終了からの独立) と
(b) コミュニティやつながりをサーバーをまたいで繋ぐためにある。 community / group は
headline の主語ではなく、 個人インスタンス上の機能として位置づける。 主要コンテンツは
Note (投稿。 ActivityPub の Note オブジェクト。 UI ラベルは「投稿 / Post」) /
Messaging (DM。 実体は direct-addressed な Note) / Story (ephemeral) の 3 つ。
Takosumi 上ではユーザーが選んで install する通常の Capsule として扱われ、
product root は独立管理で Takos core には吸収しない。

`yurucommu-core` は server Capsule / API contract の正本であり、外向きの
公式 client family ではない。 `yurucommu` repo は feed / story / profile 中心の
公式 client brand、 `Yurumeet` repo は同じ server を LINE 風のトーク UI で使う client brand として扱う。
`yurume` は Yurumeet の client id / 略称として使う。
Takosumi は server/client の Output-to-input 接続と Run / StateVersion / Output /
Audit を扱うだけで、 yurucommu / Yurumeet を特権的な公式 app として扱わない。

## 責務

### 持つ

- ActivityPub federation (Mastodon / Misskey 系との相互接続)
- single-user federated social (self-hosted、 small-community focus)
- yurucommu-server API (actor / post / story / DM / community / media / notification)
- `@takosjp/yurucommu-api` npm package (client repo / mobile shell が使う typed API SDK)
- Yurumeet / mobile / alternate web clients が接続するための discovery output と API contract
- Cloudflare ベースの低コスト self-host runtime
- custom domain support
- yurucommu 自身の content distribution と user identity (app 層で完結)

### 持たない

- Takos core service との直接 implementation 連携 (consumer 側として通常の
  Capsule install flow を経由)
- Takosumi platform 層の federation 責任 (federation は yurucommu 自身が
  ActivityPub で実装する)
- Takos product 固有の chat / agent / memory primitive
- Takosumi-owned official client catalog / official app privilege

## 隣接 product との contract

- **Installable app**: Takosumi 上でユーザーが明示的に追加する通常 Capsule (consumer 立場)
- **Upstream**: Takosumi Accounts OIDC consumer (operator-owned external
  publication / OIDC discovery で issuer を解決)、 Takos public API
- **Downstream**: ActivityPub federated network (他の Mastodon / Misskey
  instance と相互接続)
- **Client brands**: `yurucommu` repo は feed-first、 `Yurumeet` (`yurume`) repo は talk-first。
  どちらも同じ yurucommu-server の actor / DM / community / ActivityPub API を使う
- **Client SDK**: client / mobile repo は yurucommu-server repo の内部 path を import せず、
  `@takosjp/yurucommu-api` と server Capsule outputs / `/.well-known/social-server` を使う
- **Repo topology**: この repo は server Capsule / ActivityPub / typed SDK を所有し、公式
  yurucommu client、Yurumeet、mobile shell の source は別 repo に置く。ローカル確認用 checkout を
  `clients/` に置くことはできるが、 commit 対象にはしない
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
```

## 関連 docs

- [`README.md`](README.md) — product の方向性と self-host instructions
