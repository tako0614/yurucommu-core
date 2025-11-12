-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_posts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "community_id" TEXT,
    "author_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "media_json" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL,
    "pinned" INTEGER NOT NULL DEFAULT 0,
    "broadcast_all" INTEGER NOT NULL DEFAULT 0,
    "visible_to_friends" INTEGER NOT NULL DEFAULT 0,
    "attributed_community_id" TEXT
);
INSERT INTO "new_posts" ("attributed_community_id", "author_id", "broadcast_all", "community_id", "created_at", "id", "media_json", "pinned", "text", "type", "visible_to_friends") SELECT "attributed_community_id", "author_id", "broadcast_all", "community_id", "created_at", "id", "media_json", "pinned", "text", "type", "visible_to_friends" FROM "posts";
DROP TABLE "posts";
ALTER TABLE "new_posts" RENAME TO "posts";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

