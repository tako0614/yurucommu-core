import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #4 (ACTORS-DELETE) — POST /me/delete must still be able to SIGN and
 * deliver the outbound Delete(actor) after teardown.
 *
 * Previously teardown hard-deleted the actor row (incl. its private key) while
 * the queued Delete(actor) deliver_endpoint jobs were only snapshotted, not yet
 * drained. When those jobs later ran, resolveSigningActor() found no key, so the
 * Delete could never be signed/delivered.
 *
 * The fix TOMBSTONES the actor identity (sets `deletedAt`, scrubs personal data,
 * but preserves `privateKeyPem`/`publicKeyPem` + the signer-relevant fields) and
 * hard-deletes the personal data (posts, follows, sessions, media + the backing
 * R2 blobs, notification rows). This test asserts:
 *   - the Delete activity row survives teardown and a deliver job references it;
 *   - the signing key is STILL resolvable for the tombstoned actor;
 *   - the actor row is excluded from normal (notDeleted) federation queries;
 *   - personal data + media_uploads + R2 blobs + notification rows are gone.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq, isNull } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  actors,
  activities,
  deliveryQueue,
  follows,
  mediaUploads,
  notificationArchived,
  objects,
  sessions,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoutes from "../../routes/actors.ts";

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
  // Account teardown deletes notification pusher + push-job rows.
  "0019_notification_push_delivery.sql",
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

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
  const apId = localApId(username);
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    name: `Display ${username}`,
    summary: "bio",
    iconUrl: "https://yuru.test/icon.png",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "PUBLIC-KEY",
    privateKeyPem: "PRIVATE-KEY",
    takosUserId: `takos-${username}`,
    followerCount: 1,
    postCount: 1,
  });
  return apId;
}

function fakeActor(apId: string, username: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: `Display ${username}`,
    summary: "bio",
    icon_url: "https://yuru.test/icon.png",
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "PUBLIC-KEY",
    private_key_pem: "PRIVATE-KEY",
    takos_user_id: `takos-${username}`,
    follower_count: 1,
    following_count: 0,
    post_count: 1,
    is_private: 0,
    role: "member",
    created_at: new Date().toISOString(),
  } as unknown as Actor;
}

// Capturing queue stub: snapshotAndEnqueueFollowerDeliveries needs a present
// DELIVERY_QUEUE binding; the deliver job rows are written to the DB by
// upsertDeliveryJob regardless of whether the queue messages are consumed.
function captureQueue() {
  const sent: unknown[] = [];
  return {
    queue: {
      async send(msg: unknown) {
        sent.push(msg);
      },
      async sendBatch(batch: Array<{ body: unknown }>) {
        for (const m of batch) sent.push(m.body);
      },
    },
    sent,
  };
}

// Minimal R2 stub that records which keys were deleted.
function memoryR2() {
  const store = new Map<string, Uint8Array>();
  const deleted: string[] = [];
  return {
    storage: {
      async put(key: string, value: Uint8Array) {
        store.set(key, value);
      },
      async get(key: string) {
        const v = store.get(key);
        if (!v) return null;
        return { body: new Blob([v.slice()]).stream() };
      },
      async delete(key: string | string[]) {
        const keys = Array.isArray(key) ? key : [key];
        for (const k of keys) {
          deleted.push(k);
          store.delete(k);
        }
      },
    },
    has: (k: string) => store.has(k),
    deleted,
  };
}

function envFor(
  db: Database,
  queue: ReturnType<typeof captureQueue>["queue"],
  media: ReturnType<typeof memoryR2>["storage"],
): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    MEDIA: media,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
  } as unknown as Env;
}

function appWith(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", actorsRoutes);
  return app;
}

