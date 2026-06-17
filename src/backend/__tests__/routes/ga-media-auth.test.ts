import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * GA #7 (MEDIA-INDEX) — GET /media/:id authorization must use INDEXED lookups,
 * not a leading-wildcard LIKE("%...%") full-table scan over objects.attachments_json.
 *
 * This re-implementation resolves media identity by its unique indexed r2Key
 * (media_uploads_r2_key_idx -> uploaderApId) and finds the referencing object by
 * an indexed-by-author scan (objects_attributed_to_idx) + an app-side substring
 * match. The authorization OUTCOME must be unchanged:
 *   - public/unlisted media is served to anyone (incl. anonymous);
 *   - private (followers/direct) media is served only to authorized viewers;
 *   - a non-owner is denied private/unattached media.
 */

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, follows, mediaUploads, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import mediaRoutes from "../../routes/media.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
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

// Minimal in-memory R2 stub: only put/get are exercised by serveMediaByR2Key.
function memoryR2() {
  const store = new Map<string, { body: ArrayBuffer; contentType: string }>();
  return {
    async put(
      key: string,
      value: ArrayBuffer | Uint8Array,
      opts?: { httpMetadata?: { contentType?: string } },
    ) {
      const buf =
        value instanceof Uint8Array
          ? value.buffer.slice(
              value.byteOffset,
              value.byteOffset + value.byteLength,
            )
          : value;
      store.set(key, {
        body: buf as ArrayBuffer,
        contentType:
          opts?.httpMetadata?.contentType || "application/octet-stream",
      });
    },
    async get(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        body: new Blob([entry.body]).stream(),
        httpMetadata: { contentType: entry.contentType },
        httpEtag: `"etag-${key}"`,
      };
    },
  };
}

function envFor(db: Database): Env {
  return {
    APP_URL,
    DB_INSTANCE: db,
    MEDIA: memoryR2(),
  } as unknown as Env;
}

function appWith(db: Database, env: Env, actor: Actor | null) {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/media", mediaRoutes);
  return app;
}

// A valid lowercase-hex media id with an allowed extension (isValidMediaFilename).
const MEDIA_ID = "abc123";
const FILENAME = `${MEDIA_ID}.png`;
const R2_KEY = `uploads/${FILENAME}`;
const MEDIA_URL = `/media/${FILENAME}`;

// Tiny valid PNG header bytes (content is irrelevant to the auth path).
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function seedUpload(db: Database, env: Env, uploaderApId: string) {
  await (env.MEDIA as unknown as { put: (k: string, v: Uint8Array) => Promise<void> }).put(
    R2_KEY,
    PNG_BYTES,
  );
  await db.insert(mediaUploads).values({
    id: MEDIA_ID,
    r2Key: R2_KEY,
    uploaderApId,
    contentType: "image/png",
    size: PNG_BYTES.length,
  });
}

