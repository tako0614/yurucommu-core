import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
  follows,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import { registerMembershipMemberRoutes } from "../../routes/communities/membership-members.ts";

// Audit #10 finding #3: a REMOTE community member has no communityMembers row —
// their membership is the accepted follows edge to the Group actor (which the
// Announce-relay fan-out and the members-only post gate both key on). The kick
// endpoint only looked at communityMembers and 404'd any remote actor, so a
// moderator had NO way to remove a remote member. The handler now also removes
// the follows edge.

const APP_URL = "https://yuru.test";
const GROUP = `${APP_URL}/ap/groups/town`;
const OWNER = `${APP_URL}/ap/users/owner`;
const REMOTE = "https://remote.example/users/raider";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const f of [
    "0001_init.sql",
    "0002_social_remote_actor_edges.sql",
    "0004_blocklist.sql",
    "0008_actor_fields_aka.sql",
    "0009_object_tags.sql",
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
    preferredUsername: "town",
    name: "town",
    inbox: `${GROUP}/inbox`,
    outbox: `${GROUP}/outbox`,
    followersUrl: `${GROUP}/followers`,
    visibility: "public",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: OWNER,
    memberCount: 1,
  });
  await db
    .insert(communityMembers)
    .values({ communityApId: GROUP, actorApId: OWNER, role: "owner" });
  // Remote member: accepted follows edge to the Group, NO communityMembers row.
  await db.insert(follows).values({
    followerApId: REMOTE,
    followingApId: GROUP,
    status: "accepted",
    acceptedAt: "2026-01-01T00:00:00.000Z",
  });
}

function ownerActor(): Actor {
  return { ap_id: OWNER, role: "member" } as unknown as Actor;
}

function appFor(db: Database) {
  const router = new Hono<{ Bindings: Env; Variables: Variables }>();
  registerMembershipMemberRoutes(router);
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", ownerActor());
    await next();
  });
  app.route("/api/communities", router);
  return app;
}

const env = { APP_URL, DB_INSTANCE: undefined } as unknown as Env;

test("an owner can kick a REMOTE member (the follows edge is deleted)", async () => {
  const db = await freshDb();
  await seed(db);
  const app = appFor(db);

  const res = await app.fetch(
    new Request(
      `${APP_URL}/api/communities/town/members/${encodeURIComponent(REMOTE)}`,
      { method: "DELETE" },
    ),
    env,
  );
  expect(res.status).toBe(200);

  const edge = await db
    .select({ f: follows.followerApId })
    .from(follows)
    .where(
      and(eq(follows.followerApId, REMOTE), eq(follows.followingApId, GROUP)),
    )
    .get();
  expect(edge).toBeUndefined(); // removed from the relay + members-only gate
});

test("kicking an actor who is neither a local member nor a remote follower 404s", async () => {
  const db = await freshDb();
  await seed(db);
  const app = appFor(db);

  const stranger = "https://remote.example/users/nobody";
  const res = await app.fetch(
    new Request(
      `${APP_URL}/api/communities/town/members/${encodeURIComponent(stranger)}`,
      { method: "DELETE" },
    ),
    env,
  );
  expect(res.status).toBe(404);
});
