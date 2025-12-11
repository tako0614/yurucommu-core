# Dev Runner API 仕様書

## 概要

App のソースコード編集・ビルド・テスト・デプロイを行う API を提供する。

**基本方針**:
- ソースコードのみを保存し、ビルドはサーバー側で実行
- 開発環境（sandbox）で機能テストしてから本番にデプロイ
- エージェントでも手動アップロードでも同じフローで利用可能

```
┌──────────────────────────────────────────────────────────────────────┐
│                           開発フロー                                  │
├──────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐       │
│  │ ソース   │ ──→ │ ビルド   │ ──→ │ テスト   │ ──→ │ デプロイ │       │
│  │ 編集     │     │         │     │ (sandbox)│     │ (本番)   │       │
│  └─────────┘     └─────────┘     └─────────┘     └─────────┘       │
│       │               │               │               │              │
│   /fs/file        /builds         /sandbox        /deploy            │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

## エンドポイント一覧

### ファイルシステム操作（ソースコード）

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/-/dev/fs/:workspaceId/tree` | ソースファイル一覧取得 |
| `GET` | `/-/dev/fs/:workspaceId/file` | ソースファイルの内容取得 |
| `POST` | `/-/dev/fs/:workspaceId/file` | ソースファイルの保存 |
| `POST` | `/-/dev/fs/:workspaceId/patch` | ソースファイルへのパッチ適用 |

### ビルド管理

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/-/dev/builds/:workspaceId` | ビルドジョブの作成 |
| `GET` | `/-/dev/builds/:workspaceId/:buildId` | ビルドステータスの取得 |
| `GET` | `/-/dev/builds/:workspaceId/:buildId/logs` | ビルドログの取得 |
| `GET` | `/-/dev/builds/:workspaceId/:buildId/output` | ビルド成果物の取得 |

### 開発環境（Sandbox）

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/-/dev/sandbox/:workspaceId` | Sandbox セッション作成 |
| `GET` | `/-/dev/sandbox/:workspaceId/:sessionId` | Sandbox ステータス取得 |
| `POST` | `/-/dev/sandbox/:workspaceId/:sessionId/call` | ハンドラー実行 |
| `GET` | `/-/dev/sandbox/:workspaceId/:sessionId/state` | Sandbox 内のデータ状態取得 |
| `DELETE` | `/-/dev/sandbox/:workspaceId/:sessionId` | Sandbox セッション破棄 |

### デプロイ管理

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/-/dev/deploy/:workspaceId` | 本番へデプロイ |
| `GET` | `/-/dev/deploy/:workspaceId/history` | デプロイ履歴取得 |
| `POST` | `/-/dev/deploy/:workspaceId/rollback` | 前バージョンにロールバック |

---

## 1. ファイルシステム操作 API

### 1.1 `GET /-/dev/fs/:workspaceId/tree`

ソースファイル一覧を取得する。

#### リクエスト

| パラメータ | 位置 | 必須 | 説明 |
|-----------|------|------|------|
| `workspaceId` | path | ✓ | ワークスペースID |
| `root` | query | - | 起点ディレクトリ（デフォルト: `/`） |
| `depth` | query | - | 探索深度（デフォルト: `-1` 無制限） |

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "root": "src",
    "entries": [
      { "path": "src/App.tsx", "type": "file", "size": 1234 },
      { "path": "src/components/Timeline.tsx", "type": "file", "size": 2048 },
      { "path": "src/handlers/timeline.ts", "type": "file", "size": 512 },
      { "path": "src/components", "type": "directory" }
    ],
    "total_entries": 4
  }
}
```

---

### 1.2 `GET /-/dev/fs/:workspaceId/file`

ソースファイルの内容を取得する。

#### リクエスト

| パラメータ | 位置 | 必須 | 説明 |
|-----------|------|------|------|
| `workspaceId` | path | ✓ | ワークスペースID |
| `path` | query | ✓ | ファイルパス |

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "path": "src/handlers/timeline.ts",
    "content": "export async function getTimeline(ctx) { ... }",
    "size": 2048,
    "content_hash": "sha256:abc123...",
    "updated_at": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### 1.3 `POST /-/dev/fs/:workspaceId/file`

