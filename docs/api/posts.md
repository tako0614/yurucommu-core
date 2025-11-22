# 投稿 API

テキスト・メディア投稿、リアクション、コメントに関する API です。

## エンドポイント

### POST /posts

グローバル投稿を作成します。

**認証**: 必須

**リクエスト**:
```json
{
  "type": "text",
  "text": "Hello, world!",
  "media": ["https://example.com/media/image1.jpg"],
  "audience": "all",
  "visible_to_friends": true
}
```

**フィールド説明**:
- `type`: 投稿タイプ（`text`, `image`, `video` 等、デフォルト: `text`）
- `text`: 投稿本文（テキストまたはメディアが必須）
- `media`: メディア URL の配列（オプション）
- `audience`: 公開範囲（`all` または `community`、デフォルト: `all`）
- `visible_to_friends`: フレンド限定表示（デフォルト: `true`）

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "id": "post-id",
    "author_id": "user-id",
    "community_id": null,
    "type": "text",
    "text": "Hello, world!",
    "media_urls": ["https://example.com/media/image1.jpg"],
    "created_at": "2024-01-01T00:00:00.000Z",
    "pinned": 0,
    "broadcast_all": 1,
    "visible_to_friends": 1,
    "ap_object_id": "https://example.com/ap/objects/post-id",
    "ap_activity_id": "https://example.com/ap/activities/create-post-id"
  }
}
```

**ActivityPub**: このエンドポイントは自動的に ActivityPub `Create` アクティビティを送信し、フォロワーに配信されます。

---

### POST /communities/:id/posts

コミュニティ内に投稿を作成します。

**認証**: 必須

**パスパラメータ**:
- `id`: コミュニティ ID

**リクエスト**:
```json
{
  "type": "text",
  "text": "Community post",
  "media": [],
  "audience": "community"
}
```

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "id": "post-id",
    "community_id": "community-id",
    "author_id": "user-id",
    "type": "text",
    "text": "Community post",
    "media_urls": [],
    "created_at": "2024-01-01T00:00:00.000Z",
    "broadcast_all": 0,
    "attributed_community_id": "community-id"
  }
}
```

**エラー**:
- `404 Not Found` - コミュニティが見つからない
- `403 Forbidden` - コミュニティのメンバーではない

---

### GET /posts

グローバル投稿一覧を取得します（認証ユーザーのタイムライン）。

**認証**: 必須

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "post-1",
      "author_id": "user-1",
      "text": "Latest post",
      "media_urls": [],
      "created_at": "2024-01-02T00:00:00.000Z"
    },
    {
      "id": "post-2",
      "author_id": "user-2",
      "text": "Another post",
      "media_urls": ["https://example.com/media/image.jpg"],
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**ソート**: 作成日時の降順（最新が先頭）

---

### GET /communities/:id/posts

コミュニティ内の投稿一覧を取得します。

**認証**: 必須

**パスパラメータ**:
- `id`: コミュニティ ID

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "post-1",
      "community_id": "community-id",
      "author_id": "user-1",
      "text": "Community post",
      "pinned": 1,
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**ソート**: ピン留め投稿が先頭、その後作成日時の降順

**エラー**:
- `404 Not Found` - コミュニティが見つからない
- `403 Forbidden` - コミュニティのメンバーではない

---

## リアクション

### POST /posts/:id/reactions

投稿にリアクション（いいね）を追加します。

**認証**: 必須

**パスパラメータ**:
- `id`: 投稿 ID

**リクエスト**:
```json
{
  "emoji": "👍"
}
```

**フィールド説明**:
- `emoji`: リアクション絵文字（デフォルト: `👍`）

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "id": "reaction-id",
    "post_id": "post-id",
    "user_id": "user-id",
    "emoji": "👍",
    "created_at": "2024-01-01T00:00:00.000Z",
    "ap_activity_id": "https://example.com/ap/activities/like-reaction-id"
  }
}
```

**ActivityPub**: このエンドポイントは自動的に ActivityPub `Like` アクティビティを送信します（Misskey 互換の絵文字リアクション対応）。

**通知**: 投稿者（自分以外）に通知が送信されます。

**エラー**:
- `404 Not Found` - 投稿が見つからない
- `403 Forbidden` - 投稿を閲覧する権限がない

---

### GET /posts/:id/reactions

投稿のリアクション一覧を取得します。

**認証**: 必須

**パスパラメータ**:
- `id`: 投稿 ID

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "reaction-1",
      "post_id": "post-id",
      "user_id": "user-1",
      "emoji": "👍",
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "reaction-2",
      "post_id": "post-id",
      "user_id": "user-2",
      "emoji": "❤️",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### GET /communities/:id/reactions-summary

コミュニティ内の全投稿のリアクションを取得します。

**認証**: 必須

**パスパラメータ**:
- `id`: コミュニティ ID

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "post-id-1": [
      {
        "id": "reaction-1",
        "post_id": "post-id-1",
        "user_id": "user-1",
        "emoji": "👍"
      }
    ],
    "post-id-2": [
      {
        "id": "reaction-2",
        "post_id": "post-id-2",
        "user_id": "user-2",
        "emoji": "❤️"
      }
    ]
  }
}
```

