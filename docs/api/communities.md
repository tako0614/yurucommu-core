# コミュニティ API

コミュニティ（グループ・掲示板）の作成・管理、チャンネル、招待機能に関する API です。

## コミュニティ基本操作

### GET /communities

コミュニティ一覧を取得します。

**認証**: 必須

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "community-1",
      "name": "Tech Community",
      "icon_url": "https://example.com/media/icon.jpg",
      "visibility": "public",
      "created_by": "user-id",
      "created_at": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

---

### POST /communities

新しいコミュニティを作成します。

**認証**: 必須

**リクエスト**:
```json
{
  "name": "My Community",
  "icon_url": "https://example.com/media/icon.jpg",
  "visibility": "public"
}
```

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "id": "community-id",
    "name": "My Community",
    "created_by": "user-id",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### GET /communities/:id

コミュニティ詳細を取得します。

### PATCH /communities/:id

コミュニティ情報を更新します（オーナーのみ）。

### GET /communities/:id/members

コミュニティメンバー一覧を取得します。

---

## チャンネル管理

### GET /communities/:id/channels

コミュニティのチャンネル一覧を取得します。

### POST /communities/:id/channels

新しいチャンネルを作成します（モデレーター以上）。

### PATCH /communities/:id/channels/:channelId

チャンネル情報を更新します。

### DELETE /communities/:id/channels/:channelId

チャンネルを削除します（オーナーのみ）。

---

## 招待システム

### POST /communities/:id/invites

招待コードを生成します。

**リクエスト**:
```json
{
  "max_uses": 10,
  "expires_at": "2024-12-31T23:59:59.000Z"
}
```

### GET /communities/:id/invites

招待コード一覧を取得します。

### POST /communities/:id/invites/:code/disable

招待コードを無効化します。

### POST /communities/:id/invites/reset

全ての招待コードを無効化します。

### POST /communities/:id/join

招待コードを使用してコミュニティに参加します。

**リクエスト**:
```json
{
  "code": "ABC123"
}
```

---

## 直接招待

### POST /communities/:id/direct-invites

特定のユーザーをコミュニティに直接招待します。

**リクエスト**:
```json
{
  "user_id": "target-user-id"
}
```

### GET /me/invitations

受け取った招待一覧を取得します。

### POST /communities/:id/invitations/accept

招待を受諾してコミュニティに参加します。

### POST /communities/:id/invitations/decline

招待を辞退します。

---

詳細は実装コード（[backend/src/index.ts](../../backend/src/index.ts)）を参照してください。
