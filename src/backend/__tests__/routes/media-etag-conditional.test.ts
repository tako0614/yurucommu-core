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
import { actors, follows, mediaUploads, objects } from "../../../db/index.ts";
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

interface MediaFixture {
  id: string;
  filename: string;
  r2Key: string;
  url: string;
  contentType: string;
  bytes: Uint8Array<ArrayBuffer>;
}

const IMAGE: MediaFixture = {
  id: "abc123",
  filename: "abc123.png",
  r2Key: "uploads/abc123.png",
  url: "/media/abc123.png",
  contentType: "image/png",
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
};
const VIDEO: MediaFixture = {
  id: "def456",
  filename: "def456.mp4",
  r2Key: "uploads/def456.mp4",
  url: "/media/def456.mp4",
  contentType: "video/mp4",
  bytes: new Uint8Array([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]),
};

/**
 * What the self-host wrapper sends: `edge.objects` answers `{etag, size,
 * contentType?, body, partial}` and its etag is a BARE hex digest — R2's
 * unquoted `etag` spelling, not its `httpEtag`.
 */
const BARE_DIGEST = "ebf4f6351cbb4a0e93b1c0e9f1d2a3b4";

function portableHost(media: MediaFixture): EdgeObjectsBinding {
  const metadata = {
    etag: BARE_DIGEST,
    size: media.bytes.byteLength,
    contentType: media.contentType,
  };
  return {
    head: async () => metadata,
    get: async () => ({
      ...metadata,
      body: new Blob([media.bytes as unknown as BlobPart]).stream(),
      partial: false,
    }),
    put: async () => ({ etag: BARE_DIGEST, size: media.bytes.byteLength }),
    delete: async () => undefined,
    list: async () => ({ objects: [], prefixes: [], truncated: false }),
  } as unknown as EdgeObjectsBinding;
}

/** R2's own answer: `etag` bare, `httpEtag` quoted, both for the same bytes. */
function r2Bucket(media: MediaFixture): R2Bucket {
  return {
    get: async () => ({
      key: media.r2Key,
      size: media.bytes.byteLength,
      etag: BARE_DIGEST,
      httpEtag: `"${BARE_DIGEST}"`,
      httpMetadata: { contentType: media.contentType },
      body: new Blob([media.bytes as unknown as BlobPart]).stream(),
    }),
  } as unknown as R2Bucket;
}

/** The store the Cloudflare lane actually hands the route, adapter and all. */
function cloudflareStore(media: MediaFixture): ObjectStore {
  return wrapCloudflareBindings({
    DB: {} as D1Database,
    MEDIA: r2Bucket(media),
    KV: {} as KVNamespace,
  }).MEDIA!;
}

