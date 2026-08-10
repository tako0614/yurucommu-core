import { expect, test } from "bun:test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { actors, mediaUploads, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import type { IObjectStorage } from "../../runtime/types.ts";
import storiesRoutes from "../../routes/stories/routes.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

// Regression: an EXPLICIT story delete (POST /api/stories/delete) must reap the
// story's mandatory R2 blob + its media_uploads row, exactly like the expiry
// path (cleanupExpiredStories). It used to delete only the child rows + object
// row (deleteStoryAndRelatedData bypassed deleteObjectCascade), orphaning the
// blob in R2 forever with no orphan-key sweep to reclaim it.

const APP_URL = "https://yuru.test";

async function freshDb(): Promise<Database> {
  return (await createTestDb()).db;
}

// Minimal IObjectStorage stub that records the keys passed to delete().
function recordingStorage(): { storage: IObjectStorage; deleted: string[] } {
  const deleted: string[] = [];
  const storage = {
    async put() {},
    async get() {
      return null;
    },
    async delete(key: string | string[]) {
      for (const k of Array.isArray(key) ? key : [key]) deleted.push(k);
    },
  } as unknown as IObjectStorage;
  return { storage, deleted };
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
    post_count: 1,
    is_private: 0,
    role: "member",
    created_at: new Date().toISOString(),
  };
}

function envFor(db: Database, storage: IObjectStorage): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    MEDIA: storage,
    DELIVERY_QUEUE: { async send() {}, async sendBatch() {} },
    DELIVERY_DLQ: { async send() {}, async sendBatch() {} },
  } as unknown as Env;
}

function appWith(db: Database, actor: Actor) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db as unknown as never);
    c.set("actor", actor);
    await next();
  });
  app.route("/", storiesRoutes);
  return app;
}

test("explicit story delete reaps the story's R2 blob and media_uploads row", async () => {
  const db = await freshDb();
  const authorApId = `${APP_URL}/ap/users/tako`;
  await db.insert(actors).values({
    apId: authorApId,
    type: "Person",
    preferredUsername: "tako",
    inbox: `${authorApId}/inbox`,
    outbox: `${authorApId}/outbox`,
    followersUrl: `${authorApId}/followers`,
    followingUrl: `${authorApId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    postCount: 1,
  });

  const storyApId = `${APP_URL}/ap/objects/story-1`;
  const r2Key = "uploads/secret-story.jpg";
  await db.insert(objects).values({
    apId: storyApId,
    type: "Story",
    attributedTo: authorApId,
    content: "",
    attachmentsJson: JSON.stringify([
      {
        type: "Document",
        mediaType: "image/jpeg",
        url: "/media/secret-story.jpg",
        r2_key: r2Key,
      },
    ]),
    visibility: "public",
    published: new Date().toISOString(),
    // Active (not expired) — but delete is by ap_id, independent of expiry.
    endTime: "2999-01-01T00:00:00.000Z",
    isLocal: 0,
  });
  await db.insert(mediaUploads).values({
    id: "media-secret-story",
    r2Key,
    uploaderApId: authorApId,
    contentType: "image/jpeg",
    size: 123,
  });

  const { storage, deleted } = recordingStorage();
  const env = envFor(db, storage);
  const actor = fakeActor(authorApId, "tako");

  const res = await appWith(db, actor).fetch(
    new Request(`${APP_URL}/delete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ap_id: storyApId }),
    }),
    env,
  );
  expect(res.status).toEqual(200);

  // The R2 blob was requested for deletion (was: orphaned forever).
  expect(deleted).toContain(r2Key);

  // The media_uploads row is gone.
  const upload = await db
    .select()
    .from(mediaUploads)
    .where(eq(mediaUploads.r2Key, r2Key))
    .get();
  expect(upload).toBeUndefined();

  // The story object is gone.
  const obj = await db
    .select()
    .from(objects)
    .where(eq(objects.apId, storyApId))
    .get();
  expect(obj).toBeUndefined();
});
