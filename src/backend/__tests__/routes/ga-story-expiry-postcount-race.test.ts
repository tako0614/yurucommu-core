import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import { cleanupExpiredStories } from "../../routes/stories/query-helpers.ts";

// ---------------------------------------------------------------------------
// Audit #21 / finding C — expired-story cleanup must decrement author postCount
// EXACTLY ONCE per story, even when concurrent isolates race the same expiry
// batch.
//
//   The decrement used to be derived from the pre-delete SELECT, guarded only by
//   a per-isolate in-flight boolean (useless across Workers isolates). Two
//   isolates could both SELECT the same not-yet-deleted expired story and both
//   apply -1, permanently under-counting the author's post_count with no
//   reconcile job to recover.
//
//   Fix: derive the decrement from the rows the DELETE actually removed
//   (RETURNING). D1 serializes writes, so only the winning DELETE returns a
//   given row; a losing sweep's DELETE matches 0 rows and decrements nothing.
// ---------------------------------------------------------------------------

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
  // 0010/0011 drop the remote-actor FKs (incl. objects.attributed_to → actors)
  // so a remote author can attribute a stored object, matching prod.
  "0010_object_recipients_drop_actor_fk.sql",
  "0011_drop_remote_actor_fks.sql",
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

async function insertActor(
  db: Database,
  username: string,
  postCount: number,
): Promise<string> {
  const apId = `${APP_URL}/ap/users/${username}`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    postCount,
  });
  return apId;
}

async function insertExpiredStory(
  db: Database,
  apId: string,
  author: string,
): Promise<void> {
  await db.insert(objects).values({
    apId,
    type: "Story",
    attributedTo: author,
    content: "expired",
    published: "1970-01-01T00:00:00.000Z",
    endTime: "1970-01-01T00:00:01.000Z", // in the past → expired
    isLocal: 1,
  });
}

async function postCountOf(db: Database, author: string): Promise<number> {
  const row = await db
    .select({ postCount: actors.postCount })
    .from(actors)
    .where(eq(actors.apId, author))
    .get();
  return row?.postCount ?? -1;
}

test("a single sweep decrements postCount by the exact number of the author's expired stories", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author", 10);
  for (let i = 0; i < 3; i++) {
    await insertExpiredStory(db, `${APP_URL}/ap/objects/s${i}`, author);
  }
  // A remote author's expired story must not touch any local actor row.
  const remote = "https://remote.example/users/r";
  await insertExpiredStory(db, "https://remote.example/objects/rs", remote);

  const cleaned = await cleanupExpiredStories(db);
  expect(cleaned).toBe(4);
  // 3 of the author's stories expired → 10 - 3 = 7.
  expect(await postCountOf(db, author)).toBe(7);
  // No actors row was created for the remote author by the sweep.
  const remoteRow = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(eq(actors.apId, remote))
    .get();
  expect(remoteRow).toBeUndefined();
});

test("concurrent sweeps over the same expiry batch decrement postCount exactly once", async () => {
  const db = await freshDb();
  // postCount seeded ABOVE the concurrency count so a double-decrement would NOT
  // be masked by the MAX(0,…) underflow clamp — drift would surface as < 4.
  const author = await insertActor(db, "author", 5);
  await insertExpiredStory(db, `${APP_URL}/ap/objects/only`, author);

  // Fire several sweeps concurrently on the same connection. Whatever the
  // interleaving, the fixed cleanup keys the decrement on the rows each DELETE
  // actually removed, so the single story is counted exactly once.
  await Promise.all([
    cleanupExpiredStories(db),
    cleanupExpiredStories(db),
    cleanupExpiredStories(db),
    cleanupExpiredStories(db),
  ]);

  expect(await postCountOf(db, author)).toBe(4); // 5 - 1, never 5 - N
  const remaining = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.type, "Story"))
    .all();
  expect(remaining.length).toBe(0);
});