ソースファイルを保存する。

#### リクエスト

```jsonc
{
  "path": "src/handlers/timeline.ts",
  "content": "export async function getTimeline(ctx) { /* updated */ }"
}
```

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "path": "src/handlers/timeline.ts",
    "status": "updated",  // "created" | "updated"
    "content_hash": "sha256:def456...",
    "updated_at": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### 1.4 `POST /-/dev/fs/:workspaceId/patch`

ソースファイルにパッチを適用する。

#### リクエスト

```jsonc
{
  "path": "src/handlers/timeline.ts",
  "patches": [
    {
      "op": "replace",
      "range": { "start_line": 10, "end_line": 20 },
      "text": "// new implementation"
    }
  ],
  "base_hash": "sha256:abc123..."  // 競合検出用
}
```

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "path": "src/handlers/timeline.ts",
    "status": "patched",
    "applied_patches": 1,
    "content_hash": "sha256:ghi789..."
  }
}
```

---

## 2. ビルド管理 API

### 設計方針

- ソースコード（TypeScript/TSX）をサーバー側でビルド
- React コンポーネント + ハンドラーをバンドル
- キャッシュ活用で同一ソースの再ビルドをスキップ

### 2.1 `POST /-/dev/builds/:workspaceId`

ビルドジョブを作成する。

#### リクエスト

```jsonc
{
  "source_hash": "sha256:abc123...",  // オプション: 省略時は最新
  "options": {
    "minify": true,
    "sourcemap": true
  }
}
```

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "build_id": "build_001",
    "status": "queued",
    "source_hash": "sha256:abc123...",
    "created_at": "2025-01-01T00:00:00.000Z"
  }
}
```

#### キャッシュヒット時

```jsonc
{
  "ok": true,
  "data": {
    "build_id": "build_001",
    "status": "succeeded",
    "cached": true,
    "output_hash": "sha256:def456..."
  }
}
```

---

### 2.2 `GET /-/dev/builds/:workspaceId/:buildId`

ビルドステータスを取得する。

#### レスポンス（実行中）

```jsonc
{
  "ok": true,
  "data": {
    "build_id": "build_001",
    "status": "running",
    "progress": {
      "phase": "bundling",  // "validating" | "bundling" | "optimizing"
      "percent": 60
    }
  }
}
```

#### レスポンス（成功）

```jsonc
{
  "ok": true,
  "data": {
    "build_id": "build_001",
    "status": "succeeded",
    "source_hash": "sha256:abc123...",
    "output_hash": "sha256:def456...",
    "output": {
      "files": [
        { "path": "app.js", "size": 12345 },
        { "path": "app.js.map", "size": 5678 }
      ],
      "total_size": 18023
    },
    "finished_at": "2025-01-01T00:00:05.000Z"
  }
}
```

---

### 2.3 `GET /-/dev/builds/:workspaceId/:buildId/output`

ビルド成果物を取得する。

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "build_id": "build_001",
    "output_hash": "sha256:def456...",
    "files": [
      {
        "path": "app.js",
        "content": "// bundled React app...",
        "size": 12345
      }
    ]
  }
}
```

---

## 3. 開発環境（Sandbox）API

### 設計方針

- ビルド成果物をメモリ上で実行
- Core サービスをインメモリ実装でモック
- 本番データに影響しない隔離環境
- ハンドラーの動作確認・UI の表示確認が可能

### インメモリ Core サービス

```
Sandbox 内部
├── ObjectService  → Map<id, object>
├── ActorService   → Map<id, actor>
├── StorageService → Map<key, blob>
└── etc.
```

### 3.1 `POST /-/dev/sandbox/:workspaceId`

Sandbox セッションを作成する。

#### リクエスト

```jsonc
{
  "build_id": "build_001",
  "seed_data": {
    // オプション: 初期データを投入
    "actors": [
      { "id": "actor_1", "name": "Test User", "handle": "test" }
    ],
    "objects": [
      { "id": "obj_1", "type": "Note", "content": "Hello" }
    ]
  },
  "timeout_sec": 300  // セッション有効期限（デフォルト: 300秒）
}
```

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "session_id": "sandbox_001",
    "build_id": "build_001",
    "status": "ready",
    "expires_at": "2025-01-01T00:05:00.000Z"
  }
}
```

