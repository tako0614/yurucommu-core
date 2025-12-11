# Dev Runner API 仕様書

## 概要

開発支援ツール（AIエージェント等）向けのファイルシステム操作と実行管理APIを提供する。
既存の VFS (Virtual File System) エンドポイント (`/-/dev/vfs/*`) と連携し、ワークスペース内でのコード編集・実行・テストを可能にする。

## エンドポイント一覧

### ファイルシステム操作

| メソッド | パス | 説明 |
|---------|------|------|
| `GET` | `/-/dev/fs/:workspaceId/tree` | ディレクトリ構造の一覧取得 |
| `GET` | `/-/dev/fs/:workspaceId/file` | 単一ファイルの内容取得 |
| `POST` | `/-/dev/fs/:workspaceId/file` | 単一ファイルの内容を上書き |
| `POST` | `/-/dev/fs/:workspaceId/patch` | テキストパッチ適用（オプション） |

### 実行管理

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/-/dev/runs/:workspaceId` | 実行ジョブの作成 |
| `GET` | `/-/dev/runs/:workspaceId/:runId` | 実行ステータスの取得 |
| `GET` | `/-/dev/runs/:workspaceId/:runId/logs` | 実行ログの取得 |
| `DELETE` | `/-/dev/runs/:workspaceId/:runId` | 実行ジョブのキャンセル |

### 開発タスク管理

| メソッド | パス | 説明 |
|---------|------|------|
| `POST` | `/-/dev/tasks/:workspaceId` | 開発タスクの作成 |
| `GET` | `/-/dev/tasks/:workspaceId/:taskId` | タスクステータスの取得 |
| `GET` | `/-/dev/tasks/:workspaceId/:taskId/result` | タスク結果の取得 |

---

## 1. ファイルシステム操作 API

### 1.1 `GET /-/dev/fs/:workspaceId/tree`

ディレクトリ構造の一覧を取得する。

#### リクエスト

| パラメータ | 位置 | 必須 | 説明 |
|-----------|------|------|------|
| `workspaceId` | path | ✓ | ワークスペースID |
| `root` | query | - | 起点ディレクトリ（デフォルト: `/`） |
| `depth` | query | - | 探索深度（デフォルト: `-1` 無制限） |
| `include_hidden` | query | - | 隠しファイルを含むか（デフォルト: `false`） |

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "root": "services/user-api",
    "entries": [
      { "path": "services/user-api/src/index.ts", "type": "file", "size": 1234 },
      { "path": "services/user-api/src/handlers/user.ts", "type": "file", "size": 2048 },
      { "path": "services/user-api/package.json", "type": "file", "size": 512 },
      { "path": "services/user-api/tests", "type": "directory" }
    ],
    "total_entries": 4
  }
}
```

#### エラーレスポンス

```jsonc
{
  "status": 404,
  "code": "NOT_FOUND",
  "message": "workspace not found"
}
```

---

### 1.2 `GET /-/dev/fs/:workspaceId/file`

単一ファイルの内容を取得する。

#### リクエスト

| パラメータ | 位置 | 必須 | 説明 |
|-----------|------|------|------|
| `workspaceId` | path | ✓ | ワークスペースID |
| `path` | query | ✓ | ファイルパス |
| `encoding` | query | - | エンコーディング（デフォルト: `utf-8`） |

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "path": "services/user-api/src/handlers/user.ts",
    "content": "export function handler() { ... }",
    "encoding": "utf-8",
    "size": 2048,
    "content_type": "text/typescript",
    "content_hash": "sha256:abc123...",
    "updated_at": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### 1.3 `POST /-/dev/fs/:workspaceId/file`

単一ファイルの内容を丸ごと上書きする。

#### リクエスト

