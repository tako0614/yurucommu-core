import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA-fix "OUTBOX" #1 — outbox confidentiality gate.
 *
 * GET /ap/users/:username/outbox and /ap/actor/outbox previously emitted the
 * full rawJson of EVERY outbound activity with no visibility filter, leaking
 * followers-only post bodies and remote-DM plaintext to any unauthenticated
 * caller. The outbox must now mirror the GET /ap/objects/:id gate: emit ONLY
 * Create/Announce activities whose referenced object is publicly shareable
 * (visibility `public` / `unlisted`), and NEVER a `followers` or `direct`
 * Create to an unauthenticated reader.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  instanceActor,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import activityPubRoutes from "../../routes/activitypub.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
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

/**
 * Insert a local Note + the outbound Create activity that wraps it. The stored
 * Create rawJson embeds the object body (content) so we can assert leakage by
 * scanning the serialized outbox for the secret content string.
 */
async function insertCreate(
  db: Database,
  opts: {
    actorApId: string;
    objectId: string;
    activityId: string;
    visibility: string;
    content: string;
    createdAt: string;
  },
): Promise<void> {
  await db.insert(objects).values({
    apId: opts.objectId,
    type: "Note",
    attributedTo: opts.actorApId,
    content: opts.content,
    visibility: opts.visibility,
    toJson: JSON.stringify([`${opts.actorApId}/followers`]),
    published: opts.createdAt,
    isLocal: 1,
  });
  await db.insert(activities).values({
    apId: opts.activityId,
    type: "Create",
    actorApId: opts.actorApId,
    objectApId: opts.objectId,
    direction: "outbound",
    rawJson: JSON.stringify({
      "@context": "https://www.w3.org/ns/activitystreams",
      id: opts.activityId,
      type: "Create",
      actor: opts.actorApId,
      object: {
        id: opts.objectId,
        type: "Note",
        content: opts.content,
      },
    }),
    createdAt: opts.createdAt,
  });
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

function appWith(
  db: Database,
  actor: Actor | null,
): Hono<{
  Bindings: Env;
  Variables: Variables;
}> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", activityPubRoutes);
  return app;
}

async function fetchOutbox(
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

const PUBLIC_SECRET = "PUBLIC-POST-BODY";
const UNLISTED_SECRET = "UNLISTED-POST-BODY";
const FOLLOWERS_SECRET = "FOLLOWERS-ONLY-SECRET-BODY";
const DIRECT_SECRET = "DIRECT-DM-PLAINTEXT-SECRET";

async function seedMixedOutbox(db: Database, actorApId: string): Promise<void> {
  await insertCreate(db, {
    actorApId,
    objectId: `${APP_URL}/ap/objects/public-1`,
    activityId: `${APP_URL}/ap/activities/public-1`,
    visibility: "public",
    content: PUBLIC_SECRET,
    createdAt: "2026-01-01T00:00:01.000Z",
  });
  await insertCreate(db, {
    actorApId,
    objectId: `${APP_URL}/ap/objects/unlisted-1`,
    activityId: `${APP_URL}/ap/activities/unlisted-1`,
    visibility: "unlisted",
    content: UNLISTED_SECRET,
    createdAt: "2026-01-01T00:00:02.000Z",
  });
  await insertCreate(db, {
    actorApId,
    objectId: `${APP_URL}/ap/objects/followers-1`,
    activityId: `${APP_URL}/ap/activities/followers-1`,
    visibility: "followers",
    content: FOLLOWERS_SECRET,
    createdAt: "2026-01-01T00:00:03.000Z",
  });
  await insertCreate(db, {
    actorApId,
    objectId: `${APP_URL}/ap/objects/direct-1`,
    activityId: `${APP_URL}/ap/activities/direct-1`,
    visibility: "direct",
    content: DIRECT_SECRET,
    createdAt: "2026-01-01T00:00:04.000Z",
  });
}

test("unauthenticated user outbox emits public/unlisted and hides followers/direct bodies", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  await seedMixedOutbox(db, actorApId);

  const { status, body } = await fetchOutbox(
    db,
    "/ap/users/alice/outbox?page=1",
  );
  expect(status).toEqual(200);

  const items = (body.orderedItems ?? []) as Array<Record<string, unknown>>;
  const ids = items.map((i) => i.id);
  expect(ids).toContain(`${APP_URL}/ap/activities/public-1`);
  expect(ids).toContain(`${APP_URL}/ap/activities/unlisted-1`);

  // The followers-only and direct Creates must be ABSENT entirely.
  expect(ids).not.toContain(`${APP_URL}/ap/activities/followers-1`);
  expect(ids).not.toContain(`${APP_URL}/ap/activities/direct-1`);

  // Belt-and-suspenders: the secret bodies must never appear in the serialized
  // page, even if a future refactor changes the activity envelope shape.
  const serialized = JSON.stringify(body);
  expect(serialized).toContain(PUBLIC_SECRET);
  expect(serialized).toContain(UNLISTED_SECRET);
  expect(serialized).not.toContain(FOLLOWERS_SECRET);
  expect(serialized).not.toContain(DIRECT_SECRET);
});

