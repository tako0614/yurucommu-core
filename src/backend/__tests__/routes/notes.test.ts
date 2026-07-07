import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actorNotes, actors, follows } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import notesRoutes from "../../routes/notes.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
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
    name: username,
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
    name: username,
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
  app.route("/", notesRoutes);
  return app;
}

async function postNote(
  db: Database,
  actor: Actor,
  content: string,
): Promise<Response> {
  return appWith(db, actor).fetch(
    new Request(`${APP_URL}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    }),
    envFor(db),
  );
}

test("notes feed returns self and accepted-follow active notes only", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const followed = await insertLocalActor(db, "followed");
  const stranger = await insertLocalActor(db, "stranger");
  const expired = await insertLocalActor(db, "expired");

  await db.insert(follows).values({
    followerApId: viewer,
    followingApId: followed,
    status: "accepted",
  });

  const now = Date.now();
  const future = new Date(now + 60 * 60 * 1000).toISOString();
  const past = new Date(now - 60 * 60 * 1000).toISOString();
  await db.insert(actorNotes).values([
    {
      actorApId: viewer,
      content: "own note",
      createdAt: future,
      updatedAt: future,
      expiresAt: future,
    },
    {
      actorApId: followed,
      content: "followed note",
      createdAt: future,
      updatedAt: future,
      expiresAt: future,
    },
    {
      actorApId: stranger,
      content: "stranger note",
      createdAt: future,
      updatedAt: future,
      expiresAt: future,
    },
    {
      actorApId: expired,
      content: "expired note",
      createdAt: past,
      updatedAt: past,
      expiresAt: past,
    },
  ]);

  const res = await appWith(db, fakeActor(viewer, "viewer")).fetch(
    new Request(`${APP_URL}/`, { method: "GET" }),
    envFor(db),
  );

  expect(res.status).toEqual(200);
  const body = (await res.json()) as {
    notes: Array<{ content: string; actor: { username: string } }>;
  };
  expect(body.notes.map((note) => note.content).sort()).toEqual([
    "followed note",
    "own note",
  ]);
  expect(body.notes.map((note) => note.actor.username).sort()).toEqual([
    "followed@yuru.test",
    "viewer@yuru.test",
  ]);
});

test("posting a note upserts the current actor note and delete hides it", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const viewerActor = fakeActor(viewer, "viewer");

  let res = await postNote(db, viewerActor, "first");
  expect(res.status).toEqual(201);

  res = await postNote(db, viewerActor, "second");
  expect(res.status).toEqual(201);
  const postBody = (await res.json()) as { note: { content: string } };
  expect(postBody.note.content).toEqual("second");

  res = await appWith(db, viewerActor).fetch(
    new Request(`${APP_URL}/`, { method: "GET" }),
    envFor(db),
  );
  let feedBody = (await res.json()) as { notes: Array<{ content: string }> };
  expect(feedBody.notes.map((note) => note.content)).toEqual(["second"]);

  res = await appWith(db, viewerActor).fetch(
    new Request(`${APP_URL}/me`, { method: "DELETE" }),
    envFor(db),
  );
  expect(res.status).toEqual(200);

  res = await appWith(db, viewerActor).fetch(
    new Request(`${APP_URL}/`, { method: "GET" }),
    envFor(db),
  );
  feedBody = (await res.json()) as { notes: Array<{ content: string }> };
  expect(feedBody.notes).toEqual([]);
});

test("posting a blank or overlong note is rejected", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const viewerActor = fakeActor(viewer, "viewer");

  expect((await postNote(db, viewerActor, "   ")).status).toEqual(400);
  expect((await postNote(db, viewerActor, "x".repeat(81))).status).toEqual(400);
});
