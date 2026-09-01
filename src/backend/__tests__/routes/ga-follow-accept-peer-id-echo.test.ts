import { expect, test } from "bun:test";
import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";

import type { Database } from "../../../db/index.ts";
import { activities, actors, follows } from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import followRoutes from "../../routes/follow.ts";

/**
 * A manual Accept/Reject of a REMOTE follow request must reference the Follow
 * id the PEER minted, not our origin-bound internal `.../inbound-<hash>` id.
 *
 * The inbox stamps `activity.id` with the internal id before dispatch (so no
 * remote string escapes into internal keys), and handleFollow persists that
 * internal id on the follows edge. The auto-accept path already echoes the
 * peer's bounded protocol id (sourceActivityId), but the manual approval
 * surfaces (POST /accept, /accept/batch, /reject and the community
 * counterpart) sent the edge's stored INTERNAL id. The peer's handleAccept
 * looks up its own Follow by that id, finds nothing, and silently returns —
 * so an approval-mode account could never be followed cross-server: the
 * follower's edge stayed `pending` forever while ours said `accepted`.
 *
 * The fix resolves the peer-facing id from the retained inbound envelope
 * (activities.raw_json), echoing it only when it is a bounded, safe HTTP(S)
 * id on the requester's exact origin — the same trust rule the inbox applies
 * inbound.
 */

const APP_URL = "https://yuru.test";
const REMOTE_ORIGIN = "https://peer.example";
const REMOTE_ACTOR = `${REMOTE_ORIGIN}/ap/users/alice`;
const REMOTE_FOLLOW_WIRE_ID = `${REMOTE_ORIGIN}/ap/activities/follow-123`;
// Shape the inbox's internalInboundActivityId produces for inbound envelopes.
const INTERNAL_FOLLOW_ID = `${APP_URL}/ap/activities/inbound-${"ab".repeat(32)}`;

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

async function insertActor(db: Database, username: string, isPrivate = 1) {
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

function actorObj(apId: string): Actor {
  return { ap_id: apId, preferred_username: apId.split("/").pop() } as Actor;
}

function appAs(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/", followRoutes);
  return app;
}

const ENV = { APP_URL } as unknown as Env;

/**
 * Seed the state the inbox leaves behind for a pending remote follow: the
 * follows edge keyed by the INTERNAL activity id, plus the retained inbound
 * envelope (raw_json carries the peer's wire id).
 */
async function seedPendingRemoteFollow(
  db: Database,
  recipientApId: string,
  wireId: string | null = REMOTE_FOLLOW_WIRE_ID,
) {
  await db.insert(follows).values({
    followerApId: REMOTE_ACTOR,
    followingApId: recipientApId,
    status: "pending",
    activityApId: INTERNAL_FOLLOW_ID,
    acceptedAt: null,
  });
  const envelope: Record<string, unknown> = {
    "@context": "https://www.w3.org/ns/activitystreams",
    type: "Follow",
    actor: REMOTE_ACTOR,
    object: recipientApId,
  };
  if (wireId !== null) envelope.id = wireId;
  await db.insert(activities).values({
    apId: INTERNAL_FOLLOW_ID,
    type: "Follow",
    actorApId: REMOTE_ACTOR,
    objectApId: recipientApId,
    rawJson: JSON.stringify(envelope),
    direction: "inbound",
  });
}

async function latestOutbound(db: Database, type: string) {
  const row = await db
    .select()
    .from(activities)
    .where(and(eq(activities.type, type), eq(activities.direction, "outbound")))
    .orderBy(desc(activities.createdAt))
    .get();
  expect(row).toBeTruthy();
  return {
    objectApId: row!.objectApId,
    object: (JSON.parse(row!.rawJson ?? "{}") as { object?: unknown }).object,
  };
}

test("manual /accept echoes the peer's wire Follow id, not the internal id", async () => {
  const db = await freshDb();
  const recipient = await insertActor(db, "bob");
  await seedPendingRemoteFollow(db, recipient);

  const app = appAs(db, actorObj(recipient));
  const res = await app.request(
    "/accept",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_id: REMOTE_ACTOR }),
    },
    ENV,
  );
  expect(res.status).toBe(200);

  const accept = await latestOutbound(db, "Accept");
  expect(accept.object).toBe(REMOTE_FOLLOW_WIRE_ID);
  expect(accept.objectApId).toBe(REMOTE_FOLLOW_WIRE_ID);

  const edge = await db
    .select()
    .from(follows)
    .where(eq(follows.followerApId, REMOTE_ACTOR))
    .get();
  expect(edge?.status).toBe("accepted");
});

