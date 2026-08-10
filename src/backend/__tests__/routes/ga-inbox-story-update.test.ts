import { expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  actors,
  blocks,
  communities,
  follows,
  mutes,
  objects,
  storyVotes,
} from "../../../db/index.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";

const ALICE = "https://remote.example/users/alice";
const STORY_ID = "https://remote.example/stories/s1";
const COMMUNITY_ID = "https://yuru.test/ap/groups/town";
const COMMUNITY_FOLLOWERS = `${COMMUNITY_ID}/followers`;
const FETCHED_NOTE_ID = "https://remote.example/objects/fetched-late-parent";
const FETCHED_REPLY_ID = "https://remote.example/objects/fetched-reply";
const FETCHED_FORGED_REPLY_ID =
  "https://remote.example/objects/fetched-forged-reply";
const FETCHED_OVERSIZED_ADDRESSING_ID =
  "https://remote.example/objects/fetched-oversized-addressing";
const FETCHED_OVERSIZED_REPLY_ID =
  "https://remote.example/objects/fetched-oversized-reply";

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
    if (url === FETCHED_OVERSIZED_ADDRESSING_ID) {
      return new Response(
        JSON.stringify({
          id: FETCHED_OVERSIZED_ADDRESSING_ID,
          type: "Note",
          attributedTo: ALICE,
          content: "must not be partially retained",
          to: [
            "https://www.w3.org/ns/activitystreams#Public",
            ...Array.from(
              { length: 64 },
              (_, index) => `https://remote.example/users/boost-${index}`,
            ),
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/activity+json" },
        },
      );
    }
    if (url === FETCHED_OVERSIZED_REPLY_ID) {
      return new Response(
        JSON.stringify({
          id: FETCHED_OVERSIZED_REPLY_ID,
          type: "Note",
          attributedTo: ALICE,
          content: "must not retain an oversized reply edge",
          inReplyTo: `https://remote.example/objects/${"x".repeat(2050)}`,
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
    "0002_social_remote_actor_edges.sql",
    "0004_blocklist.sql",
    "0005_story_community_scope.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
    "0011_drop_remote_actor_fks.sql",
    "0015_community_bans.sql",
    "0026_remote_actor_fetch_failures.sql",
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

type StoredStoryProjection = {
  attachment?: {
    url?: string;
    content_type?: string;
    width?: number;
    height?: number;
  };
  caption?: string;
  displayDuration?: string;
  overlays?: Array<{
    type?: string;
    name?: string;
    href?: string;
    position?: { x?: number; y?: number; width?: number; height?: number };
    oneOf?: Array<{ type?: string; name?: string }>;
  }>;
};

function storedStoryProjection(attachmentsJson: string): StoredStoryProjection {
  return JSON.parse(attachmentsJson) as StoredStoryProjection;
}

function storyUpdate(
  object: Record<string, unknown>,
  envelope: Record<string, unknown> = {},
): Activity {
  return {
    id: "https://remote.example/activities/update-story-1",
    type: "Update",
    actor: ALICE,
    ...envelope,
    object: {
      id: STORY_ID,
      type: ["Story", "Note"],
      ...object,
    },
  } as unknown as Activity;
}

async function seedCommunity(db: Database): Promise<void> {
  const owner = "https://yuru.test/ap/users/owner";
  await seedActor(db, owner, "owner");
  await db.insert(communities).values({
    apId: COMMUNITY_ID,
    preferredUsername: "town",
    name: "Town",
    inbox: `${COMMUNITY_ID}/inbox`,
    outbox: `${COMMUNITY_ID}/outbox`,
    followersUrl: COMMUNITY_FOLLOWERS,
    visibility: "private",
    postPolicy: "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: owner,
  });
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

test("Create(Story) without a remote object id never mints a local-origin id", async () => {
  const db = await freshDb();
  await seedAlice(db);
  const activity = storyActivity();
  delete (activity.object as { id?: string }).id;

  await handleCreateStory(ctx(db), activity, ALICE, "https://yuru.test");

  expect(await db.select({ apId: objects.apId }).from(objects).all()).toEqual(
    [],
  );
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

test("Create(Story) resolves the exact outer-to community fanout emitted by Yurucommu", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await seedCommunity(db);
  await db.insert(follows).values({
    followerApId: ALICE,
    followingApId: COMMUNITY_ID,
    status: "accepted",
  });

  await handleCreateStory(
    ctx(db),
    {
      ...storyActivity(),
      to: [COMMUNITY_FOLLOWERS],
      object: {
        ...(storyActivity().object as object),
        type: ["Story", "Note"],
        to: [`${ALICE}/followers`],
      },
    } as Activity,
    ALICE,
    "https://yuru.test",
  );

  const row = await db
    .select({
      communityApId: objects.communityApId,
      audienceJson: objects.audienceJson,
    })
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  expect(row?.communityApId).toBe(COMMUNITY_ID);
  expect(JSON.parse(row?.audienceJson ?? "[]")).toEqual([COMMUNITY_ID]);
});

test("Create(Story) cannot turn an unauthorized outer-to community delivery into a personal Story", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await seedCommunity(db);

  await handleCreateStory(
    ctx(db),
    {
      ...storyActivity(),
      to: [COMMUNITY_FOLLOWERS],
      object: {
        ...(storyActivity().object as object),
        type: ["Story", "Note"],
        to: [`${ALICE}/followers`],
      },
    } as Activity,
    ALICE,
    "https://yuru.test",
  );

  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, STORY_ID))
      .get(),
  ).toBeUndefined();
});

test("Create(Story) fails closed when excess addressing could hide a community target", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await seedCommunity(db);
  const paddedAddresses = Array.from(
    { length: 64 },
    (_, index) => `https://audience.example/collections/${index}`,
  );

  await handleCreateStory(
    ctx(db),
    {
      ...storyActivity(),
      to: [...paddedAddresses, COMMUNITY_FOLLOWERS],
    } as Activity,
    ALICE,
    "https://yuru.test",
  );

  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, STORY_ID))
      .get(),
  ).toBeUndefined();
});

