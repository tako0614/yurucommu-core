import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * B0.2 — community-scoped reach (audience + delivery).
 *
 * A post created with `community_ap_id` must be SCOPED to that community, not
 * to the author's personal follower graph:
 *
 *  (i)   it is ADDRESSED to the community (community audience + to/cc toward the
 *        community's followers collection),
 *  (ii)  it is EXCLUDED from the public/home feed (the audienceJson != "[]"
 *        filter keeps community posts out), and
 *  (iii) its DELIVERY targets the community's members — a local member receives
 *        the post in their inbox — and NOT the author's plain followers.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
  follows,
  inbox as inboxTable,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import postsRoutes from "../../routes/posts/routes.ts";
import timelineRoutes from "../../routes/timeline.ts";
import { handleDeliveryQueueBatch } from "../../lib/delivery/queue.ts";
import type {
  DeliveryDlqMessageV1,
  DeliveryQueueMessageV1,
} from "../../lib/delivery/types.ts";

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

async function insertCommunity(
  db: Database,
  username: string,
  opts: { visibility?: string; postPolicy?: string } = {},
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
    visibility: opts.visibility ?? "public",
    postPolicy: opts.postPolicy ?? "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: localApId("owner"),
  });
  return { apId, followersUrl };
}

// A fake queue that captures everything sent, so a single test can both observe
// what was enqueued and replay it through the real batch handler.
function makeFakeQueue() {
  const sent: DeliveryQueueMessageV1[] = [];
  return {
    sent,
    queue: {
      async send(body: DeliveryQueueMessageV1) {
        sent.push(body);
      },
      async sendBatch(reqs: Array<{ body: DeliveryQueueMessageV1 }>) {
        for (const r of reqs) sent.push(r.body);
      },
    },
  };
}

function envFor(
  db: Database,
  queue: ReturnType<typeof makeFakeQueue>["queue"],
): Env {
  const dlq = {
    async send(_b: DeliveryDlqMessageV1) {},
    async sendBatch(_r: Array<{ body: DeliveryDlqMessageV1 }>) {},
  };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: dlq,
  } as unknown as Env;
}

