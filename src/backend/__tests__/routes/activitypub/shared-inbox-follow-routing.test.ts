import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { Hono } from "hono";

import * as schema from "../../../../db/schema.ts";
import type { Database } from "../../../../db/index.ts";
import { actors, actorCache, follows } from "../../../../db/index.ts";
import inboxRoutes from "../../../routes/activitypub/inbox.ts";
import { generateKeyPair, signRequest } from "../../../federation-helpers.ts";

/**
 * Shared-inbox (/ap/inbox) Follow routing.
 *
 * A `Follow` is addressed to the actor in `activity.object` (the followed
 * actor), NOT to followers of the sender. The shared-inbox dispatcher used to
 * route every recipient-scoped activity (Follow included) to the local
 * followers of the SENDER, so a Follow delivered here created a bogus edge
 * against each of the sender's local followers (followingApId = the wrong
 * actor) and dropped the real request when the sender had none. The fix
 * resolves the target from `object` and dispatches once to it.
 */

const APP_URL = "https://yuru.test";
const ALICE = "https://remote.example/users/alice"; // remote sender

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    await client.executeMultiple(await readFile(new URL(f, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

class MockKV {
  private store = new Map<string, string>();
  async get(k: string) {
    return this.store.get(k) ?? null;
  }
  async put(k: string, v: string) {
    this.store.set(k, v);
  }
  async delete(k: string) {
    this.store.delete(k);
  }
}

async function seedLocalActor(db: Database, username: string, isPrivate = 0) {
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
    isPrivate,
  });
  return apId;
}

function appFor(db: Database) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    (c as unknown as { set: (k: string, v: unknown) => void }).set("db", db);
    await next();
  });
  app.route("/", inboxRoutes);
  return app;
}

async function postSignedFollow(
  app: Hono,
  env: Record<string, unknown>,
  privateKeyPem: string,
  objectApId: string,
) {
  const body = JSON.stringify({
    "@context": "https://www.w3.org/ns/activitystreams",
    id: `${ALICE.replace("/users/alice", "")}/activities/follow-${objectApId.split("/").pop()}`,
    type: "Follow",
    actor: ALICE,
    object: objectApId,
  });
  const url = `${APP_URL}/ap/inbox`;
  const headers = await signRequest(
    privateKeyPem,
    `${ALICE}#main-key`,
    "POST",
    url,
    body,
  );
  return app.fetch(
    new Request(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/activity+json" },
      body,
    }),
    env,
  );
}

test("shared-inbox Follow resolves the target from object, NOT the sender's followers", async () => {
  const db = await freshDb();
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();

  const bob = await seedLocalActor(db, "bob"); // the follow TARGET (public)
  const carol = await seedLocalActor(db, "carol"); // a local follower of the sender (the trap)

  // alice (remote sender) is cached with her signing key (fresh => verified from cache).
  await db.insert(actorCache).values({
    apId: ALICE,
    inbox: `${ALICE}/inbox`,
    rawJson: "{}",
    publicKeyPem,
    lastFetchedAt: new Date().toISOString(),
  });
  // carol follows alice -> carol is a LOCAL FOLLOWER of the sender. The old code
  // would fan the Follow out to carol and create follows(alice -> carol).
  await db.insert(follows).values({
    followerApId: carol,
    followingApId: ALICE,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });

  const env = { APP_URL, DB_INSTANCE: db, KV: new MockKV() };
  const res = await postSignedFollow(appFor(db), env, privateKeyPem, bob);
  expect(res.status).toBe(202);

  // CORRECT: the follow edge targets bob (the object), auto-accepted (bob public).
  const correct = await db.query.follows.findFirst({
    where: and(eq(follows.followerApId, ALICE), eq(follows.followingApId, bob)),
  });
  expect(correct?.status).toBe("accepted");

  // BUG GUARD: no bogus edge against carol (a follower of the sender).
  const bogus = await db.query.follows.findFirst({
    where: and(
      eq(follows.followerApId, ALICE),
      eq(follows.followingApId, carol),
    ),
  });
  expect(bogus).toBeFalsy();
});

