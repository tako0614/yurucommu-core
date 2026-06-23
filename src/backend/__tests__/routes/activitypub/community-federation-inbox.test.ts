import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../../db/schema.ts";
import type { Database } from "../../../../db/index.ts";
import {
  activities,
  communities,
  communityMembers,
  follows,
  objectRecipients,
  objects,
} from "../../../../db/index.ts";
import {
  handleGroupCreate,
  handleGroupFollow,
  handleGroupUndo,
} from "../../../routes/activitypub/handlers/actor-inbox-handlers.ts";
import { canViewerReadObject } from "../../../lib/community-visibility.ts";
import type { InstanceActorResult } from "../../../routes/activitypub/query-helpers.ts";
import type {
  ActivityContext,
  Activity,
} from "../../../routes/activitypub/inbox-types.ts";

const APP_URL = "https://yuru.test";
const REMOTE = "https://remote.example/users/alice";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../../migrations/", import.meta.url);
  const files = (await readdir(root)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertCommunity(
  db: Database,
  name: string,
  joinPolicy: "open" | "approval",
  opts: {
    visibility?: "public" | "private";
    postPolicy?: "anyone" | "members" | "mods" | "owners";
    deletedAt?: string | null;
  } = {},
): Promise<string> {
  const apId = `${APP_URL}/ap/groups/${name}`;
  await db.insert(communities).values({
    apId,
    preferredUsername: name,
    name,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility: opts.visibility ?? "public",
    joinPolicy,
    postPolicy: opts.postPolicy ?? "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: `${APP_URL}/ap/users/owner`,
    deletedAt: opts.deletedAt ?? null,
  });
  return apId;
}

// The instance Group actor: handleGroupCreate receives it but no longer
// authorizes against it (the gate is community-scoped). postingPolicy="anyone"
// here proves the OLD instance-wide gate would have admitted the spoof.
const INSTANCE_ACTOR = {
  apId: `${APP_URL}/ap/actor`,
  postingPolicy: "anyone",
} as unknown as InstanceActorResult;

function groupCreate(communityApId: string, content: string, n = 1): Activity {
  return {
    type: "Create",
    actor: REMOTE,
    object: {
      type: "Note",
      id: `https://remote.example/notes/${n}`,
      content,
      room: `${APP_URL}/ap/rooms/${communityApId.split("/").pop()}`,
    },
  } as unknown as Activity;
}

async function chatMessages(db: Database, communityApId: string) {
  return db
    .select({ objectApId: objectRecipients.objectApId })
    .from(objectRecipients)
    .where(
      and(
        eq(objectRecipients.recipientApId, communityApId),
        eq(objectRecipients.type, "audience"),
      ),
    )
    .all();
}

async function acceptMember(db: Database, communityApId: string) {
  await db.insert(follows).values({
    followerApId: REMOTE,
    followingApId: communityApId,
    status: "accepted",
    activityApId: "https://remote.example/activities/join",
    acceptedAt: new Date().toISOString(),
  });
}

// No queue binding → enqueueDeliveryToActor is a no-op (sendQueueMessage returns
// early when the producer is unavailable), so the Accept activity ROW is still
// written and assertable without a real queue.
function ctx(db: Database): ActivityContext {
  return {
    get: (k: string) => (k === "db" ? db : undefined),
    env: { APP_URL, DB_INSTANCE: db },
  } as unknown as ActivityContext;
}

test("a remote Follow to an OPEN community is accepted + an Accept is emitted by the group", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "club", "open");
  const activityId = "https://remote.example/activities/follow-1";
  const activity = {
    type: "Follow",
    actor: REMOTE,
    object: apId,
    id: activityId,
  } as unknown as Activity;

  await handleGroupFollow(
    ctx(db),
    activity,
    { apId, joinPolicy: "open" },
    REMOTE,
    APP_URL,
    activityId,
  );

  const follow = await db.query.follows.findFirst({
    where: and(
      eq(follows.followerApId, REMOTE),
      eq(follows.followingApId, apId),
    ),
  });
  expect(follow?.status).toEqual("accepted");

  const accept = await db.query.activities.findFirst({
    where: and(
      eq(activities.type, "Accept"),
      eq(activities.actorApId, apId),
      eq(activities.objectApId, activityId),
    ),
  });
  expect(accept).toBeTruthy();
  expect(accept?.direction).toEqual("outbound");
});

