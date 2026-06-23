import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  communities,
  communityMembers,
  follows,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { registerMembershipRequestRoutes } from "../../routes/communities/membership-requests.ts";

/**
 * Audit #18: federated approval-join. A remote actor joins an approval-policy
 * community by Following the Group; handleGroupFollow holds the follow PENDING.
 * That pending follows edge IS the join request (a remote has no `actors` row, so
 * it can't be mirrored into community_join_requests). The manager approval surface
 * must therefore (a) LIST the pending edge in GET /requests and (b) on accept,
 * flip the edge to accepted + emit the community-signed Accept — NOT write a
 * communityMembers row.
 */

const APP_URL = "https://yuru.test";
const GROUP = `${APP_URL}/ap/groups/gated`;
const OWNER = `${APP_URL}/ap/users/owner`;
const REMOTE = "https://remote.example/users/alice";
const FOLLOW_ACT = "https://remote.example/activities/follow-1";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const f of [
    "0001_init.sql",
    "0002_social_remote_actor_edges.sql",
    // 0003 drops the activities.object_ap_id -> objects FK so an outbound Accept
    // whose object is a remote Follow activity id (not an objects row) can be
    // recorded; production applied this.
    "0003_activity_remote_object_edges.sql",
    "0004_blocklist.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
    "0015_community_bans.sql",
  ]) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function seed(db: Database): Promise<void> {
  await db.insert(actors).values({
    apId: OWNER,
    type: "Person",
    preferredUsername: "owner",
    inbox: `${OWNER}/inbox`,
    outbox: `${OWNER}/outbox`,
    followersUrl: `${OWNER}/followers`,
    followingUrl: `${OWNER}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(communities).values({
    apId: GROUP,
    preferredUsername: "gated",
    name: "Gated",
    inbox: `${GROUP}/inbox`,
    outbox: `${GROUP}/outbox`,
    followersUrl: `${GROUP}/followers`,
    visibility: "public",
    joinPolicy: "approval",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: OWNER,
    memberCount: 1,
  });
  await db
    .insert(communityMembers)
    .values({ communityApId: GROUP, actorApId: OWNER, role: "owner" });
  // The remote's approval-join: a PENDING follows edge to the Group (what
  // handleGroupFollow records for an approval community).
  await db.insert(follows).values({
    followerApId: REMOTE,
    followingApId: GROUP,
    status: "pending",
    activityApId: FOLLOW_ACT,
  });
}

function appFor(db: Database) {
  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  registerMembershipRequestRoutes(router);
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", { ap_id: OWNER, role: "member" } as unknown as Actor);
    await next();
  });
  app.route("/api/communities", router);
  return app;
}

const env = {
  APP_URL,
  DELIVERY_QUEUE: { send: () => Promise.resolve() },
  DELIVERY_DLQ: { send: () => Promise.resolve() },
} as unknown as Env;

test("GET /requests lists a pending REMOTE follow as a join request", async () => {
  const db = await freshDb();
  await seed(db);

  const res = await appFor(db).fetch(
    new Request(`${APP_URL}/api/communities/gated/requests`, { method: "GET" }),
    env,
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as { requests: { ap_id: string }[] };
  expect(body.requests.map((r) => r.ap_id)).toContain(REMOTE);
});

test("POST /requests/accept of a remote: flips the follows edge + emits a community Accept, no communityMembers row", async () => {
  const db = await freshDb();
  await seed(db);

  const res = await appFor(db).fetch(
    new Request(`${APP_URL}/api/communities/gated/requests/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor_ap_id: REMOTE }),
    }),
    env,
  );
  expect(res.status).toBe(200);

  // The pending follows edge is now accepted (so handleGroupCreate relays posts).
  const edge = await db
    .select({ status: follows.status })
    .from(follows)
    .where(
      and(eq(follows.followerApId, REMOTE), eq(follows.followingApId, GROUP)),
    )
    .get();
  expect(edge?.status).toBe("accepted");

  // A community-signed Accept was recorded for outbound delivery.
  const accept = await db
    .select()
    .from(activities)
    .where(and(eq(activities.actorApId, GROUP), eq(activities.type, "Accept")))
    .get();
  expect(accept).toBeDefined();
  expect(accept?.objectApId).toBe(FOLLOW_ACT);
  expect(accept?.direction).toBe("outbound");

  // A REMOTE member is NOT written to communityMembers (membership = the edge).
  const member = await db
    .select()
    .from(communityMembers)
    .where(eq(communityMembers.actorApId, REMOTE))
    .get();
  expect(member).toBeUndefined();
});
