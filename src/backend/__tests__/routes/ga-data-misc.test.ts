import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA Wave-9 DATA-MISC regressions.
 *
 * #11 — Feed pagination used an exclusive cursor on the non-unique `published`
 *   column with no tiebreak, so two posts sharing the same published millisecond
 *   straddling a page boundary could be skipped. The cursor is now composite
 *   (published, apId) with a tuple predicate and a (published desc, apId desc)
 *   total order. This test pins that two same-ms posts are BOTH returned across
 *   pages (none skipped, none duplicated).
 *
 * #15 — Story vote used check-then-insert, which raced the (storyApId, actorApId)
 *   unique index and 500'd on a concurrent double-vote. It is now an
 *   onConflictDoUpdate upsert. This test pins that re-voting is idempotent (no
 *   500, single row, updated option).
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects, storyVotes } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import timelineRoutes from "../../routes/timeline.ts";
import storyInteractionRoutes from "../../routes/stories/interactions.ts";

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
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

// Insert a public top-level Note with an explicit apId and published value so we
// can force two posts to share the same published millisecond.
async function insertPublicPost(
  db: Database,
  author: string,
  apId: string,
  published: string,
): Promise<void> {
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content: apId,
    visibility: "public",
    audienceJson: "[]",
    inReplyTo: null,
    communityApId: null,
    published,
    isLocal: 1,
  });
}

// ---------------------------------------------------------------------------
// #11 — composite cursor: two posts with the SAME published ms must both be
// returned across paginated reads, with no skip and no duplicate.
// ---------------------------------------------------------------------------
test("public feed: composite cursor returns both same-ms posts across pages", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");

  // Same published millisecond; apId is the only tiebreak. "...aaa" < "...bbb"
  // lexically, so under (published desc, apId desc) the "bbb" post comes first.
  const sameMs = "2026-01-01T00:00:00.000Z";
  const apA = `${APP_URL}/ap/objects/aaa`;
  const apB = `${APP_URL}/ap/objects/bbb`;
  await insertPublicPost(db, author, apA, sameMs);
  await insertPublicPost(db, author, apB, sameMs);

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", fakeActor(author, "author"));
    await next();
  });
  app.route("/", timelineRoutes);

  type Body = {
    posts: { ap_id: string }[];
    has_more: boolean;
    next_cursor: string | null;
  };

  // Page 1: limit 1 -> the higher-sorting post, has_more true, cursor present.
  const res1 = await app.fetch(
    new Request(`${APP_URL}/?limit=1`, { method: "GET" }),
    envFor(db),
  );
  expect(res1.status).toBe(200);
  const page1 = (await res1.json()) as Body;
  expect(page1.posts.length).toBe(1);
  expect(page1.has_more).toBe(true);
  expect(page1.next_cursor).toBeTruthy();
  // The cursor must be composite (carry the apId), not bare published.
  expect(page1.next_cursor).toContain(page1.posts[0].ap_id);

  // Page 2: resume from the composite cursor. The OTHER same-ms post must come
  // back — a published-only exclusive cursor would have skipped it.
  const res2 = await app.fetch(
    new Request(
      `${APP_URL}/?limit=1&before=${encodeURIComponent(page1.next_cursor!)}`,
      { method: "GET" },
    ),
    envFor(db),
  );
  expect(res2.status).toBe(200);
  const page2 = (await res2.json()) as Body;
  expect(page2.posts.length).toBe(1);

  const seen = [page1.posts[0].ap_id, page2.posts[0].ap_id].sort();
  expect(seen).toEqual([apA, apB].sort());
  // No duplicate across pages.
  expect(page1.posts[0].ap_id).not.toBe(page2.posts[0].ap_id);
});

// ---------------------------------------------------------------------------
// #15 — story vote upsert: re-voting is idempotent (no 500 on the unique index)
// and updates the chosen option in place (single row).
// ---------------------------------------------------------------------------
test("story vote: re-vote upserts in place without a unique-index 500", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const voter = await insertLocalActor(db, "voter");

  const storyApId = `${APP_URL}/ap/objects/poll`;
  await db.insert(objects).values({
    apId: storyApId,
    type: "Story",
    attributedTo: author,
    content: "",
    attachmentsJson: JSON.stringify({
      overlays: [{ type: "Question", oneOf: [{}, {}, {}] }],
    }),
    endTime: "2999-01-01T00:00:00.000Z",
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", fakeActor(voter, "voter"));
    await next();
  });
  app.route("/", storyInteractionRoutes);

  function voteReq(optionIndex: number): Request {
    return new Request(`${APP_URL}/vote`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ap_id: storyApId, option_index: optionIndex }),
    });
  }

  const first = await app.fetch(voteReq(0), envFor(db));
  expect(first.status).toBe(200);
  expect(((await first.json()) as { user_vote: number }).user_vote).toBe(0);

  // Re-vote for a different option: must NOT 500 on the unique index, and must
  // update the existing row rather than insert a second one.
  const second = await app.fetch(voteReq(2), envFor(db));
  expect(second.status).toBe(200);
  expect(((await second.json()) as { user_vote: number }).user_vote).toBe(2);

  const rows = await db
    .select()
    .from(storyVotes)
    .where(
      and(eq(storyVotes.storyApId, storyApId), eq(storyVotes.actorApId, voter)),
    );
  expect(rows.length).toBe(1);
  expect(rows[0].optionIndex).toBe(2);
});
