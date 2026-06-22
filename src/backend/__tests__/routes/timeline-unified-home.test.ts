import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * Unified home feed — the individual is the base, home is "everything I can see".
 *
 * GET /api/timeline (no `community`) for an authenticated viewer returns a single
 * time-ordered union of:
 *   - the viewer's own posts (any non-direct),
 *   - accepted follows' public / unlisted / followers posts,
 *   - co-members' (people who share a community with the viewer) public / unlisted
 *     posts — surfacing already-visible posts, NOT granting new visibility, and
 *   - posts deliberately narrowed to a community the viewer belongs to.
 *
 * It must NOT surface a stranger's posts (no follow, no shared community), and it
 * must NOT leak a co-member's followers-only post to a non-follower (co-member
 * surfacing is reach composition, not a visibility grant).
 *
 * GET /api/timeline?community=X narrows that SAME reach to community X's members
 * (+ posts narrowed to X), gated by membership.
 */

import { Hono } from "hono";

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  blocks,
  communities,
  communityMembers,
  follows,
  mutes,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import timelineRoutes from "../../routes/timeline.ts";

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

function appWith(
  db: Database,
  actor: Actor | null,
  router: Hono<{ Bindings: Env; Variables: Variables }>,
): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", router);
  return app;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

async function insertCommunity(
  db: Database,
  username: string,
  opts: { visibility?: string } = {},
): Promise<string> {
  const apId = `${APP_URL}/ap/groups/${username}`;
  await db.insert(communities).values({
    apId,
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility: opts.visibility ?? "public",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: localApId("owner"),
  });
  return apId;
}

async function joinCommunity(
  db: Database,
  communityApId: string,
  actorApId: string,
): Promise<void> {
  await db.insert(communityMembers).values({
    communityApId,
    actorApId,
    role: "member",
  });
}

async function acceptFollow(
  db: Database,
  followerApId: string,
  followingApId: string,
): Promise<void> {
  await db.insert(follows).values({
    followerApId,
    followingApId,
    status: "accepted",
  });
}

// A personal (default) post: addressed to the author's reach, NOT filed into a
// community (audienceJson "[]").
async function insertPersonalPost(
  db: Database,
  opts: {
    apId: string;
    author: string;
    content: string;
    published: string;
    visibility?: string;
  },
): Promise<void> {
  await db.insert(objects).values({
    apId: opts.apId,
    type: "Note",
    attributedTo: opts.author,
    content: opts.content,
    visibility: opts.visibility ?? "public",
    audienceJson: "[]",
    published: opts.published,
    isLocal: 1,
  });
}

// A post deliberately narrowed to a community (audienceJson [communityApId]).
async function insertCommunityPost(
  db: Database,
  opts: {
    apId: string;
    author: string;
    communityApId: string;
    content: string;
    published: string;
  },
): Promise<void> {
  await db.insert(objects).values({
    apId: opts.apId,
    type: "Note",
    attributedTo: opts.author,
    content: opts.content,
    visibility: "public",
    communityApId: opts.communityApId,
    audienceJson: JSON.stringify([opts.communityApId]),
    published: opts.published,
    isLocal: 1,
  });
}

// A direct post (DM-style). A plain DM is stored visibility="direct" with the
// default audienceJson="[]" (like createDmNote); a direct post deliberately
// narrowed to a community carries that community in communityApId. Neither must
// ever surface in a timeline feed — directs belong only in /dm.
async function insertDirectPost(
  db: Database,
  opts: {
    apId: string;
    author: string;
    content: string;
    published: string;
    communityApId?: string;
  },
): Promise<void> {
  await db.insert(objects).values({
    apId: opts.apId,
    type: "Note",
    attributedTo: opts.author,
    content: opts.content,
    visibility: "direct",
    communityApId: opts.communityApId ?? null,
    audienceJson: opts.communityApId
      ? JSON.stringify([opts.communityApId])
      : "[]",
    published: opts.published,
    isLocal: 1,
  });
}

type TimelineBody = { posts?: Array<{ ap_id: string }>; error?: string };

