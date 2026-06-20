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

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
  follows,
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
