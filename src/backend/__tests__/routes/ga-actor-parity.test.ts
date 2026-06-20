/**
 * Regression coverage for Wave-5 ACTOR-PARITY GA fixes:
 *
 *  - #31 Structured profile fields (PropertyValue): PUT /me accepts and
 *    persists a bounded `fields` array; the served actor document
 *    (routes/activitypub.ts) emits them as `attachment` PropertyValue rows and
 *    the federated Update(Person) carries the same attachments.
 *  - #23 Account migration + export: PUT /me persists `also_known_as`; the
 *    served actor document emits `alsoKnownAs`; POST /me/move sets `moved_to`
 *    and federates a Move(target) to followers; GET /me/export returns a
 *    bounded JSON archive (profile + outbox + follows + media manifest).
 */

import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  activities,
  actors,
  follows,
  mediaUploads,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoute from "../../routes/actors.ts";
import apRoute from "../../routes/activitypub.ts";

const APP_URL = "https://yurucommu.test";

const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0007_moderation_reports.sql",
  "0008_actor_fields_aka.sql",
  // 0009 adds objects.tags_json (authored by a sibling wave); the Drizzle
  // schema emits that column on insert, so apply it here too.
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
): Promise<Actor> {
  const apId = localApId(username);
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    name: "Old Name",
    summary: "old summary",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: username,
    name: "Old Name",
    summary: "old summary",
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
    role: "owner",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

type Sent = { activityId: string; followeeApId: string; type: string };

function envFor(db: Database, sent: Sent[]): Env {
  const DELIVERY_QUEUE = {
    send: (body: {
      type: string;
      activityId: string;
      followeeApId: string;
    }) => {
      sent.push({
        activityId: body.activityId,
        followeeApId: body.followeeApId,
        type: body.type,
      });
      return Promise.resolve();
    },
    sendBatch: () => Promise.resolve(),
  };
  const DELIVERY_DLQ = { send: () => Promise.resolve() };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE,
    DELIVERY_DLQ,
  } as unknown as Env;
}

function actorsApp(db: Database, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", actorsRoute);
  return app;
}

function apApp(db: Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null);
    await next();
  });
  app.route("/", apRoute);
  return app;
}

