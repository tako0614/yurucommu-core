# チャット API

ダイレクトメッセージ（DM）とチャンネルメッセージに関する API です。

## ダイレクトメッセージ（DM）

### POST /dm/send

ダイレクトメッセージを送信します。

**認証**: 必須

**リクエスト**:
```json
{
  "recipients": ["https://example.com/ap/users/bob"],
  "content": "Hello, Bob!",
  "in_reply_to": "https://example.com/ap/dm/thread-id/message-id"
}
```

**フィールド説明**:
- `recipients`: 宛先の ActivityPub Actor URI 配列（必須）
- `recipient`: 単一宛先の場合（`recipients` の代わりに使用可能）
- `content`: メッセージ本文（必須）
- `in_reply_to`: 返信先メッセージ ID（オプション）

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "threadId": "thread-id",
    "activity": {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "actor": "https://example.com/ap/users/alice",
      "to": ["https://example.com/ap/users/bob"],
      "object": {
        "type": "Note",
        "id": "https://example.com/ap/dm/thread-id/message-id",
        "content": "Hello, Bob!",
        "context": "https://example.com/ap/dm/thread-id"
      }
    }
  }
}
```

**ActivityPub**: このエンドポイントは自動的に ActivityPub `Create` アクティビティを宛先に配信します。

**エラー**:
- `400 Bad Request` - `recipients` または `content` が不正

---

### GET /dm/threads

認証ユーザーの DM スレッド一覧を取得します。

**認証**: 必須

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "thread-1",
      "participants": [
        "https://example.com/ap/users/alice",
        "https://example.com/ap/users/bob"
      ],
      "created_at": "2024-01-01T00:00:00.000Z",
      "latest_message": {
        "id": "message-id",
        "thread_id": "thread-1",
        "author_id": "https://example.com/ap/users/bob",
        "content_html": "Hi Alice!",
        "created_at": "2024-01-01T00:01:00.000Z"
      }
    }
  ]
}
```

---

### GET /dm/threads/:threadId/messages

特定の DM スレッドのメッセージ一覧を取得します。

**認証**: 必須

**パスパラメータ**:
- `threadId`: DM スレッド ID

