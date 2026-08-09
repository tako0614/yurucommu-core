import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actorCache, actors, follows, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { parseActivity } from "../../lib/activitypub-validators.ts";
import { handleUpdate } from "../../routes/activitypub/handlers/inbox-content-handlers.ts";
import type {
  Activity,
  ActivityContext,
} from "../../routes/activitypub/inbox-types.ts";
import postsRoutes from "../../routes/posts/routes.ts";

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

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
  "0010_object_recipients_drop_actor_fk.sql",
  "0011_drop_remote_actor_fks.sql",
  "0012_objects_content_fts.sql",
  "0013_efficiency_indexes.sql",
  "0014_inbox_actor_created_idx.sql",
  "0015_community_bans.sql",
  "0016_namespace_takos_oidc_subject.sql",
  "0017_mobile_push_registrations.sql",
  "0018_actor_notes.sql",
  "0019_notification_push_delivery.sql",
  "0020_call_sessions.sql",
  "0022_inbound_dispatch_claims.sql",
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

async function insertRemoteNote(
  db: Database,
  id: string,
  reach: {
    visibility: "public" | "unlisted" | "followers" | "direct";
    to: string[];
    cc?: string[];
  },
): Promise<void> {
  await db.insert(objects).values({
    apId: id,
    type: "Note",
    attributedTo: REMOTE,
    content: "old body",
    visibility: reach.visibility,
    toJson: JSON.stringify(reach.to),
    ccJson: JSON.stringify(reach.cc ?? []),
    audienceJson: "[]",
    isLocal: 0,
    published: "2026-08-09T00:00:00.000Z",
  });
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