async function insertObject(
  db: Database,
  opts: {
    id: string;
    author: string;
    visibility: string;
    to?: string[];
    attachments: unknown[];
  },
) {
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/${opts.id}`,
    type: "Note",
    attributedTo: opts.author,
    content: `post ${opts.id}`,
    attachmentsJson: JSON.stringify(opts.attachments),
    visibility: opts.visibility,
    toJson: JSON.stringify(opts.to ?? []),
    ccJson: "[]",
    audienceJson: "[]",
    isLocal: 1,
  });
}

async function getMedia(
  db: Database,
  env: Env,
  viewer: Actor | null,
): Promise<Response> {
  const app = appWith(db, env, viewer);
  return app.fetch(
    new Request(`${APP_URL}/media/${FILENAME}`, { method: "GET" }),
    env,
  );
}

test("public media attached to a public post is served to anonymous viewers", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const author = await insertLocalActor(db, "alice");
  await seedUpload(db, env, author);
  await insertObject(db, {
    id: "p1",
    author,
    visibility: "public",
    attachments: [{ type: "Image", url: MEDIA_URL, r2_key: R2_KEY }],
  });

  const res = await getMedia(db, env, null);
  expect(res.status).toEqual(200);
  expect(res.headers.get("Cache-Control")).toContain("public");
});

test("private (followers-only) media is DENIED to a non-owner non-follower", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const author = await insertLocalActor(db, "alice");
  await insertLocalActor(db, "mallory");
  await seedUpload(db, env, author);
  await insertObject(db, {
    id: "p2",
    author,
    visibility: "followers",
    attachments: [{ type: "Image", url: MEDIA_URL, r2_key: R2_KEY }],
  });

  const mallory = fakeActor(localApId("mallory"), "mallory");
  const res = await getMedia(db, env, mallory);
  expect(res.status).toEqual(403);
});

test("private (followers-only) media is served to an accepted follower and to the author", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const author = await insertLocalActor(db, "alice");
  const followerApId = await insertLocalActor(db, "bob");
  await seedUpload(db, env, author);
  await insertObject(db, {
    id: "p3",
    author,
    visibility: "followers",
    attachments: [{ type: "Image", url: MEDIA_URL, r2_key: R2_KEY }],
  });
  await db.insert(follows).values({
    followerApId,
    followingApId: author,
    status: "accepted",
  });

  const follower = fakeActor(followerApId, "bob");
  const followerRes = await getMedia(db, env, follower);
  expect(followerRes.status).toEqual(200);
  expect(followerRes.headers.get("Cache-Control")).toContain("private");

  const authorRes = await getMedia(db, env, fakeActor(author, "alice"));
  expect(authorRes.status).toEqual(200);
});

test("direct media is served only to addressed recipients", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const author = await insertLocalActor(db, "alice");
  const recipientApId = await insertLocalActor(db, "carol");
  await insertLocalActor(db, "dave");
  await seedUpload(db, env, author);
  await insertObject(db, {
    id: "p4",
    author,
    visibility: "direct",
    to: [recipientApId],
    attachments: [{ type: "Image", url: MEDIA_URL, r2_key: R2_KEY }],
  });

  const recipientRes = await getMedia(db, env, fakeActor(recipientApId, "carol"));
  expect(recipientRes.status).toEqual(200);

  const outsiderRes = await getMedia(db, env, fakeActor(localApId("dave"), "dave"));
  expect(outsiderRes.status).toEqual(403);
});

test("unattached media is served only to its uploader; others denied/unauthorized", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const uploader = await insertLocalActor(db, "alice");
  await insertLocalActor(db, "mallory");
  await seedUpload(db, env, uploader);
  // No referencing object exists.

  const uploaderRes = await getMedia(db, env, fakeActor(uploader, "alice"));
  expect(uploaderRes.status).toEqual(200);
  expect(uploaderRes.headers.get("Cache-Control")).toContain("private");

  const otherRes = await getMedia(db, env, fakeActor(localApId("mallory"), "mallory"));
  expect(otherRes.status).toEqual(403);

  const anonRes = await getMedia(db, env, null);
  expect(anonRes.status).toEqual(403);
});

test("no full-table LIKE scan path remains in media authorization", async () => {
  // The fix must not reintroduce a leading-wildcard LIKE over attachments_json.
  // Assert statically that the route source contains no such scan and instead
  // relies on the indexed media_uploads + objects.attributed_to lookups.
  const src = await readFile(
    new URL("../../routes/media.ts", import.meta.url),
    "utf8",
  );
  // No drizzle `like(...)` operator anywhere (the old scan used like()).
  expect(src).not.toMatch(/\blike\s*\(/);
  // The leading-wildcard substring pattern must be gone.
  expect(src).not.toContain('"%" +');
  // The indexed identity lookup by r2Key must be present.
  expect(src).toContain("eq(mediaUploads.r2Key, r2Key)");
  expect(src).toContain("eq(objects.attributedTo, uploaderApId)");
});
