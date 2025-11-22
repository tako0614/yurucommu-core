# 認証 API

takos の認証システムについて説明します。

## 認証方式

takos は以下の認証方式をサポートします：

1. **環境変数認証** (推奨) - 管理者が設定した固定ユーザー名・パスワード
2. **JWT トークン** - ログイン後に発行される Bearer トークン
3. **セッション Cookie** - `takos-session` cookie による認証

## エンドポイント

### POST /auth/password/login

環境変数で設定されたユーザー名・パスワードでログインします。

**リクエスト**:
```json
{
  "username": "admin",
  "password": "your-password"
}
```

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "user-id",
      "handle": "admin",
      "display_name": "管理者",
      "avatar_url": null,
      "created_at": "2024-01-01T00:00:00.000Z"
    },
    "session": {
      "id": "session-id",
      "user_id": "user-id",
      "created_at": "2024-01-01T00:00:00.000Z",
      "expires_at": null
    }
  }
}
```

**エラー**:
- `401 Unauthorized` - ユーザー名またはパスワードが不正

**環境変数**:
```bash
# wrangler.toml または環境変数
AUTH_USERNAME=admin
AUTH_PASSWORD=your-secure-password
```

**注意**: パスワード登録エンドポイント (`POST /auth/password/register`) は現在無効化されています。

---

### POST /auth/session/token

現在のセッションから JWT トークンを発行します。

**認証**: 必須（セッション Cookie）

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "user-id",
      "handle": "admin",
      "display_name": "管理者"
    }
  }
}
```

**使用例**:
```bash
# 1. ログインしてセッション取得
curl -X POST https://example.com/auth/password/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"pass"}' \
  -c cookies.txt

# 2. セッションからトークン発行
curl -X POST https://example.com/auth/session/token \
  -b cookies.txt

# 3. トークンで API 呼び出し
curl https://example.com/me \
  -H "Authorization: Bearer <token>"
```

---

### POST /auth/logout

現在のセッションを削除します。

**認証**: 必須

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "message": "logged out"
  }
}
```

---

## 認証ヘッダー

### Bearer Token (JWT)

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

**JWT ペイロード例**:
```json
{
  "userId": "user-id",
  "handle": "admin",
  "iat": 1640000000,
  "exp": 1640086400
}
```

### セッション Cookie

```http
Cookie: takos-session=<session-id>
```

---

## セキュリティ

### JWT シークレット

各ユーザーごとに固有の JWT シークレットが生成され、データベースに保存されます。

### セッション管理

- セッション ID は UUID v4
- `expires_at` が設定されている場合、期限切れセッションは無効
- セッションは D1 データベース (`sessions` テーブル) に保存

### HTTPS

本番環境では必ず HTTPS を使用してください。HTTP 経由での認証情報送信は推奨されません。

---

## エラーコード

| ステータス | エラー | 説明 |
|-----------|-------|------|
| 400 | `username and password required` | リクエストボディが不正 |
| 401 | `invalid credentials` | ユーザー名またはパスワードが不正 |
| 401 | `unauthorized` | 認証が必要 |
| 401 | `invalid token` | JWT トークンが不正 |
| 401 | `session expired` | セッションが期限切れ |

---

## 認証フロー例

### Web アプリケーション

```javascript
// 1. ログイン
const loginResponse = await fetch('https://example.com/auth/password/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'pass' }),
  credentials: 'include' // Cookie を保存
});

// 2. 以降のリクエストは自動的に Cookie が送信される
const meResponse = await fetch('https://example.com/me', {
  credentials: 'include'
});
```

### モバイルアプリ / SPA

```javascript
// 1. ログイン
const loginResponse = await fetch('https://example.com/auth/password/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'admin', password: 'pass' }),
  credentials: 'include'
});

// 2. トークン発行
const tokenResponse = await fetch('https://example.com/auth/session/token', {
  method: 'POST',
  credentials: 'include'
});
const { token } = await tokenResponse.json();

// 3. トークンを保存（localStorage, SecureStorage 等）
localStorage.setItem('token', token);

// 4. 以降のリクエストで使用
const meResponse = await fetch('https://example.com/me', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

---

## 参考

- JWT 生成: `platform/src/server/jwt.ts`
- セッション管理: `platform/src/server/session.ts`
- 認証ミドルウェア: `backend/src/middleware/auth.ts`
