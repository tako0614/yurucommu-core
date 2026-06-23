import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, actorCache, activities, follows } from "../../../db/index.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

const APP_URL = "https://yuru.test";

const OLD_ACTOR = "https://remote.example/users/old";
const NEW_ACTOR = "https://remote.example/users/new";
const ALICE = "https://remote.example/users/alice";

// ---------------------------------------------------------------------------
// Module mock — the only network seam these handlers reach is
// `fetchWithTimeout` (used by both `destinationDeclaresAlias` and, transitively
// via `fetchAndUpsertActorCache`, the actor-cache refresh). We stub it so the
// REAL cache-upsert / Move logic runs against an in-memory DB without touching
// the SSRF resolver or the network. `FederationBodyTooLargeError` is re-exported
// untouched because the handler module's import graph still needs it.
// ---------------------------------------------------------------------------

const fetchedUrls: string[] = [];

mock.module("../../lib/federation-fetch.ts", () => ({
  FederationBodyTooLargeError: class FederationBodyTooLargeError extends Error {},
  async fetchWithTimeout(url: string) {
    fetchedUrls.push(url);
    if (url === ALICE) {
      // Refreshed actor document: new display name, avatar, rotated key.
      return new Response(
        JSON.stringify({
          id: ALICE,
          type: "Person",
          preferredUsername: "alice",
          name: "Alice (updated)",
          icon: { url: "https://remote.example/avatar-v2.png" },
          inbox: `${ALICE}/inbox`,
          publicKey: { id: `${ALICE}#main-key`, publicKeyPem: "ROTATED-PEM" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/activity+json" },
        },
      );
    }
    if (url === NEW_ACTOR) {
      // Move destination: declares the old actor in alsoKnownAs (consent), and
      // is a valid actor document so the post-guard cache refresh succeeds too.
      return new Response(
        JSON.stringify({
          id: NEW_ACTOR,
          type: "Person",
          preferredUsername: "new",
          inbox: `${NEW_ACTOR}/inbox`,
          alsoKnownAs: [OLD_ACTOR],
          publicKey: { id: `${NEW_ACTOR}#main-key`, publicKeyPem: "PEM" },
        }),
        {
          status: 200,
          headers: { "content-type": "application/activity+json" },
        },
      );
    }
    return new Response("not found", { status: 404 });
  },
}));

// Imported AFTER the mock is registered so the handler + actor-cache modules
// pick up the stubbed fetch.
const { handleUpdate, handleMove } =
  await import("../../routes/activitypub/handlers/inbox-content-handlers.ts");

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of [
    "0001_init.sql",
    // 0003 rebuilds `activities` dropping the object_ap_id -> objects FK, so the
    // migration re-follow can record an outbound Follow whose object is a remote
    // actor (present only in actor_cache). Production applied this; the fixture
    // must mirror it or D1-style FK enforcement rejects the insert.
    "0003_activity_remote_object_edges.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
  ]) {
    const sql = await readFile(new URL(file, root), "utf8");
    await client.executeMultiple(sql);
  }
  return drizzle(client, { schema }) as unknown as Database;
}

function ctx(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : undefined),
    env: { APP_URL, DB_INSTANCE: db },
  } as unknown as ActivityContext;
}

// `follows.follower_ap_id` / `following_ap_id` both FK -> actors(ap_id), so the
// migration endpoints must exist as actor rows before seeding follow edges.
async function seedActor(
  db: Database,
  apId: string,
  username: string,
): Promise<void> {
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
}

// ---------------------------------------------------------------------------
// #9 — inbound Update(Person) refreshes the cached actor immediately.
// ---------------------------------------------------------------------------