async function getHome(
  db: Database,
  actor: Actor | null,
  query = "",
): Promise<string[]> {
  const app = appWith(db, actor, timelineRoutes);
  const res = await app.fetch(
    new Request(`${APP_URL}/${query}`, { method: "GET" }),
    envFor(db),
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as TimelineBody;
  return body.posts?.map((p) => p.ap_id) ?? [];
}

// ---------------------------------------------------------------------------
// Home merges own + follows + co-members; excludes strangers.
// ---------------------------------------------------------------------------

test("unified home: merges own + accepted follows + co-members, excludes strangers", async () => {
  const db = await freshDb();
  const me = await insertLocalActor(db, "me");
  const followed = await insertLocalActor(db, "followed");
  const coMember = await insertLocalActor(db, "comember");
  const stranger = await insertLocalActor(db, "stranger");

  await acceptFollow(db, me, followed);

  const town = await insertCommunity(db, "town", { visibility: "public" });
  await joinCommunity(db, town, me);
  await joinCommunity(db, town, coMember);

  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/mine`,
    author: me,
    content: "my own post",
    published: "2026-01-04T00:00:00.000Z",
  });
  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/followed`,
    author: followed,
    content: "a follow's post",
    published: "2026-01-03T00:00:00.000Z",
  });
  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/comember`,
    author: coMember,
    content: "a co-member's public post",
    published: "2026-01-02T00:00:00.000Z",
  });
  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/stranger`,
    author: stranger,
    content: "a stranger's post",
    published: "2026-01-01T00:00:00.000Z",
  });

  const ids = await getHome(db, fakeActor(me, "me"));

  // Time-ordered union of my reach; the stranger is not in it.
  expect(ids).toEqual([
    `${APP_URL}/ap/objects/mine`,
    `${APP_URL}/ap/objects/followed`,
    `${APP_URL}/ap/objects/comember`,
  ]);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/stranger`);
});

// ---------------------------------------------------------------------------
// Co-member surfacing grants NO new visibility.
// ---------------------------------------------------------------------------

test("unified home: a co-member's followers-only post does not leak to a non-follower", async () => {
  const db = await freshDb();
  const me = await insertLocalActor(db, "me");
  const coMember = await insertLocalActor(db, "comember");

  const town = await insertCommunity(db, "town", { visibility: "public" });
  await joinCommunity(db, town, me);
  await joinCommunity(db, town, coMember);
  // I do NOT follow the co-member.

  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/co-public`,
    author: coMember,
    content: "co-member public",
    published: "2026-01-02T00:00:00.000Z",
    visibility: "public",
  });
  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/co-followers`,
    author: coMember,
    content: "co-member followers-only",
    published: "2026-01-01T00:00:00.000Z",
    visibility: "followers",
  });

  const ids = await getHome(db, fakeActor(me, "me"));

  // The public post surfaces (shared community = reach); the followers-only post
  // stays follow-gated — co-membership is not a visibility grant.
  expect(ids).toContain(`${APP_URL}/ap/objects/co-public`);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/co-followers`);
});

// ---------------------------------------------------------------------------
// A community-narrowed post the viewer can read lands in home.
// ---------------------------------------------------------------------------

test("unified home: a post narrowed to my community appears in home", async () => {
  const db = await freshDb();
  const me = await insertLocalActor(db, "me");
  const coMember = await insertLocalActor(db, "comember");

  const town = await insertCommunity(db, "town", { visibility: "public" });
  await joinCommunity(db, town, me);
  await joinCommunity(db, town, coMember);

  await insertCommunityPost(db, {
    apId: `${APP_URL}/ap/objects/narrowed`,
    author: coMember,
    communityApId: town,
    content: "narrowed to the town",
    published: "2026-01-01T00:00:00.000Z",
  });

  const ids = await getHome(db, fakeActor(me, "me"));
  expect(ids).toContain(`${APP_URL}/ap/objects/narrowed`);
});

// ---------------------------------------------------------------------------
// Default (no community) post lands in home.
// ---------------------------------------------------------------------------

