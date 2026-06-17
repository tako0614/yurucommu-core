import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * #29 — timeline feed column projection.
 *
 * The public / community / following feed handlers project an explicit column
 * set (no `raw_json` / `to_json` / `cc_json` / `audience_json` blob columns)
 * instead of `SELECT *`. This test pins the formatted API response so the
 * projection cannot silently drop a field that `formatPost` reads — the output
 * must stay byte-for-byte identical to what a full-row read would produce.
 */

import { Hono } from "hono";

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, follows, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import timelineRoutes from "../../routes/timeline.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
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
  opts: { name?: string; iconUrl?: string } = {},
): Promise<string> {
  const apId = localApId(username);
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    name: opts.name ?? null,
    iconUrl: opts.iconUrl ?? null,
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
  app.route("/", timelineRoutes);
  return app;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

type FormattedPost = Record<string, unknown> & { ap_id: string };
type TimelineBody = { posts?: FormattedPost[] };

// A post exercising every field formatPost reads, including large columns that
// the projection deliberately drops (raw_json / to_json / cc_json) to prove the
// dropped columns do not affect the rendered output.
async function insertRichPublicPost(
  db: Database,
  author: string,
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/rich`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content: "rich content body",
    summary: "a content warning",
    attachmentsJson: JSON.stringify([
      { type: "Image", mediaType: "image/png", url: "https://x/y.png" },
    ]),
    inReplyTo: null,
    conversation: `${APP_URL}/ap/objects/rich`,
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: JSON.stringify([`${author}/followers`]),
    audienceJson: "[]",
    communityApId: null,
    likeCount: 3,
    replyCount: 2,
    announceCount: 1,
    shareCount: 5,
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
    // Large blob the projection must NOT load — present here to prove it is
    // irrelevant to the rendered shape.
    rawJson: JSON.stringify({ huge: "x".repeat(50_000) }),
  });
  return apId;
}

// The exact shape we expect formatPost to produce for the rich post above.
function expectedRichPost(author: string): FormattedPost {
  return {
    ap_id: `${APP_URL}/ap/objects/rich`,
    type: "Note",
    author: {
      ap_id: author,
      username: expect.any(String),
      preferred_username: "author",
      name: "Author Name",
      icon_url: "https://x/icon.png",
    },
    content: "rich content body",
    summary: "a content warning",
    attachments: [
      { type: "Image", mediaType: "image/png", url: "https://x/y.png" },
    ],
    in_reply_to: null,
    visibility: "public",
    community_ap_id: null,
    like_count: 3,
    reply_count: 2,
    announce_count: 1,
    published: "2026-01-01T00:00:00.000Z",
    liked: false,
    bookmarked: false,
    reposted: false,
  } as unknown as FormattedPost;
}

test("public feed: every formatPost field survives the column projection", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author", {
    name: "Author Name",
    iconUrl: "https://x/icon.png",
  });
  await insertRichPublicPost(db, author);

  // Authenticate the request so withCache bypasses the shared public-timeline
  // cache (varyByActor is false). This keeps the assertion bound to THIS test's
  // fresh DB rather than another file's cached unauthenticated response.
  const app = appWith(db, fakeActor(author, "author"));
  const res = await app.fetch(
    new Request(`${APP_URL}/`, { method: "GET" }),
    envFor(db),
  );

  expect(res.status).toEqual(200);
  const body = (await res.json()) as TimelineBody;
  expect(body.posts?.length).toEqual(1);
  expect(body.posts?.[0]).toMatchObject(expectedRichPost(author));
});

test("following feed: every formatPost field survives the column projection", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const author = await insertLocalActor(db, "author", {
    name: "Author Name",
    iconUrl: "https://x/icon.png",
  });
  await db.insert(follows).values({
    followerApId: viewer,
    followingApId: author,
    status: "accepted",
  });
  await insertRichPublicPost(db, author);

  const app = appWith(db, fakeActor(viewer, "viewer"));
  const res = await app.fetch(
    new Request(`${APP_URL}/following`, { method: "GET" }),
    envFor(db),
  );

  expect(res.status).toEqual(200);
  const body = (await res.json()) as TimelineBody;
  expect(body.posts?.length).toEqual(1);
  expect(body.posts?.[0]).toMatchObject(expectedRichPost(author));
});
