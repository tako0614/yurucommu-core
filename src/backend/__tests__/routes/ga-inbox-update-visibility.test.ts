import { expect, test } from "bun:test";

import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  actors,
  blocks,
  communities,
  communityMembers,
  follows,
  mutes,
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
import dmMessageRoutes from "../../routes/dm/messages.ts";
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

function dmMessagesApp(db: Database, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", dmMessageRoutes);
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

async function getMessages(
  db: Database,
  actor: Actor,
  otherApId: string,
): Promise<{ messages: Array<{ id: string; content: string }> }> {
  const response = await dmMessagesApp(db, actor).fetch(
    new Request(`${APP_URL}/user/${encodeURIComponent(otherApId)}/messages`, {
      method: "GET",
    }),
    envFor(db),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    messages: Array<{ id: string; content: string }>;
  };
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
    inReplyTo?: string | null;
    audience?: string[];
    communityApId?: string | null;
    replyCount?: number;
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
    inReplyTo: reach.inReplyTo ?? null,
    visibility: reach.visibility,
    toJson: JSON.stringify(reach.to),
    ccJson: JSON.stringify(reach.cc ?? []),
    audienceJson: JSON.stringify(reach.audience ?? []),
    communityApId: reach.communityApId ?? null,
    conversation: reach.conversation ?? null,
    replyCount: reach.replyCount ?? 0,
    isLocal: 0,
    published: "2026-08-09T00:00:00.000Z",
  });
}

async function seedCommunity(
  db: Database,
  name: string,
  options: { remoteMember?: boolean } = {},
): Promise<string> {
  const apId = `${APP_URL}/ap/groups/${name}`;
  await db.insert(communities).values({
    apId,
    preferredUsername: name,
    name,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility: "private",
    joinPolicy: "approval",
    postPolicy: "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: LOCAL_BOB,
  });
  await db.insert(communityMembers).values({
    communityApId: apId,
    actorApId: LOCAL_BOB,
    role: "owner",
  });
  if (options.remoteMember) {
    await db.insert(follows).values({
      followerApId: REMOTE,
      followingApId: apId,
      status: "accepted",
    });
  }
  return apId;
}

async function threadScopeRow(db: Database, id: string) {
  return db
    .select({
      content: objects.content,
      inReplyTo: objects.inReplyTo,
      replyCount: objects.replyCount,
      audienceJson: objects.audienceJson,
      communityApId: objects.communityApId,
    })
    .from(objects)
    .where(eq(objects.apId, id))
    .get();
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
  addressing?: Partial<{
    to: string[];
    cc: string[];
    bto: string[];
    bcc: string[];
  }>,
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

test("Update(Note) from a newly muted actor cannot replace retained content", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/muted-update";
  await insertRemoteNote(db, id, { visibility: "public", to: [PUBLIC] });
  await db.insert(mutes).values({
    muterApId: LOCAL_BOB,
    mutedApId: REMOTE,
  });

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "must stay suppressed"),
    REMOTE,
  );

  expect(await reachRow(db, id)).toMatchObject({ content: "old body" });
});

test("Update(Note) from a newly blocked actor cannot replace retained content", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/blocked-update";
  await insertRemoteNote(db, id, { visibility: "public", to: [PUBLIC] });
  await db.insert(blocks).values({
    blockerApId: LOCAL_BOB,
    blockedApId: REMOTE,
  });

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "must stay suppressed"),
    REMOTE,
  );

  expect(await reachRow(db, id)).toMatchObject({ content: "old body" });
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

test("inbound Create(Note) without a remote object id never mints a local-origin id", async () => {
  const db = await setup();
  const create = parseActivity({
    id: "https://remote.example/activities/create-without-object-id",
    type: "Create",
    actor: REMOTE,
    object: {
      type: "Note",
      attributedTo: REMOTE,
      content: "must not acquire a yuru.test id",
      to: [PUBLIC],
      cc: [],
    },
  }) as Activity;

  await handleCreate(ctxFor(db), create, recipient(LOCAL_BOB), REMOTE, APP_URL);

  expect(await db.select({ apId: objects.apId }).from(objects).all()).toEqual(
    [],
  );
});