test("Update(Story) cannot move a personal Story into an authorized community", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await seedCommunity(db);
  await db.insert(follows).values({
    followerApId: ALICE,
    followingApId: COMMUNITY_ID,
    status: "accepted",
  });
  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");
  const before = await db
    .select({
      attachmentsJson: objects.attachmentsJson,
      communityApId: objects.communityApId,
      updated: objects.updated,
    })
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();

  await handleUpdate(
    ctx(db),
    storyUpdate(
      { content: "must not move scope" },
      { to: [COMMUNITY_FOLLOWERS] },
    ),
    ALICE,
  );

  const after = await db
    .select({
      attachmentsJson: objects.attachmentsJson,
      communityApId: objects.communityApId,
      updated: objects.updated,
    })
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  expect(after).toEqual(before);
});

test("Update(Story) rechecks retained community authority after membership is revoked", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await seedCommunity(db);
  await db.insert(follows).values({
    followerApId: ALICE,
    followingApId: COMMUNITY_ID,
    status: "accepted",
  });
  await handleCreateStory(
    ctx(db),
    {
      ...storyActivity(),
      to: [COMMUNITY_FOLLOWERS],
      object: {
        ...(storyActivity().object as object),
        to: [`${ALICE}/followers`],
      },
    } as Activity,
    ALICE,
    "https://yuru.test",
  );
  const before = await db
    .select({
      attachmentsJson: objects.attachmentsJson,
      communityApId: objects.communityApId,
      updated: objects.updated,
    })
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  await db.delete(follows).where(eq(follows.followingApId, COMMUNITY_ID));

  await handleUpdate(
    ctx(db),
    storyUpdate({ content: "former member must not update" }),
    ALICE,
  );

  expect(
    await db
      .select({
        attachmentsJson: objects.attachmentsJson,
        communityApId: objects.communityApId,
        updated: objects.updated,
      })
      .from(objects)
      .where(eq(objects.apId, STORY_ID))
      .get(),
  ).toEqual(before);
});

