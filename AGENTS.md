# AGENTS.md — yurucommu

`yurucommu` は **self-hosted ActivityPub / community social app** で、
自分のドメイン / 自分のデータ / 小さなコミュニティ
単位のつながりを前提に設計された独立 product。 Takos distribution は新規 space
作成時に bundled 1st-party app として Takosumi 上へ auto-install するが、
product root は独立管理で Takos core には吸収しない。

## 責務

### 持つ

- ActivityPub federation (Mastodon / Misskey 系との相互接続)
- single-user federated social (self-hosted、 small-community focus)
- Cloudflare ベースの低コスト self-host runtime
- custom domain support
- yurucommu 自身の content distribution と user identity (app 層で完結)

### 持たない

- Takos core service との直接 implementation 連携 (consumer 側として通常の
  Installation flow を経由)
- Takosumi platform 層の federation 責任 (federation は yurucommu 自身が
  ActivityPub で実装する)
- Takos product 固有の chat / agent / memory primitive

## 隣接 product との contract

- **Bundled app**: Takos distribution が新規 space 作成時に Takosumi 上へ
  auto-install する通常 Installation (consumer 立場)
- **Upstream**: Takosumi Accounts OIDC consumer (operator-owned external
  publication / OIDC discovery で issuer を解決)、 Takos public API
- **Downstream**: ActivityPub federated network (他の Mastodon / Misskey
  instance と相互接続)
- **Independence**: Takos core には吸収しない、 product root として独立を保つ

## Substitutability / Federation

- **App-level federation**: yurucommu 自身が ActivityPub で federation
  を実装する。 Takosumi platform 層で federate する仕組みは持たないため、
  instance 間の social network 形成は yurucommu の責務。
- **Takos との関係**: Takos の bundled app だが、 Takos 専用化しない。単独でも
  self-host 可能 (Takos なしで使える)。

## Workflow

```bash
cd yurucommu
deno task check
deno task test
deno task lint
deno task fmt:check
deno task deploy   # Cloudflare deploy
```

## 関連 docs

- [`README.md`](README.md) — product の方向性と self-host instructions
