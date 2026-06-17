import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * B0.3 — Stories community scope.
 *
 * A story created with `community_ap_id` is SCOPED to that community:
 *
 *  (i)   it is only visible to accepted members of that community (read with
 *        `?community=<apId>`), and a non-member sees nothing,
 *  (ii)  it never leaks into the personal (self + followed) story feed, and
 *  (iii) personal stories are unaffected: they keep appearing in the personal
 *        feed and are NOT returned for a community scope.
 *  (iv)  its federation REACH is the community: creating a community story
 *        enqueues a `fanout_community` (NOT a `fanout_followers` against the
 *        author's personal follower graph); a personal story keeps
 *        author-follower reach.
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
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import storiesRoutes from "../../routes/stories/routes.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
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

async function insertCommunity(
  db: Database,
  username: string,
): Promise<{ apId: string; followersUrl: string }> {
  const apId = `${APP_URL}/ap/groups/${username}`;
  const followersUrl = `${apId}/followers`;
  await db.insert(communities).values({
    apId,
    preferredUsername: username,
    name: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl,
    visibility: "public",
    postPolicy: "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: localApId("owner"),
  });
  return { apId, followersUrl };
}

type SentMessage = {
  type: string;
  communityApId?: string;
  [k: string]: unknown;
};

function envFor(db: Database, sent?: SentMessage[]): Env {
  const capture = sent ?? [];
  return {
    APP_URL,
    DB_INSTANCE: db,
    // Capturing queue: read-side-scope tests ignore it; the reach test below
    // inspects what was enqueued.
    DELIVERY_QUEUE: {
      async send(body: SentMessage) {
        capture.push(body);
      },
      async sendBatch(reqs: Array<{ body: SentMessage }>) {
        for (const r of reqs) capture.push(r.body);
      },
    },
    DELIVERY_DLQ: {
      async send() {},
      async sendBatch() {},
    },
  } as unknown as Env;
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
  app.route("/", storiesRoutes);
  return app;
}

async function createStory(
  db: Database,
  actor: Actor,
  env: Env,
  body: Record<string, unknown>,
): Promise<string> {
  const res = await appWith(db, actor).fetch(
    new Request(`${APP_URL}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attachment: { r2_key: "uploads/x.jpg", content_type: "image/jpeg" },
        displayDuration: "PT5S",
        ...body,
      }),
    }),
    env,
  );
  expect(res.status).toEqual(201);
  const json = (await res.json()) as { story: { ap_id: string } };
  return json.story.ap_id;
}

// Read the personal (self + followed) story feed for `actor`.
async function readPersonalFeed(
  db: Database,
  actor: Actor,
  env: Env,
): Promise<string[]> {
  const res = await appWith(db, actor).fetch(
    new Request(`${APP_URL}/`, { method: "GET" }),
    env,
  );
  expect(res.status).toEqual(200);
  const json = (await res.json()) as {
    actor_stories?: Array<{ stories: Array<{ ap_id: string }> }>;
  };
  return (json.actor_stories ?? []).flatMap((g) =>
    g.stories.map((s) => s.ap_id),
  );
}

// Read the community-scoped story feed for `actor`.
async function readCommunityFeed(
  db: Database,
  actor: Actor | null,
  community: string,
  env: Env,
): Promise<string[]> {
  const res = await appWith(db, actor).fetch(
    new Request(`${APP_URL}/?community=${encodeURIComponent(community)}`, {
      method: "GET",
    }),
    env,
  );
  expect(res.status).toEqual(200);
  const json = (await res.json()) as {
    actor_stories?: Array<{ stories: Array<{ ap_id: string }> }>;
  };
  return (json.actor_stories ?? []).flatMap((g) =>
    g.stories.map((s) => s.ap_id),
  );
}

// ---------------------------------------------------------------------------
// A community story is only visible to members; personal stories unchanged.
// ---------------------------------------------------------------------------

test("community story is member-only; personal stories stay in the personal feed", async () => {
  const db = await freshDb();
  const env = envFor(db);

  const author = await insertLocalActor(db, "author");
  const member = await insertLocalActor(db, "member");
  const outsider = await insertLocalActor(db, "outsider");

  const { apId: communityApId } = await insertCommunity(db, "town");

  // author + member are accepted community members. outsider is not.
  await db.insert(communityMembers).values([
    { communityApId, actorApId: author, role: "member" },
    { communityApId, actorApId: member, role: "member" },
  ]);
  // member and outsider both follow the author (so a personal story from the
  // author would normally reach them in the personal feed).
  await db.insert(follows).values([
    { followerApId: member, followingApId: author, status: "accepted" },
    { followerApId: outsider, followingApId: author, status: "accepted" },
  ]);

  const authorActor = fakeActor(author, "author");
  const memberActor = fakeActor(member, "member");
  const outsiderActor = fakeActor(outsider, "outsider");

  // author creates one COMMUNITY story and one PERSONAL story.
  const communityStory = await createStory(db, authorActor, env, {
    community_ap_id: communityApId,
  });
  const personalStory = await createStory(db, authorActor, env, {});

  // (i) community scope: a member sees the community story...
  const memberCommunityFeed = await readCommunityFeed(
    db,
    memberActor,
    communityApId,
    env,
  );
  expect(memberCommunityFeed).toContain(communityStory);
  // ...and the community feed does NOT contain the personal story.
  expect(memberCommunityFeed).not.toContain(personalStory);

  // (i) a non-member gets nothing for the community scope.
  const outsiderCommunityFeed = await readCommunityFeed(
    db,
    outsiderActor,
    communityApId,
    env,
  );
  expect(outsiderCommunityFeed).toEqual([]);

  // (ii) the community story never leaks into the personal feed.
  const memberPersonalFeed = await readPersonalFeed(db, memberActor, env);
  expect(memberPersonalFeed).toContain(personalStory);
  expect(memberPersonalFeed).not.toContain(communityStory);

  const outsiderPersonalFeed = await readPersonalFeed(db, outsiderActor, env);
  expect(outsiderPersonalFeed).toContain(personalStory);
  expect(outsiderPersonalFeed).not.toContain(communityStory);

  // (iii) the author's own personal feed shows the personal story, not the
  // community one.
  const authorPersonalFeed = await readPersonalFeed(db, authorActor, env);
  expect(authorPersonalFeed).toContain(personalStory);
  expect(authorPersonalFeed).not.toContain(communityStory);
});

// ---------------------------------------------------------------------------
// Non-members cannot create community stories (write-side gate).
// ---------------------------------------------------------------------------

test("non-member cannot create a community story", async () => {
  const db = await freshDb();
  const env = envFor(db);

  const outsider = await insertLocalActor(db, "outsider");
  const { apId: communityApId } = await insertCommunity(db, "town");

  const res = await appWith(db, fakeActor(outsider, "outsider")).fetch(
    new Request(`${APP_URL}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        attachment: { r2_key: "uploads/x.jpg", content_type: "image/jpeg" },
        displayDuration: "PT5S",
        community_ap_id: communityApId,
      }),
    }),
    env,
  );
  // postPolicy "members" + no membership -> 403.
  expect(res.status).toEqual(403);
});

