import { expect, test } from "bun:test";
import { Hono } from "hono";

import type { Database } from "../../../db/index.ts";
import {
  actors,
  mediaUploadAttempts,
  mediaUploads,
} from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import mediaRoutes from "../../routes/media.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

/**
 * POST /api/media/upload input defenses (helpers are module-private, so only a
 * full multipart round-trip covers them): auth gate, MIME allowlist (400),
 * per-type size cap (413), magic-byte / declared-type match (400, blocks a
 * non-image masquerading as image/png), and a valid PNG succeeds (200).
 */

const APP_URL = "https://yuru.test";

function fakeActor(): Actor {
  const apId = `${APP_URL}/ap/users/tako`;
  return {
    ap_id: apId,
    type: "Person",
    preferred_username: "tako",
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
    role: "owner",
    created_at: new Date().toISOString(),
  } as unknown as Actor;
}

async function freshDbWithClient() {
  const testDb = await createTestDb();
  const actor = fakeActor();
  await testDb.db.insert(actors).values({
    apId: actor.ap_id,
    type: actor.type,
    preferredUsername: actor.preferred_username,
    inbox: actor.inbox,
    outbox: actor.outbox,
    followersUrl: actor.followers_url,
    followingUrl: actor.following_url,
    publicKeyPem: actor.public_key_pem,
    privateKeyPem: actor.private_key_pem,
    takosUserId: actor.takos_user_id,
    role: actor.role,
    createdAt: actor.created_at,
  });
  return testDb;
}

async function freshDb(): Promise<Database> {
  return (await freshDbWithClient()).db;
}

function memoryR2() {
  return {
    async put() {},
    async get() {
      return null;
    },
  };
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db, MEDIA: memoryR2() } as unknown as Env;
}

function appWith(db: Database, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/media", mediaRoutes);
  return app;
}

async function upload(
  db: Database,
  actor: Actor | null,
  file: File | null,
): Promise<Response> {
  const form = new FormData();
  if (file) form.set("file", file);
  return appWith(db, actor).fetch(
    new Request(`${APP_URL}/media/upload`, { method: "POST", body: form }),
    envFor(db),
  );
}

// Complete 1x1 PNG, including IDAT and IEND. The ingest parser intentionally
// rejects truncated containers instead of publishing bytes it could not audit.
const PNG_MAGIC = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x04,
  0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c, 0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44,
  0x41, 0x54, 0x78, 0xda, 0x63, 0x64, 0xf8, 0x0f, 0x00, 0x01, 0x05, 0x01, 0x01,
  0x27, 0x18, 0xe3, 0x66, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

test("rejects an unauthenticated upload (401)", async () => {
  const db = await freshDb();
  const res = await upload(
    db,
    null,
    new File([PNG_MAGIC], "x.png", { type: "image/png" }),
  );
  expect(res.status).toBe(401);
});

test("rejects a missing file (400)", async () => {
  const db = await freshDb();
  const res = await upload(db, fakeActor(), null);
  expect(res.status).toBe(400);
});

test("rejects a disallowed MIME type (400)", async () => {
  const db = await freshDb();
  const res = await upload(
    db,
    fakeActor(),
    new File([new Uint8Array([1, 2, 3, 4])], "x.pdf", {
      type: "application/pdf",
    }),
  );
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error?: string }).error).toBe(
    "Invalid file type",
  );
});

test("rejects content that does not match the declared type (magic-byte spoof, 400)", async () => {
  const db = await freshDb();
  // Declared image/png but the bytes are not a PNG.
  const res = await upload(
    db,
    fakeActor(),
    new File([new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05])], "x.png", {
      type: "image/png",
    }),
  );
  expect(res.status).toBe(400);
});

test("rejects an oversize image (413)", async () => {
  const db = await freshDb();
  // > MAX_IMAGE_SIZE (20MB); the size gate trips before any content is read.
  const big = new File([new Uint8Array(21 * 1024 * 1024)], "big.png", {
    type: "image/png",
  });
  const res = await upload(db, fakeActor(), big);
  expect(res.status).toBe(413);
});

test("cleans the R2 blob and attempt when ownership adoption fails", async () => {
  // Keep the collision/admission proof available, then fail metadata adoption
  // after the put succeeds. Dropping the table would now fail the pre-put
  // collision trigger and never exercise compensation after storage writes.
  const { db, client } = await freshDbWithClient();
  await client.execute(`CREATE TRIGGER fail_upload_adoption BEFORE INSERT ON media_uploads
    BEGIN SELECT RAISE(ABORT, 'synthetic adoption failure'); END`);

  const put: string[] = [];
  const deleted: string[] = [];
  const recordingMedia = {
    async put(key: string) {
      put.push(key);
    },
    async get() {
      return null;
    },
    async delete(key: string) {
      deleted.push(key);
    },
  };
  const env = {
    APP_URL,
    DB_INSTANCE: db,
    MEDIA: recordingMedia,
  } as unknown as Env;

  const form = new FormData();
  form.set("file", new File([PNG_MAGIC], "x.png", { type: "image/png" }));
  const res = await appWith(db, fakeActor()).fetch(
    new Request(`${APP_URL}/media/upload`, { method: "POST", body: form }),
    env,
  );

  // The adoption failed → 500; exactly the key that was put was deleted and
  // no stale attempt blocks account deletion.
  expect(res.status).toBe(500);
  expect(put.length).toBe(1);
  expect(deleted).toEqual(put);
  expect(await db.select().from(mediaUploadAttempts)).toHaveLength(0);
});

test("accepts a valid PNG and records it (200)", async () => {
  const db = await freshDb();
  const res = await upload(
    db,
    fakeActor(),
    new File([PNG_MAGIC], "x.png", { type: "image/png" }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    url?: string;
    content_type?: string;
    id?: string;
  };
  expect(body.content_type).toBe("image/png");
  expect(body.url).toMatch(/^\/media\/[a-f0-9]+\.png$/);

  // The ownership row was recorded.
  const rows = await db.select().from(mediaUploads).all();
  expect(rows.length).toBe(1);
  expect(rows[0]?.contentType).toBe("image/png");
});

test("passes the original video File to object storage", async () => {
  const db = await freshDb();
  const puts: Array<{
    value: unknown;
    options: Parameters<ObjectStore["put"]>[2];
  }> = [];
  const media: ObjectStore = {
    async put(_key, value, options) {
      puts.push({ value, options });
    },
    async get() {
      return null;
    },
    async delete() {},
  };
  const file = new File(
    [new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x00, 0x01])],
    "clip.webm",
    { type: "video/webm" },
  );
  const form = new FormData();
  form.set("file", file);
  const res = await appWith(db, fakeActor()).fetch(
    new Request(`${APP_URL}/media/upload`, { method: "POST", body: form }),
    { APP_URL, DB_INSTANCE: db, MEDIA: media } as unknown as Env,
  );

  expect(res.status).toBe(200);
  expect(puts).toHaveLength(1);
  expect(puts[0]?.value).toBeInstanceOf(File);
  expect((puts[0]?.value as File).name).toBe(file.name);
  expect((puts[0]?.value as File).type).toBe(file.type);
  expect((puts[0]?.value as File).size).toBe(file.size);
  expect(await (puts[0]?.value as File).arrayBuffer()).toEqual(
    await file.arrayBuffer(),
  );
  expect(puts[0]?.options?.contentType).toBe("video/webm");
});
