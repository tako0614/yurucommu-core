import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../../db/schema.ts";
import type { Database } from "../../../../db/index.ts";
import { activities, communities, follows } from "../../../../db/index.ts";
import {
  handleGroupFollow,
  handleGroupUndo,
} from "../../../routes/activitypub/handlers/actor-inbox-handlers.ts";
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
): Promise<string> {
  const apId = `${APP_URL}/ap/groups/${name}`;
  await db.insert(communities).values({
    apId,
    preferredUsername: name,
    name,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    visibility: "public",
    joinPolicy,
    postPolicy: "members",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: `${APP_URL}/ap/users/owner`,
  });
  return apId;
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