test("inbound Create(Note) rejects unsafe remote object ids", async () => {
  const db = await setup();
  const unsafeIds: unknown[] = [
    "ftp://remote.example/objects/unsafe-scheme",
    "https://user:pass@remote.example/objects/credentials",
    "http://remote.example/objects/scheme-downgrade",
    `https://remote.example/objects/${"x".repeat(2050)}`,
    42,
    { href: "https://remote.example/objects/not-a-string" },
  ];

  for (const [index, id] of unsafeIds.entries()) {
    const create = parseActivity({
      id: `https://remote.example/activities/unsafe-object-id-${index}`,
      type: "Create",
      actor: REMOTE,
      object: {
        id,
        type: "Note",
        attributedTo: REMOTE,
        content: "must not be retained",
        to: [PUBLIC],
        cc: [],
      },
    }) as Activity;
    await handleCreate(
      ctxFor(db),
      create,
      recipient(LOCAL_BOB),
      REMOTE,
      APP_URL,
    );
  }

  expect(await db.select({ apId: objects.apId }).from(objects).all()).toEqual(
    [],
  );
});

test("inbound Create(Note) rejects addressing that cannot be retained whole", async () => {
  const db = await setup();
  const oversizedCases = [
    {
      id: "https://remote.example/objects/too-many-addresses",
      to: [
        PUBLIC,
        ...Array.from(
          { length: 31 },
          (_, index) => `https://remote.example/users/to-${index}`,
        ),
      ],
      cc: Array.from(
        { length: 33 },
        (_, index) => `https://remote.example/users/cc-${index}`,
      ),
    },
    {
      id: "https://remote.example/objects/too-long-address",
      to: [PUBLIC],
      cc: [`https://remote.example/users/${"x".repeat(2050)}`],
    },
  ];

  for (const { id, to, cc } of oversizedCases) {
    const create = parseActivity({
      id: `${id}/activity`,
      type: "Create",
      actor: REMOTE,
      object: {
        id,
        type: "Note",
        attributedTo: REMOTE,
        content: "must not be partially retained",
        to,
        cc,
      },
    }) as Activity;
    await handleCreate(
      ctxFor(db),
      create,
      recipient(LOCAL_BOB),
      REMOTE,
      APP_URL,
    );
  }

  expect(await db.select({ apId: objects.apId }).from(objects).all()).toEqual(
    [],
  );
});

test("Update(Note) rejects addressing overflow without replacing old reach or content", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/update-addressing-overflow";
  await insertRemoteNote(db, id, { visibility: "public", to: [PUBLIC] });

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "must not be partially applied", {
      to: [
        PUBLIC,
        ...Array.from(
          { length: 64 },
          (_, index) => `https://remote.example/users/update-${index}`,
        ),
      ],
      cc: [],
    }),
    REMOTE,
  );

  expect(await reachRow(db, id)).toMatchObject({
    content: "old body",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    ccJson: "[]",
  });
});

test("inbound public Create(Note) from a muted actor is dropped at write time", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/muted-public-create";
  await db.insert(mutes).values({
    muterApId: LOCAL_BOB,
    mutedApId: REMOTE,
  });
  const create = parseActivity({
    id: `${id}/activity`,
    type: "Create",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "must not be retained",
      to: [PUBLIC],
      cc: [],
    },
  }) as Activity;

  await handleCreate(ctxFor(db), create, recipient(LOCAL_BOB), REMOTE, APP_URL);

  expect(await reachRow(db, id)).toBeUndefined();
});

test("inbound public Create(Note) from a blocked actor is dropped at write time", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/blocked-public-create";
  await db.insert(blocks).values({
    blockerApId: LOCAL_BOB,
    blockedApId: REMOTE,
  });
  const create = parseActivity({
    id: `${id}/activity`,
    type: "Create",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "must not be retained",
      to: [PUBLIC],
      cc: [],
    },
  }) as Activity;

  await handleCreate(ctxFor(db), create, recipient(LOCAL_BOB), REMOTE, APP_URL);

  expect(await reachRow(db, id)).toBeUndefined();
});

