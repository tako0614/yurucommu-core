import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
/**
 * Regression test for the #16 follow-up (object-served `tag`): a post that
 * mentions another actor must persist the computed `Mention` tag onto the
 * object row so the served object at `GET /ap/objects/:id` emits the same
 * `tag` the outbound `Create` carried. Before this fix the objects table had
 * no column for tags (mentions lived only in `activities.rawJson`), so the
 * served object could not surface the mention to a remote consumer.
 *
 * Exercises the real POST / route handler and the real GET /ap/objects/:id
 * handler against an in-memory libsql database with production migrations
 * applied (including 0009_object_tags.sql), then inspects the served object.
 */

import { Hono } from "hono";

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, activities, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import postRoutes from "../../routes/posts/routes.ts";
import outboxRoutes from "../../routes/activitypub/outbox.ts";

const APP_URL = "https://yuru.test";
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

function fakeActor(apId: string, username: string): Actor {
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
    created_at: new Date().toISOString(),
  };
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

function postApp(
  db: Database,
  actor: Actor,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/api/posts", postRoutes);
  return app;
}

function outboxApp(
  db: Database,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    // Author is the same actor; public objects are served unauthenticated.
    c.set("actor", null);
    await next();
  });
  app.route("/", outboxRoutes);
  return app;
}

test("a post mentioning a local actor round-trips a Mention tag through GET /ap/objects/:id", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "alice");
  const mentionedApId = await insertLocalActor(db, "bob");

  // Create a public post that @-mentions a local actor.
  const createRes = await postApp(db, fakeActor(authorApId, "alice")).fetch(
    new Request(`${APP_URL}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "hello @bob", visibility: "public" }),
    }),
    envFor(db),
  );
  expect(createRes.status).toEqual(200);
  const created = (await createRes.json()) as { ap_id: string };
  expect(typeof created.ap_id).toEqual("string");

  const postId = created.ap_id.slice(`${APP_URL}/ap/objects/`.length);
  expect(postId.length).toBeGreaterThan(0);

  // Fetch the served object: it must carry the same Mention tag the Create did.
  const objRes = await outboxApp(db).fetch(
    new Request(`${APP_URL}/ap/objects/${postId}`, { method: "GET" }),
    envFor(db),
  );
  expect(objRes.status).toEqual(200);

  const served = (await objRes.json()) as {
    id: string;
    tag?: Array<{ type: string; href: string; name: string }>;
  };
  expect(served.id).toEqual(created.ap_id);
  expect(served.tag).toEqual([
    { type: "Mention", href: mentionedApId, name: "@bob@yuru.test" },
  ]);
});

test("a post with a #hashtag (and no mention) round-trips a Hashtag tag", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "alice");

  const createRes = await postApp(db, fakeActor(authorApId, "alice")).fetch(
    new Request(`${APP_URL}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "海の見える街から #yurucommu",
        visibility: "public",
      }),
    }),
    envFor(db),
  );
  expect(createRes.status).toEqual(200);
  const created = (await createRes.json()) as { ap_id: string };
  const postId = created.ap_id.slice(`${APP_URL}/ap/objects/`.length);

  const objRes = await outboxApp(db).fetch(
    new Request(`${APP_URL}/ap/objects/${postId}`, { method: "GET" }),
    envFor(db),
  );
  expect(objRes.status).toEqual(200);
  const served = (await objRes.json()) as {
    tag?: Array<{ type: string; href: string; name: string }>;
  };
  expect(served.tag).toEqual([
    {
      type: "Hashtag",
      href: `${APP_URL}/search?search=%23yurucommu`,
      name: "#yurucommu",
    },
  ]);
});