---

### 3.2 `POST /-/dev/sandbox/:workspaceId/:sessionId/call`

Sandbox 内でハンドラーを実行する。

#### リクエスト

```jsonc
{
  "handler": "getTimeline",
  "args": {
    "actor_id": "actor_1",
    "limit": 20
  },
  "context": {
    "authenticated_user": "actor_1"
  }
}
```

#### レスポンス（成功）

```jsonc
{
  "ok": true,
  "data": {
    "session_id": "sandbox_001",
    "handler": "getTimeline",
    "result": {
      "items": [
        { "id": "obj_1", "type": "Note", "content": "Hello" }
      ],
      "has_more": false
    },
    "execution_time_ms": 12,
    "logs": [
      { "level": "debug", "message": "Fetching timeline for actor_1" }
    ]
  }
}
```

#### レスポンス（エラー）

```jsonc
{
  "ok": false,
  "status": 500,
  "code": "HANDLER_ERROR",
  "message": "TypeError: Cannot read property 'id' of undefined",
  "details": {
    "stack": "at getTimeline (handlers/timeline.ts:15:20)..."
  }
}
```

---

### 3.3 `GET /-/dev/sandbox/:workspaceId/:sessionId/state`

Sandbox 内のデータ状態を取得する。

#### リクエスト

| パラメータ | 位置 | 必須 | 説明 |
|-----------|------|------|------|
| `collection` | query | - | 取得対象（`objects`, `actors`, `all`） |

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "session_id": "sandbox_001",
    "state": {
      "objects": {
        "count": 5,
        "items": [
          { "id": "obj_1", "type": "Note", "content": "Hello" },
          { "id": "obj_2", "type": "Note", "content": "Created in test" }
        ]
      },
      "actors": {
        "count": 1,
        "items": [
          { "id": "actor_1", "name": "Test User" }
        ]
      }
    }
  }
}
```

---

### 3.4 `DELETE /-/dev/sandbox/:workspaceId/:sessionId`

Sandbox セッションを破棄する。

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "session_id": "sandbox_001",
    "deleted": true
  }
}
```

---

## 4. デプロイ管理 API

### 設計方針

- テスト済みのビルドのみデプロイ可能
- デプロイ履歴を保持しロールバック可能
- 本番環境への反映は即座に行われる

### 4.1 `POST /-/dev/deploy/:workspaceId`

本番環境にデプロイする。

#### リクエスト

```jsonc
{
  "build_id": "build_001",
  "description": "Fix timeline sorting bug"  // オプション
}
```

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "deploy_id": "deploy_001",
    "build_id": "build_001",
    "status": "deployed",
    "version": 5,  // デプロイバージョン番号
    "deployed_at": "2025-01-01T00:10:00.000Z"
  }
}
```

---

### 4.2 `GET /-/dev/deploy/:workspaceId/history`

デプロイ履歴を取得する。

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "current_version": 5,
    "history": [
      {
        "deploy_id": "deploy_001",
        "build_id": "build_001",
        "version": 5,
        "description": "Fix timeline sorting bug",
        "deployed_at": "2025-01-01T00:10:00.000Z",
        "is_current": true
      },
      {
        "deploy_id": "deploy_000",
        "build_id": "build_000",
        "version": 4,
        "description": "Add new feature",
        "deployed_at": "2024-12-31T00:00:00.000Z",
        "is_current": false
      }
    ]
  }
}
```

---

### 4.3 `POST /-/dev/deploy/:workspaceId/rollback`

前のバージョンにロールバックする。

#### リクエスト

