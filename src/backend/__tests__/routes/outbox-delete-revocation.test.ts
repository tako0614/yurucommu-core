import { expect, test } from "bun:test";
import { Hono } from "hono";
import { and, eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { activities, actors, announces, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import activityPubRoutes from "../../routes/activitypub.ts";
import interactionRoutes from "../../routes/posts/interactions.ts";
import {
  purgeActorContent,
  purgeDomainContent,
} from "../../lib/blocklist-purge.ts";
import {
  blockActor,
  blockDomain,
  unblockActor,
  unblockDomain,
} from "../../lib/blocklist.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const APP_URL = "https://yuru.test";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const CREATED_AT = "2026-01-01T00:00:00.000Z";

async function freshDb() {
  // createTestDb dynamically applies every sorted migration and guards each
  // statement with the repository's Cloudflare D1 semantic limits.
  return await createTestDb();
}

function localApId(username: string): string {
  return `${APP_URL}/ap/users/${username}`;
}

async function insertActor(db: Database, apId: string, username: string) {
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

async function insertLocalActor(db: Database, username: string) {
  const apId = localApId(username);
  await insertActor(db, apId, username);
  return apId;
}

function actorFor(apId: string, username: string): Actor {
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: null,
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followers_url: `${apId}/followers`,
    following_url: `${apId}/following`,
    public_key_pem: "pub",
    private_key_pem: "priv",
    takos_user_id: null,
    follower_count: 0,
    following_count: 0,
    post_count: 0,
    is_private: 0,
    role: "member",
    created_at: CREATED_AT,
  };
}

function envFor(db: Database, sent: string[] = []): Env {
  const queue = {
    send: async (body: { type: string }) => sent.push(body.type),
    sendBatch: async (messages: Array<{ body: { type: string } }>) => {
      sent.push(...messages.map(({ body }) => body.type));
    },
  };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
  } as unknown as Env;
}

function appForActivityPub(db: Database) {
  const env = envFor(db);
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null as Actor | null);
    await next();
  });
  app.route("/", activityPubRoutes);
  return { app, env };
}

function appForInteractions(db: Database, actor: Actor) {
  const env = envFor(db);
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", interactionRoutes);
  return { app, env };
}

async function outboxJson(db: Database, path: string) {
  const { app, env } = appForActivityPub(db);
  const response = await app.fetch(new Request(`${APP_URL}${path}`), env);
  const text = await response.text();
  return {
    status: response.status,
    body: JSON.parse(text) as Record<string, unknown>,
    text,
  };
}

function itemIds(body: Record<string, unknown>): string[] {
  return ((body.orderedItems ?? []) as Array<{ id: string }>).map(
    (item) => item.id,
  );
}

async function insertNote(
  db: Database,
  input: { apId: string; authorApId: string; content?: string },
) {
  await db.insert(objects).values({
    apId: input.apId,
    type: "Note",
    attributedTo: input.authorApId,
    content: input.content ?? "public note",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    ccJson: "[]",
    audienceJson: "[]",
    published: CREATED_AT,
    isLocal: input.authorApId.startsWith(`${APP_URL}/`) ? 1 : 0,
  });
}

async function insertActivity(
  db: Database,
  input: {
    apId: string;
    type: string;
    actorApId: string;
    objectApId: string;
    createdAt?: string;
    direction?: "inbound" | "outbound" | null;
  },
) {
  const raw = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: input.apId,
    type: input.type,
    actor: input.actorApId,
    object: input.objectApId,
    to: [PUBLIC],
  };
  await db.insert(activities).values({
    apId: input.apId,
    type: input.type,
    actorApId: input.actorApId,
    objectApId: input.objectApId,
    direction: input.direction === undefined ? "outbound" : input.direction,
    rawJson: JSON.stringify(raw),
    createdAt: input.createdAt ?? CREATED_AT,
  });
}

