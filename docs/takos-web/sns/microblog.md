# Microblog API

エンドポイント `/api/microblog` を利用して簡単なテキスト投稿ができます。
フロントエンドでは投稿の作成だけでなく、編集や削除も行えます。

## 投稿取得

```
GET /api/microblog
```

全ての投稿を新しい順で返します。

### レスポンス例

```json
[
  {
    "id": "<id>",
    "author": "user",
    "content": "hello",
    "createdAt": "2025-01-01T00:00:00.000Z",
    "likes": 0,
    "retweets": 0
  }
]
```

## 投稿作成

```
POST /api/microblog
```

```json
{
  "author": "user",
  "content": "hello"
}
```

### レスポンス

作成された投稿を返します。

## 投稿更新

```
PUT /api/microblog/:id
```

```json
{
  "content": "edited"
}
```

## 投稿削除

```
DELETE /api/microblog/:id
```

削除に成功すると `{ "success": true }` を返します。

## いいね

```
POST /api/microblog/:id/like
```

指定した投稿のいいね数を1増やします。レスポンスは更新後の`likes`数です。

## リツイート

```
POST /api/microblog/:id/retweet
```

リツイート数を1増やします。レスポンスは更新後の`retweets`数です。

## ActivityPub 配信

作成した投稿は ActivityPub 経由でフォロワーのサーバーへ配信されます。
外部から受信した ActivityPub オブジェクトは `/users/:username/inbox` に
送られ、`ActivityPubObject` コレクションに `inboxUser` フィールド付きで
保存されます。
