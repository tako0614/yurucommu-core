import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #3 — reply listing visibility leak.
 *
 * GET /api/posts/:id/replies must apply the SAME per-post visibility gate that
 * GET /api/posts/:id applies. A `followers`-only or `direct` reply must not be
 * returned to a viewer who is not its author, an accepted follower (followers
 * case), or an addressed recipient (direct case). The post author and an
 * accepted follower / recipient must still see them.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, follows, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import postsRoutes from "../../routes/posts/routes.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
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
  return {
    APP_URL,
    DB_INSTANCE: db,
    // Queue bindings are not exercised by the replies GET path.
    DELIVERY_QUEUE: undefined,
    DELIVERY_DLQ: undefined,
  } as unknown as Env;
}

function appWith(
  db: Database,
  env: Env,
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
  app.route("/", postsRoutes);
  return app;
}

async function insertReply(
  db: Database,
  opts: {
    id: string;
    author: string;
    parentApId: string;
    visibility: string;
    to?: string[];
    published: string;
  },
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${opts.id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: opts.author,
    content: `reply ${opts.id}`,
    inReplyTo: opts.parentApId,
    visibility: opts.visibility,
    toJson: JSON.stringify(opts.to ?? []),
    ccJson: "[]",
    audienceJson: "[]",
    published: opts.published,
    isLocal: 1,
  });
  return apId;
}