test("unified home: a default personal post by the viewer lands in home", async () => {
  const db = await freshDb();
  const me = await insertLocalActor(db, "me");

  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/default`,
    author: me,
    content: "just posting to my reach",
    published: "2026-01-01T00:00:00.000Z",
  });

  const ids = await getHome(db, fakeActor(me, "me"));
  expect(ids).toEqual([`${APP_URL}/ap/objects/default`]);
});

// ---------------------------------------------------------------------------
// The community filter narrows the unified feed by membership.
// ---------------------------------------------------------------------------

test("community filter: narrows home to the community's members (+ narrowed posts)", async () => {
  const db = await freshDb();
  const me = await insertLocalActor(db, "me");
  const townMember = await insertLocalActor(db, "townie");
  const followedOutsider = await insertLocalActor(db, "outsider");

  const town = await insertCommunity(db, "town", { visibility: "public" });
  await joinCommunity(db, town, me);
  await joinCommunity(db, town, townMember);

  // A follow who is NOT a member of the town: in home, excluded from the filter.
  await acceptFollow(db, me, followedOutsider);

  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/townie-public`,
    author: townMember,
    content: "town member public post",
    published: "2026-01-03T00:00:00.000Z",
  });
  await insertCommunityPost(db, {
    apId: `${APP_URL}/ap/objects/town-narrowed`,
    author: townMember,
    communityApId: town,
    content: "narrowed to town",
    published: "2026-01-02T00:00:00.000Z",
  });
  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/outsider-public`,
    author: followedOutsider,
    content: "a follow who is not in the town",
    published: "2026-01-01T00:00:00.000Z",
  });

  // Unfiltered home includes the followed outsider...
  const home = await getHome(db, fakeActor(me, "me"));
  expect(home).toContain(`${APP_URL}/ap/objects/outsider-public`);

  // ...but the town filter narrows to the town's people + posts narrowed to it.
  const filtered = await getHome(
    db,
    fakeActor(me, "me"),
    `?community=${encodeURIComponent(town)}`,
  );
  expect(filtered).toContain(`${APP_URL}/ap/objects/townie-public`);
  expect(filtered).toContain(`${APP_URL}/ap/objects/town-narrowed`);
  expect(filtered).not.toContain(`${APP_URL}/ap/objects/outsider-public`);
});

// ---------------------------------------------------------------------------
// Direct posts (DMs) never surface in any timeline feed.
// ---------------------------------------------------------------------------

test("unified home: the viewer's own direct posts (DMs) do not appear in home", async () => {
  const db = await freshDb();
  const me = await insertLocalActor(db, "me");

  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/public`,
    author: me,
    content: "a normal public post",
    published: "2026-01-02T00:00:00.000Z",
  });
  // A DM the viewer sent: visibility="direct", audienceJson="[]" (createDmNote).
  await insertDirectPost(db, {
    apId: `${APP_URL}/ap/objects/my-dm`,
    author: me,
    content: "see you at 8",
    published: "2026-01-01T00:00:00.000Z",
  });

  const ids = await getHome(db, fakeActor(me, "me"));
  expect(ids).toContain(`${APP_URL}/ap/objects/public`);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/my-dm`);
});

test("direct + community: a direct post narrowed to a community leaks to no member feed", async () => {
  const db = await freshDb();
  const me = await insertLocalActor(db, "me");
  const coMember = await insertLocalActor(db, "comember");

  const town = await insertCommunity(db, "town", { visibility: "public" });
  await joinCommunity(db, town, me);
  await joinCommunity(db, town, coMember);

  // A co-member posts something direct-visibility but tagged to the community.
  await insertDirectPost(db, {
    apId: `${APP_URL}/ap/objects/co-direct-community`,
    author: coMember,
    communityApId: town,
    content: "direct yet community-tagged",
    published: "2026-01-01T00:00:00.000Z",
  });

  // Neither the unified home (branch 3 = my communities)...
  const home = await getHome(db, fakeActor(me, "me"));
  expect(home).not.toContain(`${APP_URL}/ap/objects/co-direct-community`);

  // ...nor the community filter (communityApId leg) surfaces it.
  const filtered = await getHome(
    db,
    fakeActor(me, "me"),
    `?community=${encodeURIComponent(town)}`,
  );
  expect(filtered).not.toContain(`${APP_URL}/ap/objects/co-direct-community`);
});

// ---------------------------------------------------------------------------
// Author fan-in is lossless for a high follow count. The membership test is a
// subquery (attributed_to IN (SELECT ...)), NOT a materialized id array, so a
// post from a follow beyond the old 1000-row cap still appears. The post is
// authored by the LAST-inserted follow (highest rowid), which an arbitrary
// `LIMIT 1000` with no ORDER BY would drop.
// ---------------------------------------------------------------------------

test("unified home + /following are lossless past 1000 follows (subquery, not capped array)", async () => {
  const db = await freshDb();
  const me = await insertLocalActor(db, "me");

  const N = 1001;
  // Bulk-insert N followed actors + N accepted follow edges via recursive CTEs
  // (fast; one statement each). follow-N is inserted last → highest rowid.
  await db.run(sql`
    INSERT INTO actors
      (ap_id, type, preferred_username, inbox, outbox, followers_url, following_url, public_key_pem, private_key_pem)
    WITH RECURSIVE seq(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${N}
    )
    SELECT
      ${APP_URL} || '/ap/users/follow-' || n, 'Person', 'follow-' || n,
      ${APP_URL} || '/ap/users/follow-' || n || '/inbox',
      ${APP_URL} || '/ap/users/follow-' || n || '/outbox',
      ${APP_URL} || '/ap/users/follow-' || n || '/followers',
      ${APP_URL} || '/ap/users/follow-' || n || '/following',
      'pub', 'priv'
    FROM seq
  `);
  await db.run(sql`
    INSERT INTO follows (follower_ap_id, following_ap_id, status, created_at)
    WITH RECURSIVE seq(n) AS (
      SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < ${N}
    )
    SELECT ${me}, ${APP_URL} || '/ap/users/follow-' || n, 'accepted', '2026-01-01T00:00:00.000Z'
    FROM seq
  `);

  const farFollow = `${APP_URL}/ap/users/follow-${N}`;
  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/far-follow`,
    author: farFollow,
    content: "post from the 1001st follow",
    published: "2026-02-01T00:00:00.000Z",
  });

  const home = await getHome(db, fakeActor(me, "me"));
  expect(home).toContain(`${APP_URL}/ap/objects/far-follow`);

  const followingApp = appWith(db, fakeActor(me, "me"), timelineRoutes);
  const res = await followingApp.fetch(
    new Request(`${APP_URL}/following`, { method: "GET" }),
    envFor(db),
  );
  expect(res.status).toEqual(200);
  const body = (await res.json()) as TimelineBody;
  const followingIds = body.posts?.map((p) => p.ap_id) ?? [];
  expect(followingIds).toContain(`${APP_URL}/ap/objects/far-follow`);
});

