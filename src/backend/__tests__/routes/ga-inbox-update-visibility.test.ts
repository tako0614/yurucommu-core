import { expect, test } from "bun:test";

import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  actors,
  follows,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { parseActivity } from "../../lib/activitypub-validators.ts";
import {
  handleCreate,
  handleUpdate,
} from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";
import dmContactRoutes from "../../routes/dm/conversations.ts";
import { getConversationId } from "../../routes/dm/query-helpers.ts";
import postsRoutes from "../../routes/posts/routes.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

/**
 * Audit #19 — Update(Note) reach parity.
 *
 * An authenticated remote author may replace a Note's content. The content and
 * its addressing are one authority decision: if a previously-public Note is
 * narrowed to followers/direct, persisting only the new content leaves that
 * private body readable through the stale public single-object gate.
 *
 * These tests exercise the real inbound Update handler and the canonical
 * `GET /api/posts/:id` route against production migrations. Reach fields must
 * change in the same UPDATE statement as content, while an old peer's partial
 * content-only Update must preserve the prior reach.
 */

const APP_URL = "https://yuru.test";
const REMOTE = "https://remote.example/users/alice";
const FOLLOWERS = `${REMOTE}/followers`;
const LOCAL_BOB = `${APP_URL}/ap/users/bob`;
const LOCAL_CAROL = `${APP_URL}/ap/users/carol`;
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

async function seedLocalActor(
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

async function setup(): Promise<Database> {
  const db = await freshDb();
  await seedLocalActor(db, LOCAL_BOB, "bob");
  await seedLocalActor(db, LOCAL_CAROL, "carol");
  await db.insert(actorCache).values({
    apId: REMOTE,
    type: "Person",
    preferredUsername: "alice",
    name: "Alice",
    inbox: `${REMOTE}/inbox`,
    outbox: `${REMOTE}/outbox`,
    followersUrl: FOLLOWERS,
    publicKeyId: `${REMOTE}#main-key`,
    publicKeyPem: "pub",
    rawJson: JSON.stringify({ id: REMOTE, type: "Person" }),
  });
  return db;
}

function ctxFor(db: Database): ActivityContext {
  return {
    get: (key: string) => (key === "db" ? db : null),
    env: { APP_URL, MEDIA: undefined },
  } as unknown as ActivityContext;
}

function fakeActor(apId: string, username: string): Actor {
  return {
    ap_id: apId,
    preferred_username: username,
  } as unknown as Actor;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

function postsApp(db: Database, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/api/posts", postsRoutes);
  return app;
}

function dmContactsApp(db: Database, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/api/dm", dmContactRoutes);
  return app;
}

async function getPostStatus(
  db: Database,
  actor: Actor | null,
  objectApId: string,
): Promise<number> {
  const env = envFor(db);
  return (
    await postsApp(db, actor).fetch(
      new Request(`${APP_URL}/api/posts/${encodeURIComponent(objectApId)}`, {
        method: "GET",
      }),
      env,
    )
  ).status;
}

type PostProjection = {
  content: string;
  summary: string | null;
  attachments: unknown[];
};

async function getPost(
  db: Database,
  actor: Actor | null,
  objectApId: string,
): Promise<PostProjection> {
  const response = await postsApp(db, actor).fetch(
    new Request(`${APP_URL}/api/posts/${encodeURIComponent(objectApId)}`, {
      method: "GET",
    }),
    envFor(db),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { post: PostProjection }).post;
}

type ContactsResponse = {
  mutual_followers: Array<{
    conversation_id: string;
    last_message: { content: string; is_mine: boolean } | null;
  }>;
  request_count: number;
};

async function getContacts(
  db: Database,
  actor: Actor,
): Promise<ContactsResponse> {
  const env = envFor(db);
  const response = await dmContactsApp(db, actor).fetch(
    new Request(`${APP_URL}/api/dm/contacts`, { method: "GET" }),
    env,
  );
  expect(response.status).toBe(200);
  return (await response.json()) as ContactsResponse;
}

async function insertRemoteNote(
  db: Database,
  id: string,
  reach: {
    visibility: "public" | "unlisted" | "followers" | "direct";
    to: string[];
    cc?: string[];
    conversation?: string;
    content?: string;
    summary?: string | null;
    attachments?: unknown[];
    tags?: unknown[];
  },
): Promise<void> {
  await db.insert(objects).values({
    apId: id,
    type: "Note",
    attributedTo: REMOTE,
    content: reach.content ?? "old body",
    summary: reach.summary ?? null,
    attachmentsJson: JSON.stringify(reach.attachments ?? []),
    tagsJson: JSON.stringify(reach.tags ?? []),
    visibility: reach.visibility,
    toJson: JSON.stringify(reach.to),
    ccJson: JSON.stringify(reach.cc ?? []),
    audienceJson: "[]",
    conversation: reach.conversation ?? null,
    isLocal: 0,
    published: "2026-08-09T00:00:00.000Z",
  });
}

function createNoteWithoutAddressing(id: string): Activity {
  return parseActivity({
    id: `${id}/activity`,
    type: "Create",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "addressless secret",
    },
  }) as Activity;
}

function recipient(apId: string) {
  return {
    apId,
    followersUrl: `${apId}/followers`,
  } as unknown as Parameters<typeof handleCreate>[2];
}

function updateNote(
  id: string,
  content: string,
  addressing?: { to: string[]; cc: string[] },
): Activity {
  return parseActivity({
    id: `${id}/updates/1`,
    type: "Update",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content,
      ...(addressing ?? {}),
    },
  }) as Activity;
}