```jsonc
{
  "target_version": 4  // オプション: 省略時は直前のバージョン
}
```

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "deploy_id": "deploy_002",
    "rolled_back_from": 5,
    "rolled_back_to": 4,
    "status": "deployed",
    "deployed_at": "2025-01-01T00:15:00.000Z"
  }
}
```

---

## 5. ステータスコード

### ビルドステータス

| ステータス | 説明 |
|-----------|------|
| `queued` | キュー待ち |
| `running` | ビルド中 |
| `succeeded` | 成功 |
| `failed` | 失敗 |

### Sandbox ステータス

| ステータス | 説明 |
|-----------|------|
| `creating` | 初期化中 |
| `ready` | 実行可能 |
| `expired` | タイムアウト |
| `error` | エラー |

### デプロイステータス

| ステータス | 説明 |
|-----------|------|
| `deploying` | デプロイ中 |
| `deployed` | デプロイ完了 |
| `failed` | デプロイ失敗 |
| `rolled_back` | ロールバック済み |

---

## 6. ストレージ構造

```
ワークスペースストレージ
├── src/                          # ソースコード（ユーザーが編集）
│   ├── App.tsx                   # React エントリポイント
│   ├── components/
│   │   └── Timeline.tsx          # UI コンポーネント
│   └── handlers/
│       └── timeline.ts           # ハンドラー
│
├── builds/                       # ビルド成果物（サーバーが生成）
│   ├── latest -> build_001/      # 最新ビルドへのシンボリックリンク
│   └── build_001/
│       ├── app.js                # バンドルされた React app
│       ├── app.js.map            # ソースマップ
│       └── meta.json             # ビルドメタ情報
│
└── deploys/                      # デプロイ履歴
    ├── current -> v5/            # 現在のバージョン
    ├── v5/
    │   └── app.js
    └── v4/
        └── app.js
```

---

## 7. 実装優先度

### Phase 1（必須）- ソース編集 + ビルド

- [ ] `GET /-/dev/fs/:workspaceId/tree`
- [ ] `GET /-/dev/fs/:workspaceId/file`
- [ ] `POST /-/dev/fs/:workspaceId/file`
- [ ] `POST /-/dev/builds/:workspaceId`
- [ ] `GET /-/dev/builds/:workspaceId/:buildId`
- [ ] `GET /-/dev/builds/:workspaceId/:buildId/output`

### Phase 2（必須）- 開発環境 + デプロイ

- [ ] `POST /-/dev/sandbox/:workspaceId`
- [ ] `POST /-/dev/sandbox/:workspaceId/:sessionId/call`
- [ ] `GET /-/dev/sandbox/:workspaceId/:sessionId/state`
- [ ] `POST /-/dev/deploy/:workspaceId`
- [ ] `GET /-/dev/deploy/:workspaceId/history`

### Phase 3（推奨）- 詳細機能

- [ ] `POST /-/dev/fs/:workspaceId/patch`
- [ ] `GET /-/dev/builds/:workspaceId/:buildId/logs`
- [ ] `DELETE /-/dev/sandbox/:workspaceId/:sessionId`
- [ ] `POST /-/dev/deploy/:workspaceId/rollback`

---

## 8. ワークフロー例

### 典型的な開発フロー

```
1. ソース編集
   POST /fs/ws_123/file
   { "path": "src/handlers/timeline.ts", "content": "..." }

2. ビルド
   POST /builds/ws_123
   → { "build_id": "build_001" }

   GET /builds/ws_123/build_001
   → { "status": "succeeded" }

3. Sandbox でテスト
   POST /sandbox/ws_123
   { "build_id": "build_001" }
   → { "session_id": "sandbox_001" }

   POST /sandbox/ws_123/sandbox_001/call
   { "handler": "getTimeline", "args": {...} }
   → { "result": {...} }  // 動作確認

   GET /sandbox/ws_123/sandbox_001/state
   → { "objects": {...} }  // データ状態確認

4. 本番デプロイ
   POST /deploy/ws_123
   { "build_id": "build_001" }
   → { "version": 5, "status": "deployed" }
```

### 問題発生時のロールバック

```
POST /deploy/ws_123/rollback
{ "target_version": 4 }
→ { "rolled_back_to": 4 }
```