test("PUT /me persists profile fields + alsoKnownAs and federates them", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "alice");
  const sent: Sent[] = [];
  const app = actorsApp(db, actor);

  const res = await app.fetch(
    new Request(`${APP_URL}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fields: [
          { name: "Website", value: "https://alice.example" },
          { name: "Pronouns", value: "she/her" },
          // empty rows + overflow are dropped / capped at 4
          { name: "", value: "" },
          { name: "a", value: "1" },
          { name: "b", value: "2" },
          { name: "c", value: "3" },
        ],
        also_known_as: ["https://old.example/users/alice"],
      }),
    }),
    envFor(db, sent),
  );
  expect(res.status).toBe(200);

  // Persisted, sanitized + capped at MAX_PROFILE_FIELDS (4).
  const row = await db
    .select({
      fieldsJson: actors.fieldsJson,
      alsoKnownAsJson: actors.alsoKnownAsJson,
    })
    .from(actors)
    .where(eq(actors.apId, actor.ap_id))
    .get();
  const fields = JSON.parse(row!.fieldsJson) as Array<{
    name: string;
    value: string;
  }>;
  expect(fields.length).toBe(4);
  expect(fields[0]).toEqual({
    name: "Website",
    value: "https://alice.example",
  });
  expect(JSON.parse(row!.alsoKnownAsJson)).toEqual([
    "https://old.example/users/alice",
  ]);

  // Federated Update(Person) carries PropertyValue attachments + alsoKnownAs.
  const updates = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Update"));
  expect(updates.length).toBe(1);
  const doc = JSON.parse(updates[0].rawJson) as {
    object: {
      attachment?: Array<{ type: string; name: string; value: string }>;
      alsoKnownAs?: string[];
    };
  };
  expect(doc.object.attachment?.[0]).toEqual({
    type: "PropertyValue",
    name: "Website",
    value: "https://alice.example",
  });
  expect(doc.object.alsoKnownAs).toEqual(["https://old.example/users/alice"]);
  expect(sent).toEqual([
    {
      activityId: updates[0].apId,
      followeeApId: actor.ap_id,
      type: "fanout_followers",
    },
  ]);
});

test("PUT /me accepts relative /media upload paths for icon/header and absolutizes them for federation", async () => {
  // Regression: POST /api/media/upload returns an app-relative `/media/<hash>`
  // path, but PUT /me used to validate icon/header with isValidHttpUrl (which
  // rejects relative URLs), so setting an avatar via the upload flow always
  // failed with 400 "Invalid icon_url". Accept the relative path, persist it
  // verbatim, and absolutize against APP_URL only at federation serialization.
  const db = await freshDb();
  const actor = await insertLocalActor(db, "dave");
  const sent: Sent[] = [];
  const app = actorsApp(db, actor);

  const res = await app.fetch(
    new Request(`${APP_URL}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        icon_url: "/media/abc123.png",
        header_url: "/media/def456.png",
      }),
    }),
    envFor(db, sent),
  );
  expect(res.status).toBe(200);

  // Stored verbatim (relative), so same-origin client <img src> resolves.
  const row = await db
    .select({ iconUrl: actors.iconUrl, headerUrl: actors.headerUrl })
    .from(actors)
    .where(eq(actors.apId, actor.ap_id))
    .get();
  expect(row!.iconUrl).toBe("/media/abc123.png");
  expect(row!.headerUrl).toBe("/media/def456.png");

  // Federated Update(Person) absolutizes so remote servers can dereference.
  const updates = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Update"));
  expect(updates.length).toBe(1);
  const doc = JSON.parse(updates[0].rawJson) as {
    object: {
      icon?: { type: string; url: string };
      image?: { type: string; url: string };
    };
  };
  expect(doc.object.icon).toEqual({
    type: "Image",
    url: `${APP_URL}/media/abc123.png`,
  });
  expect(doc.object.image).toEqual({
    type: "Image",
    url: `${APP_URL}/media/def456.png`,
  });

  // The served actor document absolutizes the same way.
  const apRes = await apApp(db).fetch(
    new Request(`${APP_URL}/ap/users/dave`),
    envFor(db, []),
  );
  const apDoc = (await apRes.json()) as {
    icon?: { url: string };
    image?: { url: string };
  };
  expect(apDoc.icon?.url).toBe(`${APP_URL}/media/abc123.png`);
  expect(apDoc.image?.url).toBe(`${APP_URL}/media/def456.png`);
});

test("PUT /me still rejects icon/header URLs that are neither /media nor http(s)", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "erin");
  const app = actorsApp(db, actor);
  const res = await app.fetch(
    new Request(`${APP_URL}/me`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ icon_url: "javascript:alert(1)" }),
    }),
    envFor(db, []),
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe(
    "Invalid icon_url",
  );
});

test("served actor document emits attachment PropertyValue + alsoKnownAs + movedTo", async () => {
  const db = await freshDb();
  await insertLocalActor(db, "bob");
  await db
    .update(actors)
    .set({
      fieldsJson: JSON.stringify([
        { name: "Site", value: "https://bob.example" },
      ]),
      alsoKnownAsJson: JSON.stringify(["https://old.example/users/bob"]),
      movedTo: "https://new.example/users/bob",
    })
    .where(eq(actors.apId, localApId("bob")));

  const app = apApp(db);
  const res = await app.fetch(
    new Request(`${APP_URL}/ap/users/bob`),
    envFor(db, []),
  );
  expect(res.status).toBe(200);
  const doc = (await res.json()) as {
    attachment?: Array<{ type: string; name: string; value: string }>;
    alsoKnownAs?: string[];
    movedTo?: string;
  };
  expect(doc.attachment).toEqual([
    { type: "PropertyValue", name: "Site", value: "https://bob.example" },
  ]);
  expect(doc.alsoKnownAs).toEqual(["https://old.example/users/bob"]);
  expect(doc.movedTo).toBe("https://new.example/users/bob");
});