```jsonc
{
  "path": "services/user-api/src/handlers/user.ts",
  "content": "export function handler() { /* modified */ }",
  "encoding": "utf-8",
  "create_dirs": true  // 中間ディレクトリを自動作成（デフォルト: true）
}
```

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "path": "services/user-api/src/handlers/user.ts",
    "status": "updated",  // "created" | "updated"
    "size": 2100,
    "content_hash": "sha256:def456...",
    "updated_at": "2025-01-01T00:00:00.000Z",
    "usage": {
      "file_count": 15,
      "total_size": 45000
    }
  }
}
```

#### エラーレスポンス

```jsonc
{
  "status": 413,
  "code": "FILE_TOO_LARGE",
  "message": "file size exceeds limit",
  "details": {
    "size": 5242880,
    "limit": 1048576
  }
}
```

---

### 1.4 `POST /-/dev/fs/:workspaceId/patch`（オプション）

テキストパッチを適用する。行番号ベースの差分適用。

#### リクエスト

```jsonc
{
  "path": "services/user-api/src/handlers/user.ts",
  "patches": [
    {
      "op": "replace",
      "range": { "start_line": 10, "end_line": 20 },
      "text": "// New implementation\nexport function handler() {\n  return { ok: true };\n}"
    },
    {
      "op": "insert",
      "range": { "start_line": 5 },
      "text": "import { logger } from './logger';\n"
    },
    {
      "op": "delete",
      "range": { "start_line": 30, "end_line": 35 }
    }
  ],
  "base_hash": "sha256:abc123..."  // 競合検出用（オプション）
}
```

#### パッチ操作

| `op` | 説明 |
|------|------|
| `replace` | 指定範囲を新しいテキストで置換 |
| `insert` | 指定行の前にテキストを挿入 |
| `delete` | 指定範囲を削除 |

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "path": "services/user-api/src/handlers/user.ts",
    "status": "patched",
    "applied_patches": 3,
    "content_hash": "sha256:ghi789...",
    "updated_at": "2025-01-01T00:00:00.000Z"
  }
}
```

#### 競合エラー

```jsonc
{
  "status": 409,
  "code": "CONFLICT",
  "message": "file has been modified",
  "details": {
    "expected_hash": "sha256:abc123...",
    "current_hash": "sha256:xyz999..."
  }
}
```

---

## 2. 実行管理 API

### 2.1 `POST /-/dev/runs/:workspaceId`

コマンド実行ジョブを作成する。

#### リクエスト

```jsonc
{
  "commands": [
    "npm install",
    "npm test"
  ],
  "working_dir": "services/user-api",  // ワークスペース内の作業ディレクトリ
  "timeout_sec": 900,
  "env": {
    "NODE_ENV": "test"
  },
  "correlation_id": "task_2025-01-01_0001"  // 任意の相関ID
}
```

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "run_id": "run_2025-01-01_0001",
    "status": "queued",
    "commands": ["npm install", "npm test"],
    "created_at": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### 2.2 `GET /-/dev/runs/:workspaceId/:runId`

実行ステータスを取得する。

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "run_id": "run_2025-01-01_0001",
    "status": "running",  // queued | running | succeeded | failed | timeout | cancelled | internal_error
    "current_command_index": 1,
    "current_command": "npm test",
    "exit_code": null,
    "created_at": "2025-01-01T00:00:00.000Z",
    "started_at": "2025-01-01T00:00:05.000Z",
    "finished_at": null,
    "summary": "npm test is running"
  }
}
```

---

### 2.3 `GET /-/dev/runs/:workspaceId/:runId/logs`

実行ログを取得する。

#### リクエスト

| パラメータ | 位置 | 必須 | 説明 |
|-----------|------|------|------|
| `offset` | query | - | 開始位置（デフォルト: `0`） |
| `limit` | query | - | 取得行数（デフォルト: `1000`, 最大: `5000`） |
| `stream` | query | - | `stdout`, `stderr`, または `all`（デフォルト: `all`） |

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "run_id": "run_2025-01-01_0001",
    "logs": [
      { "ts": "2025-01-01T00:00:05.100Z", "stream": "stdout", "line": "npm test" },
      { "ts": "2025-01-01T00:00:05.200Z", "stream": "stdout", "line": "> user-api@1.0.0 test" },
      { "ts": "2025-01-01T00:00:06.000Z", "stream": "stderr", "line": "Test 'user timezone' failed: ..." }
    ],
    "offset": 0,
    "total": 150,
    "end_of_stream": false
  }
}
```

