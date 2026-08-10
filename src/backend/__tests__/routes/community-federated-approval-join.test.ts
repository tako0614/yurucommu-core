import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  communities,
  communityBans,
  communityJoinRequests,
  communityMembers,
  deliveryResolutions,
  follows,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { blockDomain } from "../../lib/blocklist.ts";
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
const LOCAL = `${APP_URL}/ap/users/local`;
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
    "0023_delivery_resolution_outbox.sql",
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

function envFor(db: Database): Env {
  const queue = {
    send: () => Promise.resolve(),
    sendBatch: () => Promise.resolve(),
  };
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: queue,
    DELIVERY_DLQ: queue,
  } as unknown as Env;
}

test("GET /requests lists a pending REMOTE follow as a join request", async () => {
  const db = await freshDb();
  await seed(db);

  const res = await appFor(db).fetch(
    new Request(`${APP_URL}/api/communities/gated/requests`, { method: "GET" }),
    envFor(db),
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
    envFor(db),
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

test("local community acceptance co-commits membership, counter, unban, and request state", async () => {
  const db = await freshDb();
  await seed(db);
  await db.insert(actors).values({
    apId: LOCAL,
    type: "Person",
    preferredUsername: "local",
    inbox: `${LOCAL}/inbox`,
    outbox: `${LOCAL}/outbox`,
    followersUrl: `${LOCAL}/followers`,
    followingUrl: `${LOCAL}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(communityJoinRequests).values({
    communityApId: GROUP,
    actorApId: LOCAL,
    status: "pending",
  });
  await db.insert(communityBans).values({
    communityApId: GROUP,
    bannedApId: LOCAL,
  });
  await db.run(sql`
    CREATE TRIGGER reject_local_approval_completion
    BEFORE UPDATE OF status ON community_join_requests
    WHEN NEW.status = 'accepted'
    BEGIN
      SELECT RAISE(ABORT, 'simulated request ledger outage');
    END
  `);

  const request = () =>
    appFor(db).fetch(
      new Request(`${APP_URL}/api/communities/gated/requests/accept`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ actor_ap_id: LOCAL }),
      }),
      envFor(db),
    );

  expect((await request()).status).toBe(500);
  expect(
    await db
      .select()
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityApId, GROUP),
          eq(communityMembers.actorApId, LOCAL),
        ),
      ),
  ).toHaveLength(0);
  expect(
    (
      await db
        .select({ memberCount: communities.memberCount })
        .from(communities)
        .where(eq(communities.apId, GROUP))
        .get()
    )?.memberCount,
  ).toBe(1);
  expect(await db.select().from(communityBans)).toHaveLength(1);
  expect(
    (
      await db
        .select({ status: communityJoinRequests.status })
        .from(communityJoinRequests)
        .where(
          and(
            eq(communityJoinRequests.communityApId, GROUP),
            eq(communityJoinRequests.actorApId, LOCAL),
          ),
        )
        .get()
    )?.status,
  ).toBe("pending");

  await db.run(sql`DROP TRIGGER reject_local_approval_completion`);
  expect((await request()).status).toBe(200);
  expect(
    await db
      .select()
      .from(communityMembers)
      .where(
        and(
          eq(communityMembers.communityApId, GROUP),
          eq(communityMembers.actorApId, LOCAL),
        ),
      ),
  ).toHaveLength(1);
  expect(
    (
      await db
        .select({ memberCount: communities.memberCount })
        .from(communities)
        .where(eq(communities.apId, GROUP))
        .get()
    )?.memberCount,
  ).toBe(2);
  expect(await db.select().from(communityBans)).toHaveLength(0);
  expect(
    (
      await db
        .select({ status: communityJoinRequests.status })
        .from(communityJoinRequests)
        .where(
          and(
            eq(communityJoinRequests.communityApId, GROUP),
            eq(communityJoinRequests.actorApId, LOCAL),
          ),
        )
        .get()
    )?.status,
  ).toBe("accepted");
});

test("remote community acceptance rolls back membership when delivery intent cannot persist", async () => {
  const db = await freshDb();
  await seed(db);
  await db.run(sql`
    CREATE TRIGGER reject_community_accept_resolution
    BEFORE INSERT ON delivery_resolutions
    BEGIN
      SELECT RAISE(ABORT, 'simulated resolution ledger outage');
    END
  `);

  const res = await appFor(db).fetch(
    new Request(`${APP_URL}/api/communities/gated/requests/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor_ap_id: REMOTE }),
    }),
    envFor(db),
  );

  expect(res.status).toBe(500);
  expect(
    (
      await db
        .select({ status: follows.status })
        .from(follows)
        .where(
          and(
            eq(follows.followerApId, REMOTE),
            eq(follows.followingApId, GROUP),
          ),
        )
        .get()
    )?.status,
  ).toBe("pending");
  expect(
    await db.select().from(activities).where(eq(activities.type, "Accept")),
  ).toHaveLength(0);
  expect(await db.select().from(deliveryResolutions)).toHaveLength(0);
});

test("community join requests hide an operator-blocked remote edge", async () => {
  const db = await freshDb();
  await seed(db);
  await blockDomain(db, "remote.example", "defederated");

  const res = await appFor(db).fetch(
    new Request(`${APP_URL}/api/communities/gated/requests`, { method: "GET" }),
    envFor(db),
  );

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ requests: [] });
});

test("community accept cannot re-admit an operator-blocked pending remote", async () => {
  const db = await freshDb();
  await seed(db);
  await blockDomain(db, "remote.example", "defederated");

  const res = await appFor(db).fetch(
    new Request(`${APP_URL}/api/communities/gated/requests/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ actor_ap_id: REMOTE }),
    }),
    envFor(db),
  );

  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "Join request not found" });
  expect((await db.select().from(follows))[0]?.status).toBe("pending");
  expect(
    await db.select().from(activities).where(eq(activities.type, "Accept")),
  ).toHaveLength(0);
});
