import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
/**
 * Regression tests for the YURU-APP findings fix wave:
 *
 *  - getConversationId no longer collides for distinct same-host actor pairs
 *    (was a 16-char truncated, alnum-stripped base64 of the low-entropy host
 *    prefix), and is order-independent and collision-free.
 *  - recipientToJsonLike escapes LIKE metacharacters so an AP-ID containing
 *    `%` / `_` cannot act as a wildcard.
 *  - POST /requests/accept responds honestly (501) instead of faking success.
 *  - Community message READ is gated by visibility/membership, not post_policy.
 *  - Story GET /:id/votes resolves a full ap_id the same way the sibling
 *    /:id/* routes do (resolveStoryApId), instead of double-prefixing it.
 *  - transformStoryData strips only the leading `uploads/` prefix.
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
  objects,
  storyVotes,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import {
  getConversationId,
  resolveConversationId,
} from "../../routes/dm/query-helpers.ts";
import { recipientToJsonLike } from "../../routes/dm/conversations-helpers.ts";
import { transformStoryData } from "../../routes/stories/query-helpers.ts";
import dmRequestRoutes from "../../routes/dm/requests.ts";
import communityMessageRoutes from "../../routes/communities/messages.ts";
import storyInteractionRoutes from "../../routes/stories/interactions.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
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
  opts: { visibility?: string; postPolicy?: string } = {},
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
    postPolicy: opts.postPolicy ?? "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: localApId("owner"),
  });
  return apId;
}

// ---------------------------------------------------------------------------
// getConversationId collision resistance
// ---------------------------------------------------------------------------

test("getConversationId: distinct same-host pairs produce distinct IDs", () => {
  const names = ["alice", "bob", "carol", "dave", "erin", "frank"];
  const ids = new Set<string>();
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      ids.add(
        getConversationId(APP_URL, localApId(names[i]), localApId(names[j])),
      );
    }
  }
  // 6 actors -> 15 distinct unordered pairs, all must be distinct.
  expect(ids.size).toEqual(15);
});

test("getConversationId: order-independent and stable", () => {
  const a = localApId("alice");
  const b = localApId("bob");
  expect(getConversationId(APP_URL, a, b)).toEqual(
    getConversationId(APP_URL, b, a),
  );
});

test("getConversationId: different pairs that previously collided now differ", () => {
  // Under the old scheme every same-host pair collapsed onto the prefix
  // "aHR0cHM6Ly95dXJ1"; assert two such pairs no longer share an ID.
  const idAB = getConversationId(APP_URL, localApId("alice"), localApId("bob"));
  const idCD = getConversationId(
    APP_URL,
    localApId("carol"),
    localApId("dave"),
  );
  expect(idAB).not.toEqual(idCD);
});

// ---------------------------------------------------------------------------
// recipientToJsonLike escapes LIKE metacharacters
// ---------------------------------------------------------------------------

test("resolveConversationId: wildcard in AP-ID does not broaden the match", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  // A remote actor whose AP-ID contains a LIKE wildcard.
  const wildcard = "https://evil.test/ap/users/%";
  const realRemote = "https://evil.test/ap/users/mallory";

  // A DM from alice addressed to the *real* remote actor.
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/m1`,
    type: "Note",
    attributedTo: alice,
    content: "hi",
    toJson: JSON.stringify([realRemote]),
    visibility: "direct",
    conversation: getConversationId(APP_URL, alice, realRemote),
    published: new Date().toISOString(),
  });

  // Resolving a conversation with the wildcard AP-ID must NOT match the
  // unrelated mallory message (which it would if `%` acted as a wildcard).
  const resolved = await resolveConversationId(db, APP_URL, alice, wildcard);
  expect(resolved).toEqual(getConversationId(APP_URL, alice, wildcard));
});

test("recipientToJsonLike: exact JSON token still matches the stored value", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = localApId("bob");
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/m1`,
    type: "Note",
    attributedTo: alice,
    content: "hi",
    toJson: JSON.stringify([bob]),
    visibility: "direct",
    conversation: getConversationId(APP_URL, alice, bob),
    published: new Date().toISOString(),
  });

  const rows = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(recipientToJsonLike(bob));
  expect(rows.length).toEqual(1);
});

// ---------------------------------------------------------------------------
// POST /requests/accept is honest (not a fake success)
// ---------------------------------------------------------------------------

test("POST /requests/accept responds 501 instead of faking success", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const app = appWith(db, fakeActor(alice, "alice"), dmRequestRoutes);

  const res = await app.fetch(
    new Request(`${APP_URL}/requests/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sender_ap_id: localApId("bob") }),
    }),
    envFor(db),
  );

  expect(res.status).toEqual(501);
  const body = (await res.json()) as { error?: string; success?: unknown };
  expect(body.error).toEqual("not_implemented");
  expect(body.success).toEqual(undefined);
});

// ---------------------------------------------------------------------------
// Community message READ access governed by visibility, not post_policy
// ---------------------------------------------------------------------------

test("community messages: member can READ a community with post_policy=owners", async () => {
  const db = await freshDb();
  const member = await insertLocalActor(db, "member");
  const communityApId = await insertCommunity(db, "town", {
    visibility: "public",
    postPolicy: "owners",
  });
  await db.insert(communityMembers).values({
    communityApId,
    actorApId: member,
    role: "member",
  });

  const app = appWith(db, fakeActor(member, "member"), communityMessageRoutes);
  const res = await app.fetch(
    new Request(`${APP_URL}/town/messages`, { method: "GET" }),
    envFor(db),
  );

  // Previously checkPostPolicy("owners") returned 403 for ordinary members.
  expect(res.status).toEqual(200);
});

test("community messages: private community read still requires membership", async () => {
  const db = await freshDb();
  const outsider = await insertLocalActor(db, "outsider");
  await insertCommunity(db, "secret", {
    visibility: "private",
    postPolicy: "members",
  });

  const app = appWith(
    db,
    fakeActor(outsider, "outsider"),
    communityMessageRoutes,
  );
  const res = await app.fetch(
    new Request(`${APP_URL}/secret/messages`, { method: "GET" }),
    envFor(db),
  );

  expect(res.status).toEqual(403);
});

// ---------------------------------------------------------------------------
// Story GET /:id/votes resolves a full ap_id like its sibling routes
// ---------------------------------------------------------------------------

test("story /:id/votes accepts a full story ap_id (matches like/share routes)", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "author");
  const voter = await insertLocalActor(db, "voter");
  const storyApId = `${APP_URL}/ap/objects/story1`;

  await db.insert(objects).values({
    apId: storyApId,
    type: "Story",
    attributedTo: author,
    content: "poll",
    visibility: "public",
    published: new Date().toISOString(),
    endTime: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await db.insert(storyVotes).values({
    id: "v1",
    storyApId,
    actorApId: voter,
    optionIndex: 0,
  });

  const app = appWith(db, fakeActor(voter, "voter"), storyInteractionRoutes);
  const res = await app.fetch(
    new Request(`${APP_URL}/${encodeURIComponent(storyApId)}/votes`, {
      method: "GET",
    }),
    envFor(db),
  );

  // Previously objectApId() double-prefixed the URL -> 404 "Story not found".
  expect(res.status).toEqual(200);
  const body = (await res.json()) as { total: number; user_vote?: number };
  expect(body.total).toEqual(1);
  expect(body.user_vote).toEqual(0);
});

// ---------------------------------------------------------------------------
// transformStoryData strips only the leading uploads/ prefix
// ---------------------------------------------------------------------------

test("transformStoryData: strips only the leading uploads/ prefix", () => {
  const out = transformStoryData(
    JSON.stringify({
      attachment: { r2_key: "uploads/abc.jpg", content_type: "image/jpeg" },
    }),
  );
  expect(out.attachment.url).toEqual("/media/abc.jpg");
});

test("transformStoryData: leaves a non-prefixed key untouched", () => {
  const out = transformStoryData(
    JSON.stringify({
      attachment: {
        r2_key: "user-uploads/x.jpg",
        content_type: "image/jpeg",
      },
    }),
  );
  // The old naive replace would have produced "/media/user-/x.jpg".
  expect(out.attachment.url).toEqual("/media/user-uploads/x.jpg");
});