test("Update(Story) rewrites the Story projection without becoming a Note or extending expiry", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");
  const before = await db
    .select({ endTime: objects.endTime })
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();

  await handleUpdate(
    ctx(db),
    storyUpdate({
      content: "updated story caption",
      attachment: {
        type: "Document",
        url: "https://remote.example/media/s1-updated.jpg",
        mediaType: "image/webp",
        width: 720,
        height: 1280,
      },
      displayDuration: "PT12S",
      overlays: [
        {
          type: "Question",
          name: "tea?",
          position: { x: 0.5, y: 0.5, width: 0.8, height: 0.3 },
          oneOf: [
            { type: "Note", name: "yes" },
            { type: "Note", name: "no" },
          ],
        },
      ],
      endTime: "9999-12-31T23:59:59.000Z",
    }),
    ALICE,
  );

  const row = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  const projection = storedStoryProjection(row!.attachmentsJson);
  expect(row?.type).toBe("Story");
  expect(row?.content).toBe("");
  expect(projection.caption).toBe("updated story caption");
  expect(projection.attachment?.url).toBe(
    "https://remote.example/media/s1-updated.jpg",
  );
  expect(projection.attachment?.content_type).toBe("image/webp");
  expect(projection.displayDuration).toBe("PT12S");
  expect(projection.overlays?.[0]?.oneOf?.map((o) => o.name)).toEqual([
    "yes",
    "no",
  ]);
  expect(row?.endTime).toBe(before?.endTime);
});

test("a content-only Update(Story) preserves media and overlays and can explicitly clear its caption", async () => {
  const db = await freshDb();
  await seedAlice(db);
  const created = storyActivity();
  (created.object as Record<string, unknown>).overlays = [
    {
      type: "Note",
      name: "keep me",
      position: { x: 0.5, y: 0.5, width: 0.5, height: 0.2 },
    },
  ];
  await handleCreateStory(ctx(db), created, ALICE, "https://yuru.test");

  await handleUpdate(
    ctx(db),
    storyUpdate({ content: "replacement caption" }),
    ALICE,
  );
  let row = await db
    .select({ attachmentsJson: objects.attachmentsJson })
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  let projection = storedStoryProjection(row!.attachmentsJson);
  expect(projection.caption).toBe("replacement caption");
  expect(projection.attachment?.url).toBe(
    "https://remote.example/media/s1.jpg",
  );
  expect(projection.overlays?.[0]?.name).toBe("keep me");

  await handleUpdate(ctx(db), storyUpdate({ content: "" }), ALICE);
  row = await db
    .select({ attachmentsJson: objects.attachmentsJson })
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  projection = storedStoryProjection(row!.attachmentsJson);
  expect(projection.caption).toBeUndefined();
  expect(projection.attachment?.url).toBe(
    "https://remote.example/media/s1.jpg",
  );
});

test("Update(Story) clears stale poll votes when its overlays change", async () => {
  const db = await freshDb();
  await seedAlice(db);
  const created = storyActivity();
  (created.object as Record<string, unknown>).overlays = [
    {
      type: "Question",
      name: "old question",
      position: { x: 0.5, y: 0.5, width: 0.8, height: 0.3 },
      oneOf: [
        { type: "Note", name: "old zero" },
        { type: "Note", name: "old one" },
      ],
    },
  ];
  await handleCreateStory(ctx(db), created, ALICE, "https://yuru.test");
  await db.insert(storyVotes).values({
    id: "vote-before-overlay-update",
    storyApId: STORY_ID,
    actorApId: "https://viewer.example/users/voter",
    optionIndex: 0,
  });

  await handleUpdate(
    ctx(db),
    storyUpdate({
      overlays: [
        {
          type: "Question",
          name: "new question",
          position: { x: 0.5, y: 0.5, width: 0.8, height: 0.3 },
          oneOf: [
            { type: "Note", name: "new zero" },
            { type: "Note", name: "new one" },
          ],
        },
      ],
    }),
    ALICE,
  );

  const row = await db
    .select({ attachmentsJson: objects.attachmentsJson })
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  expect(
    storedStoryProjection(row!.attachmentsJson).overlays?.[0]?.oneOf?.map(
      (option) => option.name,
    ),
  ).toEqual(["new zero", "new one"]);
  expect(
    await db
      .select({ id: storyVotes.id })
      .from(storyVotes)
      .where(eq(storyVotes.storyApId, STORY_ID)),
  ).toEqual([]);
});

