# takosとは

> **言語について**: README
> とドキュメントは日本語版のみ提供されています。(English version is not
> available yet)

takosはActivityPubでweb自主するためのソフトウェアです。
takosは、ActivityPubに追加で、以下の機能を提供します。

このソフトウェアは、1人のユーザが、他のユーザとコミュニケーションを取るためのものです。
基本的に同一ドメインのユーザーは同一人物です。(サブアカウントなど)

## 🔧 技術スタック

**言語/ランタイム**: TypeScript/Deno\
**バックエンドフレームワーク**: Hono\
**フロントエンドフレームワーク**: Solid.js/tauri\
**データベース**: mongodb mongoose

## 🚀 GET started(backend)

環境変数を設定したら、`app/api` ディレクトリからサーバーを起動します。

特に `ACTIVITYPUB_DOMAIN` は Mastodon など外部からアクセスされる公開ドメインを
設定してください。未設定の場合はリクエストされたホスト名が利用されます。
リレーサーバーの設定は UI から追加・削除でき、データベースに保存されます。

```bash
cd app/api
deno task dev
```

## ActivityPub エンドポイント

サーバーを起動すると以下の ActivityPub API が利用できます。

- `/.well-known/webfinger` – WebFinger でアクターを検索
- `/users/:username` – `Person` アクター情報を JSON-LD で返します
- `/users/:username/outbox` – `Note` の投稿と取得
- `/users/:username/inbox` – ActivityPub 受信エンドポイント。`Create` Activity
  の場合はオブジェクトを `ActivityPubObject` として保存し、他の Activity
  は保存せず処理のみ行います。処理は Activity タイプごとにハンドラー化し、
  新しい Activity を追加しやすくしています。
- `/inbox` – サイト全体の共有 inbox。`to` などにローカルアクターが含まれる
  Activity をそれぞれの inbox 処理へ振り分けます。

`outbox` へ `POST` すると以下の形式でノートを作成できます。

```json
{
  "type": "Note",
  "content": "hello"
}
```

## Microblog API

簡単なテキスト投稿を行う `/api/microblog` エンドポイントも利用できます。

- `GET /api/microblog` – 投稿を新しい順で取得
- `POST /api/microblog` – 投稿を作成
  (`{ "author": "user", "content": "hello" }`)
- `PUT /api/microblog/:id` – 投稿を更新 (`{ "content": "edited" }`)
- `DELETE /api/microblog/:id` – 投稿を削除
- `POST /api/microblog/:id/like` – いいねを追加
- `POST /api/microblog/:id/retweet` – リツイートを追加

## 動画 API

ActivityPub の `Video` オブジェクトを利用して動画を投稿できます。

- `GET /api/videos` – 動画一覧を取得
- `POST /api/videos` – 動画を作成するとフォロワーへ `Create` Activity を配信
- `POST /api/videos/:id/like` – いいね数を増加
- `POST /api/videos/:id/view` – 再生数を増加

## グループ機能

takos では ActivityPub の Group
アクターを利用して複数ユーザーで投稿を共有できます。グループアクターは
`GET /communities/:name` で取得できます。

### WebFinger での発見例

`!team@takos.example` を検索する場合は次のようにリクエストします。

```bash
curl "https://takos.example/.well-known/webfinger?resource=acct:!team@takos.example"
```

レスポンス例:

```json
{
  "subject": "acct:!team@takos.example",
  "links": [
    {
      "rel": "self",
      "type": "application/activity+json",
      "href": "https://takos.example/communities/team"
    }
  ]
}
```

### 参加 (Follow) 手順

1. `/communities/:name/inbox` へ `Follow` Activity を送信します。
2. 非公開グループでは `pendingFollowers`
   に追加され、承認後フォロワーとなります。公開グループの場合はすぐに `Accept`
   が返送され `followers` に登録されます。

### 投稿から `Announce` 配信まで

1. フォロワーが `Create` Activity をグループの `inbox`
   に送信すると投稿オブジェクトが保存されます。
2. グループはその投稿を対象とした `Announce` Activity
   を生成し、フォロワーへ配信します。
3. フォロワーは受信した `Announce` から投稿を取得できます。
4. `outbox` や `followers` コレクションは `?page=1` のようにページ指定
   で順次取得可能です。

### モデレーション API

- `POST /api/communities/:communityId/posts/:postId/remove`
  グループ管理者が投稿を削除し、`Remove` Activity を配信します。
- `POST /api/communities/:id/block` 特定ユーザーを BAN し、`Block` Activity
  を送信します。
- `GET  /api/communities/:id/pending-followers` 未承認フォロワー一覧を取得。
- `POST /api/communities/:id/pending-followers/approve` 承認して `Accept`
  を送信。
  - `POST /api/communities/:id/pending-followers/reject` フォロー申請を拒否。

## クライアントでのデータ保存

チャット機能で利用するMLS関連データは、ブラウザのIndexedDBに保存します。データベースは
アカウントIDごとに分割されており、別アカウントの情報が混在しないようになっています。