test("a post with both a mention and a hashtag carries both tags", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "alice");
  const mentionedApId = await insertLocalActor(db, "bob");

  const createRes = await postApp(db, fakeActor(authorApId, "alice")).fetch(
    new Request(`${APP_URL}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "@bob look #ocean",
        visibility: "public",
      }),
    }),
    envFor(db),
  );
  expect(createRes.status).toEqual(200);
  const created = (await createRes.json()) as { ap_id: string };
  const postId = created.ap_id.slice(`${APP_URL}/ap/objects/`.length);

  const objRes = await outboxApp(db).fetch(
    new Request(`${APP_URL}/ap/objects/${postId}`, { method: "GET" }),
    envFor(db),
  );
  const served = (await objRes.json()) as {
    tag?: Array<{ type: string; href: string; name: string }>;
  };
  const types = (served.tag ?? []).map((t) => t.type).sort();
  expect(types).toEqual(["Hashtag", "Mention"]);
  expect(served.tag).toContainEqual({
    type: "Mention",
    href: mentionedApId,
    name: "@bob@yuru.test",
  });
  expect(served.tag).toContainEqual({
    type: "Hashtag",
    href: `${APP_URL}/search?search=%23ocean`,
    name: "#ocean",
  });
});

test("a relative /media attachment is stored relative but federated as an absolute URL", async () => {
  // Regression: the client uploads an image and sends the resulting app-relative
  // `/media/<hash>` path as the attachment url. It is stored verbatim (so the
  // same-origin client renders it), but the outbound Create and the served
  // object doc must absolutize it — a remote server would otherwise resolve
  // `/media/...` against its OWN origin and 404 the image.
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "alice");

  const createRes = await postApp(db, fakeActor(authorApId, "alice")).fetch(
    new Request(`${APP_URL}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "look at this",
        visibility: "public",
        attachments: [
          {
            url: "/media/abc123.png",
            r2_key: "uploads/abc123.png",
            content_type: "image/png",
          },
        ],
      }),
    }),
    envFor(db),
  );
  expect(createRes.status).toEqual(200);
  const created = (await createRes.json()) as { ap_id: string };
  const postId = created.ap_id.slice(`${APP_URL}/ap/objects/`.length);

  // Stored verbatim (relative) so the local client renders it same-origin.
  const stored = await db
    .select({ attachmentsJson: objects.attachmentsJson })
    .from(objects)
    .where(eq(objects.apId, created.ap_id))
    .get();
  const storedAtt = JSON.parse(stored!.attachmentsJson) as Array<{
    url: string;
  }>;
  expect(storedAtt[0].url).toEqual("/media/abc123.png");

  // The served object doc absolutizes the attachment URL.
  const objRes = await outboxApp(db).fetch(
    new Request(`${APP_URL}/ap/objects/${postId}`, { method: "GET" }),
    envFor(db),
  );
  expect(objRes.status).toEqual(200);
  const served = (await objRes.json()) as {
    attachment?: Array<{ url: string; r2_key?: string }>;
  };
  expect(served.attachment?.[0].url).toEqual(`${APP_URL}/media/abc123.png`);
  // Non-url fields are preserved.
  expect(served.attachment?.[0].r2_key).toEqual("uploads/abc123.png");
});

test("a content-warning post federates summary + sensitive on the delivered Create", async () => {
  // Regression: the delivered Create's embedded object carried `summary` (the CW
  // text) but not `sensitive`, while the served object doc set `sensitive`.
  // Mastodon-compatible peers gate a CW on BOTH, so the two must agree.
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "alice");

  const createRes = await postApp(db, fakeActor(authorApId, "alice")).fetch(
    new Request(`${APP_URL}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: "spoilers within",
        summary: "Movie spoilers",
        visibility: "public",
      }),
    }),
    envFor(db),
  );
  expect(createRes.status).toEqual(200);
  const created = (await createRes.json()) as { ap_id: string };

  const row = await db
    .select({ rawJson: activities.rawJson })
    .from(activities)
    .where(eq(activities.objectApId, created.ap_id))
    .get();
  const activity = JSON.parse(row!.rawJson) as {
    object: { summary?: string; sensitive?: boolean };
  };
  expect(activity.object.summary).toEqual("Movie spoilers");
  expect(activity.object.sensitive).toEqual(true);
});

test("editing a post's content warning syncs `sensitive` on the delivered Update", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "alice");
  const app = postApp(db, fakeActor(authorApId, "alice"));

  const createRes = await app.fetch(
    new Request(`${APP_URL}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "to be edited", visibility: "public" }),
    }),
    envFor(db),
  );
  const created = (await createRes.json()) as { ap_id: string };
  const hash = created.ap_id.slice(`${APP_URL}/ap/objects/`.length);

  // Edit in a content warning -> the Update must mark sensitive: true.
  const addCw = await app.fetch(
    new Request(`${APP_URL}/api/posts/${hash}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "Edited spoilers" }),
    }),
    envFor(db),
  );
  expect(addCw.status).toEqual(200);
  const updates1 = await db
    .select({ rawJson: activities.rawJson })
    .from(activities)
    .where(eq(activities.type, "Update"));
  const u1 = JSON.parse(updates1[updates1.length - 1].rawJson) as {
    object: { summary?: string; sensitive?: boolean };
  };
  expect(u1.object.summary).toEqual("Edited spoilers");
  expect(u1.object.sensitive).toEqual(true);

  // Remove the content warning -> the Update must push sensitive: false to clear it.
  const removeCw = await app.fetch(
    new Request(`${APP_URL}/api/posts/${hash}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ summary: "" }),
    }),
    envFor(db),
  );
  expect(removeCw.status).toEqual(200);
  const updates2 = await db
    .select({ rawJson: activities.rawJson })
    .from(activities)
    .where(eq(activities.type, "Update"));
  const u2 = JSON.parse(updates2[updates2.length - 1].rawJson) as {
    object: { sensitive?: boolean };
  };
  expect(u2.object.sensitive).toEqual(false);
});

test("a plain post's delivered Create is not marked sensitive", async () => {
  const db = await freshDb();
  const authorApId = await insertLocalActor(db, "alice");

  const createRes = await postApp(db, fakeActor(authorApId, "alice")).fetch(
    new Request(`${APP_URL}/api/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "no warning", visibility: "public" }),
    }),
    envFor(db),
  );
  expect(createRes.status).toEqual(200);
  const created = (await createRes.json()) as { ap_id: string };

  const row = await db
    .select({ rawJson: activities.rawJson })
    .from(activities)
    .where(eq(activities.objectApId, created.ap_id))
    .get();
  const activity = JSON.parse(row!.rawJson) as {
    object: { sensitive?: boolean };
  };
  expect(activity.object.sensitive).toBeUndefined();
});
