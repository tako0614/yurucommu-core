-- Add post_reposts table for boost/quote tracking
CREATE TABLE IF NOT EXISTS "post_reposts" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "post_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "created_at" DATETIME NOT NULL,
  "ap_activity_id" TEXT,
  CONSTRAINT "post_reposts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "post_reposts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_reposts_post_id_user_id_key" ON "post_reposts"("post_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "post_reposts_ap_activity_id_key" ON "post_reposts"("ap_activity_id");
CREATE INDEX IF NOT EXISTS "post_reposts_user_id_created_at_idx" ON "post_reposts"("user_id", "created_at");
CREATE INDEX IF NOT EXISTS "post_reposts_post_id_created_at_idx" ON "post_reposts"("post_id", "created_at");

-- Add post_bookmarks table
CREATE TABLE IF NOT EXISTS "post_bookmarks" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "post_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" DATETIME NOT NULL,
  CONSTRAINT "post_bookmarks_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "posts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "post_bookmarks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "post_bookmarks_post_id_user_id_key" ON "post_bookmarks"("post_id", "user_id");
CREATE INDEX IF NOT EXISTS "post_bookmarks_user_id_created_at_idx" ON "post_bookmarks"("user_id", "created_at");