**クエリパラメータ**:
- `limit`: 取得件数（デフォルト: 50、最大: 100）

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "type": "Note",
      "id": "https://example.com/ap/dm/thread-id/message-1",
      "attributedTo": "https://example.com/ap/users/alice",
      "content": "Hello!",
      "published": "2024-01-01T00:00:00.000Z",
      "context": "https://example.com/ap/dm/thread-id"
    },
    {
      "type": "Note",
      "id": "https://example.com/ap/dm/thread-id/message-2",
      "attributedTo": "https://example.com/ap/users/bob",
      "content": "Hi!",
      "published": "2024-01-01T00:00:01.000Z",
      "context": "https://example.com/ap/dm/thread-id",
      "inReplyTo": "https://example.com/ap/dm/thread-id/message-1"
    }
  ]
}
```

**ソート**: 作成日時の降順（最新が先頭）

**エラー**:
- `404 Not Found` - スレッドが見つからない
- `403 Forbidden` - スレッドの参加者ではない

---

### GET /dm/with/:handle

特定ユーザーとの DM スレッドを取得または作成します。

**認証**: 必須

**パスパラメータ**:
- `handle`: 相手ユーザーの handle

**クエリパラメータ**:
- `limit`: 取得件数（デフォルト: 50）

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "threadId": "thread-id",
    "messages": [
      {
        "id": "message-id",
        "thread_id": "thread-id",
        "author_id": "https://example.com/ap/users/alice",
        "content_html": "Hello!",
        "created_at": "2024-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

**動作**: スレッドが存在しない場合、自動的に作成されます。

---

## チャンネルメッセージ

### GET /communities/:id/channels/:channelId/messages

コミュニティチャンネルのメッセージ一覧を取得します。

**認証**: 必須

**パスパラメータ**:
- `id`: コミュニティ ID
- `channelId`: チャンネル ID

**クエリパラメータ**:
- `limit`: 取得件数（デフォルト: 50）

**レスポンス** (200):
```json
{
  "ok": true,
  "data": [
    {
      "id": "https://example.com/ap/channels/community-id/channel-id/messages/msg-1",
      "type": "Note",
      "content": "Hello channel!",
      "attributedTo": "https://example.com/ap/users/alice",
      "context": "https://example.com/ap/channels/community-id/channel-id",
      "published": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

**エラー**:
- `404 Not Found` - コミュニティまたはチャンネルが見つからない
- `403 Forbidden` - コミュニティのメンバーではない

---

### POST /communities/:id/channels/:channelId/messages

コミュニティチャンネルにメッセージを送信します。

**認証**: 必須

**パスパラメータ**:
- `id`: コミュニティ ID
- `channelId`: チャンネル ID

**リクエスト**:
```json
{
  "content": "Hello channel!",
  "recipients": ["https://remote.example.com/ap/users/guest"],
  "in_reply_to": "https://example.com/ap/channels/community-id/channel-id/messages/msg-1"
}
```

**フィールド説明**:
- `content`: メッセージ本文（必須）
- `recipients`: 追加の宛先（オプション、リモートユーザーへの通知等）
- `in_reply_to`: 返信先メッセージ ID（オプション）

**レスポンス** (201):
```json
{
  "ok": true,
  "data": {
    "activity": {
      "@context": "https://www.w3.org/ns/activitystreams",
      "type": "Create",
      "actor": "https://example.com/ap/users/alice",
      "to": ["https://example.com/ap/channels/community-id/channel-id"],
      "object": {
        "type": "Note",
        "content": "Hello channel!",
        "context": "https://example.com/ap/channels/community-id/channel-id"
      }
    }
  }
}
```

**ActivityPub**: このエンドポイントは自動的に ActivityPub `Create` アクティビティを配信します。

**エラー**:
- `400 Bad Request` - `content` が空
- `404 Not Found` - コミュニティまたはチャンネルが見つからない
- `403 Forbidden` - コミュニティのメンバーではない

---

## データモデル

### DM Thread

| フィールド | 型 | 説明 |
|----------|---|------|
| `id` | string | スレッド ID（参加者ハッシュ） |
| `participants` | string[] | 参加者の ActivityPub Actor URI 配列 |
| `participants_hash` | string | 参加者の正規化ハッシュ |
| `participants_json` | string | 参加者の JSON 文字列 |
| `created_at` | string (ISO 8601) | 作成日時 |

### DM Message

| フィールド | 型 | 説明 |
|----------|---|------|
| `id` | string | メッセージ ID (UUID) |
| `thread_id` | string | スレッド ID |
| `author_id` | string | 送信者の ActivityPub Actor URI |
| `content_html` | string | メッセージ本文（HTML） |
| `raw_activity_json` | string | 元の ActivityPub Activity JSON |
| `created_at` | string (ISO 8601) | 作成日時 |

### Channel Message

| フィールド | 型 | 説明 |
|----------|---|------|
| `id` | string | メッセージ ID (UUID) |
| `community_id` | string | コミュニティ ID |
| `channel_id` | string | チャンネル ID |
| `author_id` | string | 送信者の ActivityPub Actor URI |
| `content_html` | string | メッセージ本文（HTML） |
| `raw_activity_json` | string | 元の ActivityPub Activity JSON |
| `created_at` | string (ISO 8601) | 作成日時 |

---

## 使用例

### DM の送受信

```javascript
// 1. Bob にメッセージ送信
const sendResponse = await fetch('https://example.com/dm/send', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer token',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    recipients: ['https://example.com/ap/users/bob'],
    content: 'Hello, Bob!'
  })
});
const { data } = await sendResponse.json();
const threadId = data.threadId;

// 2. スレッドのメッセージ一覧を取得
const messagesResponse = await fetch(`https://example.com/dm/threads/${threadId}/messages`, {
  headers: { 'Authorization': 'Bearer token' }
});

// 3. DM スレッド一覧を取得
const threadsResponse = await fetch('https://example.com/dm/threads', {
  headers: { 'Authorization': 'Bearer token' }
});
```

### チャンネルメッセージ

```javascript
// 1. チャンネルメッセージを送信
const sendResponse = await fetch(
  'https://example.com/communities/comm-id/channels/chan-id/messages',
  {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ content: 'Hello channel!' })
  }
);

// 2. チャンネルメッセージ一覧を取得
const messagesResponse = await fetch(
  'https://example.com/communities/comm-id/channels/chan-id/messages?limit=20',
  {
    headers: { 'Authorization': 'Bearer token' }
  }
);
```

---

## ActivityPub 統合

チャット機能は ActivityPub の標準的な `Note` オブジェクトと `context` プロパティを使用します：

- **DM**: `context` フィールドでスレッドをグループ化
- **チャンネルメッセージ**: チャンネル URI を `context` として使用
- **配信**: 標準的な ActivityPub `Create` アクティビティとして配信

詳細は [ActivityPub 仕様](../activitypub.md#messaging-surfaces) を参照してください。

---

## スレッド ID の生成

DM スレッド ID は参加者の Actor URI を正規化してハッシュ化したものです：

```javascript
// 例: Alice と Bob のスレッド
const participants = [
  'https://example.com/ap/users/alice',
  'https://example.com/ap/users/bob'
];
// ソート・正規化
const normalized = participants.sort().join('#');
// スレッド ID として使用
const threadId = normalized;
// => "https://example.com/ap/users/alice#https://example.com/ap/users/bob"
```

これにより、同じ参加者間の会話は常に同じスレッドにまとまります。