**エラー**:
- `404 Not Found` - コミュニティが見つからない
- `403 Forbidden` - コミュニティのメンバーではない

---

## コメント

### POST /posts/:id/comments

投稿にコメントを追加します。

**認証**: 必須

**パスパラメータ**:
- `id`: 投稿 ID

**リクエスト**:
```json
{
  "text": "Great post!"
}
```

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "id": "comment-id",
    "post_id": "post-id",
    "author_id": "user-id",
    "text": "Great post!",
    "created_at": "2024-01-01T00:00:00.000Z",
    "ap_object_id": "https://example.com/ap/objects/comment-id",
    "ap_activity_id": "https://example.com/ap/activities/create-comment-id"
  }
}
```

**ActivityPub**: このエンドポイントは自動的に ActivityPub `Create` アクティビティを送信します（`inReplyTo` フィールド付き `Note` オブジェクト）。

**通知**: 投稿者（自分以外）に通知が送信されます。

**エラー**:
- `400 Bad Request` - `text` フィールドが空
- `404 Not Found` - 投稿が見つからない
- `403 Forbidden` - 投稿を閲覧する権限がない

---

### GET /posts/:id/comments

投稿のコメント一覧を取得します。

**認証**: 必須

**パスパラメータ**:
- `id`: 投稿 ID

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "comment-1",
      "post_id": "post-id",
      "author_id": "user-1",
      "text": "First comment",
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "comment-2",
      "post_id": "post-id",
      "author_id": "user-2",
      "text": "Second comment",
      "created_at": "2024-01-01T00:00:01.000Z"
    }
  ]
}
```

**ソート**: 作成日時の降順（最新が先頭）

---

## データモデル

### Post

| フィールド | 型 | 説明 |
|----------|---|------|
| `id` | string | 投稿 ID (UUID) |
| `author_id` | string | 投稿者ユーザー ID |
| `community_id` | string \| null | コミュニティ ID（グローバル投稿の場合は `null`） |
| `type` | string | 投稿タイプ（`text`, `image`, `video` 等） |
| `text` | string | 投稿本文 |
| `media_urls` | string[] | メディア URL の配列 |
| `created_at` | string (ISO 8601) | 作成日時 |
| `pinned` | number (0 or 1) | ピン留めフラグ |
| `broadcast_all` | number (0 or 1) | 全体公開フラグ |
| `visible_to_friends` | number (0 or 1) | フレンド限定フラグ |
| `attributed_community_id` | string \| null | 帰属コミュニティ ID |
| `ap_object_id` | string | ActivityPub オブジェクト ID |
| `ap_activity_id` | string | ActivityPub アクティビティ ID |

### Reaction

| フィールド | 型 | 説明 |
|----------|---|------|
| `id` | string | リアクション ID (UUID) |
| `post_id` | string | 投稿 ID |
| `user_id` | string | リアクションしたユーザー ID |
| `emoji` | string | リアクション絵文字 |
| `created_at` | string (ISO 8601) | 作成日時 |
| `ap_activity_id` | string | ActivityPub アクティビティ ID |

### Comment

| フィールド | 型 | 説明 |
|----------|---|------|
| `id` | string | コメント ID (UUID) |
| `post_id` | string | 投稿 ID |
| `author_id` | string | コメント投稿者 ID |
| `text` | string | コメント本文 |
| `created_at` | string (ISO 8601) | 作成日時 |
| `ap_object_id` | string | ActivityPub オブジェクト ID |
| `ap_activity_id` | string | ActivityPub アクティビティ ID |

---

## 使用例

### 投稿作成からリアクション・コメントまで

```javascript
// 1. 投稿作成
const postResponse = await fetch('https://example.com/posts', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    text: 'Check out this photo!',
    media: ['https://example.com/media/photo.jpg']
  })
});
const { data: post } = await postResponse.json();

// 2. リアクション追加
const reactionResponse = await fetch(`https://example.com/posts/${post.id}/reactions`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ emoji: '❤️' })
});

// 3. コメント追加
const commentResponse = await fetch(`https://example.com/posts/${post.id}/comments`, {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ text: 'Nice photo!' })
});

// 4. 投稿のリアクション一覧取得
const reactionsResponse = await fetch(`https://example.com/posts/${post.id}/reactions`, {
  headers: { 'Authorization': 'Bearer token' }
});

// 5. 投稿のコメント一覧取得
const commentsResponse = await fetch(`https://example.com/posts/${post.id}/comments`, {
  headers: { 'Authorization': 'Bearer token' }
});
```

---

## ActivityPub 統合

投稿機能は ActivityPub と完全に統合されています：

- **投稿作成** → `Create` アクティビティ（`Note` オブジェクト）
- **リアクション** → `Like` アクティビティ（Misskey 互換絵文字リアクション）
- **コメント** → `Create` アクティビティ（`inReplyTo` 付き `Note` オブジェクト）

これにより、他の ActivityPub 対応サーバー（Mastodon, Misskey, Lemmy 等）と自動的に連携します。

詳細は [ActivityPub 仕様](../activitypub.md) を参照してください。