async function announceFromLocalActor(
  db: Database,
  actorApId: string,
  activityApId: string,
  objectApId: string,
) {
  await db.insert(announces).values({ actorApId, objectApId, activityApId });
  await insertActivity(db, {
    apId: activityApId,
    type: "Announce",
    actorApId,
    objectApId,
  });
}

test("a real user repost is public until its target is purged, retaining the ledger", async () => {
  const { db } = await freshDb();
  const author = "https://author-host.example/users/post-author";
  const boosterApId = await insertLocalActor(db, "booster");
  const postApId = `${APP_URL}/ap/objects/repost-target`;
  await insertNote(db, { apId: postApId, authorApId: author });

  const { app, env } = appForInteractions(db, actorFor(boosterApId, "booster"));
  const repostResponse = await app.fetch(
    new Request(`${APP_URL}/${encodeURIComponent(postApId)}/repost`, {
      method: "POST",
    }),
    env,
  );
  expect(repostResponse.status).toBe(200);

  const announce = await db
    .select({ apId: activities.apId, direction: activities.direction })
    .from(activities)
    .where(eq(activities.type, "Announce"))
    .get();
  expect(announce?.direction).toBe("outbound");
  if (!announce) throw new Error("repost did not create an activity");

  const collection = await outboxJson(db, "/ap/users/booster/outbox");
  const page = await outboxJson(db, "/ap/users/booster/outbox?page=1");
  expect(collection.body.totalItems).toBe(1);
  expect(itemIds(page.body)).toEqual([announce.apId]);
  expect(page.text).toContain(postApId);

  await blockActor(
    db,
    "https://AUTHOR-host.example:443/users/post-author/",
    "block",
  );
  expect((await purgeActorContent(db, author)).complete).toBe(true);
  expect(await db.select().from(announces)).toEqual([]);
  expect(await db.select().from(objects)).toEqual([]);
  const retained = await db
    .select()
    .from(activities)
    .where(eq(activities.apId, announce.apId))
    .get();
  expect(retained?.objectApId).toBe(postApId);
  expect(retained?.rawJson).toContain(postApId);
  await unblockActor(db, author);
  expect(
    (await outboxJson(db, "/ap/users/booster/outbox")).body.totalItems,
  ).toBe(0);
  expect(
    itemIds((await outboxJson(db, "/ap/users/booster/outbox?page=1")).body),
  ).toEqual([]);
});

test("retained-reader actor purge removes the remote object but preserves local Announce ledger", async () => {
  const { db } = await freshDb();
  const localOwner = await insertLocalActor(db, "alice");
  const remoteAuthor = "https://node.remote.example/users/author";
  const target = "https://node.remote.example/notes/purged";
  const remoteCreate = "https://node.remote.example/activities/create-purged";
  const localAnnounce = `${APP_URL}/ap/activities/announce-purged-target`;
  await insertNote(db, { apId: target, authorApId: remoteAuthor });
  await insertActivity(db, {
    apId: remoteCreate,
    type: "Create",
    actorApId: remoteAuthor,
    objectApId: target,
    direction: "inbound",
  });
  await announceFromLocalActor(db, localOwner, localAnnounce, target);

  await blockActor(
    db,
    "https://NODE.remote.example:443/users/author/",
    "block",
  );
  const purged = await purgeActorContent(db, remoteAuthor);
  expect(purged.complete).toBe(true);
  expect(purged.deletedObjects).toBe(1);
  expect(
    await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, target)),
  ).toEqual([]);
  expect(
    await db
      .select({ apId: activities.apId })
      .from(activities)
      .where(eq(activities.apId, remoteCreate)),
  ).toEqual([]);
  expect(
    await db
      .select({ actorApId: announces.actorApId })
      .from(announces)
      .where(eq(announces.activityApId, localAnnounce)),
  ).toEqual([]);

  const retained = await db
    .select({ rawJson: activities.rawJson, objectApId: activities.objectApId })
    .from(activities)
    .where(eq(activities.apId, localAnnounce))
    .get();
  expect(retained?.objectApId).toBe(target);
  expect(retained?.rawJson).toContain(target);
  await unblockActor(db, remoteAuthor);
  const page = await outboxJson(db, "/ap/users/alice/outbox?page=1");
  const collection = await outboxJson(db, "/ap/users/alice/outbox");
  expect(itemIds(page.body)).not.toContain(localAnnounce);
  expect(collection.body.totalItems).toBe(0);
});

