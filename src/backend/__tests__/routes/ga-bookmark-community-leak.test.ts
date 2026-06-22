import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #10 — community-scope leak via GET /api/posts/bookmarks.
 *
 * A bookmarked post is stored once and the bookmark row long outlives the
 * conditions under which it was created. Community-scoped Notes are persisted
 * as visibility="public" but carry a non-"[]" audienceJson + a communityApId
 * (the community read-gate). The bookmarks listing previously returned the
 * bookmarked object content with NO re-check, so a post bookmarked while its
 * community was public (or while the viewer was a member) kept leaking after
 * the community became private / membership was revoked.
 *
 * This test pins the read-time re-check: each bookmark row is gated via
 * canViewerReadObject and dropped when the viewer can no longer read it.
 *
 *  (i)   A private-community post is dropped for a non-member bookmarker.
 *  (ii)  The same private-community post is returned for a member bookmarker.
 *  (iii) An empty-audience public post is always returned (no over-blocking).
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  bookmarks,
  communities,
  communityMembers,
  follows,
  objects,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import interactionsRoutes from "../../routes/posts/interactions.ts";

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

async function insertLocalActor(
  db: Database,
  username: string,
): Promise<string> {
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

async function insertCommunity(
  db: Database,
  username: string,
  visibility: "public" | "private",
  createdBy: string,
): Promise<string> {
  const apId = `${APP_URL}/ap/groups/${username}`;
  await db.insert(communities).values({
    apId,
    type: "Group",
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy,
  });
  return apId;
}

async function insertPost(
  db: Database,
  author: string,
  id: string,
  content: string,
  opts: {
    audienceJson?: string;
    communityApId?: string | null;
    visibility?: string;
    toJson?: string;
  } = {},
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content,
    // Community posts are stored visibility="public" but with a non-empty
    // audience — exactly the shape that the leak depended on.
    visibility: opts.visibility ?? "public",
    audienceJson: opts.audienceJson ?? "[]",
    communityApId: opts.communityApId ?? null,
    toJson: opts.toJson ?? "[]",
    published: new Date().toISOString(),
  });
  return apId;
}

async function insertAcceptedFollow(
  db: Database,
  follower: string,
  following: string,
): Promise<void> {
  await db.insert(follows).values({
    followerApId: follower,
    followingApId: following,
    status: "accepted",
  });
}

async function bookmark(
  db: Database,
  viewer: string,
  objectApId: string,
  createdAt?: string,
): Promise<void> {
  await db.insert(bookmarks).values({
    actorApId: viewer,
    objectApId,
    createdAt: createdAt ?? new Date().toISOString(),
  });
}

function appFor(
  db: Database,
  viewerApId: string,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", { ap_id: viewerApId } as never);
    await next();
  });
  app.route("/posts", interactionsRoutes);
  return app;
}

test("bookmarks listing drops a private-community post for a non-member viewer", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const viewer = await insertLocalActor(db, "viewer");
  const community = await insertCommunity(db, "secretclub", "private", author);

  const publicPostId = await insertPost(db, author, "pub", "open thoughts");
  const commPostId = await insertPost(
    db,
    author,
    "comm",
    "members only secret",
    {
      audienceJson: JSON.stringify([community]),
      communityApId: community,
    },
  );

  // viewer bookmarked both (e.g. while a member or while the community was public)
  await bookmark(db, viewer, publicPostId);
  await bookmark(db, viewer, commPostId);

  // viewer is NOT a member of the now-private community.
  const app = appFor(db, viewer);
  const res = await app.request(`${APP_URL}/posts/bookmarks`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    posts: { ap_id: string; content: string }[];
  };

  const ids = body.posts.map((p) => p.ap_id);
  expect(ids).toContain(publicPostId);
  // The private-community post must be dropped — neither id nor content leaks.
  expect(ids).not.toContain(commPostId);
  expect(body.posts.some((p) => p.content.includes("members only"))).toBe(
    false,
  );
});

test("bookmarks listing keeps a private-community post for a member viewer", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const viewer = await insertLocalActor(db, "viewer");
  const community = await insertCommunity(db, "secretclub", "private", author);

  const commPostId = await insertPost(
    db,
    author,
    "comm",
    "members only secret",
    {
      audienceJson: JSON.stringify([community]),
      communityApId: community,
    },
  );
  await bookmark(db, viewer, commPostId);

  // viewer IS an accepted member (presence of the row is acceptance).
  await db
    .insert(communityMembers)
    .values({ communityApId: community, actorApId: viewer });

  const app = appFor(db, viewer);
  const res = await app.request(`${APP_URL}/posts/bookmarks`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    posts: { ap_id: string }[];
  };
  const ids = body.posts.map((p) => p.ap_id);
  expect(ids).toContain(commPostId);
});

test("bookmarks listing drops a followers-only post once the viewer no longer follows the author", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const viewer = await insertLocalActor(db, "viewer");

  const publicPostId = await insertPost(db, author, "pub", "open thoughts");
  const followersPostId = await insertPost(
    db,
    author,
    "foll",
    "followers only secret",
    { visibility: "followers" },
  );

  // Bookmarked while a follower (or by apId without access); the follow no
  // longer exists at read time.
  await bookmark(db, viewer, publicPostId);
  await bookmark(db, viewer, followersPostId);

  const app = appFor(db, viewer);
  const res = await app.request(`${APP_URL}/posts/bookmarks`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    posts: { ap_id: string; content: string }[];
  };
  const ids = body.posts.map((p) => p.ap_id);
  expect(ids).toContain(publicPostId);
  expect(ids).not.toContain(followersPostId);
  expect(body.posts.some((p) => p.content.includes("followers only"))).toBe(
    false,
  );
});

