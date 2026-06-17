import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA Wave-10 TOMBSTONE-REVIVE — re-registering a freed handle must cancel the
 * stranded outbound Delete(actor) before reviving the tombstone.
 *
 * A deleted account's row lingers as a tombstone keyed by the deterministic
 * apId, keeping the OLD signing key so the queued Delete(actor) delivery jobs
 * can sign with it at send time. createActor revives that row on
 * re-registration, rotating to a FRESH key + identity. Any in-flight Delete job
 * would then sign with the wrong key / target a now-live actor — so the revive
 * path must first cancel the stranded Delete: drop its non-terminal
 * delivery_queue rows AND the preserved Delete activity rows (#revive).
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq, isNotNull } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, activities, deliveryQueue } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import { cancelTombstoneDelete } from "../../routes/actors.ts";
import { createActor } from "../../routes/auth-helpers.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

/**
 * Seed a tombstoned local actor with a preserved Delete(actor) activity and a
 * set of delivery_queue jobs in the given statuses. Returns the apId and the
 * Delete activity id.
 */
async function seedTombstoneWithDelete(
  db: Database,
  username: string,
  jobStatuses: string[],
): Promise<{ apId: string; deleteActivityId: string }> {
  const apId = localApId(username);
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: `deleted-${username}`,
    name: `Display ${username}`,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "OLD-PUBLIC-KEY",
    privateKeyPem: "OLD-PRIVATE-KEY",
    takosUserId: `takos-${username}-old`,
    deletedAt: new Date().toISOString(),
  });

  const deleteActivityId = `${APP_URL}/ap/activities/del-${username}`;
  await db.insert(activities).values({
    apId: deleteActivityId,
    type: "Delete",
    actorApId: apId,
    objectApId: apId,
    rawJson: "{}",
    direction: "outbound",
  });

  let i = 0;
  for (const status of jobStatuses) {
    await db.insert(deliveryQueue).values({
      id: `job-${username}-${i++}`,
      activityApId: deleteActivityId,
      inboxUrl: `https://remote${i}.test/inbox`,
      status,
    });
  }

  return { apId, deleteActivityId };
}

test("createActor revive cancels the stranded in-flight Delete (queue + activity rows cleared)", async () => {
  const db = await freshDb();
  const env = envFor(db);

  const { apId, deleteActivityId } = await seedTombstoneWithDelete(
    db,
    "alice",
    ["pending", "retry_wait", "failed"],
  );

  // Sanity: the Delete activity + its queued jobs exist before revive.
  expect(
    (
      await db
        .select()
        .from(deliveryQueue)
        .where(eq(deliveryQueue.activityApId, deleteActivityId))
    ).length,
  ).toBe(3);

  // Re-register the freed handle "alice" → revives the tombstone row.
  const revived = await createActor(db, env, {
    username: "alice",
    name: "Alice Reborn",
    takosUserId: "takos-alice-new",
    role: "member",
  });
  expect(revived?.apId).toBe(apId);

  // --- Revive rotated to a FRESH key + identity ---
  expect(revived?.privateKeyPem).not.toBe("OLD-PRIVATE-KEY");
  expect(revived?.publicKeyPem).not.toBe("OLD-PUBLIC-KEY");
  expect(revived?.preferredUsername).toBe("alice");
  expect(revived?.takosUserId).toBe("takos-alice-new");
  expect(revived?.deletedAt).toBeNull();

  // --- The stranded Delete's delivery_queue rows are cleared ---
  const remainingJobs = await db
    .select()
    .from(deliveryQueue)
    .where(eq(deliveryQueue.activityApId, deleteActivityId));
  expect(remainingJobs.length).toBe(0);

  // --- The preserved Delete activity rows are cleared ---
  const remainingDeletes = await db
    .select()
    .from(activities)
    .where(and(eq(activities.actorApId, apId), eq(activities.type, "Delete")));
  expect(remainingDeletes.length).toBe(0);

  // The row is no longer a tombstone.
  const liveRow = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(and(eq(actors.apId, apId), isNotNull(actors.deletedAt)))
    .get();
  expect(liveRow).toBeUndefined();
});

test("cancelTombstoneDelete is a no-op (returns 0) for a tombstone with no Delete activity", async () => {
  const db = await freshDb();
  const apId = localApId("bob");
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: "deleted-bob",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "PUB",
    privateKeyPem: "PRIV",
    deletedAt: new Date().toISOString(),
  });

  const cancelled = await cancelTombstoneDelete(db, apId);
  expect(cancelled).toBe(0);
});

test("cancelTombstoneDelete drops all Delete delivery rows including terminal ones", async () => {
  const db = await freshDb();
  const { apId, deleteActivityId } = await seedTombstoneWithDelete(
    db,
    "carol",
    ["pending", "delivered", "dead_letter"],
  );

  const cancelled = await cancelTombstoneDelete(db, apId);
  expect(cancelled).toBe(1);

  const remainingJobs = await db
    .select()
    .from(deliveryQueue)
    .where(eq(deliveryQueue.activityApId, deleteActivityId));
  expect(remainingJobs.length).toBe(0);

  const remainingDeletes = await db
    .select()
    .from(activities)
    .where(eq(activities.apId, deleteActivityId));
  expect(remainingDeletes.length).toBe(0);
});
