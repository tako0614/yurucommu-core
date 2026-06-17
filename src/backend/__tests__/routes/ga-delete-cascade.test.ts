import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #13 + #14 — object delete must not orphan child rows.
 *
 * Migrations declare ON DELETE CASCADE on every table keyed by an object's
 * ap_id (likes, announces, bookmarks, object_recipients, story_views,
 * story_votes, story_shares), but SQLite enforces foreign keys only when
 * `PRAGMA foreign_keys = ON` is set per-connection, and D1 ignores the pragma
 * entirely. So deleting an object could orphan those rows.
 *
 * Both delete paths now run the shared `deleteObjectCascade` helper:
 *   - local DELETE /api/posts/:id  (routes/posts/routes.ts)
 *   - remote handleDelete          (routes/activitypub/handlers/inbox-content-handlers.ts)
 *
 * These tests assert that after a delete, ZERO child rows reference the deleted
 * object, exercising the shared helper directly and the remote handler
 * end-to-end against a real libsql DB.
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq, or } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  announces,
  bookmarks,
  likes,
  objectRecipients,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import { deleteObjectCascade } from "../../routes/posts/delete-cascade.ts";
import { handleDelete } from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import type { ActivityContext } from "../../routes/activitypub/inbox-types.ts";
import type { Activity } from "../../routes/activitypub/inbox-types.ts";

const APP_URL = "https://yuru.test";
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
  // Mirror src/db/index.ts: enforce the migrations' FK edges on this
  // connection so this test also covers real engine-level cascade.
  await client.execute("PRAGMA foreign_keys = ON");
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertActor(db: Database, username: string): Promise<string> {
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
  });
  return apId;
}

async function insertObject(
  db: Database,
  apId: string,
  attributedTo: string,
  type = "Note",
): Promise<void> {
  await db.insert(objects).values({
    apId,
    type,
    attributedTo,
    content: "hi",
    published: new Date().toISOString(),
    isLocal: type === "Story" ? 0 : 1,
  });
}

/**
 * Seed one object with one row in every CASCADE-keyed child table, plus a
 * SECOND unrelated object whose child rows must survive the delete.
 */
async function seedWithChildren(
  db: Database,
  objectApId: string,
  authorApId: string,
  interactorApId: string,
  type = "Note",
): Promise<void> {
  await insertObject(db, objectApId, authorApId, type);
  await db.insert(likes).values({ actorApId: interactorApId, objectApId });
  await db.insert(announces).values({ actorApId: interactorApId, objectApId });
  await db.insert(bookmarks).values({ actorApId: interactorApId, objectApId });
  await db.insert(objectRecipients).values({
    objectApId,
    recipientApId: interactorApId,
    type: "to",
  });
  await db
    .insert(storyViews)
    .values({ actorApId: interactorApId, storyApId: objectApId });
  await db.insert(storyVotes).values({
    id: `vote-${objectApId}`,
    storyApId: objectApId,
    actorApId: interactorApId,
    optionIndex: 0,
  });
  await db.insert(storyShares).values({
    id: `share-${objectApId}`,
    storyApId: objectApId,
    actorApId: interactorApId,
  });
}

async function countChildRows(
  db: Database,
  objectApId: string,
): Promise<number> {
  const [l, a, b, r, sv, vo, sh] = await Promise.all([
    db.select().from(likes).where(eq(likes.objectApId, objectApId)),
    db.select().from(announces).where(eq(announces.objectApId, objectApId)),
    db.select().from(bookmarks).where(eq(bookmarks.objectApId, objectApId)),
    db
      .select()
      .from(objectRecipients)
      .where(eq(objectRecipients.objectApId, objectApId)),
    db.select().from(storyViews).where(eq(storyViews.storyApId, objectApId)),
    db.select().from(storyVotes).where(eq(storyVotes.storyApId, objectApId)),
    db.select().from(storyShares).where(eq(storyShares.storyApId, objectApId)),
  ]);
  return (
    l.length +
    a.length +
    b.length +
    r.length +
    sv.length +
    vo.length +
    sh.length
  );
}

function mockContext(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
  } as unknown as ActivityContext;
}

test("deleteObjectCascade removes every CASCADE-keyed child row and leaves unrelated objects untouched", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const other = await insertActor(db, "other");

  const target = `${APP_URL}/ap/objects/target`;
  const survivor = `${APP_URL}/ap/objects/survivor`;
  await seedWithChildren(db, target, author, other);
  await seedWithChildren(db, survivor, author, other);

  expect(await countChildRows(db, target)).toBe(7);
  expect(await countChildRows(db, survivor)).toBe(7);

  // Helper deletes the child rows; caller deletes the object row.
  await deleteObjectCascade(db, target);
  await db.delete(objects).where(eq(objects.apId, target));

  // No orphan rows remain for the deleted object.
  expect(await countChildRows(db, target)).toBe(0);
  // The unrelated object's children are untouched.
  expect(await countChildRows(db, survivor)).toBe(7);

  const remaining = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(or(eq(objects.apId, target), eq(objects.apId, survivor)));
  expect(remaining.map((o) => o.apId)).toEqual([survivor]);
});

test("remote handleDelete cascades child rows so none are orphaned", async () => {
  const db = await freshDb();
  // Remote author owns the object being deleted.
  const author = "https://remote.test/ap/users/alice";
  await db.insert(actors).values({
    apId: author,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${author}/inbox`,
    outbox: `${author}/outbox`,
    followersUrl: `${author}/followers`,
    followingUrl: `${author}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    postCount: 1,
  });
  const local = await insertActor(db, "local");

  const objectId = "https://remote.test/ap/objects/note-1";
  await seedWithChildren(db, objectId, author, local);
  expect(await countChildRows(db, objectId)).toBe(7);

  const activity: Activity = {
    id: "https://remote.test/ap/activities/delete-1",
    type: "Delete",
    actor: author,
    object: objectId,
  };

  await handleDelete(mockContext(db), activity);

  // Object row gone and no orphan child rows.
  const obj = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  expect(obj).toBeUndefined();
  expect(await countChildRows(db, objectId)).toBe(0);
});

test("remote handleDelete refuses to delete when actor does not own the object (no child rows removed)", async () => {
  const db = await freshDb();
  const author = "https://remote.test/ap/users/alice";
  await db.insert(actors).values({
    apId: author,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${author}/inbox`,
    outbox: `${author}/outbox`,
    followersUrl: `${author}/followers`,
    followingUrl: `${author}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  const local = await insertActor(db, "local");

  const objectId = "https://remote.test/ap/objects/note-2";
  await seedWithChildren(db, objectId, author, local);

  const activity: Activity = {
    id: "https://remote.test/ap/activities/delete-2",
    type: "Delete",
    actor: "https://evil.test/ap/users/mallory",
    object: objectId,
  };

  await handleDelete(mockContext(db), activity);

  // Ownership mismatch -> nothing deleted.
  const obj = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  expect(obj?.apId).toBe(objectId);
  expect(await countChildRows(db, objectId)).toBe(7);
});