test("a RETRIED Follow re-attempts the Accept without duplicating it (lost-Accept recovery)", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "club", "open");
  const activityId = "https://remote.example/activities/follow-retry";
  const activity = {
    type: "Follow",
    actor: REMOTE,
    object: apId,
    id: activityId,
  } as unknown as Activity;
  const run = () =>
    handleGroupFollow(
      ctx(db),
      activity,
      { apId, joinPolicy: "open" },
      REMOTE,
      APP_URL,
      activityId,
    );

  await run();
  await run(); // a retry (e.g. our first Accept was lost) must not early-return

  // Exactly ONE Accept activity exists (idempotent), and the follow is accepted.
  const accepts = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(and(eq(activities.type, "Accept"), eq(activities.actorApId, apId)))
    .all();
  expect(accepts.length).toEqual(1);
  const follow = await db.query.follows.findFirst({
    where: and(
      eq(follows.followerApId, REMOTE),
      eq(follows.followingApId, apId),
    ),
  });
  expect(follow?.status).toEqual("accepted");
});

test("a Follow to an APPROVAL community is held pending (no Accept emitted)", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "gated", "approval");
  const activityId = "https://remote.example/activities/follow-2";
  const activity = {
    type: "Follow",
    actor: REMOTE,
    object: apId,
    id: activityId,
  } as unknown as Activity;

  await handleGroupFollow(
    ctx(db),
    activity,
    { apId, joinPolicy: "approval" },
    REMOTE,
    APP_URL,
    activityId,
  );

  const follow = await db.query.follows.findFirst({
    where: and(
      eq(follows.followerApId, REMOTE),
      eq(follows.followingApId, apId),
    ),
  });
  // The pending follows edge IS the remote join request (audit #18): it is what
  // the manager approval surface reads + accepts (a remote follower has no
  // `actors` row, so it cannot be mirrored into community_join_requests).
  expect(follow?.status).toEqual("pending");

  const accept = await db.query.activities.findFirst({
    where: and(eq(activities.actorApId, apId), eq(activities.type, "Accept")),
  });
  expect(accept).toBeUndefined();
});

test("Undo(Follow) removes the community membership", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "club", "open");
  const activityId = "https://remote.example/activities/follow-3";
  await handleGroupFollow(
    ctx(db),
    {
      type: "Follow",
      actor: REMOTE,
      object: apId,
      id: activityId,
    } as unknown as Activity,
    { apId, joinPolicy: "open" },
    REMOTE,
    APP_URL,
    activityId,
  );
  expect(
    await db.query.follows.findFirst({
      where: and(
        eq(follows.followerApId, REMOTE),
        eq(follows.followingApId, apId),
      ),
    }),
  ).toBeTruthy();

  await handleGroupUndo(
    ctx(db),
    {
      type: "Undo",
      actor: REMOTE,
      object: { type: "Follow", id: activityId },
    } as unknown as Activity,
    { apId, joinPolicy: "open" },
    REMOTE,
  );

  expect(
    await db.query.follows.findFirst({
      where: and(
        eq(follows.followerApId, REMOTE),
        eq(follows.followingApId, apId),
      ),
    }),
  ).toBeUndefined();
});

test("a forged Undo from a DIFFERENT actor cannot sever a victim's follow", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "club", "open");
  const victimActivityId = "https://remote.example/activities/follow-victim";
  // Victim (REMOTE) follows the community.
  await handleGroupFollow(
    ctx(db),
    {
      type: "Follow",
      actor: REMOTE,
      object: apId,
      id: victimActivityId,
    } as unknown as Activity,
    { apId, joinPolicy: "open" },
    REMOTE,
    APP_URL,
    victimActivityId,
  );

  // Attacker on a different domain signs an Undo referencing the victim's
  // (public) Follow activity id. The signer is the attacker, NOT the victim.
  await handleGroupUndo(
    ctx(db),
    {
      type: "Undo",
      actor: "https://evil.example/users/mallory",
      object: { type: "Follow", id: victimActivityId },
    } as unknown as Activity,
    { apId, joinPolicy: "open" },
    "https://evil.example/users/mallory",
  );

  // The victim's follow MUST survive — the forged Undo is ignored.
  expect(
    await db.query.follows.findFirst({
      where: and(
        eq(follows.followerApId, REMOTE),
        eq(follows.followingApId, apId),
      ),
    }),
  ).toBeTruthy();
});

// --- handleGroupCreate authorization (community-scoped, not instance-scoped) ---