async function reachRow(db: Database, id: string) {
  return db
    .select({
      content: objects.content,
      visibility: objects.visibility,
      toJson: objects.toJson,
      ccJson: objects.ccJson,
    })
    .from(objects)
    .where(eq(objects.apId, id))
    .get();
}

async function projectionRow(db: Database, id: string) {
  return db
    .select({
      content: objects.content,
      summary: objects.summary,
      attachmentsJson: objects.attachmentsJson,
      tagsJson: objects.tagsJson,
    })
    .from(objects)
    .where(eq(objects.apId, id))
    .get();
}

test("Update(Note) narrowing public to followers hides the new body from anonymous GET", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/narrow-followers";
  await insertRemoteNote(db, id, { visibility: "public", to: [PUBLIC] });
  expect(await getPostStatus(db, null, id)).toBe(200);

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "followers secret", { to: [FOLLOWERS], cc: [] }),
    REMOTE,
  );

  expect((await reachRow(db, id))?.content).toBe("followers secret");
  expect(await getPostStatus(db, null, id)).toBe(404);
  expect(await reachRow(db, id)).toMatchObject({
    content: "followers secret",
    visibility: "followers",
    toJson: JSON.stringify([FOLLOWERS]),
    ccJson: "[]",
  });
  expect(await getPostStatus(db, fakeActor(LOCAL_CAROL, "carol"), id)).toBe(
    404,
  );

  await db.insert(follows).values({
    followerApId: LOCAL_BOB,
    followingApId: REMOTE,
    status: "accepted",
  });
  expect(await getPostStatus(db, fakeActor(LOCAL_BOB, "bob"), id)).toBe(200);
});

test("Update(Note) narrowing public to direct exposes the new body only to its recipient", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/narrow-direct";
  await insertRemoteNote(db, id, { visibility: "public", to: [PUBLIC] });

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "bob secret", { to: [LOCAL_BOB], cc: [] }),
    REMOTE,
  );

  expect((await reachRow(db, id))?.content).toBe("bob secret");
  expect(await getPostStatus(db, null, id)).toBe(404);
  expect(await reachRow(db, id)).toMatchObject({
    content: "bob secret",
    visibility: "direct",
    toJson: JSON.stringify([LOCAL_BOB]),
    ccJson: "[]",
  });
  expect(await getPostStatus(db, fakeActor(LOCAL_CAROL, "carol"), id)).toBe(
    404,
  );
  expect(await getPostStatus(db, fakeActor(LOCAL_BOB, "bob"), id)).toBe(200);
});

test("a content-only partial Update preserves the Note's existing reach", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/partial-update";
  await insertRemoteNote(db, id, {
    visibility: "followers",
    to: [FOLLOWERS],
    cc: [LOCAL_BOB],
  });

  await handleUpdate(ctxFor(db), updateNote(id, "edited body"), REMOTE);

  expect(await reachRow(db, id)).toMatchObject({
    content: "edited body",
    visibility: "followers",
    toJson: JSON.stringify([FOLLOWERS]),
    ccJson: JSON.stringify([LOCAL_BOB]),
  });
  expect(await getPostStatus(db, null, id)).toBe(404);
});

