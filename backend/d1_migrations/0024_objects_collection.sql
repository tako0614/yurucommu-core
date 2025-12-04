-- Objects Collection (ActivityPub unified data store)
-- PLAN.md 10.2: 外部発信される全てのデータを統合管理

CREATE TABLE "objects" (
    -- 識別子
    "id" TEXT NOT NULL PRIMARY KEY,           -- ActivityPub ID (URI)
    "local_id" TEXT UNIQUE,                   -- ローカル短縮ID（オプション）

    -- ActivityPub 必須フィールド（インデックス用）
    "type" TEXT NOT NULL,                     -- "Note", "Article", "Question", "Like", etc.
    "actor" TEXT NOT NULL,                    -- 作成者の Actor URI
    "published" TEXT,                         -- ISO 8601 タイムスタンプ
    "updated" TEXT,                           -- 更新タイムスタンプ

    -- 宛先（配信制御）
    "to" TEXT,                                -- JSON array of recipients (public, followers, etc.)
    "cc" TEXT,                                -- JSON array of CC recipients
    "bto" TEXT,                               -- JSON array of BTO (private)
    "bcc" TEXT,                               -- JSON array of BCC (private)

    -- コンテキスト・スレッド
    "context" TEXT,                           -- 会話/スレッドのコンテキストURI
    "in_reply_to" TEXT,                       -- 返信先オブジェクトID

    -- オブジェクト本体
    "content" TEXT NOT NULL,                  -- JSON-LD オブジェクト全体

    -- ローカル管理用
    "is_local" INTEGER DEFAULT 1,             -- ローカル作成 or リモート受信
    "visibility" TEXT,                        -- "public", "followers", "direct", "community"
    "deleted_at" TEXT,                        -- 論理削除タイムスタンプ

    -- メタデータ
    "created_at" TEXT DEFAULT CURRENT_TIMESTAMP
);

-- パフォーマンス用インデックス
CREATE INDEX "idx_objects_type" ON "objects"("type");
CREATE INDEX "idx_objects_actor" ON "objects"("actor");
CREATE INDEX "idx_objects_published" ON "objects"("published" DESC);
CREATE INDEX "idx_objects_context" ON "objects"("context");
CREATE INDEX "idx_objects_in_reply_to" ON "objects"("in_reply_to");
CREATE INDEX "idx_objects_visibility" ON "objects"("visibility");
CREATE INDEX "idx_objects_is_local" ON "objects"("is_local");
CREATE INDEX "idx_objects_deleted_at" ON "objects"("deleted_at");
