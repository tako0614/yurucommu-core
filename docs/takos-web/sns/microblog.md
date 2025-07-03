# Microblog API

エンドポイント `/api/microblog` を利用して簡単なテキスト投稿ができます。

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
    "createdAt": "2025-01-01T00:00:00.000Z"
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