test("explicit empty Update fields clear stale content, warning, media, and tags", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/clear-projections";
  await insertRemoteNote(db, id, {
    visibility: "public",
    to: [PUBLIC],
    content: "remove every old projection",
    summary: "old warning",
    attachments: [
      {
        type: "Document",
        mediaType: "image/png",
        url: "https://remote.example/media/old.png",
      },
    ],
    tags: [
      {
        type: "Hashtag",
        name: "#old",
        href: "https://remote.example/tags/old",
      },
    ],
  });

  const update = parseActivity({
    id: `${id}/updates/clear`,
    type: "Update",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "",
      summary: null,
      attachment: null,
      tag: [],
    },
  }) as Activity;
  await handleUpdate(ctxFor(db), update, REMOTE);

  expect(await projectionRow(db, id)).toMatchObject({
    content: "",
    summary: null,
    attachmentsJson: "[]",
    tagsJson: "[]",
  });
  expect(await getPost(db, null, id)).toEqual(
    expect.objectContaining({ content: "", summary: null, attachments: [] }),
  );
});

test("Update normalizes a single attachment object and replaces the tag projection", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/replace-projections";
  const attachment = {
    type: "Document",
    mediaType: "image/jpeg",
    url: "https://remote.example/media/new.jpg",
    name: "new image",
  };
  const tag = {
    type: "Hashtag",
    name: "#new",
    href: "https://remote.example/tags/new",
  };
  await insertRemoteNote(db, id, {
    visibility: "public",
    to: [PUBLIC],
    summary: "old warning",
    attachments: [{ url: "https://remote.example/media/old.jpg" }],
    tags: [{ type: "Hashtag", name: "#old" }],
  });

  const update = parseActivity({
    id: `${id}/updates/replace`,
    type: "Update",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "new body",
      summary: "new warning",
      attachment,
      tag: [tag],
    },
  }) as Activity;
  await handleUpdate(ctxFor(db), update, REMOTE);

  expect(await projectionRow(db, id)).toMatchObject({
    content: "new body",
    summary: "new warning",
    attachmentsJson: JSON.stringify([attachment]),
    tagsJson: JSON.stringify([tag]),
  });
  expect(await getPost(db, null, id)).toEqual(
    expect.objectContaining({
      content: "new body",
      summary: "new warning",
      attachments: [attachment],
    }),
  );
});

test("a partial Update preserves omitted warning, media, and tag projections", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/preserve-projections";
  const attachments = [{ url: "https://remote.example/media/keep.jpg" }];
  const tags = [{ type: "Hashtag", name: "#keep" }];
  await insertRemoteNote(db, id, {
    visibility: "public",
    to: [PUBLIC],
    summary: "keep warning",
    attachments,
    tags,
  });

  await handleUpdate(ctxFor(db), updateNote(id, "new body only"), REMOTE);

  expect(await projectionRow(db, id)).toMatchObject({
    content: "new body only",
    summary: "keep warning",
    attachmentsJson: JSON.stringify(attachments),
    tagsJson: JSON.stringify(tags),
  });
});

test("inbound Create normalizes single media and persists bounded tag projection", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/create-projections";
  const attachment = {
    type: "Document",
    mediaType: "image/webp",
    url: "https://remote.example/media/create.webp",
  };
  const tag = {
    type: "Hashtag",
    name: "#created",
    href: "https://remote.example/tags/created",
  };
  const create = parseActivity({
    id: `${id}/activity`,
    type: "Create",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "created projection",
      attachment,
      tag: [tag],
      to: [PUBLIC],
      cc: [],
    },
  }) as Activity;

  await handleCreate(ctxFor(db), create, recipient(LOCAL_BOB), REMOTE, APP_URL);

  expect(await projectionRow(db, id)).toMatchObject({
    attachmentsJson: JSON.stringify([attachment]),
    tagsJson: JSON.stringify([tag]),
  });
  expect(await getPost(db, null, id)).toEqual(
    expect.objectContaining({ attachments: [attachment] }),
  );
});