test("domain purge stays revoked after unblock and target reinsertion", async () => {
  const { db } = await freshDb();
  const localOwner = await insertLocalActor(db, "domain-owner");
  const remoteAuthor = "https://node.defederated.example/users/author";
  const target = "https://node.defederated.example/notes/reused-id";
  const oldAnnounce = `${APP_URL}/ap/activities/old-domain-announce`;
  const newActivity = `${APP_URL}/ap/activities/new-after-reinsert`;
  await insertNote(db, {
    apId: target,
    authorApId: remoteAuthor,
    content: "old",
  });
  await announceFromLocalActor(db, localOwner, oldAnnounce, target);

  await blockDomain(db, "https://DEFEDERATED.example:443/anything", "block");
  const purged = await purgeDomainContent(db, "defederated.example");
  expect(purged.complete).toBe(true);
  expect(purged.deletedObjects).toBe(1);
  await unblockDomain(db, "DEFEDERATED.example");

  await insertNote(db, {
    apId: target,
    authorApId: remoteAuthor,
    content: "reinserted",
  });
  await insertActivity(db, {
    apId: newActivity,
    type: "Create",
    actorApId: localOwner,
    objectApId: target,
  });

  const collection = await outboxJson(db, "/ap/users/domain-owner/outbox");
  const page = await outboxJson(
    db,
    "/ap/users/domain-owner/outbox?page=1&limit=10",
  );
  expect(collection.body.totalItems).toBe(1);
  expect(itemIds(page.body)).toContain(newActivity);
  expect(itemIds(page.body)).not.toContain(oldAnnounce);
  expect(page.text).toContain(target);
});

test("public Announce of an unknown remote object remains in the public outbox", async () => {
  const { db } = await freshDb();
  const owner = await insertLocalActor(db, "remote-boost-owner");
  const remoteTarget = "https://remote.example/notes/not-ingested";
  const announceId = `${APP_URL}/ap/activities/unknown-remote-public-boost`;
  await insertActivity(db, {
    apId: announceId,
    type: "Announce",
    actorApId: owner,
    objectApId: remoteTarget,
  });

  const collection = await outboxJson(
    db,
    "/ap/users/remote-boost-owner/outbox",
  );
  const page = await outboxJson(
    db,
    "/ap/users/remote-boost-owner/outbox?page=1",
  );
  expect(collection.body.totalItems).toBe(1);
  expect(itemIds(page.body)).toEqual([announceId]);
  expect(page.text).toContain(remoteTarget);
});

