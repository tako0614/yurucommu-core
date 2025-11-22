# 通知 API

通知の取得、既読管理、プッシュ通知設定に関する API です。

## 通知管理

### GET /notifications

現在のユーザーの通知一覧を取得します。

**認証**: 必須

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "notification-1",
      "user_id": "my-user-id",
      "type": "friend_request",
      "actor_id": "user-2",
      "ref_type": "user",
      "ref_id": "user-2",
      "message": "Alice さんからフレンドリクエストが届きました",
      "created_at": "2024-01-01T00:00:00.000Z",
      "read": 0
    },
    {
      "id": "notification-2",
      "type": "like",
      "actor_id": "user-3",
      "ref_type": "post",
      "ref_id": "post-id",
      "message": "Bob さんがあなたの投稿にリアクションしました",
      "created_at": "2024-01-01T00:01:00.000Z",
      "read": 0
    },
    {
      "id": "notification-3",
      "type": "comment",
      "actor_id": "user-4",
      "ref_type": "post",
      "ref_id": "post-id",
      "message": "Carol さんがあなたの投稿にコメントしました",
      "created_at": "2024-01-01T00:02:00.000Z",
      "read": 1
    }
  ]
}
```

**通知タイプ**:
- `friend_request`: フレンドリクエスト受信
- `friend_accepted`: フレンドリクエスト承認
- `like`: 投稿へのリアクション
- `comment`: 投稿へのコメント
- `mention`: メンション
- `community_invite`: コミュニティ招待

---

### POST /notifications/:id/read

通知を既読にします。

**認証**: 必須

**パスパラメータ**:
- `id`: 通知 ID

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "id": "notification-1",
    "read": true,
    "unread_count": 5
  }
}
```

---

## プッシュ通知

### POST /me/push-devices

プッシュ通知デバイスを登録します。

**認証**: 必須

**リクエスト**:
```json
{
  "token": "fcm-token-abc123...",
  "platform": "ios",
  "device_name": "iPhone 14 Pro",
  "locale": "ja"
}
```

**フィールド説明**:
- `token`: FCM トークンまたはデバイストークン（必須）
- `platform`: プラットフォーム（`ios`, `android`, `web` 等）
- `device_name`: デバイス名（オプション）
- `locale`: ロケール（オプション、デフォルト: `ja`）

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "user_id": "user-id",
    "token": "fcm-token-abc123...",
    "platform": "ios",
    "device_name": "iPhone 14 Pro",
    "locale": "ja",
    "created_at": "2024-01-01T00:00:00.000Z"
  }
}
```

---

### DELETE /me/push-devices

プッシュ通知デバイスを削除します。

**認証**: 必須

**クエリパラメータ**:
- `token`: 削除するデバイストークン

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "message": "device removed"
  }
}
```

---

## GET /me/communities

現在のユーザーが参加しているコミュニティ一覧を取得します。

**認証**: 必須

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "community-1",
      "name": "Tech Community",
      "role": "owner",
      "joined_at": "2024-01-01T00:00:00.000Z"
    },
    {
      "id": "community-2",
      "name": "Gaming Community",
      "role": "member",
      "joined_at": "2024-01-02T00:00:00.000Z"
    }
  ]
}
```

---

## データモデル

### Notification

| フィールド | 型 | 説明 |
|----------|---|------|
| `id` | string | 通知 ID (UUID) |
| `user_id` | string | 通知受信者ユーザー ID |
| `type` | string | 通知タイプ |
| `actor_id` | string | 通知を発生させたユーザー ID |
| `ref_type` | string | 参照先のタイプ（`post`, `user`, `community` 等） |
| `ref_id` | string | 参照先 ID |
| `message` | string | 通知メッセージ |
| `created_at` | string (ISO 8601) | 作成日時 |
| `read` | number (0 or 1) | 既読フラグ |

### Push Device

| フィールド | 型 | 説明 |
|----------|---|------|
| `user_id` | string | ユーザー ID |
| `token` | string | プッシュトークン（FCM/APNS） |
| `platform` | string | プラットフォーム（`ios`, `android`, `web`） |
| `device_name` | string \| null | デバイス名 |
| `locale` | string \| null | ロケール |
| `created_at` | string (ISO 8601) | 登録日時 |

---

## プッシュ通知の仕組み

takos は以下の3つのプッシュ配信方式をサポートします：

1. **FCM 直接配信** (推奨)
   - Firebase Cloud Messaging を使用
   - 環境変数 `FCM_SERVER_KEY` で設定

2. **独自 Push Gateway 経由**
   - カスタム Push Gateway サーバーを使用
   - 環境変数 `PUSH_GATEWAY_URL`, `PUSH_WEBHOOK_SECRET` で設定

3. **デフォルト Push サービス**
   - フォールバック用デフォルトサービス
   - `DEFAULT_PUSH_SERVICE_URL` で設定（オプション）

詳細は [プッシュ通知サービス仕様](../push-service.md) を参照してください。

---

## 使用例

### 通知の取得と既読化

```javascript
// 1. 通知一覧取得
const notificationsResponse = await fetch('https://example.com/notifications', {
  headers: { 'Authorization': 'Bearer token' }
});
const { data: notifications } = await notificationsResponse.json();

// 2. 未読通知を既読にする
for (const notification of notifications) {
  if (!notification.read) {
    await fetch(`https://example.com/notifications/${notification.id}/read`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer token' }
    });
  }
}
```

### プッシュ通知登録

```javascript
// FCM トークン取得（Firebase SDK）
const messaging = firebase.messaging();
const token = await messaging.getToken();

// takos にデバイス登録
const registerResponse = await fetch('https://example.com/me/push-devices', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    token: token,
    platform: 'web',
    device_name: navigator.userAgent
  })
});
```

---

## 通知トリガー

以下のイベントで自動的に通知が生成されます：

- フレンドリクエスト受信
- フレンドリクエスト承認
- 投稿へのリアクション（自分の投稿）
- 投稿へのコメント（自分の投稿）
- コミュニティ招待受信
- メンション（今後実装予定）

通知生成ロジックは [backend/src/lib/notifications.ts](../../backend/src/lib/notifications.ts) を参照してください。
