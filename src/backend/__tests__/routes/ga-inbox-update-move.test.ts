import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, actorCache, follows } from "../../../db/index.ts";
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

  // Pre-existing stale cache row (old name / avatar / key).
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
