# ユーザー API

ユーザープロフィール、検索、フレンド機能に関する API です。

## エンドポイント

### GET /me

現在ログイン中のユーザー情報を取得します。

**認証**: 必須

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "id": "user-id",
    "handle": "alice",
    "display_name": "Alice",
    "avatar_url": "https://example.com/media/avatar.jpg",
    "created_at": "2024-01-01T00:00:00.000Z",
    "is_private": 0,
    "profile_completed_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### PATCH /me

現在のユーザーのプロフィールを更新します。

**認証**: 必須

**リクエスト**:
```json
{
  "display_name": "Alice Smith",
  "avatar_url": "https://example.com/media/new-avatar.jpg",
  "is_private": false
}
```

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "id": "user-id",
    "handle": "alice",
    "display_name": "Alice Smith",
    "avatar_url": "https://example.com/media/new-avatar.jpg",
    "is_private": 0
  }
}
```

**フィールド説明**:
- `display_name`: 表示名（必須）
- `avatar_url`: アバター画像 URL（オプション）
- `is_private`: プライベートアカウント（`true` or `false`）

---

### GET /users

ユーザーを検索します。

**認証**: 必須

**クエリパラメータ**:
- `q`: 検索クエリ（ユーザー名または handle）
- `limit`: 取得件数（デフォルト: 20）

**リクエスト例**:
```
GET /users?q=alice&limit=10
```

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "user-1",
      "handle": "alice",
      "display_name": "Alice",
      "avatar_url": "https://example.com/media/avatar1.jpg"
    },
    {
      "id": "user-2",
      "handle": "alice2",
      "display_name": "Alice Smith",
      "avatar_url": null
    }
  ]
}
```

---

### GET /users/:id

特定のユーザー情報を取得します。

**認証**: 必須

**パスパラメータ**:
- `id`: ユーザー ID または handle

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "id": "user-id",
    "handle": "alice",
    "display_name": "Alice",
    "avatar_url": "https://example.com/media/avatar.jpg",
    "created_at": "2024-01-01T00:00:00.000Z",
    "is_private": 0
  }
}
```

**エラー**:
- `404 Not Found` - ユーザーが見つからない

---

## フレンド機能

### POST /users/:id/friends

ユーザーにフレンドリクエストを送信します。

**認証**: 必須

**パスパラメータ**:
- `id`: フレンドリクエストを送信する相手のユーザー ID

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "id": "friend-request-id",
    "from_user_id": "my-user-id",
    "to_user_id": "target-user-id",
    "status": "pending",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**ActivityPub**: このエンドポイントは自動的に ActivityPub `Follow` アクティビティを送信します。

**エラー**:
- `404 Not Found` - ユーザーが見つからない
- `400 Bad Request` - 既にフレンドまたはリクエスト送信済み

---

### POST /users/:id/friends/accept

受け取ったフレンドリクエストを承認します。

**認証**: 必須

**パスパラメータ**:
- `id`: フレンドリクエストを送信してきたユーザーの ID

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "id": "friend-request-id",
    "from_user_id": "requester-user-id",
    "to_user_id": "my-user-id",
    "status": "accepted",
    "accepted_at": "2024-01-01T00:00:00.000Z"
  }
}
```

**ActivityPub**: このエンドポイントは自動的に ActivityPub `Accept` アクティビティを送信します。

**エラー**:
- `404 Not Found` - フレンドリクエストが見つからない
- `403 Forbidden` - 自分宛てのリクエストではない

---

### POST /users/:id/friends/reject

受け取ったフレンドリクエストを拒否します。

**認証**: 必須

**パスパラメータ**:
- `id`: フレンドリクエストを送信してきたユーザーの ID

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "id": "friend-request-id",
    "status": "rejected"
  }
}
```

**ActivityPub**: このエンドポイントは自動的に ActivityPub `Reject` アクティビティを送信します。

---

### GET /me/friends

現在のユーザーのフレンド一覧を取得します。

**認証**: 必須

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "user-1",
      "handle": "bob",
      "display_name": "Bob",
      "avatar_url": "https://example.com/media/bob.jpg",
      "status": "accepted",
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "user-2",
      "handle": "carol",
      "display_name": "Carol",
      "avatar_url": null,
      "status": "accepted",
      "created_at": "2024-01-02T00:00:00.000Z"
    }
  ]
}
```

---

### GET /me/friend-requests

現在のユーザーが受け取ったフレンドリクエスト一覧を取得します。

**認証**: 必須

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "request-1",
      "from_user_id": "user-3",
      "from_user": {
        "id": "user-3",
        "handle": "dave",
        "display_name": "Dave",
        "avatar_url": null
      },
      "status": "pending",
      "created_at": "2024-01-03T00:00:00.000Z"
    }
  ]
}
```

---

## データモデル

### User

| フィールド | 型 | 説明 |
|----------|---|------|
| `id` | string | ユーザー ID (UUID) |
| `handle` | string | ユーザーハンドル（一意） |
| `display_name` | string | 表示名 |
| `avatar_url` | string \| null | アバター画像 URL |
| `created_at` | string (ISO 8601) | 作成日時 |
| `is_private` | number (0 or 1) | プライベートアカウントフラグ |
| `profile_completed_at` | string \| null | プロフィール完成日時 |

### Friend Request

| フィールド | 型 | 説明 |
|----------|---|------|
| `id` | string | リクエスト ID |
| `from_user_id` | string | 送信者ユーザー ID |
| `to_user_id` | string | 受信者ユーザー ID |
| `status` | string | ステータス (`pending`, `accepted`, `rejected`) |
| `created_at` | string (ISO 8601) | 作成日時 |
| `accepted_at` | string \| null | 承認日時 |

---

## 使用例

### フレンドリクエストの送信と承認

```javascript
// 1. Alice が Bob にフレンドリクエストを送信
const requestResponse = await fetch('https://example.com/users/bob-id/friends', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer alice-token' }
});

// 2. Bob がリクエスト一覧を確認
const requestsResponse = await fetch('https://example.com/me/friend-requests', {
  headers: { 'Authorization': 'Bearer bob-token' }
});

// 3. Bob が Alice のリクエストを承認
const acceptResponse = await fetch('https://example.com/users/alice-id/friends/accept', {
  method: 'POST',
  headers: { 'Authorization': 'Bearer bob-token' }
});

// 4. Alice のフレンド一覧に Bob が表示される
const friendsResponse = await fetch('https://example.com/me/friends', {
  headers: { 'Authorization': 'Bearer alice-token' }
});
```

---

## ActivityPub 統合

フレンド機能は ActivityPub と統合されています：

- **フレンドリクエスト送信** → `Follow` アクティビティ送信
- **リクエスト承認** → `Accept` アクティビティ送信
- **リクエスト拒否** → `Reject` アクティビティ送信

これにより、他の ActivityPub 対応サーバーとのフォロー/フォロワー関係が自動的に同期されます。

詳細は [ActivityPub 仕様](../activitypub.md) を参照してください。
