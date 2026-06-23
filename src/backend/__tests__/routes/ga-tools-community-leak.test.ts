import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #4 + #5 — community-scope leak via the AI-agent (takos-tools) surface.
 *
 * Community-scoped Notes are persisted as visibility="public" but carry a
 * non-"[]" audienceJson (the community read-gate). The agent tools
 * (yurucommu_get_timeline / yurucommu_search_posts / yurucommu_get_trending)
 * previously filtered on visibility="public" ALONE, so they surfaced
 * private-community posts and their hashtags to the agent.
 *
 * This test pins the same NO_AUDIENCE_PREDICATE (audienceJson="[]") guard that
 * the human-facing search/timeline routes already enforce, plus the
 * deletedAt-tombstone exclusion:
 *
 *  (i)   handleGetTimeline must NOT return a community post.
 *  (ii)  searchPosts must NOT return a community post (id or content).
 *  (iii) getTrending must NOT surface a community post's hashtag.
 *
 * A regular (empty-audience) public post IS returned in each case, proving the
 * guard scopes out only the community-gated content. A soft-deleted public
 * post is also excluded.
 */

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, blocks, follows, likes, objects } from "../../../db/index.ts";
import {
  handleSearchPosts,
  handleGetTrending,
} from "../../routes/takos-tools/search.ts";
import { handleGetTimeline as getTimeline } from "../../routes/takos-tools/timeline.ts";
import {
  handleCreatePost,
  handleLikePost,
} from "../../routes/takos-tools/posts.ts";
import { handleFollowUser } from "../../routes/takos-tools/follows.ts";

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

async function insertPost(
  db: Database,
  author: string,
  id: string,
  content: string,
  published: string,
  audienceJson: string,
  deletedAt: string | null = null,
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content,
    visibility: "public",
    audienceJson,
    published,
    deletedAt,
  });
  return apId;
}