test("bookmarks listing keeps a followers-only post for a current accepted follower (and the author)", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const viewer = await insertLocalActor(db, "viewer");

  const followersPostId = await insertPost(
    db,
    author,
    "foll",
    "followers only secret",
    { visibility: "followers" },
  );
  await bookmark(db, viewer, followersPostId);
  await insertAcceptedFollow(db, viewer, author);

  const app = appFor(db, viewer);
  const res = await app.request(`${APP_URL}/posts/bookmarks`);
  const body = (await res.json()) as { posts: { ap_id: string }[] };
  expect(body.posts.map((p) => p.ap_id)).toContain(followersPostId);

  // The author bookmarking their OWN followers-only post always sees it.
  await bookmark(db, author, followersPostId);
  const authorApp = appFor(db, author);
  const authorBody = (await (
    await authorApp.request(`${APP_URL}/posts/bookmarks`)
  ).json()) as { posts: { ap_id: string }[] };
  expect(authorBody.posts.map((p) => p.ap_id)).toContain(followersPostId);
});

test("bookmarks listing drops a direct post for a non-recipient viewer", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const viewer = await insertLocalActor(db, "viewer");
  const other = await insertLocalActor(db, "other");

  // A DM addressed to `other`, bookmarked by `viewer` via apId (viewer is not
  // a recipient and must never see the content).
  const dmPostId = await insertPost(db, author, "dm", "secret whisper", {
    visibility: "direct",
    toJson: JSON.stringify([other]),
  });
  await bookmark(db, viewer, dmPostId);

  const app = appFor(db, viewer);
  const res = await app.request(`${APP_URL}/posts/bookmarks`);
  const body = (await res.json()) as {
    posts: { ap_id: string; content: string }[];
  };
  expect(body.posts.map((p) => p.ap_id)).not.toContain(dmPostId);
  expect(body.posts.some((p) => p.content.includes("secret whisper"))).toBe(
    false,
  );

  // The actual recipient keeps it.
  await bookmark(db, other, dmPostId);
  const recipientApp = appFor(db, other);
  const recipientBody = (await (
    await recipientApp.request(`${APP_URL}/posts/bookmarks`)
  ).json()) as { posts: { ap_id: string }[] };
  expect(recipientBody.posts.map((p) => p.ap_id)).toContain(dmPostId);
});

test("bookmarks listing returns public-community posts (no over-blocking)", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const viewer = await insertLocalActor(db, "viewer");
  // Public community: single-object read-gate must short-circuit to readable
  // even for a non-member.
  const community = await insertCommunity(db, "plaza", "public", author);

  const commPostId = await insertPost(
    db,
    author,
    "comm",
    "town square chatter",
    {
      audienceJson: JSON.stringify([community]),
      communityApId: community,
    },
  );
  await bookmark(db, viewer, commPostId);

  const app = appFor(db, viewer);
  const res = await app.request(`${APP_URL}/posts/bookmarks`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    posts: { ap_id: string }[];
  };
  const ids = body.posts.map((p) => p.ap_id);
  expect(ids).toContain(commPostId);
});

type BookmarksBody = {
  posts: { ap_id: string }[];
  has_more: boolean;
  next_cursor: string | null;
};

test("bookmarks paginate: has_more + composite cursor reach every bookmark (no same-ms skip)", async () => {
  const db = await freshDb();
  const viewer = await insertLocalActor(db, "viewer");
  const author = await insertLocalActor(db, "author");

  const all = new Set<string>();
  // 5 public posts bookmarked. Bookmarks 2 & 3 share an EXACT createdAt ms — a
  // bare createdAt cursor would skip one at the page boundary.
  const times = [
    "2026-01-01T00:00:05.000Z",
    "2026-01-01T00:00:04.000Z",
    "2026-01-01T00:00:03.000Z", // tie
    "2026-01-01T00:00:03.000Z", // tie
    "2026-01-01T00:00:01.000Z",
  ];
  for (let i = 0; i < times.length; i++) {
    const apId = await insertPost(db, author, `bm-${i}`, `post ${i}`, {
      visibility: "public",
    });
    all.add(apId);
    await bookmark(db, viewer, apId, times[i]);
  }

  const app = appFor(db, viewer);
  const seen = new Set<string>();
  let before: string | null = null;
  // Page through 2 at a time; every readable bookmark must be reached once.
  for (let guard = 0; guard < 10; guard++) {
    const qs = before
      ? `?limit=2&before=${encodeURIComponent(before)}`
      : "?limit=2";
    const res = await app.request(`${APP_URL}/posts/bookmarks${qs}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BookmarksBody;
    for (const p of body.posts) {
      expect(seen.has(p.ap_id)).toBe(false); // no overlap across pages
      seen.add(p.ap_id);
    }
    if (!body.has_more) break;
    expect(body.next_cursor).toBeTruthy();
    before = body.next_cursor;
  }

  expect(seen.size).toEqual(all.size);
  for (const id of all) expect(seen.has(id)).toBe(true);
});
