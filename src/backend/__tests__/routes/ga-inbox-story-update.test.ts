import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actorCache, actors, blocks, objects } from "../../../db/index.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

const ALICE = "https://remote.example/users/alice";
const STORY_ID = "https://remote.example/stories/s1";
const FETCHED_NOTE_ID = "https://remote.example/objects/fetched-late-parent";
const FETCHED_REPLY_ID = "https://remote.example/objects/fetched-reply";
const FETCHED_FORGED_REPLY_ID =
  "https://remote.example/objects/fetched-forged-reply";

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
    if (url === FETCHED_NOTE_ID) {
      return new Response(
        JSON.stringify({
          id: FETCHED_NOTE_ID,
          type: "Note",
          attributedTo: ALICE,
          content: "fetched parent",
          to: ["https://www.w3.org/ns/activitystreams#Public"],
        }),
        {
          status: 200,
          headers: { "content-type": "application/activity+json" },
        },
      );
    }
    if (url === FETCHED_REPLY_ID || url === FETCHED_FORGED_REPLY_ID) {
      return new Response(
        JSON.stringify({
          id: url,
          type: "Note",
          attributedTo: ALICE,
          content: "fetched reply",
          inReplyTo:
            url === FETCHED_REPLY_ID
              ? "https://yuru.test/ap/objects/public-parent"
              : "https://yuru.test/ap/objects/direct-parent",
          to: ["https://www.w3.org/ns/activitystreams#Public"],
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
const { fetchAndPersistAnnouncedNote, handleCreateStory, handleUpdate } =
  await import("../../routes/activitypub/handlers/inbox-content-handlers.ts");

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of [
    "0001_init.sql",
    "0004_blocklist.sql",
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

test("a Story arriving after an indexed reply reconstructs and repairs replyCount", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await db.insert(objects).values({
    apId: "https://remote.example/objects/story-reply",
    type: "Note",
    attributedTo: ALICE,
    content: "early reply",
    inReplyTo: STORY_ID,
    isLocal: 0,
  });

  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");
  expect(
    (
      await db
        .select({ replyCount: objects.replyCount })
        .from(objects)
        .where(eq(objects.apId, STORY_ID))
        .get()
    )?.replyCount,
  ).toBe(1);

  await db
    .update(objects)
    .set({ replyCount: 0 })
    .where(eq(objects.apId, STORY_ID));
  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");
  expect(
    (
      await db
        .select({ replyCount: objects.replyCount })
        .from(objects)
        .where(eq(objects.apId, STORY_ID))
        .get()
    )?.replyCount,
  ).toBe(1);
});

test("an Announce-fetched parent arriving after a reply reconstructs replyCount", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();
  await seedAlice(db);
  await db.insert(objects).values({
    apId: "https://remote.example/objects/fetched-parent-reply",
    type: "Note",
    attributedTo: ALICE,
    content: "early fetched-parent reply",
    inReplyTo: FETCHED_NOTE_ID,
    isLocal: 0,
  });

  expect(
    await fetchAndPersistAnnouncedNote(
      db,
      FETCHED_NOTE_ID,
      "https://yuru.test",
    ),
  ).toBe(true);
  expect(fetchedUrls).toContain(FETCHED_NOTE_ID);
  expect(
    (
      await db
        .select({ replyCount: objects.replyCount })
        .from(objects)
        .where(eq(objects.apId, FETCHED_NOTE_ID))
        .get()
    )?.replyCount,
  ).toBe(1);
});

test("an Announce-fetched reply recomputes its already-retained public parent", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();
  await seedAlice(db);
  const bob = "https://yuru.test/ap/users/bob";
  await seedActor(db, bob, "bob");
  const parentId = "https://yuru.test/ap/objects/public-parent";
  await db.insert(objects).values({
    apId: parentId,
    type: "Note",
    attributedTo: bob,
    content: "public parent",
    visibility: "public",
    replyCount: 0,
    isLocal: 1,
  });

  expect(
    await fetchAndPersistAnnouncedNote(
      db,
      FETCHED_REPLY_ID,
      "https://yuru.test",
    ),
  ).toBe(true);
  expect(
    (
      await db
        .select({ replyCount: objects.replyCount })
        .from(objects)
        .where(eq(objects.apId, parentId))
        .get()
    )?.replyCount,
  ).toBe(1);
});

test("an Announce-fetched reply cannot inject beneath an unreadable direct parent", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();
  await seedAlice(db);
  const bob = "https://yuru.test/ap/users/bob";
  await seedActor(db, bob, "bob");
  const parentId = "https://yuru.test/ap/objects/direct-parent";
  await db.insert(objects).values({
    apId: parentId,
    type: "Note",
    attributedTo: bob,
    content: "private parent",
    visibility: "direct",
    toJson: JSON.stringify([bob]),
    ccJson: "[]",
    replyCount: 0,
    isLocal: 1,
  });

  expect(
    await fetchAndPersistAnnouncedNote(
      db,
      FETCHED_FORGED_REPLY_ID,
      "https://yuru.test",
    ),
  ).toBe(false);
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, FETCHED_FORGED_REPLY_ID))
      .get(),
  ).toBeUndefined();
  expect(
    (
      await db
        .select({ replyCount: objects.replyCount })
        .from(objects)
        .where(eq(objects.apId, parentId))
        .get()
    )?.replyCount,
  ).toBe(0);
});

