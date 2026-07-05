import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, bookmarks, follows, objects } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import interactionsRoutes from "../../routes/posts/interactions.ts";

// DEEP round-2 #3 (MED security): GET /bookmarks re-implemented the visibility
// gate and omitted the Story branch, so a personal (followers-only) Story —
// stored type="Story", visibility="public", audienceJson="[]", communityApId
// NULL with the caption/overlays/attachment metadata in attachmentsJson —
// survived both bookmark filters and leaked its caption + attachment descriptor
// to a non-follower (and past the 24h endTime). The bookmark gate now uses the
// canonical passesPostVisibilitySync, and the create path is read-gated.

const APP_URL = "https://yuru.test";
const CAPTION = "my private story caption";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertActor(db: Database, username: string): Promise<string> {
  const apId = `${APP_URL}/ap/users/${username}`;
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

async function insertPersonalStory(
  db: Database,
  author: string,
  id: string,
  endTime: string,
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Story",
    attributedTo: author,
    content: "",
    visibility: "public", // stored public; REAL reach is followers
    audienceJson: "[]",
    toJson: "[]",
    ccJson: "[]",
    communityApId: null,
    endTime,
    attachmentsJson: JSON.stringify({
      caption: CAPTION,
      attachment: { r2_key: "uploads/secret.png", content_type: "image/png" },
    }),
    published: new Date().toISOString(),
  });
  return apId;
}

function appFor(db: Database, viewerApId: string) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", { ap_id: viewerApId } as never);
    await next();
  });
  app.route("/posts", interactionsRoutes);
  return app;
}

const future = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const past = () => new Date(Date.now() - 60 * 60 * 1000).toISOString();

test("GET /bookmarks does NOT leak a personal Story to a non-follower", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const viewer = await insertActor(db, "viewer");
  const storyId = await insertPersonalStory(db, author, "story1", future());
  // A bookmark row exists (e.g. inserted directly / before the create gate).
  await db.insert(bookmarks).values({ actorApId: viewer, objectApId: storyId });

  const res = await appFor(db, viewer).request(`${APP_URL}/posts/bookmarks`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    posts: { ap_id: string }[];
  };
  expect(body.posts.map((p) => p.ap_id)).not.toContain(storyId);
  // The caption must not appear anywhere in the response.
  expect(JSON.stringify(body)).not.toContain(CAPTION);
});

test("GET /bookmarks keeps a personal Story for an accepted follower", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const viewer = await insertActor(db, "viewer");
  const storyId = await insertPersonalStory(db, author, "story1", future());
  await db.insert(bookmarks).values({ actorApId: viewer, objectApId: storyId });
  await db.insert(follows).values({
    followerApId: viewer,
    followingApId: author,
    status: "accepted",
  });

  const res = await appFor(db, viewer).request(`${APP_URL}/posts/bookmarks`);
  const body = (await res.json()) as { posts: { ap_id: string }[] };
  expect(body.posts.map((p) => p.ap_id)).toContain(storyId);
});

test("GET /bookmarks drops an EXPIRED personal Story even for a follower", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const viewer = await insertActor(db, "viewer");
  const storyId = await insertPersonalStory(db, author, "story1", past());
  await db.insert(bookmarks).values({ actorApId: viewer, objectApId: storyId });
  await db.insert(follows).values({
    followerApId: viewer,
    followingApId: author,
    status: "accepted",
  });

  const res = await appFor(db, viewer).request(`${APP_URL}/posts/bookmarks`);
  const body = (await res.json()) as { posts: { ap_id: string }[] };
  expect(body.posts.map((p) => p.ap_id)).not.toContain(storyId);
});

test("POST /:id/bookmark refuses a personal Story for a non-follower (read-gated create)", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const viewer = await insertActor(db, "viewer");
  const storyId = await insertPersonalStory(db, author, "story1", future());

  const res = await appFor(db, viewer).request(
    `${APP_URL}/posts/story1/bookmark`,
    { method: "POST" },
    { APP_URL } as never,
  );
  expect(res.status).toBe(404);
  // No bookmark row was created.
  const rows = await db.select().from(bookmarks);
  expect(rows.length).toBe(0);
  void storyId;
});

test("POST /:id/bookmark allows a personal Story for an accepted follower", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const viewer = await insertActor(db, "viewer");
  await insertPersonalStory(db, author, "story1", future());
  await db.insert(follows).values({
    followerApId: viewer,
    followingApId: author,
    status: "accepted",
  });

  const res = await appFor(db, viewer).request(
    `${APP_URL}/posts/story1/bookmark`,
    { method: "POST" },
    { APP_URL } as never,
  );
  expect(res.status).toBe(200);
});