test("handleUpdate(Person) re-fetches and upserts the remote actor immediately", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();

  // Pre-existing stale cache row (old name / avatar / key). `lastFetchedAt`
  // is forced well into the past (the column otherwise defaults to `now`):
  // the inbound-Update handler now applies an amplification cooldown
  // (ACTOR_UPDATE_REFETCH_COOLDOWN_MS) that suppresses the outbound re-fetch
  // when the cached row was fetched within the last minute. A genuinely stale
  // row must look stale, so the re-fetch this test asserts actually fires.
  await db.insert(actorCache).values({
    apId: ALICE,
    type: "Person",
    preferredUsername: "alice",
    name: "Alice (stale)",
    iconUrl: "https://remote.example/avatar-v1.png",
    inbox: `${ALICE}/inbox`,
    publicKeyId: `${ALICE}#main-key`,
    publicKeyPem: "OLD-PEM",
    rawJson: "{}",
    lastFetchedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  });

  const activity: Activity = {
    id: "https://remote.example/activities/upd-1",
    type: "Update",
    actor: ALICE,
    object: { id: ALICE, type: "Person" },
  };

  await handleUpdate(ctx(db), activity, ALICE);

  // The actor was re-fetched from origin (not silently ignored).
  expect(fetchedUrls).toContain(ALICE);

  const row = await db
    .select()
    .from(actorCache)
    .where(eq(actorCache.apId, ALICE))
    .get();
  expect(row?.name).toBe("Alice (updated)");
  expect(row?.publicKeyPem).toBe("ROTATED-PEM");
  expect(row?.iconUrl).toBe("https://remote.example/avatar-v2.png");
});

test("handleUpdate(actor) rejects when the object id does not match the actor", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();

  const activity: Activity = {
    type: "Update",
    actor: ALICE,
    object: {
      // A Person update whose id is some OTHER actor — must not refresh.
      id: "https://remote.example/users/mallory",
      type: "Person",
    },
  };

  await handleUpdate(ctx(db), activity, ALICE);

  expect(fetchedUrls).toEqual([]);
});

// ---------------------------------------------------------------------------
// #19 — handleMove must not materialize self-follow rows when old and new
// actor were already connected.
// ---------------------------------------------------------------------------

test("handleMove does not create self-follow rows when old/new were already connected", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();

  const localFollower = `${APP_URL}/ap/users/bob`;

  await seedActor(db, OLD_ACTOR, "old");
  await seedActor(db, NEW_ACTOR, "new");
  await seedActor(db, localFollower, "bob");

  // Pre-existing connections that, after the migration, would collapse into a
  // self-edge unless filtered:
  //   1. old -> new (old follows new): rewriting follower old->new yields
  //                  (new -> new), a self-follow.
  //   2. new -> old (new follows old): rewriting following old->new yields
  //                  (new -> new), a self-follow.
  // Plus a genuine local follower of old that must migrate to new.
  await db.insert(follows).values([
    { followerApId: OLD_ACTOR, followingApId: NEW_ACTOR, status: "accepted" },
    { followerApId: NEW_ACTOR, followingApId: OLD_ACTOR, status: "accepted" },
    {
      followerApId: localFollower,
      followingApId: OLD_ACTOR,
      status: "accepted",
    },
  ]);

  const activity: Activity = {
    type: "Move",
    actor: OLD_ACTOR,
    object: OLD_ACTOR,
    target: NEW_ACTOR,
  };

  await handleMove(ctx(db), activity, OLD_ACTOR);

  // No self-follow rows were created.
  const selfRows = await db
    .select()
    .from(follows)
    .where(eq(follows.followerApId, follows.followingApId));
  expect(selfRows.length).toBe(0);

  // The genuine local follower edge was migrated to the new actor.
  const migrated = await db
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, localFollower),
        eq(follows.followingApId, NEW_ACTOR),
      ),
    )
    .get();
  expect(migrated).toBeDefined();

  // The migrated LOCAL follower is re-issued as a *pending* Follow: the
  // destination server has not Accepted yet, and a bare accepted edge would
  // leave the local user receiving nothing (the destination never learned of
  // the follow).
  expect(migrated?.status).toBe("pending");

  // A fresh outbound Follow to the new actor was recorded (and enqueued for
  // delivery) so the destination registers the local user as a follower. The
  // recorded activity id matches the migrated edge's activity_ap_id.
  const reFollow = await db
    .select()
    .from(activities)
    .where(
      and(
        eq(activities.actorApId, localFollower),
        eq(activities.objectApId, NEW_ACTOR),
      ),
    )
    .get();
  expect(reFollow?.type).toBe("Follow");
  expect(reFollow?.direction).toBe("outbound");
  expect(reFollow?.apId).toBe(migrated!.activityApId!);

  // The old actor no longer appears anywhere in the follow graph.
  const oldFollower = await db
    .select()
    .from(follows)
    .where(eq(follows.followerApId, OLD_ACTOR))
    .get();
  expect(oldFollower).toBeUndefined();
  const oldFollowing = await db
    .select()
    .from(follows)
    .where(eq(follows.followingApId, OLD_ACTOR))
    .get();
  expect(oldFollowing).toBeUndefined();
});