async function fetchReplyIds(
  db: Database,
  viewer: Actor | null,
  parentApId: string,
): Promise<string[]> {
  const env = envFor(db);
  const app = appWith(db, env, viewer);
  const encoded = encodeURIComponent(parentApId);
  const res = await app.fetch(
    new Request(`${APP_URL}/${encoded}/replies`, { method: "GET" }),
    env,
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as { replies: Array<{ ap_id: string }> };
  return body.replies.map((r) => r.ap_id);
}

test("replies listing hides followers/direct replies from a non-follower and reveals them to author/follower/recipient", async () => {
  const db = await freshDb();

  const author = await insertLocalActor(db, "author"); // owns parent + replies
  const follower = await insertLocalActor(db, "follower"); // accepted follower
  const stranger = await insertLocalActor(db, "stranger"); // no relationship
  const dmTarget = await insertLocalActor(db, "dmtarget"); // direct recipient

  // Accepted follow: follower -> author.
  await db.insert(follows).values({
    followerApId: follower,
    followingApId: author,
    status: "accepted",
  });

  // Parent post (public).
  const parentApId = `${APP_URL}/ap/objects/parent`;
  await db.insert(objects).values({
    apId: parentApId,
    type: "Note",
    attributedTo: author,
    content: "parent",
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: "[]",
    audienceJson: "[]",
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  const publicReply = await insertReply(db, {
    id: "rpublic",
    author,
    parentApId,
    visibility: "public",
    published: "2026-01-01T00:00:01.000Z",
  });
  const followersReply = await insertReply(db, {
    id: "rfollowers",
    author,
    parentApId,
    visibility: "followers",
    published: "2026-01-01T00:00:02.000Z",
  });
  const directReply = await insertReply(db, {
    id: "rdirect",
    author,
    parentApId,
    visibility: "direct",
    to: [dmTarget],
    published: "2026-01-01T00:00:03.000Z",
  });

  // (a) Anonymous viewer: only the public reply.
  const anon = await fetchReplyIds(db, null, parentApId);
  expect(anon).toContain(publicReply);
  expect(anon).not.toContain(followersReply);
  expect(anon).not.toContain(directReply);

  // (b) Stranger (no follow, not addressed): only the public reply.
  const strangerView = await fetchReplyIds(
    db,
    fakeActor(stranger, "stranger"),
    parentApId,
  );
  expect(strangerView).toContain(publicReply);
  expect(strangerView).not.toContain(followersReply);
  expect(strangerView).not.toContain(directReply);

  // (c) Author of the replies: sees all of their own replies.
  const authorView = await fetchReplyIds(
    db,
    fakeActor(author, "author"),
    parentApId,
  );
  expect(authorView).toContain(publicReply);
  expect(authorView).toContain(followersReply);
  expect(authorView).toContain(directReply);

  // (d) Accepted follower: sees the followers-only reply, NOT the direct one.
  const followerView = await fetchReplyIds(
    db,
    fakeActor(follower, "follower"),
    parentApId,
  );
  expect(followerView).toContain(publicReply);
  expect(followerView).toContain(followersReply);
  expect(followerView).not.toContain(directReply);

  // (e) DM recipient: sees the direct reply (addressed), NOT the followers-only
  //     reply (no accepted follow edge).
  const dmView = await fetchReplyIds(
    db,
    fakeActor(dmTarget, "dmtarget"),
    parentApId,
  );
  expect(dmView).toContain(publicReply);
  expect(dmView).toContain(directReply);
  expect(dmView).not.toContain(followersReply);
});

async function fetchRepliesPage(
  db: Database,
  viewer: Actor | null,
  parentApId: string,
  opts: { limit?: number; before?: string } = {},
): Promise<{ ids: string[]; hasMore: boolean; nextCursor: string | null }> {
  const env = envFor(db);
  const app = appWith(db, env, viewer);
  const params = new URLSearchParams();
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.before) params.set("before", opts.before);
  const qs = params.toString() ? `?${params}` : "";
  const res = await app.fetch(
    new Request(`${APP_URL}/${encodeURIComponent(parentApId)}/replies${qs}`, {
      method: "GET",
    }),
    env,
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as {
    replies: Array<{ ap_id: string }>;
    has_more: boolean;
    next_cursor: string | null;
  };
  return {
    ids: body.replies.map((r) => r.ap_id),
    hasMore: body.has_more,
    nextCursor: body.next_cursor,
  };
}

async function insertPublicParent(db: Database, author: string) {
  const parentApId = `${APP_URL}/ap/objects/parent-page`;
  await db.insert(objects).values({
    apId: parentApId,
    type: "Note",
    attributedTo: author,
    content: "parent",
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: "[]",
    audienceJson: "[]",
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });
  return parentApId;
}

test("replies paginate: has_more + cursor reach every reply across pages", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const parentApId = await insertPublicParent(db, author);

  const total = 25;
  const all = new Set<string>();
  for (let i = 0; i < total; i++) {
    // Distinct, increasing timestamps (newest last). String-padded so the
    // lexical published order is unambiguous.
    const published = `2026-01-02T00:00:${String(i).padStart(2, "0")}.000Z`;
    all.add(
      await insertReply(db, {
        id: `rp-${String(i).padStart(2, "0")}`,
        author,
        parentApId,
        visibility: "public",
        published,
      }),
    );
  }

  const page1 = await fetchRepliesPage(db, null, parentApId, { limit: 20 });
  expect(page1.ids.length).toEqual(20);
  expect(page1.hasMore).toBe(true);
  expect(page1.nextCursor).toBeTruthy();

  const page2 = await fetchRepliesPage(db, null, parentApId, {
    limit: 20,
    before: page1.nextCursor!,
  });
  expect(page2.hasMore).toBe(false);

  // Every reply is reachable across the two pages with no overlap.
  const seen = new Set([...page1.ids, ...page2.ids]);
  expect(seen.size).toEqual(total);
  for (const id of all) expect(seen.has(id)).toBe(true);
});

test("replies composite cursor does not skip replies that share a published millisecond", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const parentApId = await insertPublicParent(db, author);

  // Two replies at the EXACT same millisecond — a published-only cursor would
  // drop the second on the load-older page. apId is the unique tiebreaker.
  const sameMs = "2026-01-03T00:00:00.000Z";
  const a = await insertReply(db, {
    id: "tie-a",
    author,
    parentApId,
    visibility: "public",
    published: sameMs,
  });
  const b = await insertReply(db, {
    id: "tie-b",
    author,
    parentApId,
    visibility: "public",
    published: sameMs,
  });

  const page1 = await fetchRepliesPage(db, null, parentApId, { limit: 1 });
  expect(page1.ids.length).toEqual(1);
  expect(page1.hasMore).toBe(true);

  const page2 = await fetchRepliesPage(db, null, parentApId, {
    limit: 1,
    before: page1.nextCursor!,
  });
  // The sibling at the same ms is returned, not skipped.
  const seen = new Set([...page1.ids, ...page2.ids]);
  expect(seen.has(a)).toBe(true);
  expect(seen.has(b)).toBe(true);
});