test("inbound Create caps attachment and tag arrays before persistence", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/bounded-projections";
  const attachments = Array.from({ length: 20 }, (_, index) => ({
    url: `https://remote.example/media/${index}.png`,
  }));
  const tags = Array.from({ length: 80 }, (_, index) => ({
    type: "Hashtag",
    name: `#tag${index}`,
  }));
  const create = parseActivity({
    id: `${id}/activity`,
    type: "Create",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "bounded projection",
      attachment: attachments,
      tag: tags,
      to: [PUBLIC],
      cc: [],
    },
  }) as Activity;

  await handleCreate(ctxFor(db), create, recipient(LOCAL_BOB), REMOTE, APP_URL);

  const row = await projectionRow(db, id);
  expect(JSON.parse(row!.attachmentsJson)).toHaveLength(8);
  expect(JSON.parse(row!.tagsJson)).toHaveLength(64);
});

test("Update(Note) widening followers to public updates the canonical GET gate", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/widen-public";
  await insertRemoteNote(db, id, {
    visibility: "followers",
    to: [FOLLOWERS],
  });
  expect(await getPostStatus(db, null, id)).toBe(404);

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "public edit", { to: [PUBLIC], cc: [] }),
    REMOTE,
  );

  expect(await reachRow(db, id)).toMatchObject({
    content: "public edit",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    ccJson: "[]",
  });
  expect(await getPostStatus(db, null, id)).toBe(200);
});

test("the verified signer cannot update another actor's Note or its reach", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/not-yours";
  await insertRemoteNote(db, id, { visibility: "public", to: [PUBLIC] });

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "stolen secret", { to: [LOCAL_BOB], cc: [] }),
    "https://attacker.example/users/mallory",
  );

  expect(await reachRow(db, id)).toMatchObject({
    content: "old body",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    ccJson: "[]",
  });
});

test("an explicit empty audience Update fails closed instead of widening to unlisted", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/empty-audience-update";
  await insertRemoteNote(db, id, {
    visibility: "followers",
    to: [FOLLOWERS],
  });

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "nobody secret", { to: [], cc: [] }),
    REMOTE,
  );

  expect((await reachRow(db, id))?.content).toBe("nobody secret");
  expect(await getPostStatus(db, null, id)).toBe(404);
  expect(await reachRow(db, id)).toMatchObject({
    visibility: "direct",
    toJson: "[]",
    ccJson: "[]",
  });
});

test("an inbound Create(Note) with no usable addressing is never world-readable", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/addressless-create";

  await handleCreate(
    ctxFor(db),
    createNoteWithoutAddressing(id),
    recipient(LOCAL_BOB),
    REMOTE,
    APP_URL,
  );

  expect((await reachRow(db, id))?.content).toBe("addressless secret");
  expect(await getPostStatus(db, null, id)).toBe(404);
  expect(await reachRow(db, id)).toMatchObject({
    visibility: "direct",
    toJson: "[]",
    ccJson: "[]",
  });
});

test("readdressing a direct Note revokes the old recipient's contact preview atomically", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/readdress-direct";
  const oldConversation = getConversationId(APP_URL, REMOTE, LOCAL_BOB);
  const newConversation = getConversationId(APP_URL, REMOTE, LOCAL_CAROL);
  await insertRemoteNote(db, id, {
    visibility: "direct",
    to: [LOCAL_BOB],
    conversation: oldConversation,
  });
  await db.insert(objectRecipients).values({
    objectApId: id,
    recipientApId: LOCAL_BOB,
    type: "to",
  });

  expect(
    (await getContacts(db, fakeActor(LOCAL_BOB, "bob"))).mutual_followers[0]
      ?.last_message?.content,
  ).toBe("old body");

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "carol secret", { to: [LOCAL_CAROL], cc: [] }),
    REMOTE,
  );

  const bobContacts = await getContacts(db, fakeActor(LOCAL_BOB, "bob"));
  expect(bobContacts.mutual_followers).toEqual([]);
  expect(bobContacts.request_count).toBe(0);

  const carolContacts = await getContacts(db, fakeActor(LOCAL_CAROL, "carol"));
  expect(carolContacts.mutual_followers).toEqual([
    expect.objectContaining({
      conversation_id: newConversation,
      last_message: {
        content: "carol secret",
        is_mine: false,
      },
    }),
  ]);
  expect(carolContacts.request_count).toBe(1);

  const links = await db
    .select({ recipientApId: objectRecipients.recipientApId })
    .from(objectRecipients)
    .where(eq(objectRecipients.objectApId, id));
  expect(links).toEqual([{ recipientApId: LOCAL_CAROL }]);
});

