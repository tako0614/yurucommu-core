import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, activities, inbox } from "../../../db/index.ts";

// Regression: inbox.created_at is the notification feed's sort + cursor key
// (`desc(created_at)`, `lt(created_at, before)`). Some inbox inserts pass an
// explicit `new Date().toISOString()` (…Z) while the follow/DM-notify paths omit
// the column and fall to its default. That default used the space-separated
// `nowIso`, which under SQLite BINARY collation sorts BELOW a same-instant …Z
// row — mixing the two formats mis-ordered the feed. The default is now the
// canonical UTC `nowIsoUtc`, so the omit-path matches the explicit-path format.

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await client.execute("PRAGMA foreign_keys = ON");
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

test("inbox.created_at default is canonical ISO-8601 UTC (…T…Z), matching the explicit-insert paths", async () => {
  const db = await freshDb();
  const actorApId = "https://yuru.test/ap/users/tako";
  const activityApId = "https://yuru.test/ap/activities/a1";

  await db.insert(actors).values({
    apId: actorApId,
    type: "Person",
    preferredUsername: "tako",
    inbox: `${actorApId}/inbox`,
    outbox: `${actorApId}/outbox`,
    followersUrl: `${actorApId}/followers`,
    followingUrl: `${actorApId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(activities).values({
    apId: activityApId,
    type: "Follow",
    actorApId,
    rawJson: "{}",
    direction: "local",
  });

  // Omit createdAt → falls to the column's $defaultFn (the path the
  // follow/DM-notify inbox inserts take).
  await db.insert(inbox).values({ actorApId, activityApId, read: 0 });

  const row = await db
    .select()
    .from(inbox)
    .where(eq(inbox.activityApId, activityApId))
    .get();

  expect(row).toBeDefined();
  // Canonical UTC: T-separated, Z-terminated — NOT the legacy space format.
  expect(row!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z$/);
  expect(row!.createdAt).not.toContain(" ");
  // Round-trips through Date (so the lexical compare also reflects real order).
  expect(Number.isNaN(Date.parse(row!.createdAt))).toBe(false);
});