test("a non-member's group Create into a PRIVATE community is REJECTED (no spoof injection)", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "secret", "approval", {
    visibility: "private",
  });
  // REMOTE is NOT a member of `secret`. With INSTANCE_ACTOR.postingPolicy
  // "anyone", the OLD instance-scoped gate would have admitted this.
  await handleGroupCreate(
    ctx(db),
    groupCreate(apId, "spoofed private msg"),
    INSTANCE_ACTOR,
    REMOTE,
    APP_URL,
  );

  expect((await db.select().from(objects).all()).length).toBe(0);
  expect((await chatMessages(db, apId)).length).toBe(0);
});

test("a non-member's group Create into a members-policy PUBLIC community is REJECTED", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "club", "open"); // postPolicy members
  await handleGroupCreate(
    ctx(db),
    groupCreate(apId, "non-member msg"),
    INSTANCE_ACTOR,
    REMOTE,
    APP_URL,
  );
  expect((await db.select().from(objects).all()).length).toBe(0);
  expect((await chatMessages(db, apId)).length).toBe(0);
});

test("an ACCEPTED member's group Create IS inserted + audience-linked to the community", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "club", "open");
  await acceptMember(db, apId); // REMOTE is now an accepted member of `club`

  await handleGroupCreate(
    ctx(db),
    groupCreate(apId, "legit member msg"),
    INSTANCE_ACTOR,
    REMOTE,
    APP_URL,
  );

  const inserted = await db.query.objects.findFirst({
    where: eq(objects.apId, "https://remote.example/notes/1"),
  });
  expect(inserted?.content).toBe("legit member msg");
  expect(inserted?.visibility).toBe("group");
  const audience = await chatMessages(db, apId);
  expect(audience.length).toBe(1);
  expect(audience[0]?.objectApId).toBe("https://remote.example/notes/1");
});

test("a federated group-chat message in a PRIVATE community is read-gated (anon + non-member denied, local member allowed)", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "vault", "open", {
    visibility: "private",
  });
  await acceptMember(db, apId); // REMOTE is an accepted (remote) member
  await handleGroupCreate(
    ctx(db),
    groupCreate(apId, "secret member chat"),
    INSTANCE_ACTOR,
    REMOTE,
    APP_URL,
  );

  const obj = await db
    .select({
      visibility: objects.visibility,
      communityApId: objects.communityApId,
      audienceJson: objects.audienceJson,
    })
    .from(objects)
    .where(eq(objects.apId, "https://remote.example/notes/1"))
    .get();
  expect(obj).toBeTruthy();
  // The fix records the community in audienceJson, so the canonical read-gate
  // fires. /api/posts/:id serves LOCAL actors, so the gate keys on local
  // communityMembers: an anonymous caller and a local non-member are DENIED.
  expect(await canViewerReadObject(db, obj!, null)).toBe(false);
  expect(
    await canViewerReadObject(db, obj!, `${APP_URL}/ap/users/nobody`),
  ).toBe(false);

  // A LOCAL accepted member can read it. (Seed the actor row first — the
  // community_members FK to actors is enforced by the in-memory DB.)
  const insider = `${APP_URL}/ap/users/insider`;
  await db.insert(schema.actors).values({
    apId: insider,
    type: "Person",
    preferredUsername: "insider",
    inbox: `${insider}/inbox`,
    outbox: `${insider}/outbox`,
    followersUrl: `${insider}/followers`,
    followingUrl: `${insider}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(communityMembers).values({
    communityApId: apId,
    actorApId: insider,
    role: "member",
  });
  expect(
    await canViewerReadObject(db, obj!, `${APP_URL}/ap/users/insider`),
  ).toBe(true);
});

test("a group Create into a SOFT-DELETED community is REJECTED even from a member", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "gone", "open", {
    deletedAt: new Date().toISOString(),
  });
  await acceptMember(db, apId);
  await handleGroupCreate(
    ctx(db),
    groupCreate(apId, "into a tombstoned community"),
    INSTANCE_ACTOR,
    REMOTE,
    APP_URL,
  );
  expect((await db.select().from(objects).all()).length).toBe(0);
  expect((await chatMessages(db, apId)).length).toBe(0);
});

test("a non-member CAN post to a postPolicy=anyone PUBLIC community (gate is community-scoped)", async () => {
  const db = await freshDb();
  const apId = await insertCommunity(db, "open-mic", "open", {
    postPolicy: "anyone",
  });
  // No membership for REMOTE — but the COMMUNITY's own policy is "anyone".
  await handleGroupCreate(
    ctx(db),
    groupCreate(apId, "anyone-policy msg"),
    INSTANCE_ACTOR,
    REMOTE,
    APP_URL,
  );
  const audience = await chatMessages(db, apId);
  expect(audience.length).toBe(1);
});