test("widening a direct Note to public removes its old DM projection", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/direct-to-public";
  const oldConversation = getConversationId(APP_URL, REMOTE, LOCAL_BOB);
  await insertRemoteNote(db, id, {
    visibility: "direct",
    to: [LOCAL_BOB],
    conversation: oldConversation,
  });
  await db.insert(objectRecipients).values({
    objectApId: id,
    recipientApId: LOCAL_BOB,
    type: "to",
  });

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "now public", { to: [PUBLIC], cc: [] }),
    REMOTE,
  );

  expect(await reachRow(db, id)).toMatchObject({
    content: "now public",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    ccJson: "[]",
  });
  expect(await getPostStatus(db, null, id)).toBe(200);
  expect(
    (await getContacts(db, fakeActor(LOCAL_BOB, "bob"))).mutual_followers,
  ).toEqual([]);
  expect(
    await db
      .select({ recipientApId: objectRecipients.recipientApId })
      .from(objectRecipients)
      .where(eq(objectRecipients.objectApId, id)),
  ).toEqual([]);
  expect(
    (
      await db
        .select({ conversation: objects.conversation })
        .from(objects)
        .where(eq(objects.apId, id))
        .get()
    )?.conversation,
  ).toBeNull();
});

test("a recipient projection failure rolls back the Note body, reach, conversation, and old link", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/readdress-rollback";
  const oldConversation = getConversationId(APP_URL, REMOTE, LOCAL_BOB);
  await insertRemoteNote(db, id, {
    visibility: "direct",
    to: [LOCAL_BOB],
    conversation: oldConversation,
  });
  await db.insert(objectRecipients).values({
    objectApId: id,
    recipientApId: LOCAL_BOB,
    type: "to",
  });
  await db.run(
    sql.raw(`
      CREATE TRIGGER reject_readdress_recipient
      BEFORE INSERT ON object_recipients
      WHEN NEW.recipient_ap_id = '${LOCAL_CAROL}'
      BEGIN
        SELECT RAISE(ABORT, 'simulated recipient projection failure');
      END
    `),
  );

  await expect(
    handleUpdate(
      ctxFor(db),
      updateNote(id, "must roll back", { to: [LOCAL_CAROL], cc: [] }),
      REMOTE,
    ),
  ).rejects.toThrow("simulated recipient projection failure");

  expect(await reachRow(db, id)).toMatchObject({
    content: "old body",
    visibility: "direct",
    toJson: JSON.stringify([LOCAL_BOB]),
    ccJson: "[]",
  });
  const row = await db
    .select({ conversation: objects.conversation })
    .from(objects)
    .where(eq(objects.apId, id))
    .get();
  expect(row?.conversation).toBe(oldConversation);
  const links = await db
    .select({ recipientApId: objectRecipients.recipientApId })
    .from(objectRecipients)
    .where(eq(objectRecipients.objectApId, id));
  expect(links).toEqual([{ recipientApId: LOCAL_BOB }]);
});

test("a 64-recipient direct Update stays within D1 parameter and batch ceilings", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/readdress-max";
  await insertRemoteNote(db, id, { visibility: "public", to: [PUBLIC] });
  const recipients = Array.from(
    { length: 64 },
    (_, index) => `${APP_URL}/ap/users/recipient-${index}`,
  );

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "bounded group secret", { to: recipients, cc: [] }),
    REMOTE,
  );

  expect(await reachRow(db, id)).toMatchObject({
    content: "bounded group secret",
    visibility: "direct",
    toJson: JSON.stringify(recipients),
    ccJson: "[]",
  });
  const links = await db
    .select({ recipientApId: objectRecipients.recipientApId })
    .from(objectRecipients)
    .where(eq(objectRecipients.objectApId, id));
  expect(links).toHaveLength(64);
  expect(new Set(links.map((link) => link.recipientApId))).toEqual(
    new Set(recipients),
  );
  const row = await db
    .select({ conversation: objects.conversation })
    .from(objects)
    .where(eq(objects.apId, id))
    .get();
  expect(row?.conversation).toBeNull();
});