async function postSigned(
  app: Hono,
  env: Record<string, unknown>,
  privateKeyPem: string,
  body: Record<string, unknown>,
) {
  const json = JSON.stringify(body);
  const url = `${APP_URL}/ap/inbox`;
  const headers = await signRequest(
    privateKeyPem,
    `${ALICE}#main-key`,
    "POST",
    url,
    json,
  );
  return app.fetch(
    new Request(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/activity+json" },
      body: json,
    }),
    env,
  );
}

async function seedAlice(db: Database, publicKeyPem: string) {
  await db.insert(actorCache).values({
    apId: ALICE,
    inbox: `${ALICE}/inbox`,
    rawJson: "{}",
    publicKeyPem,
    lastFetchedAt: new Date().toISOString(),
  });
}

test("shared-inbox Undo(Follow) targets the followed actor (unfollow not dropped, right count) even with no local followers of the sender", async () => {
  const db = await freshDb();
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const bob = await seedLocalActor(db, "bob");
  await db.update(actors).set({ followerCount: 1 }).where(eq(actors.apId, bob));
  await seedAlice(db, publicKeyPem);
  const followId = "https://remote.example/activities/follow-bob";
  // alice already follows bob; alice has NO local followers (the drop case).
  await db.insert(follows).values({
    followerApId: ALICE,
    followingApId: bob,
    status: "accepted",
    activityApId: followId,
    acceptedAt: new Date().toISOString(),
  });

  const env = { APP_URL, DB_INSTANCE: db, KV: new MockKV() };
  const res = await postSigned(appFor(db), env, privateKeyPem, {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://remote.example/activities/undo-1",
    type: "Undo",
    actor: ALICE,
    object: { id: followId, type: "Follow", actor: ALICE, object: bob },
  });
  expect(res.status).toBe(202);

  // The R->bob edge is gone and bob's followerCount was decremented (not some
  // follower of alice's, and not silently dropped).
  const edge = await db.query.follows.findFirst({
    where: and(eq(follows.followerApId, ALICE), eq(follows.followingApId, bob)),
  });
  expect(edge).toBeFalsy();
  const bobRow = await db.query.actors.findFirst({
    where: eq(actors.apId, bob),
  });
  expect(bobRow?.followerCount).toBe(0);
});

test("shared-inbox Block targets the blocked actor and severs both follow edges", async () => {
  const db = await freshDb();
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  const bob = await seedLocalActor(db, "bob");
  await seedAlice(db, publicKeyPem);
  // bob<->alice follow each other.
  await db.insert(follows).values([
    {
      followerApId: ALICE,
      followingApId: bob,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    },
    {
      followerApId: bob,
      followingApId: ALICE,
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    },
  ]);

  const env = { APP_URL, DB_INSTANCE: db, KV: new MockKV() };
  const res = await postSigned(appFor(db), env, privateKeyPem, {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: "https://remote.example/activities/block-1",
    type: "Block",
    actor: ALICE,
    object: bob,
  });
  expect(res.status).toBe(202);

  // Both follow edges were severed (handleBlock ran with recipient = bob).
  const remaining = await db
    .select({ f: follows.followerApId })
    .from(follows)
    .all();
  expect(remaining.length).toBe(0);
});

test("shared-inbox Follow naming a non-local / unknown object creates no edge (202 no-op)", async () => {
  const db = await freshDb();
  const { publicKeyPem, privateKeyPem } = await generateKeyPair();
  await db.insert(actorCache).values({
    apId: ALICE,
    inbox: `${ALICE}/inbox`,
    rawJson: "{}",
    publicKeyPem,
    lastFetchedAt: new Date().toISOString(),
  });

  const env = { APP_URL, DB_INSTANCE: db, KV: new MockKV() };
  // object is a remote actor (not ours) — nothing for us to do.
  const res = await postSignedFollow(
    appFor(db),
    env,
    privateKeyPem,
    "https://other.example/users/dave",
  );
  expect(res.status).toBe(202);

  const any = await db
    .select({ followerApId: follows.followerApId })
    .from(follows)
    .all();
  expect(any.length).toBe(0);
});
