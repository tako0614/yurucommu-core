import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * Wave-6 FK-REVERT regression — federation ingest must not be blocked by
 * engine-level foreign keys.
 *
 * Remote actors are stored ONLY in `actor_cache`, never in `actors`. Yet the
 * migrations declare FK edges from objects.attributed_to / follows.* /
 * likes.actor_ap_id / announces.actor_ap_id onto `actors(ap_id)`. Cloudflare
 * D1 ignores these FK constraints, but a Wave-2 change had turned on
 * `PRAGMA foreign_keys = ON` for the Bun/libsql connections. With enforcement
 * ON, EVERY inbound federated activity from a remote actor violates the FK and
 * the insert throws — silently dropping or 500-ing inbound federation. The
 * existing inbox/handler tests missed this because they use a hand-rolled mock
 * db that never enforces FKs.
 *
 * This test runs the REAL migrations against a real libsql :memory: DB with FK
 * enforcement OFF (mirroring the reverted production config that now matches
 * D1) and asserts that an object / follow / like / announce attributed to a
 * remote actor that lives only in actor_cache INSERTS successfully.
 *
 * It also asserts the negative: with `PRAGMA foreign_keys = ON` the SAME
 * inserts throw. That locks in the divergence rationale and guards against
 * anyone naively re-enabling the pragma.
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";

import * as schema from "../../db/schema.ts";
import type { Database } from "../../db/index.ts";
import {
  actorCache,
  announces,
  follows,
  likes,
  objects,
} from "../../db/index.ts";

const APP_URL = "https://yuru.test";
const REMOTE = "https://remote.example/users/alice";
const LOCAL = `${APP_URL}/ap/users/host`;

// Apply every real migration, in order, exactly as the server does.
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

async function migrate(client: Client): Promise<void> {
  const root = new URL("../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
}

/**
 * Fresh DB whose FK enforcement matches the reverted production config. Note
 * libsql (unlike bun:sqlite / stock SQLite) defaults foreign_keys ON, so —
 * exactly like src/db/index.ts — this must explicitly turn them OFF to match
 * Cloudflare D1's ignore-FK behaviour.
 */
async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  await migrate(client);
  await client.execute("PRAGMA foreign_keys = OFF");
  return drizzle(client, { schema }) as unknown as Database;
}

async function seedRemoteActorAndLocalObject(db: Database): Promise<void> {
  // The remote actor exists ONLY in actor_cache (this is how federation
  // stores remote actors); it is intentionally NOT in `actors`.
  await db.insert(actorCache).values({
    apId: REMOTE,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${REMOTE}/inbox`,
    rawJson: "{}",
  });

  // A local actor + a local object so the remote like/announce has a target.
  await db.insert(schema.actors).values({
    apId: LOCAL,
    type: "Person",
    preferredUsername: "host",
    inbox: `${LOCAL}/inbox`,
    outbox: `${LOCAL}/outbox`,
    followersUrl: `${LOCAL}/followers`,
    followingUrl: `${LOCAL}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(objects).values({
    apId: `${LOCAL}/objects/1`,
    type: "Note",
    attributedTo: LOCAL,
    content: "local post",
  });
}

test("federation ingest: remote-actor object/follow/like/announce inserts with FK off", async () => {
  const db = await freshDb();
  await seedRemoteActorAndLocalObject(db);

  const remoteObjectId = `${REMOTE}/objects/1`;

  // Object whose attributed_to FK-references actors(ap_id) but resolves to a
  // remote actor that lives only in actor_cache.
  await db.insert(objects).values({
    apId: remoteObjectId,
    type: "Note",
    attributedTo: REMOTE,
    content: "hello from a remote actor",
    isLocal: 0,
  });

  // Remote actor follows a local actor (follower_ap_id FK -> actors).
  await db.insert(follows).values({
    followerApId: REMOTE,
    followingApId: LOCAL,
    status: "accepted",
  });

  // Remote actor likes a local object (actor_ap_id FK -> actors).
  await db.insert(likes).values({
    actorApId: REMOTE,
    objectApId: `${LOCAL}/objects/1`,
  });

  // Remote actor announces a local object (actor_ap_id FK -> actors).
  await db.insert(announces).values({
    actorApId: REMOTE,
    objectApId: `${LOCAL}/objects/1`,
  });

  // Everything landed — federation ingest works.
  const remoteObjects = await db.select().from(objects);
  expect(remoteObjects.some((o) => o.apId === remoteObjectId)).toBe(true);

  const followRows = await db.select().from(follows);
  expect(followRows.length).toBe(1);
  expect(followRows[0]?.followerApId).toBe(REMOTE);

  const likeRows = await db.select().from(likes);
  expect(likeRows.length).toBe(1);

  const announceRows = await db.select().from(announces);
  expect(announceRows.length).toBe(1);
});

test("guard: enabling PRAGMA foreign_keys=ON would re-break remote-actor ingest", async () => {
  const client = createClient({ url: ":memory:" });
  await migrate(client);
  // Naive re-enable of the pragma reverted in this wave.
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema }) as unknown as Database;

  await seedRemoteActorAndLocalObject(db);

  const remoteObjectId = `${REMOTE}/objects/2`;

  // With FK enforcement ON, an object attributed to a remote actor (present in
  // actor_cache but not actors) violates the actors(ap_id) FK and throws.
  await expect(
    (async () =>
      db
        .insert(objects)
        .values({
          apId: remoteObjectId,
          type: "Note",
          attributedTo: REMOTE,
          content: "would be rejected under FK enforcement",
          isLocal: 0,
        })
        .execute())(),
  ).rejects.toThrow();
});
