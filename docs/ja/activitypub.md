---
title: "ActivityPub仕様"
outline: deep
---

# ActivityPub仕様

本章では、インスタンスごとに公開されるActivityPubサーフェスとペイロード契約を定義します。Worker実装で提供される内容を **https://docs.takos.jp** に公開し、Takos配備と外部連携の双方が同じ仕様を参照できるようにします。

以下はTakos固有のルーティング/認証/ペイロード差分のみを列挙します。標準的な振る舞い、シグネチャ要件、ActivityStreamsオブジェクトの基本形は [W3C ActivityPub勧告](https://www.w3.org/TR/activitypub/) を参照し、既存サーバー実装の挙動に従ってください。

## スコープと原則

- すべてのインスタンスでRESTと同じ `INSTANCE_DOMAIN` を再利用します。そのため `https://alice.example.com` のような完全修飾ドメイン配下にActivityPub IDが並びます。
- ディスカバリ（`/.well-known/webfinger`、Actor JSON）は常に公開。プライベートコレクションとオブジェクトはREST APIと同じBearerトークンモデルで保護します。
- インボックスへの書き込みはHTTPシグネチャ必須で、Workerは署名とActor鍵の所有を検証してからアクティビティを保存します。

## ドメイン/アクセス/認証

- `INSTANCE_DOMAIN` にはハンドル＋ドメイン（`alice.example.com`）を含めます。`https://example.com/ap/...` のようなApexアクセスは早期に拒否されます。
- ディスカバリ（`/.well-known/webfinger`、`/ap/users/:handle`、`/ap/groups/:slug`）は常に公開で、プライベートコレクション（`/ap/users/:handle/outbox`、`/ap/stories/:id`、DM/チャンネル）は `/auth/session/token` で払い出すJWTを `platform/src/server/jwt.ts` の `authenticateJWT` で検証します。
- `/ap/inbox` へのPOSTは、投稿Actorの公開鍵で検証できるHTTPシグネチャが必須です。

## ディスカバリとルーティング

### WebFinger

`/.well-known/webfinger` は標準どおり `acct:{handle}@{domain}` を受け取り、Actorエイリアスと `self` リンクを返します。パーサーは `platform/src/activitypub/activitypub-routes.ts` に実装されています。

### Actorエンドポイント

- Person Actorは `GET /ap/users/:handle`、コミュニティActorは `GET /ap/groups/:slug` に配置されます。
- これらは標準のActivityStreams Actorドキュメントをベースにしつつ、Takos固有の差分のみを追加しています。
- すべてのActorが `inbox` / `outbox` とインスタンス固有のコレクションURLを返します。
- `ap_keypairs` に鍵が無い場合は `publicKey` ブロック自体を省略し、ダミー値を返しません。
- `discoverable = false` / `manuallyApprovesFollowers = true` が既定で、管理者が明示的に変更しない限り保持されます。

### Group Actor固有の挙動

- **オーナー鍵の再利用** — `generateGroupActor` はコミュニティ作成者の鍵ペアを `ensureUserKeyPair` で発行し、`publicKey.owner` をGroup URIに設定しつつPEM本体はオーナー由来のものを埋め込みます。オーナーの鍵を更新するとコミュニティActorも更新されます。
- **フォロワー = メンバー** — 承認済みフォロワーをそのままメンバーとして扱い、独自の `members` フィールドは使いません (Lemmy互換)。
- **Followの自動承認** — Group inboxで `Follow` を受信すると所有者のアウトボックスに `Accept` を記録しつつ配送キューに積み、`group:{slug}` 名義で `ap_followers` に `status = "accepted"` として保存します。
- **Inboxゲーティング** — `Follow` 以外のアクティビティは、送信Actorがすでに `status = "accepted"` なフォロワーとして存在しない限り `403` で拒否され、実質的に `Follow` が入室ハンドシェイクになります。
- **非ActivityPubアクセスのリダイレクト** — `/ap/groups/:slug` をブラウザで開くと `/communities/:slug` へリダイレクトし、BotにはJSON、ユーザーにはWebページを提供します。
- **Lemmy互換フィールド** — Group Actor は `@context = ["https://join-lemmy.org/context.json", "https://www.w3.org/ns/activitystreams", ...]` とし、`preferredUsername`、`summary` + `source`、`sensitive`、`postingRestrictedToMods`、`featured`、`icon` / `image`、`publicKey`、`inbox` / `outbox` / `followers` を公開します。

## コレクション

Takosが公開するActivityStreamsコレクションと対応テーブルは次の通りです。

| エンドポイント | バッキングストア | 補足 |
| --- | --- | --- |
| `GET /ap/users/:handle/outbox` | `ap_outbox_activities` | `page` クエリでページング。未指定なら `first` を含むメタデータのみ。 |
| `GET /ap/users/:handle/followers` | `ap_followers` | `OrderedCollectionPage` 形式。 |
| `GET /ap/users/:handle/following` | `ap_following` | フォロワーと同じページング。 |
| `GET /ap/groups/:slug/outbox` | D1上のコミュニティ投稿 | `generateNoteObject` で `Create` にラップ。 |
| `GET /ap/stories/:id` | インスタンス内のストーリーレコード | `toStoryObject` を使用。プライベート可視性はBearerトークン必須。 |
| `GET /ap/dm/:threadId` | `chat_dm_messages` | 直近50件を `OrderedCollection` で返却。要Bearerトークン。 |
| `GET /ap/channels/:communityId/:channelId/messages` | `chat_channel_messages` | 認証済みメンバー向けチャンネルログ。 |

## ストーリー連合

### ストーリーサーフェス

- `GET /ap/stories/:id` はインスタンス境界・所有者・可視性を検証してからシリアライズ済みストーリーを返します。
- REST更新時は `publishStoryCreate` / `publishStoryDelete` を呼び出し、ActivityPub配送を常に最新の状態へ同期させます。

### ストーリーオブジェクト

```json
{
  "@context": [
    "https://www.w3.org/ns/activitystreams",
    "https://docs.takos.jp/ns/activitypub/v1.jsonld"
  ],
  "id": "https://example.com/ap/stories/01HXYZ...",
  "type": "Story",
  "actor": "https://example.com/ap/users/alice",
  "published": "2024-06-24T08:32:41.000Z",
  "expiresAt": "2024-06-25T08:32:41.000Z",
  "visibility": "friends",
  "slides": [
    {
      "type": "StoryImageSlide",
      "media": {
        "type": "Image",
        "mediaType": "image/jpeg",
        "url": "https://cdn.example.com/01HXYZ-cover.jpg",
        "width": 1080,
        "height": 1920
      },
      "alt": "夜明けの東京",
      "durationMs": 5000,
      "order": 0
    },
    {
      "type": "StoryTextSlide",
      "content": "新しいリリースノートを公開しました。",
      "format": "plain",
      "align": "center",
      "backgroundColor": "#101820",
      "durationMs": 5000,
      "order": 1
    },
    {
      "type": "StoryExtensionSlide",
      "extensionType": "takos.canvas",
      "payload": {
        "canvas": {
          "...": "キャンバス構造は Tenant API を参照"
        }
      },
      "durationMs": 5000,
      "order": 2
    }
  ]
}
```

- ActivityStreamsへ `Story` 名前空間（`https://docs.takos.jp/ns/activitypub/v1.jsonld`）を追加します。同一コンテキストで `DirectMessage` / `ChannelMessage` も定義されています。
- `slides` は以下4タイプのいずれかです。
  - `StoryImageSlide` — ActivityStreams `Image` を内包。縦横サイズや alt を付加。
  - `StoryVideoSlide` — ActivityStreams `Video` を内包し、`hasAudio` やポスターURLをオプション指定。
  - `StoryTextSlide` — テキストスライド。整列や色などの軽量な装飾ヒントを含められます。
  - `StoryExtensionSlide` — `takos.canvas` など名前空間付き拡張。ペイロードは任意JSON。
- 既定の `visibility` は `friends`。`public` を指定するとパブリックコレクションへ配送します。

### ファンアウトエンベロープ

`publishStoryCreate` はストーリーを `Create` アクティビティでラップします。

```json
{
  "@context": "https://www.w3.org/ns/activitystreams",
  "type": "Create",
  "id": "https://example.com/ap/activities/01HXYZ...",
  "actor": "https://example.com/ap/users/alice",
  "to": [
    "https://example.com/ap/users/alice/followers"
  ],
  "object": {
    "...": "上記のストーリーペイロード"
  }
}
```

スライド共通仕様:

- `durationMs`: 1500〜60000ms の範囲で再生時間を指定。
- `order`: 未指定の場合は配列順。
- `StoryExtensionSlide` の `extensionType` は `org.example.feature` のようにドメインベースで命名してください。`takos.canvas` は既存のDOMキャンバス互換拡張です。

## メッセージングサーフェス

Takosは `platform/src/activitypub/chat.ts` のヘルパーでDMとチャンネル会話を連合配信します。両方のアクティビティが `https://docs.takos.jp/ns/activitypub/v1.jsonld` を `@context` に含め、語彙を共通化しています。

### DM

- `sendDirectMessage` がアクティビティ生成→配送→ローカル保存を担当。
- `GET /ap/dm/:threadId` は直近50件の `OrderedCollection`（Bearerトークン必須）。
- スレッド宛の受信 `Create` アクティビティは `handleIncomingDm` が検証→保存→REST公開まで行います。

### チャンネル

- チャンネルID: `https://{domain}/ap/channels/{communityId}/{channelId}`。
- `sendChannelMessage` が `object.type = "ChannelMessage"` の `Create` を発行し、レコードを保存（`channel` エイリアスや `Note` フォールバックは廃止）。
- `GET /ap/channels/:communityId/:channelId/messages` は認証済みメンバー向けの時系列ログ。
- `handleIncomingChannelMessage` がリモートメッセージを保存後、REST経由で公開します。

## 運用メモ

- すべてのレスポンスは `activityPubResponse` で `Content-Type: application/activity+json` を強制します。
- データストアのハンドルは `releaseStore` で解放し、D1接続リークを防止します（`activitypub-routes.ts` 参照）。
- `platform/src/activitypub/story-publisher.ts` のヘルパーは共有キュー `enqueueActivity` に積むことで再試行ポリシーを一元化します。