test("inbound Create preserves an authorized private-community audience and its read gate", async () => {
  const db = await setup();
  const communityApId = await seedCommunity(db, "private-create", {
    remoteMember: true,
  });
  const id = "https://remote.example/objects/private-community-create";
  const create = parseActivity({
    id: `${id}/activity`,
    type: "Create",
    actor: REMOTE,
    audience: [communityApId],
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "member-only community body",
      to: [communityApId, `${communityApId}/followers`],
      cc: [PUBLIC],
      audience: [communityApId],
    },
  }) as Activity;

  await handleCreate(ctxFor(db), create, recipient(LOCAL_BOB), REMOTE, APP_URL);

  expect(await threadScopeRow(db, id)).toMatchObject({
    audienceJson: JSON.stringify([communityApId]),
    communityApId,
  });
  expect(await getPostStatus(db, null, id)).toBe(404);
  expect(await getPostStatus(db, fakeActor(LOCAL_BOB, "bob"), id)).toBe(200);
});

test("inbound Create cannot inject a non-member Note into a known private community", async () => {
  const db = await setup();
  const communityApId = await seedCommunity(db, "private-injection");
  const id = "https://remote.example/objects/private-community-injection";
  const create = parseActivity({
    id: `${id}/activity`,
    type: "Create",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "unauthorized community body",
      to: [communityApId, `${communityApId}/followers`],
      cc: [PUBLIC],
      audience: [communityApId],
    },
  }) as Activity;

  await handleCreate(ctxFor(db), create, recipient(LOCAL_BOB), REMOTE, APP_URL);

  expect(await threadScopeRow(db, id)).toBeUndefined();
});

test("Update(Note) explicitly clears an authorized community scope", async () => {
  const db = await setup();
  const communityApId = await seedCommunity(db, "private-clear", {
    remoteMember: true,
  });
  const id = "https://remote.example/objects/private-community-clear";
  await insertRemoteNote(db, id, {
    visibility: "public",
    to: [PUBLIC],
    audience: [communityApId],
    communityApId,
  });
  expect(await getPostStatus(db, null, id)).toBe(404);

  const update = parseActivity({
    id: `${id}/updates/clear-community`,
    type: "Update",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "now deliberately general",
      audience: [],
    },
  }) as Activity;
  await handleUpdate(ctxFor(db), update, REMOTE);

  expect(await threadScopeRow(db, id)).toMatchObject({
    content: "now deliberately general",
    audienceJson: "[]",
    communityApId: null,
  });
  expect(await getPostStatus(db, null, id)).toBe(200);
});

test("Update(Note) cannot partially apply content while injecting an unauthorized community scope", async () => {
  const db = await setup();
  const communityApId = await seedCommunity(db, "private-update-injection");
  const id = "https://remote.example/objects/community-update-injection";
  await insertRemoteNote(db, id, { visibility: "public", to: [PUBLIC] });

  const update = parseActivity({
    id: `${id}/updates/inject-community`,
    type: "Update",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "must not be partially applied",
      audience: [communityApId],
    },
  }) as Activity;
  await handleUpdate(ctxFor(db), update, REMOTE);

  expect(await threadScopeRow(db, id)).toMatchObject({
    content: "old body",
    audienceJson: "[]",
    communityApId: null,
  });
});

test("content-only Update(Note) rechecks retained community membership", async () => {
  const db = await setup();
  const communityApId = await seedCommunity(db, "private-retained-update", {
    remoteMember: true,
  });
  const id = "https://remote.example/objects/private-retained-update";
  await insertRemoteNote(db, id, {
    visibility: "public",
    to: [PUBLIC],
    audience: [communityApId],
    communityApId,
  });
  await db
    .delete(follows)
    .where(
      sql`${follows.followerApId} = ${REMOTE} AND ${follows.followingApId} = ${communityApId}`,
    );

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "must stay suppressed"),
    REMOTE,
  );

  expect(await threadScopeRow(db, id)).toMatchObject({
    content: "old body",
    communityApId,
  });
});

test("content-only Update(Note) keeps working while retained community authority is current", async () => {
  const db = await setup();
  const communityApId = await seedCommunity(db, "private-retained-authorized", {
    remoteMember: true,
  });
  const id = "https://remote.example/objects/private-retained-authorized";
  await insertRemoteNote(db, id, {
    visibility: "public",
    to: [PUBLIC],
    audience: [communityApId],
    communityApId,
  });

  await handleUpdate(ctxFor(db), updateNote(id, "authorized edit"), REMOTE);

  expect(await threadScopeRow(db, id)).toMatchObject({
    content: "authorized edit",
    communityApId,
  });
});