// ---------------------------------------------------------------------------
// handleMove must not inflate a local follower's followingCount. A local user
// who followed the migrating (old) actor had that ACCEPTED edge counted in
// followingCount. handleMove deletes the old edge and re-issues a PENDING Follow
// to the new actor; the destination's later Accept does followingCount +1. If
// the delete does not first remove the old +1, the Accept stacks a SECOND +1 →
// a permanent over-count. The fix decrements at delete time so the count tracks
// reality across the whole migration (and in the pending window in between).
// ---------------------------------------------------------------------------

test("handleMove decrements a migrated local follower's followingCount so the re-follow Accept does not over-count", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();

  const localFollower = `${APP_URL}/ap/users/carol`;

  await seedActor(db, OLD_ACTOR, "old");
  await seedActor(db, NEW_ACTOR, "new");
  await seedActor(db, localFollower, "carol");

  // Carol follows the old (migrating) actor — an ACCEPTED edge counted in her
  // followingCount.
  await db
    .update(actors)
    .set({ followingCount: 1 })
    .where(eq(actors.apId, localFollower));
  await db.insert(follows).values([
    {
      followerApId: localFollower,
      followingApId: OLD_ACTOR,
      status: "accepted",
    },
  ]);

  const activity: Activity = {
    type: "Move",
    actor: OLD_ACTOR,
    object: OLD_ACTOR,
    target: NEW_ACTOR,
  };

  await handleMove(ctx(db), activity, OLD_ACTOR);

  // The migrated edge to the new actor is PENDING (the destination will +1 on
  // Accept), so the old +1 must already be gone: Carol's followingCount drops to
  // 0 during the pending window. (Was: stayed 1 → after Accept would read 2.)
  const carol = await db
    .select()
    .from(actors)
    .where(eq(actors.apId, localFollower))
    .get();
  expect(carol?.followingCount).toBe(0);

  // Sanity: the relationship really did migrate to a pending edge.
  const migrated = await db
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, localFollower),
        eq(follows.followingApId, NEW_ACTOR),
      ),
    )
    .get();
  expect(migrated?.status).toBe("pending");
});

// Audit #18: the FOLLOWEE-side mirror of the followingCount fix. When the old
// actor's ACCEPTED follow of a LOCAL actor L is dedup-DROPPED (the new actor
// already follows L), the (old->L) edge is deleted but no rewrite re-adds it, so
// L.followerCount must be decremented or it stays permanently +1 over.
test("handleMove decrements a dedup-dropped local followee's followerCount", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();

  const localFollowee = `${APP_URL}/ap/users/lia`;
  await seedActor(db, OLD_ACTOR, "old");
  await seedActor(db, NEW_ACTOR, "new");
  await seedActor(db, localFollowee, "lia");
  // L is followed by BOTH old and new (each +1'd L.followerCount → 2).
  await db
    .update(actors)
    .set({ followerCount: 2 })
    .where(eq(actors.apId, localFollowee));
  await db.insert(follows).values([
    {
      followerApId: OLD_ACTOR,
      followingApId: localFollowee,
      status: "accepted",
    },
    {
      followerApId: NEW_ACTOR,
      followingApId: localFollowee,
      status: "accepted",
    },
  ]);

  await handleMove(
    ctx(db),
    { type: "Move", actor: OLD_ACTOR, object: OLD_ACTOR, target: NEW_ACTOR },
    OLD_ACTOR,
  );

  // The (old->L) rewrite was dropped (new already follows L) and the edge deleted,
  // so L now has exactly ONE follower (new) and followerCount reconciled to 1.
  expect(
    (
      await db
        .select()
        .from(follows)
        .where(eq(follows.followingApId, localFollowee))
    ).length,
  ).toBe(1);
  const l = await db
    .select({ fc: actors.followerCount })
    .from(actors)
    .where(eq(actors.apId, localFollowee))
    .get();
  expect(l?.fc).toBe(1);
});
