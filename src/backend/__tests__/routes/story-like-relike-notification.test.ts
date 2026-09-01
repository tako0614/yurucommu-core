import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import {
  actors,
  activities,
  follows,
  inbox,
  objects,
} from "../../../db/index.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";
import type { Env, Variables } from "../../types.ts";
import storiesInteractions from "../../routes/stories/interactions.ts";
import notificationRoutes from "../../routes/notifications.ts";

// DEEP round-2 #14: a story unlike deleted only the `likes` edge + decremented
// likeCount, never reaping the inbox/activities rows the like minted. The re-like
// dedup guard checks only the `likes` edge (removed by unlike), so like→unlike→
// like minted a NEW activity id + a NEW read=0 inbox row each cycle — duplicate
// "X liked your story" + a phantom unread on the author. The unlike now reaps the
// original inbox + activities rows (mirroring the post path), making re-like
// idempotent.

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

async function insertActor(db: Database, username: string): Promise<string> {
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
  });
  return apId;
}

function appFor(db: Database, viewerApId: string) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", { ap_id: viewerApId } as never);
    await next();
  });
  app.route("/", storiesInteractions);
  return app;
}

const env = { APP_URL } as never;

test("story like -> unlike -> like does not accumulate duplicate notifications", async () => {
  const db = await freshDb();
  const author = await insertActor(db, "author");
  const liker = await insertActor(db, "liker");
  // The liker follows the author so a personal story is readable/likeable.
  await db
    .insert(follows)
    .values({ followerApId: liker, followingApId: author, status: "accepted" });

  const storyApId = `${APP_URL}/ap/objects/story1`;
  await db.insert(objects).values({
    apId: storyApId,
    type: "Story",
    attributedTo: author,
    content: "",
    visibility: "public",
    audienceJson: "[]",
    toJson: "[]",
    ccJson: "[]",
    endTime: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    likeCount: 0,
    published: new Date().toISOString(),
  });

  const app = appFor(db, liker);
  const like = () =>
    app.request(`${APP_URL}/story1/like`, { method: "POST" }, env);
  const unlike = () =>
    app.request(`${APP_URL}/story1/like`, { method: "DELETE" }, env);

  expect((await like()).status).toBe(200);
  expect((await unlike()).status).toBe(200);
  expect((await like()).status).toBe(200);

  // Exactly ONE inbox notification row for the author (not two) and ONE Like
  // activity — the unlike reaped the first cycle's rows.
  const inboxRows = await db
    .select()
    .from(inbox)
    .where(eq(inbox.actorApId, author));
  expect(inboxRows.length).toBe(1);
  expect(inboxRows[0].read).toBe(0);

  const likeActivities = await db
    .select()
    .from(activities)
    .where(eq(activities.type, "Like"));
  expect(likeActivities.length).toBe(1);

  // likeCount is back to 1 (1 -> 0 -> 1), not drifted.
  const story = await db
    .select({ likeCount: objects.likeCount })
    .from(objects)
    .where(eq(objects.apId, storyApId))
    .get();
  expect(story?.likeCount).toBe(1);

  const notificationApp = appFor(db, author);
  notificationApp.route("/notifications", notificationRoutes);
  const response = await notificationApp.request(
    `${APP_URL}/notifications`,
    { method: "GET" },
    env,
  );
  const body = (await response.json()) as {
    notifications: Array<{
      target_kind: string;
      target_id: string | null;
      target_url: string;
    }>;
  };
  expect(body.notifications[0]).toMatchObject({
    target_kind: "story",
    target_id: storyApId,
    target_url: `/?story=${encodeURIComponent(storyApId)}`,
  });
});