---

### 2.4 `DELETE /-/dev/runs/:workspaceId/:runId`

実行中のジョブをキャンセルする。

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "run_id": "run_2025-01-01_0001",
    "status": "cancelled",
    "cancelled_at": "2025-01-01T00:00:10.000Z"
  }
}
```

---

## 3. 開発タスク管理 API

AIエージェント等による自動修正タスクを管理する。

### 3.1 `POST /-/dev/tasks/:workspaceId`

開発タスクを作成する。

#### リクエスト

```jsonc
{
  "title": "Fix timezone bug in user settings",
  "description": "User timezone is not being saved correctly",
  "mode": "apply",  // "apply" | "dry_run"
  "test_command": "npm test",
  "max_iterations": 5,
  "context": {
    "error_logs": "...",
    "related_files": ["src/handlers/settings.ts"]
  }
}
```

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "task_id": "task_2025-01-01_0001",
    "status": "queued",
    "mode": "apply",
    "created_at": "2025-01-01T00:00:00.000Z"
  }
}
```

---

### 3.2 `GET /-/dev/tasks/:workspaceId/:taskId`

タスクステータスを取得する。

#### レスポンス

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "task_id": "task_2025-01-01_0001",
    "status": "running",  // queued | planning | editing | testing | succeeded | failed
    "current_iteration": 2,
    "max_iterations": 5,
    "summary": "2回目のテストが失敗、再修正中",
    "created_at": "2025-01-01T00:00:00.000Z",
    "updated_at": "2025-01-01T00:01:00.000Z"
  }
}
```

---

### 3.3 `GET /-/dev/tasks/:workspaceId/:taskId/result`

タスク結果を取得する。

#### レスポンス（`mode: "apply"` の場合）

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "task_id": "task_2025-01-01_0001",
    "status": "succeeded",
    "mode": "apply",
    "changes": [
      {
        "path": "services/user-api/src/handlers/settings.ts",
        "status": "modified",
        "before_hash": "sha256:aaa...",
        "after_hash": "sha256:bbb...",
        "before_excerpt": "function saveTimezone(tz) { ... }",
        "after_excerpt": "function saveTimezone(tz: string) { ... }"
      }
    ],
    "test": {
      "command": "npm test",
      "exit_code": 0,
      "passed": true,
      "summary": "All 42 tests passed"
    },
    "iterations": 2,
    "completed_at": "2025-01-01T00:02:00.000Z"
  }
}
```

#### レスポンス（`mode: "dry_run"` の場合）

```jsonc
{
  "ok": true,
  "data": {
    "workspace_id": "ws_abc123",
    "task_id": "task_2025-01-01_0001",
    "status": "succeeded",
    "mode": "dry_run",
    "changes": [
      {
        "path": "services/user-api/src/handlers/settings.ts",
        "diff": "--- a/services/user-api/src/handlers/settings.ts\n+++ b/services/user-api/src/handlers/settings.ts\n@@ -10,7 +10,7 @@\n-function saveTimezone(tz) {\n+function saveTimezone(tz: string) {",
        "before_content": "...",
        "after_content": "..."
      }
    ],
    "estimated_test_impact": "high",
    "completed_at": "2025-01-01T00:01:30.000Z"
  }
}
```

---

## 4. ステータスコード

### 実行ステータス (`runs`)