test("Update(Note) rejects a reparent to a retained parent the signer cannot read", async () => {
  const db = await setup();
  const parentId = `${APP_URL}/ap/objects/private-parent`;
  await db.insert(objects).values({
    apId: parentId,
    type: "Note",
    attributedTo: LOCAL_BOB,
    content: "private parent",
    visibility: "direct",
    toJson: JSON.stringify([LOCAL_BOB]),
    published: "2026-08-09T00:00:00.000Z",
  });
  const id = "https://remote.example/objects/reparent-unreadable";
  await insertRemoteNote(db, id, { visibility: "public", to: [PUBLIC] });

  const update = parseActivity({
    id: `${id}/updates/reparent-unreadable`,
    type: "Update",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "must not be partially applied",
      inReplyTo: parentId,
    },
  }) as Activity;
  await handleUpdate(ctxFor(db), update, REMOTE);

  expect(await threadScopeRow(db, id)).toMatchObject({
    content: "old body",
    inReplyTo: null,
  });
  expect((await threadScopeRow(db, parentId))?.replyCount).toBe(0);
});

test("Update(Note) reparent, retry, and explicit clear keep both parent counters exact", async () => {
  const db = await setup();
  const oldParent = "https://remote.example/objects/old-parent";
  const newParent = "https://remote.example/objects/new-parent";
  await insertRemoteNote(db, oldParent, {
    visibility: "public",
    to: [PUBLIC],
    replyCount: 1,
  });
  await insertRemoteNote(db, newParent, {
    visibility: "public",
    to: [PUBLIC],
  });
  const id = "https://remote.example/objects/reparent-child";
  await insertRemoteNote(db, id, {
    visibility: "public",
    to: [PUBLIC],
    inReplyTo: oldParent,
  });

  const reparent = parseActivity({
    id: `${id}/updates/reparent`,
    type: "Update",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "moved reply",
      inReplyTo: newParent,
    },
  }) as Activity;
  await handleUpdate(ctxFor(db), reparent, REMOTE);
  await handleUpdate(ctxFor(db), reparent, REMOTE);

  expect(await threadScopeRow(db, id)).toMatchObject({
    inReplyTo: newParent,
    content: "moved reply",
  });
  expect((await threadScopeRow(db, oldParent))?.replyCount).toBe(0);
  expect((await threadScopeRow(db, newParent))?.replyCount).toBe(1);

  const clear = parseActivity({
    id: `${id}/updates/clear-parent`,
    type: "Update",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      inReplyTo: null,
    },
  }) as Activity;
  await handleUpdate(ctxFor(db), clear, REMOTE);

  expect((await threadScopeRow(db, id))?.inReplyTo).toBeNull();
  expect((await threadScopeRow(db, newParent))?.replyCount).toBe(0);
});

