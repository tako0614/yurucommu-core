-- Add content warning and sensitive flags to posts
ALTER TABLE "posts" ADD COLUMN "content_warning" TEXT;
ALTER TABLE "posts" ADD COLUMN "sensitive" INTEGER NOT NULL DEFAULT 0;

-- Media metadata with alt text/description
CREATE TABLE IF NOT EXISTS "media" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "content_type" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

CREATE INDEX IF NOT EXISTS "media_user_id_idx" ON "media"("user_id");