const LANES: readonly (readonly [
  string,
  (media: MediaFixture) => ObjectStore,
])[] = [
  ["portable", (media) => wrapEdgeObjects(portableHost(media))],
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

/** One post by one local actor, with the media attached to it. */
async function seedMedia(
  db: Database,
  media: MediaFixture,
  visibility: "public" | "followers" = "public",
): Promise<Actor | null> {
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
    id: media.id,
    r2Key: media.r2Key,
    uploaderApId: apId,
    contentType: media.contentType,
    size: media.bytes.length,
  });
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/p1`,
    type: "Note",
    attributedTo: apId,
    content: "hello",
    attachmentsJson: JSON.stringify([
      {
        type: media.contentType.startsWith("video/") ? "Video" : "Image",
        url: media.url,
        r2_key: media.r2Key,
      },
    ]),
    visibility,
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    isLocal: 1,
  });
  if (visibility === "public") return null;

  const followerApId = `${APP_URL}/ap/users/bob`;
  await db.insert(actors).values({
    apId: followerApId,
    type: "Person",
    preferredUsername: "bob",
    inbox: `${followerApId}/inbox`,
    outbox: `${followerApId}/outbox`,
    followersUrl: `${followerApId}/followers`,
    followingUrl: `${followerApId}/following`,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
  });
  await db.insert(follows).values({
    followerApId,
    followingApId: apId,
    status: "accepted",
  });
  return {
    ap_id: followerApId,
    type: "Person",
    preferred_username: "bob",
    name: null,
    summary: null,
    icon_url: null,
    header_url: null,
    inbox: `${followerApId}/inbox`,
    outbox: `${followerApId}/outbox`,
    followers_url: `${followerApId}/followers`,
    following_url: `${followerApId}/following`,
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

async function fetchMedia(
  store: ObjectStore,
  db: Database,
  headers: Record<string, string> = {},
  actor: Actor | null = null,
  media: MediaFixture = IMAGE,
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
  return app.fetch(new Request(`${APP_URL}${media.url}`, { headers }), env);
}

for (const [lane, makeStore] of LANES) {
  test(`${lane} lane: GET /media emits a QUOTED entity-tag, never the bare digest`, async () => {
    const db = await freshDb();
    await seedMedia(db, IMAGE);

    const response = await fetchMedia(makeStore(IMAGE), db);
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
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(IMAGE.bytes);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000",
    );
  });

  test(`${lane} lane: If-None-Match with the emitted ETag answers 304`, async () => {
    const db = await freshDb();
    await seedMedia(db, IMAGE);

    const first = await fetchMedia(makeStore(IMAGE), db);
    const etag = first.headers.get("ETag")!;
    await first.arrayBuffer();

    const second = await fetchMedia(makeStore(IMAGE), db, {
      "If-None-Match": etag,
    });
    expect(second.status).toBe(304);
    // §15.4.5: no body, and the caching metadata a 200 would have carried.
    expect(await second.text()).toBe("");
    expect(second.headers.get("ETag")).toBe(etag);
    expect(second.headers.get("Cache-Control")).toBe(
      "public, max-age=31536000",
    );
  });

  test(`${lane} lane: the conditional comparison is WEAK and takes a list`, async () => {
    const db = await freshDb();
    await seedMedia(db, IMAGE);
    const etag = `"${BARE_DIGEST}"`;

    // §13.1.2 evaluates If-None-Match with the weak comparison function, so the
    // marker is ignored on either side.
    const weak = await fetchMedia(makeStore(IMAGE), db, {
      "If-None-Match": `W/${etag}`,
    });
    expect(weak.status).toBe(304);

    // The field is a list, and `*` matches any current representation.
    const listed = await fetchMedia(makeStore(IMAGE), db, {
      "If-None-Match": `"other", ${etag}`,
    });
    expect(listed.status).toBe(304);
    const wildcard = await fetchMedia(makeStore(IMAGE), db, {
      "If-None-Match": "*",
    });
    expect(wildcard.status).toBe(304);

    // A stale validator — and the BARE digest, which is what a client would
    // have echoed back before the fix — still get the representation.
    const stale = await fetchMedia(makeStore(IMAGE), db, {
      "If-None-Match": '"stale"',
    });
    expect(stale.status).toBe(200);
    await stale.arrayBuffer();
    const bare = await fetchMedia(makeStore(IMAGE), db, {
      "If-None-Match": BARE_DIGEST,
    });
    expect(bare.status).toBe(200);
    await bare.arrayBuffer();
  });

  for (const media of [IMAGE, VIDEO]) {
    test(`${lane} lane: authorized restricted ${media.contentType} keeps no-store on 200, bodyless 200, and 304`, async () => {
      const db = await freshDb();
      const follower = await seedMedia(db, media, "followers");
      if (!follower) throw new Error("restricted fixture must return follower");

      const first = await fetchMedia(makeStore(media), db, {}, follower, media);
      expect(first.status).toBe(200);
      expect(first.headers.get("ETag")).toBe(`"${BARE_DIGEST}"`);
      expect(first.headers.get("Cache-Control")).toBe("private, no-store");
      expect(new Uint8Array(await first.arrayBuffer())).toEqual(media.bytes);

      // The provider-neutral ObjectStore permits a null body. Exercise that
      // route branch at its own seam, without inventing a null wire body in
      // the portable Host or R2 contracts.
      const bodylessStore = makeStore(media);
      const getWithBody = bodylessStore.get.bind(bodylessStore);
      bodylessStore.get = async (key) => {
        const object = await getWithBody(key);
        if (!object) return null;
        await object.body?.cancel();
        return { ...object, body: null };
      };
      const bodyless = await fetchMedia(bodylessStore, db, {}, follower, media);
      expect(bodyless.status).toBe(200);
      expect(await bodyless.text()).toBe("");
      expect(bodyless.headers.get("ETag")).toBe(`"${BARE_DIGEST}"`);
      expect(bodyless.headers.get("Cache-Control")).toBe("private, no-store");

      const conditional = await fetchMedia(
        makeStore(media),
        db,
        { "If-None-Match": `"${BARE_DIGEST}"` },
        follower,
        media,
      );
      expect(conditional.status).toBe(304);
      expect(await conditional.text()).toBe("");
      expect(conditional.headers.get("ETag")).toBe(`"${BARE_DIGEST}"`);
      expect(conditional.headers.get("Cache-Control")).toBe(
        "private, no-store",
      );
    });

    test(`${lane} lane: public ${media.contentType} retains max-age on 200 and 304`, async () => {
      const db = await freshDb();
      await seedMedia(db, media);
      const maxAge = media === VIDEO ? 604800 : 31536000;
      const expectedCacheControl = `public, max-age=${maxAge}`;

      const first = await fetchMedia(makeStore(media), db, {}, null, media);
      expect(first.status).toBe(200);
      expect(first.headers.get("Cache-Control")).toBe(expectedCacheControl);
      expect(new Uint8Array(await first.arrayBuffer())).toEqual(media.bytes);

      const second = await fetchMedia(
        makeStore(media),
        db,
        { "If-None-Match": `"${BARE_DIGEST}"` },
        null,
        media,
      );
      expect(second.status).toBe(304);
      expect(await second.text()).toBe("");
      expect(second.headers.get("ETag")).toBe(`"${BARE_DIGEST}"`);
      expect(second.headers.get("Cache-Control")).toBe(expectedCacheControl);
    });
  }
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
    id: IMAGE.id,
    r2Key: IMAGE.r2Key,
    uploaderApId: apId,
    contentType: IMAGE.contentType,
    size: IMAGE.bytes.length,
  });
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/p2`,
    type: "Note",
    attributedTo: apId,
    content: "secret",
    attachmentsJson: JSON.stringify([
      { type: "Image", url: IMAGE.url, r2_key: IMAGE.r2Key },
    ]),
    visibility: "followers",
    toJson: "[]",
    ccJson: "[]",
    audienceJson: "[]",
    isLocal: 1,
  });

  const response = await fetchMedia(wrapEdgeObjects(portableHost(IMAGE)), db, {
    "If-None-Match": "*",
  });
  expect(response.status).toBe(403);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