test("manual /accept/batch echoes the peer's wire Follow id", async () => {
  const db = await freshDb();
  const recipient = await insertActor(db, "carol");
  await seedPendingRemoteFollow(db, recipient);

  const app = appAs(db, actorObj(recipient));
  const res = await app.request(
    "/accept/batch",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_ids: [REMOTE_ACTOR] }),
    },
    ENV,
  );
  expect(res.status).toBe(200);

  const accept = await latestOutbound(db, "Accept");
  expect(accept.object).toBe(REMOTE_FOLLOW_WIRE_ID);
});

test("manual /reject echoes the peer's wire Follow id", async () => {
  const db = await freshDb();
  const recipient = await insertActor(db, "dave");
  await seedPendingRemoteFollow(db, recipient);

  const app = appAs(db, actorObj(recipient));
  const res = await app.request(
    "/reject",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_id: REMOTE_ACTOR }),
    },
    ENV,
  );
  expect(res.status).toBe(200);

  const reject = await latestOutbound(db, "Reject");
  expect(reject.object).toBe(REMOTE_FOLLOW_WIRE_ID);
});

test("an envelope id on a foreign origin is NOT echoed (falls back to stored id)", async () => {
  const db = await freshDb();
  const recipient = await insertActor(db, "erin");
  // Attacker-shaped envelope: id claims a third origin the requester does not
  // control. Echoing it would let a peer plant ids for other servers.
  await seedPendingRemoteFollow(
    db,
    recipient,
    "https://third-party.example/ap/activities/not-yours",
  );

  const app = appAs(db, actorObj(recipient));
  const res = await app.request(
    "/accept",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_id: REMOTE_ACTOR }),
    },
    ENV,
  );
  expect(res.status).toBe(200);

  const accept = await latestOutbound(db, "Accept");
  expect(accept.object).toBe(INTERNAL_FOLLOW_ID);
});

for (const [label, unsafeWireId] of [
  [
    "scheme-downgraded",
    "http://peer.example/ap/activities/not-the-same-origin",
  ],
  ["non-HTTP", "ftp://peer.example/ap/activities/not-http"],
  [
    "credential-bearing",
    "https://alice:secret@peer.example/ap/activities/credential-leak",
  ],
] as const) {
  test(`a ${label} same-host envelope id is NOT echoed`, async () => {
    const db = await freshDb();
    const recipient = await insertActor(db, "unsafe-id-target");
    await seedPendingRemoteFollow(db, recipient, unsafeWireId);

    const app = appAs(db, actorObj(recipient));
    const res = await app.request(
      "/accept",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ requester_ap_id: REMOTE_ACTOR }),
      },
      ENV,
    );
    expect(res.status).toBe(200);

    const accept = await latestOutbound(db, "Accept");
    expect(accept.object).toBe(INTERNAL_FOLLOW_ID);
  });
}

test("an envelope without an id falls back to the stored id", async () => {
  const db = await freshDb();
  const recipient = await insertActor(db, "frank");
  await seedPendingRemoteFollow(db, recipient, null);

  const app = appAs(db, actorObj(recipient));
  const res = await app.request(
    "/accept",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ requester_ap_id: REMOTE_ACTOR }),
    },
    ENV,
  );
  expect(res.status).toBe(200);

  const accept = await latestOutbound(db, "Accept");
  expect(accept.object).toBe(INTERNAL_FOLLOW_ID);
});