test("after /me/delete the Delete(actor) deliver job can still resolve a signing key; personal data + media rows are gone", async () => {
  const db = await freshDb();
  const { queue } = captureQueue();
  const r2 = memoryR2();
  const env = envFor(db, queue, r2.storage);

  const aliceApId = await insertLocalActor(db, "alice");

  // A remote follower with a fresh actor_cache entry → produces a deliver job.
  const remoteApId = "https://remote.test/users/bob";
  await db.insert(follows).values({
    followerApId: remoteApId,
    followingApId: aliceApId,
    status: "accepted",
  });
  await db.insert(actorCache).values({
    apId: remoteApId,
    type: "Person",
    inbox: "https://remote.test/users/bob/inbox",
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });

  // A live session so we can confirm auth severance.
  await db.insert(sessions).values({
    id: "sess-1",
    memberId: aliceApId,
    accessToken: "tok-1",
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  });

  // A post authored by alice.
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/p1`,
    type: "Note",
    attributedTo: aliceApId,
    content: "hello",
    visibility: "public",
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    isLocal: 1,
  });

  // Media owned by alice, with a backing R2 object.
  const r2Key = "uploads/abc123.png";
  await r2.storage.put(r2Key, new Uint8Array([1, 2, 3]));
  await db.insert(mediaUploads).values({
    id: "abc123",
    r2Key,
    uploaderApId: aliceApId,
    contentType: "image/png",
    size: 3,
  });

  // A notification (archived projection) for alice.
  await db.insert(notificationArchived).values({
    actorApId: aliceApId,
    activityApId: `${APP_URL}/ap/activities/n1`,
  });

  // Sanity: blob present before deletion.
  expect(r2.has(r2Key)).toBe(true);

  const app = appWith(db, fakeActor(aliceApId, "alice"));
  const res = await app.fetch(
    new Request(`${APP_URL}/me/delete`, { method: "POST" }),
    env,
  );
  expect(res.status).toBe(200);

  // --- The Delete(actor) activity survives teardown ---
  const deleteActivity = await db
    .select()
    .from(activities)
    .where(
      and(eq(activities.actorApId, aliceApId), eq(activities.type, "Delete")),
    )
    .get();
  expect(deleteActivity).toBeTruthy();
  expect(deleteActivity?.objectApId).toBe(aliceApId);

  // --- A deliver job references the Delete activity (snapshotted before the
  //     follows row was deleted) ---
  const jobs = await db
    .select()
    .from(deliveryQueue)
    .where(eq(deliveryQueue.activityApId, deleteActivity!.apId));
  expect(jobs.length).toBeGreaterThan(0);
  expect(jobs[0].inboxUrl).toBe("https://remote.test/users/bob/inbox");

  // --- The signing key is STILL resolvable for the tombstoned actor. This is
  //     exactly what resolveSigningActor() reads (actors row by apId,
  //     unfiltered by deletedAt) when the deliver job later drains. ---
  const signingRow = await db
    .select({
      apId: actors.apId,
      privateKeyPem: actors.privateKeyPem,
      deletedAt: actors.deletedAt,
    })
    .from(actors)
    .where(eq(actors.apId, aliceApId))
    .get();
  expect(signingRow).toBeTruthy();
  expect(signingRow?.privateKeyPem).toBe("PRIVATE-KEY");
  // Tombstoned: excluded from all notDeleted(...) federation/auth queries.
  expect(signingRow?.deletedAt).toBeTruthy();

  const liveRow = await db
    .select({ apId: actors.apId })
    .from(actors)
    .where(and(eq(actors.apId, aliceApId), isNull(actors.deletedAt)))
    .get();
  expect(liveRow).toBeUndefined();

  // Personal profile data scrubbed from the tombstone.
  const scrubbed = await db
    .select({
      name: actors.name,
      summary: actors.summary,
      takosUserId: actors.takosUserId,
      followerCount: actors.followerCount,
    })
    .from(actors)
    .where(eq(actors.apId, aliceApId))
    .get();
  expect(scrubbed?.name).toBeNull();
  expect(scrubbed?.summary).toBeNull();
  expect(scrubbed?.takosUserId).toBeNull();
  expect(scrubbed?.followerCount).toBe(0);

  // --- Personal data is gone ---
  const remainingObjects = await db
    .select()
    .from(objects)
    .where(eq(objects.attributedTo, aliceApId));
  expect(remainingObjects.length).toBe(0);

  const remainingFollows = await db
    .select()
    .from(follows)
    .where(eq(follows.followingApId, aliceApId));
  expect(remainingFollows.length).toBe(0);

  const remainingSessions = await db
    .select()
    .from(sessions)
    .where(eq(sessions.memberId, aliceApId));
  expect(remainingSessions.length).toBe(0);

  // --- Media rows + R2 blobs gone ---
  const remainingMedia = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.uploaderApId, aliceApId));
  expect(remainingMedia.length).toBe(0);
  expect(r2.deleted).toContain(r2Key);
  expect(r2.has(r2Key)).toBe(false);

  // --- Notification rows gone ---
  const remainingNotifs = await db
    .select()
    .from(notificationArchived)
    .where(eq(notificationArchived.actorApId, aliceApId));
  expect(remainingNotifs.length).toBe(0);
});
