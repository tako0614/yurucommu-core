/**
 * Regression: community GROUP-CHAT messages must not appear in the author's own
 * profile post feed (`GET /api/actors/:id/posts`).
 *
 * A chat message is a Note addressed to a community audience
 * (audienceJson = ["<community>"]) with NO communityApId; a personal post has an
 * empty audience ("[]"); a community FEED post has communityApId set. The
 * own-profile branch previously excluded only `visibility = "direct"`, so a
 * viewer looking at their OWN profile saw their group-chat messages mixed into
 * their posts. (Other viewers were already protected by the public/empty-
 * audience guard.) The feed must keep personal + community-feed posts and drop
 * chat messages.
 */

import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import actorsRoute from "../../routes/actors.ts";

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
  "0010_object_recipients_drop_actor_fk.sql",
  "0011_drop_remote_actor_fks.sql",
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  // Query-logic test: avoid needing a real communities row for the feed post.
  await client.execute("PRAGMA foreign_keys = OFF");
  return drizzle(client, { schema }) as unknown as Database;
}

const ALICE = `${APP_URL}/ap/users/alice`;
const COMMUNITY = `${APP_URL}/ap/groups/g`;

async function insertActor(db: Database): Promise<Actor> {
  await db.insert(actors).values({
    apId: ALICE,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${ALICE}/inbox`,
    outbox: `${ALICE}/outbox`,
    followersUrl: `${ALICE}/followers`,
    followingUrl: `${ALICE}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return { ap_id: ALICE } as Actor;
}

async function insertNote(
  db: Database,
  opts: {
    id: string;
    audience: string[];
    communityApId: string | null;
    visibility: string;
    content: string;
    published?: string;
  },
): Promise<void> {
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/${opts.id}`,
    type: "Note",
    attributedTo: ALICE,
    content: opts.content,
    visibility: opts.visibility,
    audienceJson: JSON.stringify(opts.audience),
    toJson: JSON.stringify(opts.audience),
    communityApId: opts.communityApId,
    published: opts.published ?? new Date().toISOString(),
    isLocal: 1,
  });
}

function app(db: Database, actor: Actor) {
  const a = new Hono<{ Bindings: Env; Variables: Variables }>();
  a.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  a.route("/", actorsRoute);
  return a;
}

test("own profile feed excludes group-chat messages, keeps personal + community-feed posts", async () => {
  const db = await freshDb();
  const alice = await insertActor(db);

  await insertNote(db, {
    id: "personal",
    audience: [],
    communityApId: null,
    visibility: "public",
    content: "personal post",
  });
  // Community group-chat message: audience = community, NO communityApId.
  await insertNote(db, {
    id: "chat",
    audience: [COMMUNITY],
    communityApId: null,
    visibility: "unlisted",
    content: "group chat message",
  });
  // Community FEED post: audience = community AND communityApId set.
  await insertNote(db, {
    id: "feed",
    audience: [COMMUNITY],
    communityApId: COMMUNITY,
    visibility: "public",
    content: "community feed post",
  });

  const res = await app(db, alice).fetch(
    new Request(`${APP_URL}/${encodeURIComponent(ALICE)}/posts`, {
      method: "GET",
    }),
    { APP_URL, DB_INSTANCE: db } as unknown as Env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { posts: Array<{ content: string }> };
  const contents = body.posts.map((p) => p.content);

  expect(contents).toContain("personal post");
  expect(contents).toContain("community feed post");
  expect(contents).not.toContain("group chat message");
});

test("profile posts paginate: has_more + composite cursor reach every post (no same-ms skip)", async () => {
  const db = await freshDb();
  const alice = await insertActor(db);

  const all = new Set<string>();
  // 5 personal public posts. Posts 2 & 3 share an EXACT published ms — a bare
  // published cursor would skip one at the page boundary; apId tiebreaks.
  const times = [
    "2026-02-01T00:00:05.000Z",
    "2026-02-01T00:00:04.000Z",
    "2026-02-01T00:00:03.000Z", // tie
    "2026-02-01T00:00:03.000Z", // tie
    "2026-02-01T00:00:01.000Z",
  ];
  for (let i = 0; i < times.length; i++) {
    const id = `pp-${i}`;
    await insertNote(db, {
      id,
      audience: [],
      communityApId: null,
      visibility: "public",
      content: `post ${i}`,
      published: times[i],
    });
    all.add(`${APP_URL}/ap/objects/${id}`);
  }

  const a = app(db, alice);
  const seen = new Set<string>();
  let before: string | null = null;
  for (let guard = 0; guard < 10; guard++) {
    const qs = before
      ? `?limit=2&before=${encodeURIComponent(before)}`
      : "?limit=2";
    const res = await a.fetch(
      new Request(`${APP_URL}/${encodeURIComponent(ALICE)}/posts${qs}`, {
        method: "GET",
      }),
      { APP_URL, DB_INSTANCE: db } as unknown as Env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      posts: Array<{ ap_id: string }>;
      has_more: boolean;
      next_cursor: string | null;
    };
    for (const p of body.posts) {
      expect(seen.has(p.ap_id)).toBe(false);
      seen.add(p.ap_id);
    }
    if (!body.has_more) break;
    expect(body.next_cursor).toBeTruthy();
    before = body.next_cursor;
  }

  expect(seen.size).toEqual(all.size);
  for (const id of all) expect(seen.has(id)).toBe(true);
});
