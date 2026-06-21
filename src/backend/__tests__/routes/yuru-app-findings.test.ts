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
import communitiesRouter from "../../routes/communities/routes.ts";
import postsAggregator from "../../routes/posts.ts";
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

test("community messages: a PRIVATE community with post_policy=anyone still requires membership to POST", async () => {
  const db = await freshDb();
  const member = await insertLocalActor(db, "member");
  const outsider = await insertLocalActor(db, "outsider");
  const communityApId = await insertCommunity(db, "secretroom", {
    visibility: "private",
    postPolicy: "anyone",
  });
  await db.insert(communityMembers).values({
    communityApId,
    actorApId: member,
    role: "member",
  });

  const post = (actor: Actor) =>
    appWith(db, actor, communityMessageRoutes).fetch(
      new Request(`${APP_URL}/secretroom/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "hi" }),
      }),
      envFor(db),
    );

  // The fix: a non-member who CANNOT read the private community must not be able
  // to write into it just because post_policy="anyone".
  expect((await post(fakeActor(outsider, "outsider"))).status).toEqual(403);
  // A member passes the authz gate (anything but the 403 the gate would return;
  // the send path itself needs platform bindings the unit env doesn't provide).
  expect((await post(fakeActor(member, "member"))).status).not.toEqual(403);
});

test("community settings: governance fields (visibility) are OWNER-only, not moderator", async () => {
  const db = await freshDb();
  const owner = await insertLocalActor(db, "owner");
  const mod = await insertLocalActor(db, "mod");
  const communityApId = await insertCommunity(db, "club", {
    visibility: "private",
  });
  await db.insert(communityMembers).values([
    { communityApId, actorApId: owner, role: "owner" },
    { communityApId, actorApId: mod, role: "moderator" },
  ]);

  const patch = (actor: Actor, body: Record<string, unknown>) =>
    appWith(db, actor, communitiesRouter).fetch(
      new Request(`${APP_URL}/club/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      envFor(db),
    );

  // A moderator may edit cosmetic fields...
  expect((await patch(fakeActor(mod, "mod"), { summary: "x" })).status).toEqual(
    200,
  );
  // ...but NOT flip visibility (would expose all member-only content + roster).
  expect(
    (await patch(fakeActor(mod, "mod"), { visibility: "public" })).status,
  ).toEqual(403);
  // The owner can.
  expect(
    (await patch(fakeActor(owner, "owner"), { visibility: "public" })).status,
  ).toEqual(200);
});

test("community profile: over-length display_name / summary are rejected on create and update", async () => {
  const db = await freshDb();
  const owner = await insertLocalActor(db, "owner");

  const create = (body: Record<string, unknown>) =>
    appWith(db, fakeActor(owner, "owner"), communitiesRouter).fetch(
      new Request(`${APP_URL}/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      envFor(db),
    );

  // The handle ("name") is valid, but the summary exceeds the 500-char cap, so
  // creation is rejected BEFORE the actor is persisted/federated.
  const longSummary = await create({
    name: "validclub",
    summary: "x".repeat(501),
  });
  expect(longSummary.status).toEqual(400);
  expect(((await longSummary.json()) as { error: string }).error).toContain(
    "Summary",
  );

  // display_name has a 64-char cap.
  const longDisplay = await create({
    name: "validclubtwo",
    display_name: "y".repeat(65),
  });
  expect(longDisplay.status).toEqual(400);

  // The update path enforces the same caps. Seed a community the owner manages.
  const communityApId = await insertCommunity(db, "club");
  await db
    .insert(communityMembers)
    .values({ communityApId, actorApId: owner, role: "owner" });

  const patchSettings = (body: Record<string, unknown>) =>
    appWith(db, fakeActor(owner, "owner"), communitiesRouter).fetch(
      new Request(`${APP_URL}/club/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      envFor(db),
    );

  expect((await patchSettings({ summary: "z".repeat(501) })).status).toEqual(
    400,
  );
  // Exactly at the cap is allowed.
  expect((await patchSettings({ summary: "z".repeat(500) })).status).toEqual(
    200,
  );
});

test("posts route order: GET /bookmarks hits the bookmarks list, not the /:id post lookup", async () => {
  const db = await freshDb();
  const actor = await insertLocalActor(db, "tako");
  const app = appWith(db, fakeActor(actor, "tako"), postsAggregator);

  // /bookmarks must resolve to the bookmarks handler (200 { posts }). When
  // baseRoutes was mounted first, GET /:id matched id="bookmarks" and 404'd.
  const bm = await app.fetch(
    new Request(`${APP_URL}/bookmarks`, { method: "GET" }),
    envFor(db),
  );
  expect(bm.status).toEqual(200);
  expect(Object.keys((await bm.json()) as object)).toContain("posts");

  // /:id still resolves to the single-post handler (404 for a missing post).
  const sp = await app.fetch(
    new Request(
      `${APP_URL}/${encodeURIComponent("https://yuru.test/ap/objects/nope")}`,
      {
        method: "GET",
      },
    ),
    envFor(db),
  );
  expect(sp.status).toEqual(404);
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

// ---------------------------------------------------------------------------
// Discovery list (GET /api/communities) must not leak private/deleted communities
// ---------------------------------------------------------------------------

test("community discovery list hides private (non-member) + deleted communities", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  await insertCommunity(db, "publicclub", { visibility: "public" });
  const priv = await insertCommunity(db, "secretclub", {
    visibility: "private",
  });

  // A soft-deleted community must never surface, regardless of visibility.
  const delApId = `${APP_URL}/ap/groups/goneclub`;
  await db.insert(communities).values({
    apId: delApId,
    preferredUsername: "goneclub",
    name: "goneclub",
    inbox: `${delApId}/inbox`,
    outbox: `${delApId}/outbox`,
    followersUrl: `${delApId}/followers`,
    visibility: "public",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: localApId("owner"),
    deletedAt: "2026-06-20T00:00:00.000Z",
  });

  // alice is a member of the private community; bob is not.
  await db.insert(communityMembers).values({
    communityApId: priv,
    actorApId: alice,
    joinedAt: "2026-06-20T00:00:00.000Z",
  });

  const listFor = async (actor: Actor | null): Promise<string[]> => {
    const app = appWith(db, actor, communitiesRouter);
    const res = await app.request(`${APP_URL}/`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { communities: { name: string }[] };
    return body.communities.map((c) => c.name);
  };

  // Anonymous: only the public community (no secret, no deleted).
  const anon = await listFor(null);
  expect(anon).toContain("publicclub");
  expect(anon).not.toContain("secretclub");
  expect(anon).not.toContain("goneclub");

  // Non-member: same — private community stays hidden.
  const nonMember = await listFor(fakeActor(bob, "bob"));
  expect(nonMember).not.toContain("secretclub");
  expect(nonMember).not.toContain("goneclub");

  // Member: sees the public AND their own private community, never the deleted one.
  const member = await listFor(fakeActor(alice, "alice"));
  expect(member).toContain("publicclub");
  expect(member).toContain("secretclub");
  expect(member).not.toContain("goneclub");
});

test("community detail redacts a private community's metadata from non-members", async () => {
  const db = await freshDb();
  const alice = await insertLocalActor(db, "alice");
  const bob = await insertLocalActor(db, "bob");

  const apId = `${APP_URL}/ap/groups/vault`;
  await db.insert(communities).values({
    apId,
    preferredUsername: "vault",
    name: "Vault",
    summary: "secret summary",
    visibility: "private",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: alice,
    memberCount: 3,
  });
  await db.insert(communityMembers).values({
    communityApId: apId,
    actorApId: alice,
    joinedAt: "2026-06-20T00:00:00.000Z",
  });

  type Detail = {
    name: string;
    visibility: string;
    summary: string | null;
    member_count: number;
    created_by: string | null;
  };
  const detailFor = async (actor: Actor | null): Promise<Detail> => {
    const app = appWith(db, actor, communitiesRouter);
    const res = await app.request(`${APP_URL}/vault`, undefined, envFor(db));
    expect(res.status).toBe(200);
    return ((await res.json()) as { community: Detail }).community;
  };

  // Non-member sees identity (so an invite page can render) but NOT the size /
  // activity / summary / owner.
  const asBob = await detailFor(fakeActor(bob, "bob"));
  expect(asBob.name).toBe("vault");
  expect(asBob.visibility).toBe("private");
  expect(asBob.summary).toBeNull();
  expect(asBob.member_count).toBe(0);
  expect(asBob.created_by).toBeNull();

  // Anonymous: same redaction.
  const asAnon = await detailFor(null);
  expect(asAnon.member_count).toBe(0);
  expect(asAnon.summary).toBeNull();

  // Member: full detail.
  const asAlice = await detailFor(fakeActor(alice, "alice"));
  expect(asAlice.summary).toBe("secret summary");
  expect(asAlice.member_count).toBe(3);
  expect(asAlice.created_by).toBe(alice);
});

test("community detail 404s a soft-deleted community", async () => {
  const db = await freshDb();
  const apId = `${APP_URL}/ap/groups/gone`;
  await db.insert(communities).values({
    apId,
    preferredUsername: "gone",
    name: "gone",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: localApId("owner"),
    deletedAt: "2026-06-20T00:00:00.000Z",
  });
  const app = appWith(db, null, communitiesRouter);
  const res = await app.request(`${APP_URL}/gone`, undefined, envFor(db));
  expect(res.status).toBe(404);
});