function appWith(
  db: Database,
  env: Env,
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

// Replay captured queue messages through the real batch handler. Each message
// is wrapped to satisfy the Cloudflare `Message` ack/retry contract.
async function drainQueue(
  env: Env,
  bodies: DeliveryQueueMessageV1[],
): Promise<void> {
  const messages = bodies.map((body) => ({
    id: Math.random().toString(36),
    timestamp: new Date(),
    body,
    attempts: 1,
    ack() {},
    retry() {},
  }));
  await handleDeliveryQueueBatch(
    { messages, queue: "delivery", ackAll() {}, retryAll() {} } as never,
    env,
  );
}

// ---------------------------------------------------------------------------
// (i) + (ii) + (iii) in one end-to-end flow.
// ---------------------------------------------------------------------------

test("community post: audience is the community, excluded from public feed, delivered to community members not author followers", async () => {
  const db = await freshDb();
  const fake = makeFakeQueue();
  const env = envFor(db, fake.queue);

  const author = await insertLocalActor(db, "author");
  const member = await insertLocalActor(db, "member");
  const plainFollower = await insertLocalActor(db, "plainfollower");

  const { apId: communityApId, followersUrl } = await insertCommunity(
    db,
    "town",
    { visibility: "public", postPolicy: "anyone" },
  );

  // `member` is a community member; `plainFollower` follows the AUTHOR but is
  // NOT a community member. A correctly community-scoped post must reach the
  // member and must NOT reach the plain follower.
  await db.insert(communityMembers).values({
    communityApId,
    actorApId: member,
    role: "member",
  });
  await db.insert(follows).values({
    followerApId: plainFollower,
    followingApId: author,
    status: "accepted",
  });

  // --- create the community post via the real route ---
  const createApp = appWith(db, env, fakeActor(author, "author"), postsRoutes);
  const createRes = await createApp.fetch(
    new Request(`${APP_URL}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        content: "hello town",
        visibility: "public",
        community_ap_id: communityApId,
      }),
    }),
    env,
  );
  expect(createRes.status).toEqual(200);
  const created = (await createRes.json()) as { ap_id: string };
  const postApId = created.ap_id;

  // (i) audience/addressing is the community (not the author's followers).
  const row = await db
    .select({
      audienceJson: objects.audienceJson,
      toJson: objects.toJson,
      communityApId: objects.communityApId,
    })
    .from(objects)
    .where(eq(objects.apId, postApId))
    .get();
  expect(row).toBeTruthy();
  expect(JSON.parse(row!.audienceJson)).toEqual([communityApId]);
  const to = JSON.parse(row!.toJson) as string[];
  expect(to).toContain(communityApId);
  expect(to).toContain(followersUrl);
  // It must NOT be addressed to the author's own follower collection.
  expect(to).not.toContain(`${author}/followers`);
  expect(row!.communityApId).toEqual(communityApId);

  // (ii) excluded from the public/home feed.
  const tlApp = appWith(db, env, null, timelineRoutes);
  const tlRes = await tlApp.fetch(
    new Request(`${APP_URL}/`, { method: "GET" }),
    env,
  );
  expect(tlRes.status).toEqual(200);
  const tlBody = (await tlRes.json()) as { posts?: Array<{ ap_id: string }> };
  const publicIds = tlBody.posts?.map((p) => p.ap_id) ?? [];
  expect(publicIds).not.toContain(postApId);

  // (iii) delivery targets the community — a community fanout was enqueued for
  // the community actor, and NOT a plain author-follower fanout.
  const communityFanouts = fake.sent.filter(
    (m) => m.type === "fanout_community",
  );
  expect(communityFanouts.length).toEqual(1);
  expect(
    (communityFanouts[0] as { communityApId: string }).communityApId,
  ).toEqual(communityApId);
  // Critically: reach is NOT the author's follower graph.
  expect(fake.sent.some((m) => m.type === "fanout_followers")).toBe(false);

  // Drain the captured fanout through the real handler; the local community
  // member must receive the post in their inbox, the author must not echo to
  // self, and the author's plain (non-member) follower must NOT receive it.
  const toDrain = [...fake.sent];
  fake.sent.length = 0;
  await drainQueue(env, toDrain);

  const memberInbox = await db
    .select({ activityApId: inboxTable.activityApId })
    .from(inboxTable)
    .where(eq(inboxTable.actorApId, member))
    .all();
  expect(memberInbox.length).toEqual(1);

  const authorInbox = await db
    .select({ activityApId: inboxTable.activityApId })
    .from(inboxTable)
    .where(eq(inboxTable.actorApId, author))
    .all();
  expect(authorInbox.length).toEqual(0);

  const followerInbox = await db
    .select({ activityApId: inboxTable.activityApId })
    .from(inboxTable)
    .where(eq(inboxTable.actorApId, plainFollower))
    .all();
  expect(followerInbox.length).toEqual(0);
});

// ---------------------------------------------------------------------------
// Non-community posts are unaffected: they keep author-follower reach.
// ---------------------------------------------------------------------------

test("non-community post keeps author-follower reach and empty community audience", async () => {
  const db = await freshDb();
  const fake = makeFakeQueue();
  const env = envFor(db, fake.queue);

  const author = await insertLocalActor(db, "author");

  const createApp = appWith(db, env, fakeActor(author, "author"), postsRoutes);
  const createRes = await createApp.fetch(
    new Request(`${APP_URL}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "just me", visibility: "public" }),
    }),
    env,
  );
  expect(createRes.status).toEqual(200);
  const created = (await createRes.json()) as { ap_id: string };

  const row = await db
    .select({
      audienceJson: objects.audienceJson,
      communityApId: objects.communityApId,
    })
    .from(objects)
    .where(eq(objects.apId, created.ap_id))
    .get();
  // No community audience -> stays in the public feed path.
  expect(JSON.parse(row!.audienceJson)).toEqual([]);
  expect(row!.communityApId).toBeNull();

  // Reach is the author's followers (not a community fanout).
  expect(fake.sent.some((m) => m.type === "fanout_followers")).toBe(true);
  expect(fake.sent.some((m) => m.type === "fanout_community")).toBe(false);
});