/** Minimal ToolContext stub: handlers only use c.get("db") and c.json(). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ctxFor(db: Database): any {
  return {
    get(key: string) {
      if (key === "db") return db;
      return null;
    },
    env: { APP_URL },
    json(value: unknown) {
      return { __body: value };
    },
  };
}

function isoMinutesAgo(min: number): string {
  return new Date(Date.now() - min * 60 * 1000).toISOString();
}

const COMMUNITY_AUDIENCE = JSON.stringify([`${APP_URL}/ap/groups/secretclub`]);

test("agent get_timeline excludes community-scoped and deleted posts", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "alice");

  const publicId = await insertPost(
    db,
    author,
    "pub",
    "open thoughts",
    isoMinutesAgo(5),
    "[]",
  );
  await insertPost(
    db,
    author,
    "comm",
    "members only secret",
    isoMinutesAgo(4),
    COMMUNITY_AUDIENCE,
  );
  await insertPost(
    db,
    author,
    "del",
    "tombstoned public",
    isoMinutesAgo(3),
    "[]",
    isoMinutesAgo(1),
  );

  const res = (await getTimeline(ctxFor(db), {}, null)) as unknown as {
    __body: { data: { posts: { ap_id: string; content: string }[] } };
  };
  const posts = res.__body.data.posts;
  const ids = posts.map((p) => p.ap_id);

  expect(ids).toContain(publicId);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/comm`);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/del`);
  expect(posts.some((p) => p.content.includes("members only"))).toBe(false);
});

test("agent search_posts excludes community-scoped and deleted posts", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "bob");

  const publicId = await insertPost(
    db,
    author,
    "pub",
    "open secretword thoughts",
    isoMinutesAgo(5),
    "[]",
  );
  await insertPost(
    db,
    author,
    "comm",
    "members only secretword",
    isoMinutesAgo(4),
    COMMUNITY_AUDIENCE,
  );
  await insertPost(
    db,
    author,
    "del",
    "deleted secretword",
    isoMinutesAgo(3),
    "[]",
    isoMinutesAgo(1),
  );

  const res = (await handleSearchPosts(
    ctxFor(db),
    { query: "secretword" },
    null,
  )) as unknown as {
    __body: { data: { posts: { ap_id: string; content: string }[] } };
  };
  const posts = res.__body.data.posts;
  const ids = posts.map((p) => p.ap_id);

  expect(ids).toContain(publicId);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/comm`);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/del`);
  expect(posts.some((p) => p.content.includes("members only"))).toBe(false);
});

test("agent get_trending omits community-scoped post hashtags", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "carol");

  await insertPost(
    db,
    author,
    "t1",
    "town square #plaza",
    isoMinutesAgo(3),
    "[]",
  );
  await insertPost(
    db,
    author,
    "t2",
    "hush #backroom #backroom",
    isoMinutesAgo(2),
    COMMUNITY_AUDIENCE,
  );
  await insertPost(
    db,
    author,
    "t3",
    "deleted #ghosttag",
    isoMinutesAgo(1),
    "[]",
    isoMinutesAgo(1),
  );

  const res = (await handleGetTrending(ctxFor(db), {}, null)) as unknown as {
    __body: { data: { trending: { tag: string; count: number }[] } };
  };
  const tags = res.__body.data.trending.map((t) => t.tag);

  expect(tags).toContain("plaza");
  expect(tags).not.toContain("backroom");
  expect(tags).not.toContain("ghosttag");
});

test("agent like_post is read-gated like the web route (cannot like an unreadable post)", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  // alice's followers-only post; bob does NOT follow alice → cannot read it.
  const hidden = `${APP_URL}/ap/objects/foll-1`;
  await db.insert(objects).values({
    apId: hidden,
    type: "Note",
    attributedTo: alice,
    content: "secret",
    visibility: "followers",
    audienceJson: "[]",
    published: isoMinutesAgo(1),
  });

  await handleLikePost(
    ctxFor(db),
    { post_id: hidden, like: true },
    { ap_id: bob },
  );

  // The gate must have refused: no like edge, no like_count bump.
  expect(
    (await db.select().from(likes).where(eq(likes.objectApId, hidden)).all())
      .length,
  ).toBe(0);
  expect(
    (
      await db
        .select({ likeCount: objects.likeCount })
        .from(objects)
        .where(eq(objects.apId, hidden))
        .get()
    )?.likeCount,
  ).toBe(0);

  // Positive control: bob CAN like a public post (gate allows, edge + count).
  const open = `${APP_URL}/ap/objects/pub-1`;
  await db.insert(objects).values({
    apId: open,
    type: "Note",
    attributedTo: alice,
    content: "hello",
    visibility: "public",
    audienceJson: "[]",
    published: isoMinutesAgo(1),
  });
  // bob now follows alice too (irrelevant to a public post, but realistic).
  await db.insert(follows).values({
    followerApId: bob,
    followingApId: alice,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });

  await handleLikePost(
    ctxFor(db),
    { post_id: open, like: true },
    { ap_id: bob },
  );
  expect(
    (await db.select().from(likes).where(eq(likes.objectApId, open)).all())
      .length,
  ).toBe(1);
  expect(
    (
      await db
        .select({ likeCount: objects.likeCount })
        .from(objects)
        .where(eq(objects.apId, open))
        .get()
    )?.likeCount,
  ).toBe(1);
});

// Audit #18: the agent tool paths must enforce the same per-user block + reply
// read-gate the canonical routes do.
test("agent like_post is BLOCK-gated (a blocked actor cannot like the blocker's public post)", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  const open = `${APP_URL}/ap/objects/pub-block`;
  await db.insert(objects).values({
    apId: open,
    type: "Note",
    attributedTo: alice,
    content: "public",
    visibility: "public",
    audienceJson: "[]",
    published: isoMinutesAgo(1),
  });
  // alice blocks bob.
  await db.insert(blocks).values({ blockerApId: alice, blockedApId: bob });

  await handleLikePost(
    ctxFor(db),
    { post_id: open, like: true },
    { ap_id: bob },
  );

  expect(
    (await db.select().from(likes).where(eq(likes.objectApId, open)).all())
      .length,
  ).toBe(0);
});

test("agent follow_user is BLOCK-gated (a blocked actor cannot re-follow the blocker)", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  // alice blocks bob; bob's agent tries to follow alice.
  await db.insert(blocks).values({ blockerApId: alice, blockedApId: bob });

  await handleFollowUser(ctxFor(db), { username: "alice" }, { ap_id: bob });

  expect(
    (
      await db
        .select()
        .from(follows)
        .where(
          eq(follows.followerApId, bob) && eq(follows.followingApId, alice),
        )
        .all()
    ).length,
  ).toBe(0);
});

test("agent create_post reply is read-gated (cannot reply to an unreadable parent)", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");
  // alice's followers-only parent; bob does NOT follow alice.
  const parent = `${APP_URL}/ap/objects/foll-parent`;
  await db.insert(objects).values({
    apId: parent,
    type: "Note",
    attributedTo: alice,
    content: "secret parent",
    visibility: "followers",
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    replyCount: 0,
    published: isoMinutesAgo(1),
  });

  const res = (await handleCreatePost(
    ctxFor(db),
    { content: "sneaky reply", in_reply_to: parent },
    { ap_id: bob },
  )) as unknown as { __body: { success: boolean } };
  expect(res.__body.success).toBe(false);

  // No reply object stored, parent replyCount untouched.
  expect(
    (await db.select().from(objects).where(eq(objects.inReplyTo, parent)).all())
      .length,
  ).toBe(0);
  expect(
    (
      await db
        .select({ replyCount: objects.replyCount })
        .from(objects)
        .where(eq(objects.apId, parent))
        .get()
    )?.replyCount,
  ).toBe(0);

  // Positive control: an accepted follower CAN reply.
  await db.insert(follows).values({
    followerApId: bob,
    followingApId: alice,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  const ok2 = (await handleCreatePost(
    ctxFor(db),
    { content: "allowed reply", in_reply_to: parent },
    { ap_id: bob },
  )) as unknown as { __body: { success: boolean } };
  expect(ok2.__body.success).toBe(true);
  expect(
    (await db.select().from(objects).where(eq(objects.inReplyTo, parent)).all())
      .length,
  ).toBe(1);
});
