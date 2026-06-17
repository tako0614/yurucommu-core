import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

/**
 * [Round5 LOW] Composite feed cursor separator.
 *
 * The public/community/following feed cursor encodes the last row of a page as
 * `${published}${SEP}${apId}` and `decodeFeedCursor` splits on the FIRST
 * occurrence of `SEP`. The doc comment promised a NUL separator precisely
 * because NUL cannot appear in an ISO timestamp or an http(s) ap_id, but the
 * constant had regressed to a space.
 *
 * A federated Note whose remote `object.published` is a non-xsd:dateTime string
 * containing a literal space (e.g. "2026-06-17 13:00:00", stored verbatim by
 * inbox-content-handlers) would then be split at the space INSIDE the timestamp
 * — decoding the cursor to the wrong (published, apId) tuple and producing a
 * wrong (non-crashing) page boundary.
 *
 * This test pins two invariants:
 *  1. CURSOR_SEP is the NUL escape "\u0000" (source-level pin so the literal
 *     can never silently regress to a space again).
 *  2. A `published` value containing a literal space round-trips through the
 *     `next_cursor` -> `before` cursor cycle and yields the correct boundary
 *     (the cursor row is excluded; strictly-older rows survive).
 */

import { Hono } from "hono";

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import timelineRoutes from "../../routes/timeline.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
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

async function insertLocalActor(
  db: Database,
  username: string,
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
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  return apId;
}

async function insertPublicPost(
  db: Database,
  author: string,
  apId: string,
  published: string,
): Promise<void> {
  await db.insert(objects).values({
    apId,
    type: "Note",
    attributedTo: author,
    content: `content ${apId}`,
    inReplyTo: null,
    conversation: apId,
    visibility: "public",
    toJson: JSON.stringify(["https://www.w3.org/ns/activitystreams#Public"]),
    ccJson: "[]",
    audienceJson: "[]",
    communityApId: null,
    published,
    isLocal: 0,
  });
}

function appWith(db: Database): Hono<{ Bindings: Env; Variables: Variables }> {
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", null as unknown as Actor);
    await next();
  });
  app.route("/", timelineRoutes);
  return app;
}

function envFor(db: Database): Env {
  return { APP_URL, DB_INSTANCE: db } as unknown as Env;
}

test("CURSOR_SEP is the NUL escape, not a space", async () => {
  const src = await readFile(
    new URL("../../routes/timeline.ts", import.meta.url),
    "utf8",
  );
  // Pin the exact source literal. A space separator (or a raw NUL byte) would
  // not match: the constant must be the 6-char "\u0000" escape.
  expect(src).toContain('const CURSOR_SEP = "\\u0000";');
  expect(src).not.toContain('const CURSOR_SEP = " ";');
});

test("published value with a literal space round-trips through the feed cursor", async () => {
  const db = await freshDb();
  const author = await insertLocalActor(db, "alice");

  // Two federated Notes whose published values both contain a literal space
  // (non-xsd:dateTime form stored verbatim). The newer one sorts first under
  // (published desc, apId desc).
  const newer = `${APP_URL}/ap/objects/remote-newer`;
  const older = `${APP_URL}/ap/objects/remote-older`;
  await insertPublicPost(db, author, newer, "2026-06-17 13:00:00");
  await insertPublicPost(db, author, older, "2026-06-17 12:00:00");

  const app = appWith(db);
  const env = envFor(db);

  // Page 1: limit=1 -> the newer post + a next_cursor pointing strictly after
  // it.
  const page1 = await app.request(`${APP_URL}/?limit=1`, {}, env);
  expect(page1.status).toBe(200);
  const body1 = (await page1.json()) as {
    posts: Array<{ ap_id: string }>;
    has_more: boolean;
    next_cursor: string | null;
  };
  expect(body1.posts.map((p) => p.ap_id)).toEqual([newer]);
  expect(body1.has_more).toBe(true);
  expect(body1.next_cursor).not.toBeNull();
  // The cursor must carry the FULL published value (space intact) before the
  // NUL, then the ap_id. A space separator would have truncated published to
  // "2026-06-17".
  expect(body1.next_cursor).toBe(`2026-06-17 13:00:00\u0000${newer}`);

  // Page 2: feed the cursor back. The boundary must exclude the cursor row
  // (newer) and return exactly the strictly-older row.
  const page2 = await app.request(
    `${APP_URL}/?limit=1&before=${encodeURIComponent(body1.next_cursor!)}`,
    {},
    env,
  );
  expect(page2.status).toBe(200);
  const body2 = (await page2.json()) as { posts: Array<{ ap_id: string }> };
  expect(body2.posts.map((p) => p.ap_id)).toEqual([older]);
});
