import { afterAll, expect, mock, test } from "bun:test";
import { readFile } from "node:fs/promises";

// Capture the REAL ap-verify exports before mocking. `bun`'s `mock.module`
// replaces the module GLOBALLY for every test file loaded after this one and is
// NOT auto-restored, so a bare mock here leaks its stub into unrelated suites
// (e.g. the ap-verify host-binding tests would import the stub instead of the
// real verifier). We spread the real exports into the mock so only the one seam
// we stub changes, and restore the real module in afterAll so the leak ends with
// this file.
import * as realApVerify from "../../lib/ap-verify.ts";
const realVerifyGetHttpSignature = realApVerify.verifyGetHttpSignature;

/**
 * GA Wave-8 "COMMUNITY-GATE" — private-community single-object read leak.
 *
 * Community-scoped Notes are stored with `visibility = "public"` and a non-empty
 * `audienceJson = [communityApId]`. The list feeds keep them private via the
 * `audienceJson = "[]"` filter, but the SINGLE-object gates bypass that filter:
 *
 *   #3  GET /api/posts/:id
 *   #4  GET /api/posts/:id/replies
 *   #5  GET /ap/objects/:id
 *
 * For a PRIVATE community each of these must be hidden from an anonymous viewer
 * and from a non-member, while remaining visible to an accepted member / the
 * author. This covers all three with one private-community post + reply + object.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

// The /ap/objects/:id gate authenticates the fetcher via an HTTP signature.
// Real signatures cannot be minted in a unit test, so stub the verify seam to
// return whatever signing actor a test request declares via `x-test-signer`.
mock.module("../../lib/ap-verify.ts", () => ({
  ...realApVerify,
  verifyGetHttpSignature: async (req: Request) => {
    const signer = req.headers.get("x-test-signer");
    if (!signer) return { valid: false, error: "Missing Signature header" };
    return { valid: true, signingActor: signer };
  },
}));

// Restore the real module so the stub does not leak into later-loaded suites.
afterAll(() => {
  mock.module("../../lib/ap-verify.ts", () => ({
    ...realApVerify,
    verifyGetHttpSignature: realVerifyGetHttpSignature,
  }));
});

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
  objects,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import postsRoutes from "../../routes/posts/routes.ts";
import activityPubRoutes from "../../routes/activitypub.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
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
  } as unknown as Actor;
}

function envFor(db: Database): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    DELIVERY_QUEUE: undefined,
    DELIVERY_DLQ: undefined,
  } as unknown as Env;
}

function postsAppWith(db: Database, env: Env, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", postsRoutes);
  return app;
}

function apAppWith(db: Database) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null);
    await next();
  });
  app.route("/", activityPubRoutes);
  return app;
}

const COMMUNITY_AP_ID = `${APP_URL}/ap/communities/secretclub`;

async function insertPrivateCommunity(db: Database): Promise<void> {
  await db.insert(communities).values({
    apId: COMMUNITY_AP_ID,
    type: "Group",
    preferredUsername: "secretclub",
    name: "Secret Club",
    inbox: `${COMMUNITY_AP_ID}/inbox`,
    outbox: `${COMMUNITY_AP_ID}/outbox`,
    followersUrl: `${COMMUNITY_AP_ID}/followers`,
    visibility: "private",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: `${APP_URL}/ap/users/author`,
  });
}

/** Insert a community-scoped Note: stored "public" but addressed to the community. */
async function insertCommunityNote(
  db: Database,
  opts: {
    id: string;
    author: string;
    inReplyTo?: string;
    published: string;
  },
): Promise<string> {
  const apId = `${APP_URL}/ap/objects/${opts.id}`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: opts.author,
    content: `secret ${opts.id}`,
    inReplyTo: opts.inReplyTo ?? null,
    visibility: "public",
    toJson: JSON.stringify([COMMUNITY_AP_ID, `${COMMUNITY_AP_ID}/followers`]),
    ccJson: "[]",
    audienceJson: JSON.stringify([COMMUNITY_AP_ID]),
    communityApId: COMMUNITY_AP_ID,
    published: opts.published,
    isLocal: 1,
  });
  return apId;
}

async function getPost(
  db: Database,
  viewer: Actor | null,
  postApId: string,
): Promise<number> {
  const env = envFor(db);
  const app = postsAppWith(db, env, viewer);
  const res = await app.fetch(
    new Request(`${APP_URL}/${encodeURIComponent(postApId)}`, {
      method: "GET",
    }),
    env,
  );
  return res.status;
}

