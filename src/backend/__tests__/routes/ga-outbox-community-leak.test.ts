import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA-fix Wave-9 "OUTBOX-GATE" #1/#8 — community-addressed posts must not leak
 * through the unauthenticated public outbox.
 *
 * A community-scoped Note is stored with `visibility = "public"` (so the normal
 * public/unlisted visibility gate treats it as openly readable) but carries a
 * non-empty `audienceJson = [communityApId]`. The public outbox row + count
 * queries previously admitted ANY Create whose object visibility was
 * public/unlisted, so the full Create envelope (incl. `object.content`) of a
 * private-community post leaked to anonymous callers — even though the SAME
 * file's GET /ap/objects/:id gates private-community fetches via
 * `canViewerReadObject`. The outbox gate now ANDs in the empty-audience
 * predicate (`objects.audienceJson = "[]"`) for the local-object branch, so
 * community-addressed activities are excluded from both `orderedItems` and
 * `totalItems`, while non-community public/unlisted posts stay admitted.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, activities, communities, objects } from "../../../db/index.ts";
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

/**
 * Insert a local Note + the outbound Create activity that wraps it. When
 * `communityApId` is provided the Note is stored "public"-visibility but
 * carries `audienceJson = [communityApId]` (the community-scoped shape).
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
    communityApId?: string;
  },
): Promise<void> {
  await db.insert(objects).values({
    apId: opts.objectId,
    type: "Note",
    attributedTo: opts.actorApId,
    content: opts.content,
    visibility: opts.visibility,
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    audienceJson: opts.communityApId
      ? JSON.stringify([opts.communityApId])
      : "[]",
    communityApId: opts.communityApId ?? null,
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
        ...(opts.communityApId ? { audience: [opts.communityApId] } : {}),
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

const PUBLIC_SECRET = "NORMAL-PUBLIC-POST-BODY";
const COMMUNITY_SECRET = "PRIVATE-COMMUNITY-POST-SECRET-BODY";
const PRIVATE_COMMUNITY = `${APP_URL}/ap/communities/secret-club`;

async function seedOutbox(db: Database, actorApId: string): Promise<void> {
  // A normal public post (no audience) — MUST stay admitted.
  await insertCreate(db, {
    actorApId,
    objectId: `${APP_URL}/ap/objects/public-1`,
    activityId: `${APP_URL}/ap/activities/public-1`,
    visibility: "public",
    content: PUBLIC_SECRET,
    createdAt: "2026-01-01T00:00:01.000Z",
  });
  // A private-community post stored "public"-visibility but community-addressed
  // — MUST be excluded from the anonymous outbox.
  await db.insert(communities).values({
    apId: PRIVATE_COMMUNITY,
    preferredUsername: "secret-club",
    name: "Secret Club",
    inbox: `${PRIVATE_COMMUNITY}/inbox`,
    outbox: `${PRIVATE_COMMUNITY}/outbox`,
    followersUrl: `${PRIVATE_COMMUNITY}/followers`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: actorApId,
    visibility: "private",
  });
  await insertCreate(db, {
    actorApId,
    objectId: `${APP_URL}/ap/objects/community-1`,
    activityId: `${APP_URL}/ap/activities/community-1`,
    visibility: "public",
    content: COMMUNITY_SECRET,
    createdAt: "2026-01-01T00:00:02.000Z",
    communityApId: PRIVATE_COMMUNITY,
  });
}

test("anonymous user outbox excludes private-community Create and admits normal public post", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  await seedOutbox(db, actorApId);

  const { status, body } = await fetchOutbox(
    db,
    "/ap/users/alice/outbox?page=1",
  );
  expect(status).toEqual(200);

  const items = (body.orderedItems ?? []) as Array<Record<string, unknown>>;
  const ids = items.map((i) => i.id);
  expect(ids).toContain(`${APP_URL}/ap/activities/public-1`);
  expect(ids).not.toContain(`${APP_URL}/ap/activities/community-1`);

  // Belt-and-suspenders: the community post body must never appear in the
  // serialized page; the normal public body must.
  const serialized = JSON.stringify(body);
  expect(serialized).toContain(PUBLIC_SECRET);
  expect(serialized).not.toContain(COMMUNITY_SECRET);
});

test("anonymous user outbox totalItems excludes community-addressed activities", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  await seedOutbox(db, actorApId);

  const { status, body } = await fetchOutbox(db, "/ap/users/alice/outbox");
  expect(status).toEqual(200);
  expect(body.type).toEqual("OrderedCollection");
  // 2 outbound public-visibility Creates exist, but only the non-community one
  // is publicly shareable.
  expect(body.totalItems).toEqual(1);
});

test("instance actor outbox applies the same community-audience exclusion", async () => {
  const db = await freshDb();
  const actorApId = await insertLocalActor(db, "alice");
  await seedOutbox(db, actorApId);

  // Reuse the per-user route's gate via the same fetchPublicOutbox path; the
  // community-addressed Create must be absent from the count + items.
  const { status, body } = await fetchOutbox(
    db,
    "/ap/users/alice/outbox?page=1",
  );
  expect(status).toEqual(200);
  const items = (body.orderedItems ?? []) as Array<Record<string, unknown>>;
  expect(items).toHaveLength(1);
  expect((items[0] as Record<string, unknown>).id).toEqual(
    `${APP_URL}/ap/activities/public-1`,
  );
});