test("an invalid Update(Story) is rejected atomically instead of corrupting its media shape", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");
  const before = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();

  await handleUpdate(
    ctx(db),
    storyUpdate({
      content: "must not partially apply",
      attachment: { url: "javascript:alert(1)", mediaType: "image/jpeg" },
    }),
    ALICE,
  );

  const after = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  expect(after?.attachmentsJson).toBe(before?.attachmentsJson);
  expect(after?.content).toBe(before?.content);
  expect(after?.updated).toBe(before?.updated);
});

test("a Note-typed Update cannot rewrite an existing Story through type confusion", async () => {
  const db = await freshDb();
  await seedAlice(db);
  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");
  const before = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();

  await handleUpdate(
    ctx(db),
    storyUpdate({
      type: "Note",
      content: "type-confused body",
      attachment: { url: "https://remote.example/media/not-story.jpg" },
    }),
    ALICE,
  );

  const after = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  expect(after?.attachmentsJson).toBe(before?.attachmentsJson);
  expect(after?.content).toBe(before?.content);
  expect(after?.updated).toBe(before?.updated);
});

test("an already-expired inbound Story is dropped instead of bypassing the live-story cap", async () => {
  const db = await freshDb();
  await seedAlice(db);
  const expired = storyActivity();
  (expired.object as Record<string, unknown>).published = new Date(
    Date.now() - 2 * 60 * 60 * 1000,
  ).toISOString();
  (expired.object as Record<string, unknown>).endTime = new Date(
    Date.now() - 60 * 60 * 1000,
  ).toISOString();

  await handleCreateStory(ctx(db), expired, ALICE, "https://yuru.test");
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, STORY_ID))
      .get(),
  ).toBeUndefined();
});

test("inbound Create(Story) from a muted actor is dropped at write time", async () => {
  const db = await freshDb();
  const owner = "https://yuru.test/ap/users/tako";
  await seedActor(db, owner, "tako");
  await seedAlice(db);
  await db.insert(mutes).values({ muterApId: owner, mutedApId: ALICE });

  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, STORY_ID))
      .get(),
  ).toBeUndefined();
});

test("inbound Update(Story) from a newly muted actor cannot replace retained content", async () => {
  const db = await freshDb();
  const owner = "https://yuru.test/ap/users/tako";
  await seedActor(db, owner, "tako");
  await seedAlice(db);
  await handleCreateStory(ctx(db), storyActivity(), ALICE, "https://yuru.test");
  const before = await db
    .select({
      attachmentsJson: objects.attachmentsJson,
      updated: objects.updated,
    })
    .from(objects)
    .where(eq(objects.apId, STORY_ID))
    .get();
  await db.insert(mutes).values({ muterApId: owner, mutedApId: ALICE });

  await handleUpdate(
    ctx(db),
    storyUpdate({ content: "must stay suppressed" }),
    ALICE,
  );

  expect(
    await db
      .select({
        attachmentsJson: objects.attachmentsJson,
        updated: objects.updated,
      })
      .from(objects)
      .where(eq(objects.apId, STORY_ID))
      .get(),
  ).toEqual(before);
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

test("an Announce-fetched Note with addressing overflow is rejected whole", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();
  await seedAlice(db);

  expect(
    await fetchAndPersistAnnouncedNote(
      db,
      FETCHED_OVERSIZED_ADDRESSING_ID,
      "https://yuru.test",
    ),
  ).toBe(false);
  expect(fetchedUrls).toContain(FETCHED_OVERSIZED_ADDRESSING_ID);
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, FETCHED_OVERSIZED_ADDRESSING_ID))
      .get(),
  ).toBeUndefined();
});

test("an Announce-fetched Note with an oversized reply target is rejected whole", async () => {
  fetchedUrls.length = 0;
  const db = await freshDb();
  await seedAlice(db);

  expect(
    await fetchAndPersistAnnouncedNote(
      db,
      FETCHED_OVERSIZED_REPLY_ID,
      "https://yuru.test",
    ),
  ).toBe(false);
  expect(fetchedUrls).toContain(FETCHED_OVERSIZED_REPLY_ID);
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, FETCHED_OVERSIZED_REPLY_ID))
      .get(),
  ).toBeUndefined();
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
  const published = new Date(Date.now() - 60_000).toISOString();
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
      published,
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
  const publishedMs = Date.parse(row!.published);
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
