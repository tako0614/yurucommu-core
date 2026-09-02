/**
 * O-8 — `GET /media/:id` served a BARE etag.
 *
 * The route put `object.etag` straight into the `ETag` header. That field is
 * the backend's verbatim spelling and on the portable lane it is a raw hex
 * digest (`ebf4f635…`), which RFC 9110 §8.8.3 does not admit as an entity-tag:
 * an opaque-tag is always quoted. A validator no cache can parse is a validator
 * no cache can match, so every media hit on a self-host install re-transferred
 * the whole object — and nothing could echo the value back either, because the
 * route never read `If-None-Match` at all.
 *
 * These tests drive the route through the REAL adapters on BOTH lanes — a
 * `wrapEdgeObjects` store over a Host that sends a bare digest, and the
 * Cloudflare R2 adapter over a bucket that sends R2's two spellings — and pin
 * three things: the emitted `ETag` is a quoted entity-tag, the bare digest
 * never reaches a header, and the value the response emits is the value a
 * conditional request matches (weakly, per §13.1.2).
 */

import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { Hono } from "hono";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import type {
  D1Database,
  KVNamespace,
  R2Bucket,
} from "@cloudflare/workers-types";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import { actors, mediaUploads, objects } from "../../../db/index.ts";
import type { Actor, Env, Variables } from "../../types.ts";
import mediaRoutes from "../../routes/media.ts";
import { wrapEdgeObjects } from "../../runtime/edge-objects.ts";
import { wrapCloudflareBindings } from "../../runtime/cloudflare.ts";
import type { EdgeObjectsBinding } from "../../runtime/edge-facades.ts";
import type { ObjectStore } from "../../runtime/types.ts";

const APP_URL = "https://yuru.test";
const MIGRATIONS = [
  "0001_init.sql",
  "0002_social_remote_actor_edges.sql",
  "0003_activity_remote_object_edges.sql",
  "0004_blocklist.sql",
  "0005_story_community_scope.sql",
  "0006_dm_community_read_status.sql",
  "0008_actor_fields_aka.sql",
  "0009_object_tags.sql",
];

const MEDIA_ID = "abc123";
const FILENAME = `${MEDIA_ID}.png`;
const R2_KEY = `uploads/${FILENAME}`;
const MEDIA_URL = `/media/${FILENAME}`;
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/**
 * What the self-host wrapper sends: `edge.objects` answers `{etag, size,
 * contentType?, body, partial}` and its etag is a BARE hex digest — R2's
 * unquoted `etag` spelling, not its `httpEtag`.
 */
const BARE_DIGEST = "ebf4f6351cbb4a0e93b1c0e9f1d2a3b4";

function portableHost(): EdgeObjectsBinding {
  const metadata = {
    etag: BARE_DIGEST,
    size: PNG_BYTES.byteLength,
    contentType: "image/png",
  };
  return {
    head: async () => metadata,
    get: async () => ({
      ...metadata,
      body: new Blob([PNG_BYTES as unknown as BlobPart]).stream(),
      partial: false,
    }),
    put: async () => ({ etag: BARE_DIGEST, size: PNG_BYTES.byteLength }),
    delete: async () => undefined,
    list: async () => ({ objects: [], prefixes: [], truncated: false }),
  } as unknown as EdgeObjectsBinding;
}

/** R2's own answer: `etag` bare, `httpEtag` quoted, both for the same bytes. */
function r2Bucket(): R2Bucket {
  return {
    get: async () => ({
      key: R2_KEY,
      size: PNG_BYTES.byteLength,
      etag: BARE_DIGEST,
      httpEtag: `"${BARE_DIGEST}"`,
      httpMetadata: { contentType: "image/png" },
      body: new Blob([PNG_BYTES as unknown as BlobPart]).stream(),
    }),
  } as unknown as R2Bucket;
}

/** The store the Cloudflare lane actually hands the route, adapter and all. */
function cloudflareStore(): ObjectStore {
  return wrapCloudflareBindings({
    DB: {} as D1Database,
    MEDIA: r2Bucket(),
    KV: {} as KVNamespace,
  }).MEDIA!;
}

const LANES: readonly (readonly [string, () => ObjectStore])[] = [
  ["portable", () => wrapEdgeObjects(portableHost())],
  ["cloudflare", cloudflareStore],
];

async function freshDb(): Promise<Database> {
  const client = createClient({ url: ":memory:" });
  const root = new URL("../../../../migrations/", import.meta.url);
  for (const file of MIGRATIONS) {
    await client.executeMultiple(await readFile(new URL(file, root), "utf8"));
  }
  return drizzle(client, { schema }) as unknown as Database;
}

