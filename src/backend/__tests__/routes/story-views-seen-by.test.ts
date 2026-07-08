import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, follows, objects, storyViews } from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import storiesInteractions from "../../routes/stories/interactions.ts";

// Author-only "seen by" (viewer) list for a story: the author sees every actor
// who registered a view (most-recent-first); a non-author (or anonymous) gets a
// 404 so the viewer list is never disclosed and the endpoint isn't a
// story-existence oracle for non-authors. `view_count` is the true total.

const APP_URL = "https://yuru.test";

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

function appFor(db: Database, viewerApId: string | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", (viewerApId ? { ap_id: viewerApId } : null) as never);
    await next();
  });
  app.route("/", storiesInteractions);
  return app;
}

const env = { APP_URL } as never;

async function seedStory(db: Database, author: string): Promise<string> {
  const storyApId = `${APP_URL}/ap/objects/story1`;
  await db.insert(objects).values({
    apId: storyApId,
    type: "Story",
    attributedTo: author,
    content: "",
    visibility: "public",
    audienceJson: "[]",
    toJson: "[]",
    ccJson: "[]",
    endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    likeCount: 0,
    published: new Date().toISOString(),
  });
  return storyApId;
}

test("author sees the seen-by list (viewers who registered a view), most-recent-first, with hydrated + gracefully-degraded actors", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const alice = await insertActor(db, "alice");
  const bob = await insertActor(db, "bob");
  // Followers may register a view (canViewerReadStory passes).
  for (const follower of [alice, bob]) {
    await db.insert(follows).values({
      followerApId: follower,
      followingApId: author,
      status: "accepted",
    });
  }

  const storyApId = await seedStory(db, author);

  // Drive the real write path: alice then bob register a view.
  const post = (viewer: string) =>
    appFor(db, viewer).request(
      `${APP_URL}/view`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ap_id: storyApId }),
      },
      env,
    );
  expect((await post(alice)).status).toBe(200);
  expect((await post(bob)).status).toBe(200);

  // A REMOTE viewer with no local `actors` / `actor_cache` row, seeded directly
  // with an explicit (newest) timestamp so ordering + graceful hydration are
  // deterministic.
  const carol = "https://remote.test/users/carol";
  await db.insert(storyViews).values({
    actorApId: carol,
    storyApId,
    viewedAt: new Date(Date.now() + 1000).toISOString(),
  });

  const res = await appFor(db, author).request(
    `${APP_URL}/story1/views`,
    {},
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    view_count: number;
    viewers: Array<{
      actor: {
        ap_id: string;
        username: string;
        preferred_username: string | null;
      };
      viewed_at: string;
    }>;
  };

  // view_count matches the number of distinct viewers.
  expect(body.view_count).toBe(3);
  expect(body.viewers.length).toBe(3);

  // Most-recent-first: carol (seeded newest) is first.
  expect(body.viewers[0].actor.ap_id).toBe(carol);
  const times = body.viewers.map((v) => v.viewed_at);
  expect([...times].sort().reverse()).toEqual(times);

  // Every viewer present exactly once.
  expect(new Set(body.viewers.map((v) => v.actor.ap_id))).toEqual(
    new Set([alice, bob, carol]),
  );

  // Local viewers are hydrated (preferred_username), the remote one degrades
  // gracefully (null preferred_username, best-effort non-empty username) rather
  // than being dropped.
  const byId = new Map(body.viewers.map((v) => [v.actor.ap_id, v.actor]));
  expect(byId.get(alice)?.preferred_username).toBe("alice");
  expect(byId.get(bob)?.preferred_username).toBe("bob");
  expect(byId.get(carol)?.preferred_username).toBeNull();
  expect(byId.get(carol)?.username).toContain("carol");
});

test("a non-author gets 404 (viewer list is not disclosed)", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const alice = await insertActor(db, "alice");
  await db.insert(follows).values({
    followerApId: alice,
    followingApId: author,
    status: "accepted",
  });
  const storyApId = await seedStory(db, author);

  // alice registered a view but is NOT the author.
  await db.insert(storyViews).values({
    actorApId: alice,
    storyApId,
    viewedAt: new Date().toISOString(),
  });

  // Non-author read → 404.
  const asAlice = await appFor(db, alice).request(
    `${APP_URL}/story1/views`,
    {},
    env,
  );
  expect(asAlice.status).toBe(404);

  // Anonymous read → 404 too.
  const anon = await appFor(db, null).request(
    `${APP_URL}/story1/views`,
    {},
    env,
  );
  expect(anon.status).toBe(404);

  // The author, by contrast, sees the one recorded viewer.
  const asAuthor = await appFor(db, author).request(
    `${APP_URL}/story1/views`,
    {},
    env,
  );
  expect(asAuthor.status).toBe(200);
  const body = (await asAuthor.json()) as { view_count: number };
  expect(body.view_count).toBe(1);
});