// ---------------------------------------------------------------------------
// Audit #15 #5 — a hostile remote must not Create() an unbounded number of
// Stories: once an author already holds MAX_INBOUND_STORIES_PER_ACTOR (50) live
// (non-expired) remote stories, a further inbound story is dropped.
// ---------------------------------------------------------------------------

test("handleCreateStory drops a new story once the author hits the live-story cap", async () => {
  const db = await freshDb();
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

  // Seed exactly 50 LIVE (future endTime) remote stories for ALICE.
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  for (let i = 0; i < 50; i++) {
    await db.insert(objects).values({
      apId: `${ALICE}/stories/live-${i}`,
      type: "Story",
      attributedTo: ALICE,
      content: "",
      attachmentsJson: "{}",
      endTime: future,
      published: new Date().toISOString(),
      isLocal: 0,
    });
  }

  // A fresh inbound story (distinct id) is rejected — the cap is hit.
  const capped = {
    id: "https://remote.example/activities/create-story-capped",
    type: "Create",
    actor: ALICE,
    object: {
      id: "https://remote.example/stories/s-capped",
      type: "Story",
      content: "one too many",
      attachment: {
        url: "https://remote.example/media/capped.jpg",
        mediaType: "image/jpeg",
        width: 1080,
        height: 1920,
      },
    },
  } as unknown as Activity;
  await handleCreateStory(ctx(db), capped, ALICE, "https://yuru.test");

  const cappedRow = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, "https://remote.example/stories/s-capped"));
  expect(cappedRow.length).toBe(0);

  // An EXPIRED story does not count toward the live cap: after one of the 50
  // expires, a new inbound story is accepted again.
  await db
    .update(objects)
    .set({ endTime: new Date(Date.now() - 60 * 60 * 1000).toISOString() })
    .where(eq(objects.apId, `${ALICE}/stories/live-0`));
  await handleCreateStory(ctx(db), capped, ALICE, "https://yuru.test");
  const acceptedRow = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, "https://remote.example/stories/s-capped"));
  expect(acceptedRow.length).toBe(1);
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

// ---------------------------------------------------------------------------
// A malicious remote must not create a never-expiring story: handleCreateStory
// clamps an attacker far-future / non-ISO endTime to published + ~25h.
// ---------------------------------------------------------------------------

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

async function seedAlice(db: Database): Promise<void> {
  await seedActor(db, ALICE, "alice");
}

