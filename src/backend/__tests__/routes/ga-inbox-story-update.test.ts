import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actorCache, actors, objects } from "../../../db/index.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

const ALICE = "https://remote.example/users/alice";
const STORY_ID = "https://remote.example/stories/s1";

// ---------------------------------------------------------------------------
// Module mock — the only network seam these handlers reach is
// `fetchWithTimeout` (used transitively via `fetchAndUpsertActorCache` for the
// Update(actor) re-fetch). We stub it and COUNT the calls so the cooldown
// behaviour is observable, while the real cache-upsert / story-insert logic
// runs against an in-memory DB without touching the SSRF resolver or network.
// ---------------------------------------------------------------------------

const fetchedUrls: string[] = [];

mock.module("../../lib/federation-fetch.ts", () => ({
  FederationBodyTooLargeError: class FederationBodyTooLargeError extends Error {},
  async fetchWithTimeout(url: string) {
    fetchedUrls.push(url);
    if (url === ALICE) {
      return new Response(
        JSON.stringify({
          id: ALICE,
          type: "Person",
          preferredUsername: "alice",
          name: "Alice (updated)",
          inbox: `${ALICE}/inbox`,
          publicKey: { id: `${ALICE}#main-key`, publicKeyPem: "PEM" },
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
const { handleCreateStory, handleUpdate } = await import(
  "../../routes/activitypub/handlers/inbox-content-handlers.ts"
);

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of [
    "0001_init.sql",
    "0005_story_community_scope.sql",
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

function storyActivity(): Activity {
  return {
    id: "https://remote.example/activities/create-story-1",
    type: "Create",
    actor: ALICE,
    object: {
      id: STORY_ID,
      type: "Story",
      content: "hi from a story",
      attachment: {
        url: "https://remote.example/media/s1.jpg",
        mediaType: "image/jpeg",
        width: 1080,
        height: 1920,
      },
    },
  } as unknown as Activity;
}

// ---------------------------------------------------------------------------
// #16 — handleCreateStory must dedup race-safely: a second delivery of the same
// story (TOCTOU after the existence check) must not create a duplicate row.
// ---------------------------------------------------------------------------

test("handleCreateStory dedups a redelivered remote story (onConflictDoNothing)", async () => {
  const db = await freshDb();

  // `objects.attributed_to` FK -> actors(ap_id), so the remote author must
  // exist as an actor row before the story object can be inserted.
  await db.insert(actors).values({
    apId: ALICE,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${ALICE}/inbox`,
    outbox: `${ALICE}/outbox`,
    followersUrl: `${ALICE}/followers`,
    followingUrl: `${ALICE}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });

  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");
  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");

  const rows = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, STORY_ID));
  expect(rows.length).toBe(1);
  expect(rows[0]?.type).toBe("Story");
});

// ---------------------------------------------------------------------------
// #13 — inbound Update(actor) re-fetch is rate-limited: a recently-fetched
// cache row suppresses the outbound re-fetch (amplification guard), while a
// stale row still triggers it.
// ---------------------------------------------------------------------------

test("handleUpdate(actor) skips re-fetch when cache was fetched within cooldown", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();

  // Fresh cache row (just fetched) — within the cooldown window.
  await db.insert(actorCache).values({
    apId: ALICE,
    type: "Person",
    preferredUsername: "alice",
    name: "Alice (cached)",
    inbox: `${ALICE}/inbox`,
    publicKeyId: `${ALICE}#main-key`,
    publicKeyPem: "PEM",
    rawJson: "{}",
    lastFetchedAt: new Date().toISOString(),
  });

  const activity: Activity = {
    id: "https://remote.example/activities/upd-1",
    type: "Update",
    actor: ALICE,
    object: { id: ALICE, type: "Person" },
  };

  await handleUpdate(ctx(db), activity, ALICE);

  // No outbound re-fetch was made; we relied on the existing cache row.
  expect(fetchedUrls).toEqual([]);
});

test("handleUpdate(actor) re-fetches when the cached row is older than the cooldown", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();

  // Stale cache row (fetched well outside the cooldown window).
  await db.insert(actorCache).values({
    apId: ALICE,
    type: "Person",
    preferredUsername: "alice",
    name: "Alice (stale)",
    inbox: `${ALICE}/inbox`,
    publicKeyId: `${ALICE}#main-key`,
    publicKeyPem: "OLD-PEM",
    rawJson: "{}",
    lastFetchedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  });

  const activity: Activity = {
    id: "https://remote.example/activities/upd-2",
    type: "Update",
    actor: ALICE,
    object: { id: ALICE, type: "Person" },
  };

  await handleUpdate(ctx(db), activity, ALICE);

  // The stale row triggered a fresh re-fetch + upsert.
  expect(fetchedUrls).toContain(ALICE);
  const row = await db
    .select()
    .from(actorCache)
    .where(eq(actorCache.apId, ALICE))
    .get();
  expect(row?.name).toBe("Alice (updated)");
});

// A cold (no-cache) Update(actor) must still re-fetch so first-seen actor
// documents are populated rather than skipped by the cooldown.
test("handleUpdate(actor) re-fetches when no cache row exists yet", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();

  const activity: Activity = {
    id: "https://remote.example/activities/upd-3",
    type: "Update",
    actor: ALICE,
    object: { id: ALICE, type: "Person" },
  };

  await handleUpdate(ctx(db), activity, ALICE);

  expect(fetchedUrls).toContain(ALICE);
});