test("object deletion revokes eligible activities without disturbing equal-time cursor controls", async () => {
  const { db } = await freshDb();
  const owner = await insertLocalActor(db, "cursor-owner");
  const target = `${APP_URL}/ap/objects/cursor-target`;
  const controlTarget = `${APP_URL}/ap/objects/cursor-control`;
  const ledgerActor = await insertLocalActor(db, "ledger-control");
  await insertNote(db, { apId: target, authorApId: owner });
  await insertNote(db, { apId: controlTarget, authorApId: owner });

  const revokedIds = [
    `${APP_URL}/ap/activities/m-revoked-create`,
    `${APP_URL}/ap/activities/l-revoked-update`,
    `${APP_URL}/ap/activities/k-revoked-announce`,
  ];
  for (const [index, id] of revokedIds.entries()) {
    await insertActivity(db, {
      apId: id,
      type: ["Create", "Update", "Announce"][index]!,
      actorApId: owner,
      objectApId: target,
      direction: index === 1 ? "inbound" : "outbound",
    });
  }
  await insertActivity(db, {
    apId: `${APP_URL}/ap/activities/j-not-a-revocation-delete`,
    type: "Delete",
    actorApId: ledgerActor,
    objectApId: target,
  });
  await insertActivity(db, {
    apId: `${APP_URL}/ap/activities/i-not-a-revocation-undo`,
    type: "Undo",
    actorApId: ledgerActor,
    objectApId: target,
  });
  const newestControl = `${APP_URL}/ap/activities/z-equal-time-control`;
  const oldestControl = `${APP_URL}/ap/activities/a-equal-time-control`;
  await insertActivity(db, {
    apId: newestControl,
    type: "Create",
    actorApId: owner,
    objectApId: controlTarget,
  });
  await insertActivity(db, {
    apId: oldestControl,
    type: "Create",
    actorApId: owner,
    objectApId: controlTarget,
  });

  await db.delete(objects).where(eq(objects.apId, target));
  await insertNote(db, {
    apId: target,
    authorApId: owner,
    content: "same id again",
  });
  const newActivity = `${APP_URL}/ap/activities/new-activity-same-target`;
  await insertActivity(db, {
    apId: newActivity,
    type: "Create",
    actorApId: owner,
    objectApId: target,
  });

  const collection = await outboxJson(db, "/ap/users/cursor-owner/outbox");
  expect(collection.body.totalItems).toBe(3);
  const first = await outboxJson(
    db,
    "/ap/users/cursor-owner/outbox?page=1&limit=1",
  );
  expect(itemIds(first.body)).toEqual([newestControl]);
  expect(first.body.next).toEqual(expect.any(String));
  const nextUrl = new URL(first.body.next as string);
  nextUrl.searchParams.set("limit", "1");
  const second = await outboxJson(db, `${nextUrl.pathname}${nextUrl.search}`);
  const thirdCursor = second.body.next;
  expect(itemIds(second.body)).toEqual([newActivity]);
  expect(thirdCursor).toEqual(expect.any(String));
  const thirdUrl = new URL(thirdCursor as string);
  thirdUrl.searchParams.set("limit", "1");
  const third = await outboxJson(db, `${thirdUrl.pathname}${thirdUrl.search}`);
  expect(itemIds(third.body)).toEqual([oldestControl]);
  expect(third.body.next).toBeUndefined();

  const allItems = [
    ...itemIds(first.body),
    ...itemIds(second.body),
    ...itemIds(third.body),
  ];
  for (const id of revokedIds) expect(allItems).not.toContain(id);
});

test("normal unrepost preserves its existing Undo behavior while the target exists", async () => {
  const { db } = await freshDb();
  const author = await insertLocalActor(db, "undo-author");
  const boosterApId = await insertLocalActor(db, "undo-booster");
  const target = `${APP_URL}/ap/objects/unrepost-target`;
  await insertNote(db, { apId: target, authorApId: author });
  const { app, env } = appForInteractions(
    db,
    actorFor(boosterApId, "undo-booster"),
  );
  const url = `${APP_URL}/${encodeURIComponent(target)}/repost`;

  const repost = await app.fetch(new Request(url, { method: "POST" }), env);
  expect(repost.status).toBe(200);
  const originalAnnounce = await db
    .select({ activityApId: announces.activityApId })
    .from(announces)
    .where(
      and(
        eq(announces.actorApId, boosterApId),
        eq(announces.objectApId, target),
      ),
    )
    .get();
  if (!originalAnnounce?.activityApId)
    throw new Error("Announce edge was not persisted");

  const unrepost = await app.fetch(new Request(url, { method: "DELETE" }), env);
  expect(unrepost.status).toBe(200);
  expect(await unrepost.json()).toEqual({ success: true, reposted: false });
  expect(
    await db
      .select({ type: activities.type })
      .from(activities)
      .where(eq(activities.apId, originalAnnounce.activityApId)),
  ).toEqual([]);
  const undo = await db
    .select({ type: activities.type, rawJson: activities.rawJson })
    .from(activities)
    .where(eq(activities.type, "Undo"))
    .get();
  expect(undo?.type).toBe("Undo");
  expect(undo?.rawJson).toContain(target);
});
