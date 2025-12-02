# 認証 API

takos の認証システムについて説明します。

## 認証方式

takos は Owner モード専用の単一ログインフローを持ちます：

1. **オーナーパスワードログイン** - 環境変数 `AUTH_PASSWORD` のマスターパスワードを `POST /auth/login` で送信し、オーナーセッションと JWT を取得
2. **JWT トークン** - ログイン後に発行される Bearer トークン
3. **セッション Cookie** - `takos-session` cookie による認証

## エンドポイント

### POST /auth/login

マスターパスワードでオーナーモードにログインします（ユーザー名やメールアドレスは不要）。

**リクエスト**:
```json
{
  "password": "your-password"
}
```

**レスポンス** (200):
```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "owner",
      "display_name": "owner",
      "created_at": "2024-01-01T00:00:00.000Z",
      "is_private": 0
    },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "session": {
      "id": "session-id",
      "expires_at": "2024-01-01T00:00:00.000Z"
    }
  }
}
```

**エラー**:
- `401 Unauthorized` - パスワードが不正、または未設定

**環境変数**:
```bash
AUTH_PASSWORD=your-secure-password      # 平文または salt$sha256 形式
INSTANCE_OWNER_HANDLE=owner             # 任意。省略時は "owner"
# AUTH_USERNAME はレガシー互換のハンドル指定にのみ利用し、ログインには不要
```

**注意**:
- 標準のログインエンドポイントは `POST /auth/login` です。
- `POST /auth/password/login` は後方互換のために一時的に残りますが、新規実装では使用しないでください。
- パスワード登録エンドポイント (`POST /auth/password/register`) は無効化されています。ローカルアクターの作成・切替はオーナーセッション専用の `/auth/owner/actors` を使用してください。

---

### POST /auth/owner/actors

オーナーセッションでローカルアクターを作成・切り替えます（パスワード不要）。

**認証**: 必須（オーナー）

**リクエスト例**:
```json
{
  "handle": "alice",
  "display_name": "Alice",
  "create": true,
  "activate": true,
  "issue_token": true
}
```

**レスポンス** (201 when created):
```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "alice",
      "display_name": "Alice",
      "avatar_url": "",
      "created_at": "2024-01-01T00:00:00.000Z",
      "is_private": 0
    },
    "active_user_id": "alice",
    "created": true,
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
  }
}
```

既存ユーザーを切り替える場合は `create` を省略するか `false` を指定してください。

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
curl -X POST https://example.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"password":"pass"}' \
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
| 401 | `invalid credentials` | パスワードが不正、または未設定 |
| 401 | `unauthorized` | 認証が必要 |
| 401 | `invalid token` | JWT トークンが不正 |
| 401 | `session expired` | セッションが期限切れ |
| 404 | `password authentication disabled` | 環境変数によるログインが無効 |

---

## 認証フロー例

### Web アプリケーション

```javascript
// 1. ログイン
const loginResponse = await fetch('https://example.com/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'pass' }),
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
const loginResponse = await fetch('https://example.com/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password: 'pass' }),
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