test("user outbox collection totalItems counts only publicly-shareable activities", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  await seedMixedOutbox(db, actorApId);

  const { status, body } = await fetchOutbox(db, "/ap/users/alice/outbox");
  expect(status).toEqual(200);
  expect(body.type).toEqual("OrderedCollection");
  // 4 outbound Creates exist, but only 2 (public + unlisted) are shareable.
  expect(body.totalItems).toEqual(2);
});

test("instance actor outbox applies the same public/unlisted gate", async () => {
  const db = await freshDb();
  // The instance/group actor is the bare-origin actor served at /ap/actor;
  // seed the instance_actor row directly so the route's lazy cold-start
  // (RSA keygen + insert) is skipped and the apId resolves deterministically.
  const instanceApId = `${APP_URL}/ap/actor`;
  await db.insert(instanceActor).values({
    apId: instanceApId,
    preferredUsername: "community",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  // objects.attributed_to / activities.actor_ap_id carry a FK to actors, so
  // the instance actor needs a backing actors row for the seed inserts.
  await db.insert(actors).values({
    apId: instanceApId,
    type: "Group",
    preferredUsername: "community",
    inbox: `${APP_URL}/ap/actor/inbox`,
    outbox: `${APP_URL}/ap/actor/outbox`,
    followersUrl: `${APP_URL}/ap/actor/followers`,
    followingUrl: `${APP_URL}/ap/actor/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    role: "owner",
  });
  await seedMixedOutbox(db, instanceApId);

  const { status, body } = await fetchOutbox(db, "/ap/actor/outbox?page=1");
  expect(status).toEqual(200);

  const serialized = JSON.stringify(body);
  expect(serialized).toContain(PUBLIC_SECRET);
  expect(serialized).toContain(UNLISTED_SECRET);
  expect(serialized).not.toContain(FOLLOWERS_SECRET);
  expect(serialized).not.toContain(DIRECT_SECRET);
});

test("object endpoint serves stored addressing (cc/audience) + CW sensitive flag", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  const objectId = `${APP_URL}/ap/objects/cw-post`;
  await db.insert(objects).values({
    apId: objectId,
    type: "Note",
    attributedTo: actorApId,
    content: "behind a content warning",
    summary: "CW: spoilers",
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: JSON.stringify([`${actorApId}/followers`]),
    audienceJson: JSON.stringify([`${APP_URL}/ap/groups/book-club`]),
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  const app = appWith(db, null);
  const res = await app.fetch(
    new Request(`${APP_URL}/ap/objects/cw-post`),
    envFor(db),
  );
  expect(res.status).toEqual(200);
  const obj = (await res.json()) as Record<string, unknown>;

  expect(obj.to).toEqual(["https://www.w3.org/ns/activitystreams#Public"]);
  expect(obj.cc).toEqual([`${actorApId}/followers`]);
  expect(obj.audience).toEqual([`${APP_URL}/ap/groups/book-club`]);
  expect(obj.summary).toEqual("CW: spoilers");
  expect(obj.sensitive).toEqual(true);
});
