import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA-fix Wave-6 "OUTBOX" — AP-conformance hardening for the outbox / object
 * endpoints. Covers four Round-2 findings:
 *
 *  #8  OrderedCollectionPage `id` must be unique per page (derived from the
 *      actual request URL incl. the cursor), not a hardcoded `?page=1`.
 *  #15 A public `Announce` of a REMOTE object (no local `objects` row) must
 *      still be emitted; followers/direct Creates stay excluded.
 *  #16 GET /ap/objects/:id must treat `unlisted` as public-readable, matching
 *      the outbox/media gate (not author-only).
 *  #17 The object doc must NOT advertise dangling `replies` / `likes`
 *      sub-collection IRIs (no route serves them).
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, activities, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import activityPubRoutes from "../../routes/activitypub.ts";

const APP_URL = "https://yuru.test";
const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
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
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return apId;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

function appWith(
  db: Database,
  actor: Actor | null,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", activityPubRoutes);
  return app;
}

async function fetchJson(
  db: Database,
  path: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = appWith(db, null);
  const res = await app.fetch(new Request(`${APP_URL}${path}`), envFor(db));
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown>,
  };
}

/** Seed `n` public Creates so a `limit`-sized page yields a `next` cursor. */
async function seedPublicCreates(
  db: Database,
  actorApId: string,
  n: number,
): Promise<void> {
  for (let i = 0; i < n; i++) {
    const seq = String(i).padStart(3, "0");
    const objectId = `${APP_URL}/ap/objects/p-${seq}`;
    const activityId = `${APP_URL}/ap/activities/p-${seq}`;
    await db.insert(objects).values({
      apId: objectId,
      type: "Note",
      attributedTo: actorApId,
      content: `public ${seq}`,
      visibility: "public",
      toJson: JSON.stringify([PUBLIC]),
      published: `2026-01-01T00:00:${seq.slice(-2).padStart(2, "0")}.000Z`,
      isLocal: 1,
    });
    await db.insert(activities).values({
      apId: activityId,
      type: "Create",
      actorApId,
      objectApId: objectId,
      direction: "outbound",
      rawJson: JSON.stringify({ id: activityId, type: "Create" }),
      createdAt: `2026-01-01T00:00:${seq.slice(-2).padStart(2, "0")}.000Z`,
    });
  }
}

test("#8 OrderedCollectionPage id is unique per page (derived from cursor)", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  // 3 items with a page limit of 2 forces a second page via the next cursor.
  await seedPublicCreates(db, actorApId, 3);

  const first = await fetchJson(db, "/ap/users/alice/outbox?page=1&limit=2");
  expect(first.status).toEqual(200);
  expect(first.body.type).toEqual("OrderedCollectionPage");

  const firstId = first.body.id as string;
  const next = first.body.next as string | undefined;
  expect(typeof next).toEqual("string");

  // The first page id has no cursor; the next page link carries one.
  expect(firstId).not.toContain("cursor=");
  expect(next).toContain("cursor=");

  // Dereference the next page; its `id` must equal the link we followed and
  // must differ from the first page's id (not a shared hardcoded `?page=1`).
  const nextPath =
    new URL(next as string).pathname + new URL(next as string).search;
  const second = await fetchJson(db, nextPath);
  expect(second.status).toEqual(200);
  const secondId = second.body.id as string;

  expect(secondId).toEqual(next as string);
  expect(secondId).not.toEqual(firstId);
  expect(secondId).toContain("cursor=");
});

test("outbox emits NO `next` link on an exact-multiple final page (limit+1 probe)", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  // Exactly `limit` items: the page is full but there is nothing after it.
  await seedPublicCreates(db, actorApId, 2);

  const { status, body } = await fetchJson(
    db,
    "/ap/users/alice/outbox?page=1&limit=2",
  );
  expect(status).toEqual(200);
  expect((body.orderedItems as unknown[]).length).toEqual(2);
  // Pre-fix, rows.length === limit advertised a `next` cursor pointing at an
  // empty terminal page; the limit+1 probe suppresses it.
  expect(body.next).toBeUndefined();
});

test("followers collection emits NO `next` link on an exact-multiple final page", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  // Two accepted followers of alice; request a page of exactly 2.
  for (const u of ["bob", "carol"]) {
    const follower = await insertLocalActor(db, u);
    await db.insert(schema.follows).values({
      followerApId: follower,
      followingApId: alice,
      status: "accepted",
      acceptedAt: `2026-01-01T00:00:0${u === "bob" ? 1 : 2}.000Z`,
    });
  }

  const { status, body } = await fetchJson(
    db,
    "/ap/users/alice/followers?page=1&limit=2",
  );
  expect(status).toEqual(200);
  expect((body.orderedItems as unknown[]).length).toEqual(2);
  expect(body.next).toBeUndefined();
});