test("POST /me/move sets moved_to and federates Move(target) to followers", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "carol");
  const sent: Sent[] = [];
  const app = actorsApp(db, actor);

  const target = "https://new.example/users/carol";
  const res = await app.fetch(
    new Request(`${APP_URL}/me/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    }),
    envFor(db, sent),
  );
  expect(res.status).toBe(200);

  const row = await db
    .select({ movedTo: actors.movedTo })
    .from(actors)
    .where(eq(actors.apId, actor.ap_id))
    .get();
  expect(row!.movedTo).toBe(target);

  const moves = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Move"));
  expect(moves.length).toBe(1);
  const doc = JSON.parse(moves[0].rawJson) as {
    type: string;
    actor: string;
    object: string;
    target: string;
  };
  expect(doc.type).toBe("Move");
  expect(doc.actor).toBe(actor.ap_id);
  expect(doc.object).toBe(actor.ap_id);
  expect(doc.target).toBe(target);
  expect(sent).toEqual([
    {
      activityId: moves[0].apId,
      followeeApId: actor.ap_id,
      type: "fanout_followers",
    },
  ]);
});

test("POST /me/move rejects invalid / self target", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "dan");
  const app = actorsApp(db, actor);

  const bad = await app.fetch(
    new Request(`${APP_URL}/me/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: "not-a-url" }),
    }),
    envFor(db, []),
  );
  expect(bad.status).toBe(400);

  const self = await app.fetch(
    new Request(`${APP_URL}/me/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target: actor.ap_id }),
    }),
    envFor(db, []),
  );
  expect(self.status).toBe(400);
});

test("GET /me/export returns a bounded profile + outbox + follows + media archive", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "erin");
  await db
    .update(actors)
    .set({
      fieldsJson: JSON.stringify([
        { name: "Site", value: "https://e.example" },
      ]),
      alsoKnownAsJson: JSON.stringify(["https://old.example/users/erin"]),
    })
    .where(eq(actors.apId, actor.ap_id));

  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/p1`,
    type: "Note",
    attributedTo: actor.ap_id,
    content: "hello world",
    visibility: "public",
    published: "2026-02-01T00:00:00.000Z",
  });
  await db.insert(follows).values({
    followerApId: actor.ap_id,
    followingApId: "https://remote.example/users/zed",
    status: "accepted",
  });
  await db.insert(follows).values({
    followerApId: "https://remote.example/users/fan",
    followingApId: actor.ap_id,
    status: "accepted",
  });
  await db.insert(mediaUploads).values({
    id: "m1",
    r2Key: "media/erin/m1.png",
    uploaderApId: actor.ap_id,
    contentType: "image/png",
    size: 1234,
  });

  const app = actorsApp(db, actor);
  const res = await app.fetch(
    new Request(`${APP_URL}/me/export`),
    envFor(db, []),
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-disposition")).toContain("erin-export.json");
  const archive = (await res.json()) as {
    actor: {
      preferred_username: string;
      fields: Array<{ name: string; value: string }>;
      also_known_as: string[];
    };
    outbox: { total_items: number; ordered_items: Array<{ ap_id: string }> };
    following: { total_items: number; items: Array<{ ap_id: string }> };
    followers: { total_items: number; items: Array<{ ap_id: string }> };
    media: { total_items: number; items: Array<{ key: string }> };
  };
  expect(archive.actor.preferred_username).toBe("erin");
  expect(archive.actor.fields).toEqual([
    { name: "Site", value: "https://e.example" },
  ]);
  expect(archive.actor.also_known_as).toEqual([
    "https://old.example/users/erin",
  ]);
  expect(archive.outbox.total_items).toBe(1);
  expect(archive.outbox.ordered_items[0].ap_id).toBe(
    `${APP_URL}/ap/objects/p1`,
  );
  expect(archive.following.total_items).toBe(1);
  expect(archive.following.items[0].ap_id).toBe(
    "https://remote.example/users/zed",
  );
  expect(archive.followers.total_items).toBe(1);
  expect(archive.media.total_items).toBe(1);
  expect(archive.media.items[0].key).toBe("media/erin/m1.png");
});

test("GET /me/export requires auth", async () => {
  const db = await freshDb();
  const app = actorsApp(db, null);
  const res = await app.fetch(
    new Request(`${APP_URL}/me/export`),
    envFor(db, []),
  );
  expect(res.status).toBe(401);
});
