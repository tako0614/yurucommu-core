import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { mediaUploads } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import mediaRoutes from "../../routes/media.ts";

/**
 * POST /api/media/upload input defenses (helpers are module-private, so only a
 * full multipart round-trip covers them): auth gate, MIME allowlist (400),
 * per-type size cap (413), magic-byte / declared-type match (400, blocks a
 * non-image masquerading as image/png), and a valid PNG succeeds (200).
 */

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
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

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

// 8-byte PNG signature + a little padding so the header slice is satisfied.
const PNG_MAGIC = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49,
  0x48, 0x44, 0x52,
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
