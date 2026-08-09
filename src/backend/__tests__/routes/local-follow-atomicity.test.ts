import { expect, test } from "bun:test";
import { readFile, readdir } from "node:fs/promises";
import { and, eq, sql } from "drizzle-orm";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { activities, actors, follows, inbox } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import followRoutes from "../../routes/follow.ts";

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  const files = (await readdir(root))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  for (const file of files) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

async function insertActor(
  db: Database,
  username: string,
  isPrivate: number,
): Promise<string> {
  const apId = `${APP_URL}/ap/users/${username}`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: username,
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "public",
    privateKeyPem: "private",
    isPrivate,
  });
  return apId;
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

async function postFollow(
  db: Database,
  followerApId: string,
  targetApId: string,
) {
  return appAs(db, { ap_id: followerApId } as Actor).fetch(
    new Request(`${APP_URL}/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target_ap_id: targetApId }),
    }),
    { APP_URL, DB_INSTANCE: db } as Env,
  );
}

async function stateOf(db: Database, followerApId: string, targetApId: string) {
  const edge = await db
    .select({ status: follows.status })
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, followerApId),
        eq(follows.followingApId, targetApId),
      ),
    )
    .get();
  const follower = await db
    .select({ count: actors.followingCount })
    .from(actors)
    .where(eq(actors.apId, followerApId))
    .get();
  const target = await db
    .select({ count: actors.followerCount })
    .from(actors)
    .where(eq(actors.apId, targetApId))
    .get();
  const activityRows = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(eq(activities.type, "Follow"));
  const inboxRows = await db
    .select({ activityApId: inbox.activityApId })
    .from(inbox)
    .where(eq(inbox.actorApId, targetApId));
  return {
    edgeStatus: edge?.status ?? null,
    followerFollowingCount: follower?.count ?? null,
    targetFollowerCount: target?.count ?? null,
    activities: activityRows.length,
    inbox: inboxRows.length,
  };
}

async function exerciseFailure(
  failure: "activity" | "inbox",
  isPrivate: number,
) {
  const db = await freshDb();
  const followerApId = await insertActor(db, `${failure}-alice`, 0);
  const targetApId = await insertActor(db, `${failure}-bob`, isPrivate);
  const triggerName = `reject_local_follow_${failure}`;
  if (failure === "activity") {
    await db.run(
      sql.raw(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON activities
      WHEN NEW.type = 'Follow' AND NEW.direction = 'local'
      BEGIN
        SELECT RAISE(ABORT, 'simulated local Follow activity failure');
      END
    `),
    );
  } else {
    await db.run(
      sql.raw(`
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON inbox
      BEGIN
        SELECT RAISE(ABORT, 'simulated local Follow inbox failure');
      END
    `),
    );
  }

  const first = await postFollow(db, followerApId, targetApId);
  const afterFailure = await stateOf(db, followerApId, targetApId);
  await db.run(sql.raw(`DROP TRIGGER ${triggerName}`));
  const retry = await postFollow(db, followerApId, targetApId);
  const afterRetry = await stateOf(db, followerApId, targetApId);
  const duplicate = await postFollow(db, followerApId, targetApId);
  const afterDuplicate = await stateOf(db, followerApId, targetApId);

  return {
    firstStatus: first.status,
    afterFailure,
    retryStatus: retry.status,
    afterRetry,
    duplicateStatus: duplicate.status,
    afterDuplicate,
  };
}

test("local Follow rolls back the relationship when activity or inbox storage fails", async () => {
  const publicTarget = await exerciseFailure("activity", 0);
  const privateTarget = await exerciseFailure("inbox", 1);

  expect({ publicTarget, privateTarget }).toEqual({
    publicTarget: {
      firstStatus: 500,
      afterFailure: {
        edgeStatus: null,
        followerFollowingCount: 0,
        targetFollowerCount: 0,
        activities: 0,
        inbox: 0,
      },
      retryStatus: 200,
      afterRetry: {
        edgeStatus: "accepted",
        followerFollowingCount: 1,
        targetFollowerCount: 1,
        activities: 1,
        inbox: 1,
      },
      duplicateStatus: 400,
      afterDuplicate: {
        edgeStatus: "accepted",
        followerFollowingCount: 1,
        targetFollowerCount: 1,
        activities: 1,
        inbox: 1,
      },
    },
    privateTarget: {
      firstStatus: 500,
      afterFailure: {
        edgeStatus: null,
        followerFollowingCount: 0,
        targetFollowerCount: 0,
        activities: 0,
        inbox: 0,
      },
      retryStatus: 200,
      afterRetry: {
        edgeStatus: "pending",
        followerFollowingCount: 0,
        targetFollowerCount: 0,
        activities: 1,
        inbox: 1,
      },
      duplicateStatus: 400,
      afterDuplicate: {
        edgeStatus: "pending",
        followerFollowingCount: 0,
        targetFollowerCount: 0,
        activities: 1,
        inbox: 1,
      },
    },
  });
});