function storyWithEndTime(endTime: string, id: string): Activity {
  return {
    id,
    type: "Create",
    actor: ALICE,
    object: {
      id: STORY_ID,
      type: "Story",
      content: "x",
      attachment: {
        url: "https://remote.example/media/s.jpg",
        mediaType: "image/jpeg",
      },
      published: "2026-06-21T00:00:00.000Z",
      endTime,
    },
  } as unknown as Activity;
}

test("handleCreateStory clamps a far-future inbound endTime so the story still expires", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await handleCreateStory(
    ctx(db),
    storyWithEndTime("9999-01-01T00:00:00.000Z", "https://remote.example/a/ff"),
    ALICE,
    "https://yuru.test",
  );
  const row = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  const publishedMs = Date.parse("2026-06-21T00:00:00.000Z");
  const stored = Date.parse(row!.endTime!);
  expect(Number.isNaN(stored)).toBe(false);
  expect(stored).toBeLessThanOrEqual(publishedMs + 25 * 60 * 60 * 1000);
});

test("handleCreateStory clamps a non-ISO inbound endTime to a valid future instant", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await handleCreateStory(
    ctx(db),
    storyWithEndTime("not-a-date", "https://remote.example/a/gb"),
    ALICE,
    "https://yuru.test",
  );
  const row = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  // Stored endTime must be a parseable ISO instant (so the lexical expiry
  // compare works), not the garbage string.
  expect(Number.isNaN(Date.parse(row!.endTime!))).toBe(false);
});

// A malicious remote must not pin its post to the top of every desc(published)
// feed forever by claiming a far-future `published` (which is VALID ISO so it
// parses, yet lexically dominates every real timestamp). handleCreate* clamps a
// future-dated published down to ~now; the endTime expiry bound is anchored to
// the clamped value so it can't escape either.
test("handleCreateStory clamps a far-future inbound published so it cannot dominate feed ordering", async () => {
  const db = await freshDb();
  await seedAlice(db);
  const activity = {
    id: "https://remote.example/a/fp",
    type: "Create",
    actor: ALICE,
    object: {
      id: STORY_ID,
      type: "Story",
      content: "x",
      attachment: {
        url: "https://remote.example/media/s.jpg",
        mediaType: "image/jpeg",
      },
      published: "9999-12-31T23:59:59Z",
      endTime: "9999-12-31T23:59:59Z",
    },
  } as unknown as Activity;
  await handleCreateStory(ctx(db), activity, ALICE, "https://yuru.test");

  const row = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  const publishedMs = Date.parse(row!.published!);
  expect(Number.isNaN(publishedMs)).toBe(false);
  // Clamped to ~now (not the year-9999 value), so it sorts with real posts.
  expect(publishedMs).toBeLessThanOrEqual(Date.now() + 60_000);
  // And the story still expires — endTime stayed anchored to the clamped now.
  expect(Date.parse(row!.endTime!)).toBeLessThanOrEqual(
    Date.now() + 26 * 60 * 60 * 1000,
  );
});

// Audit #19: an inbound Create(Story) from an actor the local owner has blocked
// must be dropped — parity with the inbound DM/Like/Announce/Follow/reply block
// gates. Without it a blocked actor's story is stored (cap consumption + GET
// /api/posts/:id retrievability).
test("inbound Create(Story) from a blocked actor is dropped (not stored)", async () => {
  const db = await freshDb();
  const owner = "https://yuru.test/ap/users/tako";
  await db.insert(actors).values({
    apId: owner,
    type: "Person",
    preferredUsername: "tako",
    inbox: `${owner}/inbox`,
    outbox: `${owner}/outbox`,
    followersUrl: `${owner}/followers`,
    followingUrl: `${owner}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
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
  // The owner blocks the remote story author.
  await db.insert(blocks).values({ blockerApId: owner, blockedApId: ALICE });

  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");

  expect(
    (await db.select().from(objects).where(eq(objects.apId, STORY_ID))).length,
  ).toBe(0);
});