| ステータス | 説明 |
|-----------|------|
| `queued` | キューに追加済み、実行待ち |
| `running` | 実行中 |
| `succeeded` | 正常終了（exit code = 0） |
| `failed` | 異常終了（exit code != 0） |
| `timeout` | タイムアウト |
| `cancelled` | ユーザーによるキャンセル |
| `internal_error` | 内部エラー |

### タスクステータス (`tasks`)

| ステータス | 説明 |
|-----------|------|
| `queued` | キューに追加済み |
| `planning` | 修正計画を策定中 |
| `editing` | ファイルを編集中 |
| `testing` | テスト実行中 |
| `succeeded` | タスク完了（テスト成功） |
| `failed` | タスク失敗（最大試行回数到達） |

---

## 5. 認証・認可

すべてのエンドポイントは以下のミドルウェアを通過する：

1. `auth` - セッション認証
2. `requireHumanSession` - 人間のセッションであることを確認
3. `requireWorkspacePlan` - ワークスペース機能へのアクセス権を確認

---

## 6. 制限事項

### ワークスペース制限

| 項目 | Free | Pro | Business |
|------|------|-----|----------|
| 最大ファイル数 | 100 | 1,000 | 10,000 |
| 最大総容量 | 10 MB | 100 MB | 1 GB |
| 最大ファイルサイズ | 1 MB | 10 MB | 100 MB |
| 同時実行数 | 1 | 3 | 10 |
| 実行タイムアウト | 60s | 300s | 900s |

### レート制限

- `/fs/*`: 100 req/min
- `/runs/*`: 20 req/min
- `/tasks/*`: 10 req/min

---

## 7. Runner 内部仕様

### ワークスペース構造

```
/workspace/
├── {workspaceId}/
│   ├── .takos/
│   │   ├── config.json
│   │   └── state.json
│   ├── services/
│   │   └── user-api/
│   └── ...
└── __shared/
    └── node_modules/  (キャッシュ)
```

### 実行環境

- コンテナ化された Node.js 環境
- ネットワークアクセスは npm registry のみ許可
- ファイルシステムはワークスペース内に制限
- 実行時間は `timeout_sec` で制限

---

## 8. 実装優先度

### Phase 1（必須）

- [x] `GET /-/dev/fs/:workspaceId/tree`
- [x] `GET /-/dev/fs/:workspaceId/file`
- [x] `POST /-/dev/fs/:workspaceId/file`
- [ ] `POST /-/dev/runs/:workspaceId`
- [ ] `GET /-/dev/runs/:workspaceId/:runId`
- [ ] `GET /-/dev/runs/:workspaceId/:runId/logs`

### Phase 2（推奨）

- [ ] `POST /-/dev/fs/:workspaceId/patch`
- [ ] `DELETE /-/dev/runs/:workspaceId/:runId`
- [ ] `POST /-/dev/tasks/:workspaceId`
- [ ] `GET /-/dev/tasks/:workspaceId/:taskId`
- [ ] `GET /-/dev/tasks/:workspaceId/:taskId/result`

---

## 9. 既存 VFS API との関係

この API は既存の `/-/dev/vfs/*` API を補完する：

| 既存 VFS API | 新 Dev Runner API | 用途 |
|-------------|-------------------|------|
| `GET /vfs/:id/files` | `GET /fs/:id/tree` | ディレクトリ一覧（tree はより構造化） |
| `GET /vfs/:id/files/*` | `GET /fs/:id/file` | ファイル取得（file はクエリパラメータ） |
| `PUT /vfs/:id/files/*` | `POST /fs/:id/file` | ファイル書き込み（file は JSON body） |
| - | `POST /fs/:id/patch` | パッチ適用（新機能） |
| - | `/runs/*` | 実行管理（新機能） |
| - | `/tasks/*` | タスク管理（新機能） |

既存の VFS API はそのまま維持し、新 API は開発ツール向けに最適化された代替インターフェースとして提供する。