/** One public post by one local actor, with the media attached to it. */
async function seedPublicMedia(db: Database): Promise<void> {
  const apId = `${APP_URL}/ap/users/alice`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(mediaUploads).values({
    id: MEDIA_ID,
    r2Key: R2_KEY,
    uploaderApId: apId,
    contentType: "image/png",
    size: PNG_BYTES.length,
  });
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/p1`,
    type: "Note",
    attributedTo: apId,
    content: "hello",
    attachmentsJson: JSON.stringify([
      { type: "Image", url: MEDIA_URL, r2_key: R2_KEY },
    ]),
    visibility: "public",
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    isLocal: 1,
  });
}

async function fetchMedia(
  store: ObjectStore,
  db: Database,
  headers: Record<string, string> = {},
  actor: Actor | null = null,
): Promise<Response> {
  const env = {
    APP_URL,
    DB_INSTANCE: db,
    MEDIA: store,
  } as unknown as Env;
  const app = new Hono<{ Bindings: Env; Variables: Variables }>();
  app.use("*", async (c, next) => {
    c.set("db", db);
    c.set("actor", actor);
    await next();
  });
  app.route("/media", mediaRoutes);
  return app.fetch(new Request(`${APP_URL}${MEDIA_URL}`, { headers }), env);
}

for (const [lane, makeStore] of LANES) {
  test(`${lane} lane: GET /media emits a QUOTED entity-tag, never the bare digest`, async () => {
    const db = await freshDb();
    await seedPublicMedia(db);

    const response = await fetchMedia(makeStore(), db);
    expect(response.status).toBe(200);
    const etag = response.headers.get("ETag");
    // RFC 9110 §8.8.3: `entity-tag = [ weak ] DQUOTE *etagc DQUOTE`.
    expect(etag).toBe(`"${BARE_DIGEST}"`);
    expect(etag).toMatch(/^(W\/)?"[^"]*"$/);
    // The defect itself: the unquoted digest must not appear as a field value
    // anywhere on the response.
    expect(etag).not.toBe(BARE_DIGEST);
    for (const [, value] of response.headers) {
      expect(value).not.toBe(BARE_DIGEST);
    }
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  test(`${lane} lane: If-None-Match with the emitted ETag answers 304`, async () => {
    const db = await freshDb();
    await seedPublicMedia(db);

    const first = await fetchMedia(makeStore(), db);
    const etag = first.headers.get("ETag")!;
    await first.arrayBuffer();

    const second = await fetchMedia(makeStore(), db, { "If-None-Match": etag });
    expect(second.status).toBe(304);
    // §15.4.5: no body, and the caching metadata a 200 would have carried.
    expect(await second.text()).toBe("");
    expect(second.headers.get("ETag")).toBe(etag);
    expect(second.headers.get("Cache-Control")).toContain("max-age=");
  });

  test(`${lane} lane: the conditional comparison is WEAK and takes a list`, async () => {
    const db = await freshDb();
    await seedPublicMedia(db);
    const etag = `"${BARE_DIGEST}"`;

    // §13.1.2 evaluates If-None-Match with the weak comparison function, so the
    // marker is ignored on either side.
    const weak = await fetchMedia(makeStore(), db, {
      "If-None-Match": `W/${etag}`,
    });
    expect(weak.status).toBe(304);

    // The field is a list, and `*` matches any current representation.
    const listed = await fetchMedia(makeStore(), db, {
      "If-None-Match": `"other", ${etag}`,
    });
    expect(listed.status).toBe(304);
    const wildcard = await fetchMedia(makeStore(), db, {
      "If-None-Match": "*",
    });
    expect(wildcard.status).toBe(304);

    // A stale validator — and the BARE digest, which is what a client would
    // have echoed back before the fix — still get the representation.
    const stale = await fetchMedia(makeStore(), db, {
      "If-None-Match": '"stale"',
    });
    expect(stale.status).toBe(200);
    await stale.arrayBuffer();
    const bare = await fetchMedia(makeStore(), db, {
      "If-None-Match": BARE_DIGEST,
    });
    expect(bare.status).toBe(200);
    await bare.arrayBuffer();
  });
}

test("a conditional request cannot short-circuit the authorization gate", async () => {
  // `*` matches whenever a representation exists, so a 304 for a viewer who may
  // not read the object would disclose that it is there. The gate runs first.
  const db = await freshDb();
  const apId = `${APP_URL}/ap/users/alice`;
  await db.insert(actors).values({
    apId,
    type: "Person",
    preferredUsername: "alice",
    inbox: `${apId}/inbox`,
    outbox: `${apId}/outbox`,
    followersUrl: `${apId}/followers`,
    followingUrl: `${apId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(mediaUploads).values({
    id: MEDIA_ID,
    r2Key: R2_KEY,
    uploaderApId: apId,
    contentType: "image/png",
    size: PNG_BYTES.length,
  });
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/p2`,
    type: "Note",
    attributedTo: apId,
    content: "secret",
    attachmentsJson: JSON.stringify([
      { type: "Image", url: MEDIA_URL, r2_key: R2_KEY },
    ]),
    visibility: "followers",
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    isLocal: 1,
  });

  const response = await fetchMedia(wrapEdgeObjects(portableHost()), db, {
    "If-None-Match": "*",
  });
  expect(response.status).toBe(403);
});