// ---------------------------------------------------------------------------
// Block / mute exclusion (regression for the subquery-based feed exclusion).
//
// The exclusion is expressed as `attributed_to NOT IN (SELECT blocked) AND
// NOT IN (SELECT muted)` (lib/feed-exclude.ts) — db.select subqueries, not a
// materialised `notInArray([...ids])`, so it never exceeds D1's 100-bound-
// parameter ceiling regardless of how many accounts the viewer has blocked or
// muted. This asserts the behavior is preserved: a followed author the viewer
// has blocked or muted is removed from the home feed.
// ---------------------------------------------------------------------------

test("unified home: excludes posts by blocked and muted authors", async () => {
  const db = await freshDb();
  const me = await insertLocalActor(db, "me");
  const normal = await insertLocalActor(db, "fnormal");
  const blocked = await insertLocalActor(db, "fblocked");
  const muted = await insertLocalActor(db, "fmuted");

  // I follow all three; then block one and mute another.
  await acceptFollow(db, me, normal);
  await acceptFollow(db, me, blocked);
  await acceptFollow(db, me, muted);
  await db.insert(blocks).values({ blockerApId: me, blockedApId: blocked });
  await db.insert(mutes).values({ muterApId: me, mutedApId: muted });

  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/normal`,
    author: normal,
    content: "visible",
    published: "2026-01-03T00:00:00.000Z",
  });
  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/blocked`,
    author: blocked,
    content: "from a blocked author",
    published: "2026-01-02T00:00:00.000Z",
  });
  await insertPersonalPost(db, {
    apId: `${APP_URL}/ap/objects/muted`,
    author: muted,
    content: "from a muted author",
    published: "2026-01-01T00:00:00.000Z",
  });

  const ids = await getHome(db, fakeActor(me, "me"));

  expect(ids).toContain(`${APP_URL}/ap/objects/normal`);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/blocked`);
  expect(ids).not.toContain(`${APP_URL}/ap/objects/muted`);
});