async function getReplyIds(
  db: Database,
  viewer: Actor | null,
  parentApId: string,
): Promise<{ status: number; ids: string[] }> {
  const env = envFor(db);
  const app = postsAppWith(db, env, viewer);
  const res = await app.fetch(
    new Request(`${APP_URL}/${encodeURIComponent(parentApId)}/replies`, {
      method: "GET",
    }),
    env,
  );
  if (res.status !== 200) return { status: res.status, ids: [] };
  const body = (await res.json()) as { replies: Array<{ ap_id: string }> };
  return { status: res.status, ids: body.replies.map((r) => r.ap_id) };
}

async function getApObject(
  db: Database,
  objectApId: string,
  signer: string | null,
): Promise<number> {
  const app = apAppWith(db);
  const id = objectApId.split("/").pop()!;
  const headers: Record<string, string> = {};
  if (signer) headers["x-test-signer"] = signer;
  const res = await app.fetch(
    new Request(`${APP_URL}/ap/objects/${id}`, { method: "GET", headers }),
    envFor(db),
  );
  return res.status;
}

test("private-community post/reply/object hidden from anonymous + non-member, visible to member/author", async () => {
  const db = await freshDb();

  const author = await insertLocalActor(db, "author"); // member + author
  const member = await insertLocalActor(db, "member"); // accepted member
  const outsider = await insertLocalActor(db, "outsider"); // not a member

  await insertPrivateCommunity(db);
  // Accepted membership = presence of a community_members row.
  await db.insert(communityMembers).values([
    { communityApId: COMMUNITY_AP_ID, actorApId: author, role: "admin" },
    { communityApId: COMMUNITY_AP_ID, actorApId: member, role: "member" },
  ]);

  const postApId = await insertCommunityNote(db, {
    id: "ctop",
    author,
    published: "2026-01-01T00:00:00.000Z",
  });
  const replyApId = await insertCommunityNote(db, {
    id: "creply",
    author,
    inReplyTo: postApId,
    published: "2026-01-01T00:00:01.000Z",
  });

  // -- #3 GET /api/posts/:id --------------------------------------------------
  expect(await getPost(db, null, postApId)).toEqual(404); // anonymous
  expect(await getPost(db, fakeActor(outsider, "outsider"), postApId)).toEqual(
    404,
  ); // non-member
  expect(await getPost(db, fakeActor(member, "member"), postApId)).toEqual(200); // member
  expect(await getPost(db, fakeActor(author, "author"), postApId)).toEqual(200); // author

  // -- #4 GET /api/posts/:id/replies -----------------------------------------
  const anonReplies = await getReplyIds(db, null, postApId);
  expect(anonReplies.status).toEqual(404); // parent itself gated

  const outsiderReplies = await getReplyIds(
    db,
    fakeActor(outsider, "outsider"),
    postApId,
  );
  expect(outsiderReplies.status).toEqual(404);

  const memberReplies = await getReplyIds(
    db,
    fakeActor(member, "member"),
    postApId,
  );
  expect(memberReplies.status).toEqual(200);
  expect(memberReplies.ids).toContain(replyApId);

  // -- #5 GET /ap/objects/:id ------------------------------------------------
  expect(await getApObject(db, postApId, null)).toEqual(404); // anonymous/unsigned
  expect(await getApObject(db, postApId, outsider)).toEqual(404); // signed non-member
  expect(await getApObject(db, replyApId, outsider)).toEqual(404); // reply too
  expect(await getApObject(db, postApId, member)).toEqual(200); // signed member
  expect(await getApObject(db, replyApId, member)).toEqual(200);
  expect(await getApObject(db, postApId, author)).toEqual(200); // signed author
});

test("public-community object is NOT gated (helper never widens or narrows public reach)", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "pauthor");

  const publicCommunity = `${APP_URL}/ap/communities/openclub`;
  await db.insert(communities).values({
    apId: publicCommunity,
    type: "Group",
    preferredUsername: "openclub",
    name: "Open Club",
    inbox: `${publicCommunity}/inbox`,
    outbox: `${publicCommunity}/outbox`,
    followersUrl: `${publicCommunity}/followers`,
    visibility: "public",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: author,
  });

  const apId = `${APP_URL}/ap/objects/openpost`;
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content: "open community post",
    visibility: "public",
    toJson: JSON.stringify([publicCommunity]),
    ccJson: "[]",
    audienceJson: JSON.stringify([publicCommunity]),
    communityApId: publicCommunity,
    published: "2026-01-01T00:00:00.000Z",
    isLocal: 1,
  });

  // Public community: an anonymous single-object read still succeeds.
  expect(await getPost(db, null, apId)).toEqual(200);
  expect(await getApObject(db, apId, null)).toEqual(200);
});