test("a parent-counter failure rolls back reparenting and content atomically", async () => {
  const db = await setup();
  const oldParent = "https://remote.example/objects/rollback-old-parent";
  const newParent = "https://remote.example/objects/rollback-new-parent";
  await insertRemoteNote(db, oldParent, {
    visibility: "public",
    to: [PUBLIC],
    replyCount: 1,
  });
  await insertRemoteNote(db, newParent, {
    visibility: "public",
    to: [PUBLIC],
  });
  const id = "https://remote.example/objects/rollback-reparent-child";
  await insertRemoteNote(db, id, {
    visibility: "public",
    to: [PUBLIC],
    inReplyTo: oldParent,
  });
  await db.run(
    sql.raw(`
      CREATE TRIGGER reject_new_parent_counter
      BEFORE UPDATE OF reply_count ON objects
      WHEN OLD.ap_id = '${newParent}'
      BEGIN
        SELECT RAISE(ABORT, 'simulated parent counter failure');
      END
    `),
  );

  const update = parseActivity({
    id: `${id}/updates/rollback-reparent`,
    type: "Update",
    actor: REMOTE,
    object: {
      id,
      type: "Note",
      attributedTo: REMOTE,
      content: "must roll back with the thread",
      inReplyTo: newParent,
    },
  }) as Activity;
  await expect(handleUpdate(ctxFor(db), update, REMOTE)).rejects.toThrow(
    "simulated parent counter failure",
  );

  expect(await threadScopeRow(db, id)).toMatchObject({
    content: "old body",
    inReplyTo: oldParent,
  });
  expect((await threadScopeRow(db, oldParent))?.replyCount).toBe(1);
  expect((await threadScopeRow(db, newParent))?.replyCount).toBe(0);
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

test("a bcc-only Update moves private content to the hidden recipient and revokes the old one", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/readdress-hidden-bcc";
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

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "hidden carol secret", { bcc: [LOCAL_CAROL] }),
    REMOTE,
  );

  expect(await reachRow(db, id)).toMatchObject({
    content: "hidden carol secret",
    visibility: "direct",
    toJson: "[]",
    ccJson: "[]",
  });
  expect(await getPostStatus(db, fakeActor(LOCAL_BOB, "bob"), id)).toBe(404);
  expect(await getPostStatus(db, fakeActor(LOCAL_CAROL, "carol"), id)).toBe(
    200,
  );
  expect(
    (await getContacts(db, fakeActor(LOCAL_BOB, "bob"))).request_count,
  ).toBe(0);
  expect(
    (await getContacts(db, fakeActor(LOCAL_CAROL, "carol"))).mutual_followers,
  ).toEqual([
    expect.objectContaining({
      conversation_id: newConversation,
      last_message: { content: "hidden carol secret", is_mine: false },
    }),
  ]);
  expect(
    (await getMessages(db, fakeActor(LOCAL_CAROL, "carol"), REMOTE)).messages,
  ).toEqual([expect.objectContaining({ id, content: "hidden carol secret" })]);
  expect(
    await db
      .select({ recipientApId: objectRecipients.recipientApId })
      .from(objectRecipients)
      .where(eq(objectRecipients.objectApId, id)),
  ).toEqual([{ recipientApId: LOCAL_CAROL }]);
});

test("an explicit empty bcc Update clears stale direct-recipient authority", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/clear-hidden-reach";
  await insertRemoteNote(db, id, {
    visibility: "direct",
    to: [LOCAL_BOB],
    conversation: getConversationId(APP_URL, REMOTE, LOCAL_BOB),
  });
  await db.insert(objectRecipients).values({
    objectApId: id,
    recipientApId: LOCAL_BOB,
    type: "to",
  });

  await handleUpdate(
    ctxFor(db),
    updateNote(id, "no recipient remains", { bcc: [] }),
    REMOTE,
  );

  expect(await reachRow(db, id)).toMatchObject({
    content: "no recipient remains",
    visibility: "direct",
    toJson: "[]",
    ccJson: "[]",
  });
  expect(await getPostStatus(db, fakeActor(LOCAL_BOB, "bob"), id)).toBe(404);
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

test("a hidden-recipient projection failure rolls back content and the old private reach", async () => {
  const db = await setup();
  const id = "https://remote.example/objects/readdress-hidden-rollback";
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
      CREATE TRIGGER reject_hidden_readdress_recipient
      BEFORE INSERT ON object_recipients
      WHEN NEW.recipient_ap_id = '${LOCAL_CAROL}'
      BEGIN
        SELECT RAISE(ABORT, 'simulated hidden recipient failure');
      END
    `),
  );

  await expect(
    handleUpdate(
      ctxFor(db),
      updateNote(id, "must not reach bob", { bto: [LOCAL_CAROL] }),
      REMOTE,
    ),
  ).rejects.toThrow("simulated hidden recipient failure");

  expect(await reachRow(db, id)).toMatchObject({
    content: "old body",
    visibility: "direct",
    toJson: JSON.stringify([LOCAL_BOB]),
    ccJson: "[]",
  });
  expect(
    await db
      .select({ recipientApId: objectRecipients.recipientApId })
      .from(objectRecipients)
      .where(eq(objectRecipients.objectApId, id)),
  ).toEqual([{ recipientApId: LOCAL_BOB }]);
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