test("#15 public Announce of a REMOTE (absent) object is emitted; followers/direct excluded", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");

  const remoteObjectId = "https://remote.example/notes/42";
  const announceId = `${APP_URL}/ap/activities/announce-remote-1`;
  // No local `objects` row for the announced (remote) object.
  await db.insert(activities).values({
    apId: announceId,
    type: "Announce",
    actorApId,
    objectApId: remoteObjectId,
    direction: "outbound",
    rawJson: JSON.stringify({
      id: announceId,
      type: "Announce",
      actor: actorApId,
      object: remoteObjectId,
      to: [PUBLIC],
      cc: [`${actorApId}/followers`],
    }),
    createdAt: "2026-01-01T00:00:10.000Z",
  });

  // A NON-public (followers-only) Announce of a remote object must NOT leak.
  const privAnnounceId = `${APP_URL}/ap/activities/announce-remote-priv`;
  await db.insert(activities).values({
    apId: privAnnounceId,
    type: "Announce",
    actorApId,
    objectApId: "https://remote.example/notes/99",
    direction: "outbound",
    rawJson: JSON.stringify({
      id: privAnnounceId,
      type: "Announce",
      actor: actorApId,
      object: "https://remote.example/notes/99",
      to: [`${actorApId}/followers`],
    }),
    createdAt: "2026-01-01T00:00:11.000Z",
  });

  const { status, body } = await fetchJson(db, "/ap/users/alice/outbox?page=1");
  expect(status).toEqual(200);
  const items = (body.orderedItems ?? []) as Array<Record<string, unknown>>;
  const ids = items.map((i) => i.id);
  expect(ids).toContain(announceId);
  expect(ids).not.toContain(privAnnounceId);

  const collection = await fetchJson(db, "/ap/users/alice/outbox");
  // Only the public remote-object Announce counts toward totalItems.
  expect(collection.body.totalItems).toEqual(1);
});

test("#16 GET /ap/objects/:id serves an unlisted object publicly (no signature)", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  const objectId = `${APP_URL}/ap/objects/unlisted-readable`;
  await db.insert(objects).values({
    apId: objectId,
    type: "Note",
    attributedTo: actorApId,
    content: "unlisted body",
    visibility: "unlisted",
    toJson: JSON.stringify([`${actorApId}/followers`]),
    ccJson: JSON.stringify([PUBLIC]),
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  // Unauthenticated (no HTTP signature) fetch must succeed for `unlisted`.
  const { status, body } = await fetchJson(db, "/ap/objects/unlisted-readable");
  expect(status).toEqual(200);
  expect(body.id).toEqual(objectId);
  expect(body.content).toEqual("unlisted body");
});

test("#17 object doc does NOT advertise dangling replies/likes sub-collections", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  const objectId = `${APP_URL}/ap/objects/no-subcollections`;
  await db.insert(objects).values({
    apId: objectId,
    type: "Note",
    attributedTo: actorApId,
    content: "hi",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  const { status, body } = await fetchJson(db, "/ap/objects/no-subcollections");
  expect(status).toEqual(200);
  expect(body.replies).toBeUndefined();
  expect(body.likes).toBeUndefined();
});

test("AP documents are served as application/activity+json (not application/json)", async () => {
  // Hono's c.json() force-sets application/json; a strict AP consumer
  // (Mastodon's Request only accepts application/activity+json or ld+json)
  // would reject the document, breaking inbound federation. Pin the header.
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  await seedPublicCreates(db, actorApId, 1);
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/ct-note`,
    type: "Note",
    attributedTo: actorApId,
    content: "hi",
    visibility: "public",
    toJson: JSON.stringify([PUBLIC]),
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });
  const app = appWith(db, null);

  for (const path of [
    "/ap/users/alice/outbox",
    "/ap/users/alice/outbox?page=1",
    "/ap/users/alice/following",
    "/ap/objects/ct-note",
  ]) {
    const res = await app.fetch(new Request(`${APP_URL}${path}`), envFor(db));
    expect(res.status).toEqual(200);
    expect(res.headers.get("content-type") ?? "").toContain(
      "application/activity+json",
    );
  }
});