// ---------------------------------------------------------------------------
// (iv) Federation reach: a community story fans out to the community, a
// personal story to the author's followers.
// ---------------------------------------------------------------------------

test("community story reach is the community fanout, not the author follower fanout", async () => {
  const db = await freshDb();
  const sent: SentMessage[] = [];
  const env = envFor(db, sent);

  const author = await insertLocalActor(db, "author");
  const { apId: communityApId } = await insertCommunity(db, "town");
  await db.insert(communityMembers).values({
    communityApId,
    actorApId: author,
    role: "member",
  });

  const authorActor = fakeActor(author, "author");

  // Community story -> exactly one fanout_community for THIS community, and no
  // author-follower fanout (reach is NOT the author's personal follower graph).
  await createStory(db, authorActor, env, { community_ap_id: communityApId });
  const communityFanouts = sent.filter((m) => m.type === "fanout_community");
  expect(communityFanouts.length).toEqual(1);
  expect(communityFanouts[0].communityApId).toEqual(communityApId);
  expect(sent.some((m) => m.type === "fanout_followers")).toBe(false);

  // Personal story -> author-follower fanout, no community fanout.
  sent.length = 0;
  await createStory(db, authorActor, env, {});
  expect(sent.some((m) => m.type === "fanout_followers")).toBe(true);
  expect(sent.some((m) => m.type === "fanout_community")).toBe(false);
});
