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
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";

import * as schema from "../../../db/schema.ts";
import type { Database } from "../../../db/index.ts";
import {
  actors,
  communities,
  communityMembers,
  follows,
  mediaUploads,
  objects,
} from "../../../db/index.ts";
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
const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

async function seedUpload(db: Database, env: Env, uploaderApId: string) {
  await (
    env.MEDIA as unknown as { put: (k: string, v: Uint8Array) => Promise<void> }
  ).put(R2_KEY, PNG_BYTES);
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

test("PRIVATE-community story media is members-only (stored visibility=public is not enough)", async () => {
  // Regression: a Story (and community post) is stored visibility="public" but
  // addressed to a community. For a PRIVATE community the media blob must stay
  // members-only — the world-readable ALLOW_PUBLIC path leaked it.
  const db = await freshDb();
  const env = envFor(db);
  const author = await insertLocalActor(db, "alice");
  const member = await insertLocalActor(db, "bob");
  const outsider = await insertLocalActor(db, "mallory");
  await seedUpload(db, env, author);

  const communityApId = `${APP_URL}/ap/groups/secret`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "secret",
    name: "Secret",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "private",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: author,
  });
  await db.insert(communityMembers).values([
    { communityApId, actorApId: author },
    { communityApId, actorApId: member },
  ]);

  // A Story: stored visibility="public" (stories never set visibility) but
  // addressed to the private community, with the media nested under `attachment`.
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/story1`,
    type: "Story",
    attributedTo: author,
    content: "",
    attachmentsJson: JSON.stringify({
      attachment: { url: MEDIA_URL, r2_key: R2_KEY },
    }),
    visibility: "public",
    communityApId,
    audienceJson: "[]",
    isLocal: 1,
  });

  // Non-member is denied (the leak this guards against).
  expect(
    (await getMedia(db, env, fakeActor(outsider, "mallory"))).status,
  ).toEqual(403);
  // Anonymous (e.g. a stray fetch of the guessed URL) is denied.
  expect((await getMedia(db, env, null)).status).toEqual(403);
  // A member is served — privately, so the blob is never shared-cached.
  const memberRes = await getMedia(db, env, fakeActor(member, "bob"));
  expect(memberRes.status).toEqual(200);
  expect(memberRes.headers.get("Cache-Control")).toContain("private");
  // The author is served.
  expect((await getMedia(db, env, fakeActor(author, "alice"))).status).toEqual(
    200,
  );
});

test("PUBLIC-community story media stays viewable (served, not gated)", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const author = await insertLocalActor(db, "alice");
  const outsider = await insertLocalActor(db, "mallory");
  await seedUpload(db, env, author);

  const communityApId = `${APP_URL}/ap/groups/open`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "open",
    name: "Open",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "public",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: author,
  });
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/story2`,
    type: "Story",
    attributedTo: author,
    content: "",
    attachmentsJson: JSON.stringify({
      attachment: { url: MEDIA_URL, r2_key: R2_KEY },
    }),
    visibility: "public",
    communityApId,
    audienceJson: "[]",
    isLocal: 1,
  });

  // A public community gates nothing: a non-member (and anonymous) still gets it.
  expect(
    (await getMedia(db, env, fakeActor(outsider, "mallory"))).status,
  ).toEqual(200);
  expect((await getMedia(db, env, null)).status).toEqual(200);
});

test("an EXPIRED personal Story's media is DENIED to a follower but still served to the author", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const author = await insertLocalActor(db, "alice");
  const followerApId = await insertLocalActor(db, "bob");
  await seedUpload(db, env, author);
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/story-expired`,
    type: "Story",
    attributedTo: author,
    content: "",
    attachmentsJson: JSON.stringify({
      attachment: { url: MEDIA_URL, r2_key: R2_KEY },
    }),
    visibility: "public",
    endTime: "2020-01-01T00:00:00.000Z", // past
    audienceJson: "[]",
    isLocal: 1,
  });
  await db.insert(follows).values({
    followerApId,
    followingApId: author,
    status: "accepted",
  });

  // An accepted follower would normally get a live story's media (200); once the
  // 24h window elapsed the blob is denied — the media lifetime now matches the
  // content lifetime instead of lingering until the best-effort reap.
  expect(
    (await getMedia(db, env, fakeActor(followerApId, "bob"))).status,
  ).toEqual(403);
  // The author can still access their own blob.
  expect((await getMedia(db, env, fakeActor(author, "alice"))).status).toEqual(
    200,
  );
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

  const recipientRes = await getMedia(
    db,
    env,
    fakeActor(recipientApId, "carol"),
  );
  expect(recipientRes.status).toEqual(200);

  const outsiderRes = await getMedia(
    db,
    env,
    fakeActor(localApId("dave"), "dave"),
  );
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

  const otherRes = await getMedia(
    db,
    env,
    fakeActor(localApId("mallory"), "mallory"),
  );
  expect(otherRes.status).toEqual(403);

  const anonRes = await getMedia(db, env, null);
  expect(anonRes.status).toEqual(403);
});

test("profile media (actor icon/header) is served publicly to anonymous viewers", async () => {
  // Regression: a profile avatar/header is uploaded (so it has a media_uploads
  // row) but attached to the ACTOR, not to any object. The object-only
  // authorization treated it as "unattached" → uploader-only → 403 for the
  // public actor document's <img> and for federation peers. It must be public.
  const db = await freshDb();
  const env = envFor(db);
  const uploader = await insertLocalActor(db, "alice");
  await insertLocalActor(db, "mallory");
  await seedUpload(db, env, uploader);
  await db
    .update(actors)
    .set({ iconUrl: MEDIA_URL })
    .where(eq(actors.apId, uploader));

  // Anonymous (e.g. a remote server fetching the avatar) is served the image.
  const anonRes = await getMedia(db, env, null);
  expect(anonRes.status).toEqual(200);
  expect(anonRes.headers.get("Cache-Control")).toContain("public");

  // A different signed-in user is also served it (it is public).
  const otherRes = await getMedia(
    db,
    env,
    fakeActor(localApId("mallory"), "mallory"),
  );
  expect(otherRes.status).toEqual(200);
});

test("header media (actor headerUrl) is likewise public", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const uploader = await insertLocalActor(db, "alice");
  await seedUpload(db, env, uploader);
  await db
    .update(actors)
    .set({ headerUrl: MEDIA_URL })
    .where(eq(actors.apId, uploader));

  const anonRes = await getMedia(db, env, null);
  expect(anonRes.status).toEqual(200);
});

test("PUBLIC community icon (set via /media, attached to no object) is served publicly", async () => {
  // Audit #16: a community icon set via a local /media upload is stored on the
  // communities table (not an actor row) and attached to no object. Without the
  // community branch in checkMediaAuthorization it fell through to the
  // uploader-only "!obj" deny, so the Group actor doc's published icon 401/403'd
  // for federation peers and every non-uploader member (broken image).
  const db = await freshDb();
  const env = envFor(db);
  const uploader = await insertLocalActor(db, "alice");
  await insertLocalActor(db, "mallory");
  await seedUpload(db, env, uploader);

  const communityApId = `${APP_URL}/ap/groups/open`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "open",
    name: "Open",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "public",
    iconUrl: MEDIA_URL,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: uploader,
  });

  // Anonymous federation peer / search engine fetching the Group icon: served.
  const anonRes = await getMedia(db, env, null);
  expect(anonRes.status).toEqual(200);
  expect(anonRes.headers.get("Cache-Control")).toContain("public");
  // A non-uploader signed-in member is served it too.
  expect(
    (await getMedia(db, env, fakeActor(localApId("mallory"), "mallory")))
      .status,
  ).toEqual(200);
});

test("PRIVATE community icon stays members-only", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const uploader = await insertLocalActor(db, "alice");
  const member = await insertLocalActor(db, "bob");
  const outsider = await insertLocalActor(db, "mallory");
  await seedUpload(db, env, uploader);

  const communityApId = `${APP_URL}/ap/groups/secret`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "secret",
    name: "Secret",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "private",
    iconUrl: MEDIA_URL,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: uploader,
  });
  await db.insert(communityMembers).values([
    { communityApId, actorApId: uploader },
    { communityApId, actorApId: member },
  ]);

  // Non-member + anonymous are denied (a private Group icon is not world-readable).
  expect(
    (await getMedia(db, env, fakeActor(outsider, "mallory"))).status,
  ).toEqual(403);
  expect((await getMedia(db, env, null)).status).toEqual(403);
  // A member is served, privately (never shared-cached).
  const memberRes = await getMedia(db, env, fakeActor(member, "bob"));
  expect(memberRes.status).toEqual(200);
  expect(memberRes.headers.get("Cache-Control")).toContain("private");
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

test("PERSONAL story media (stored visibility=public, reach=followers) is followers-gated", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const author = await insertLocalActor(db, "alice");
  const followerApId = await insertLocalActor(db, "bob");
  await insertLocalActor(db, "mallory");
  await seedUpload(db, env, author);

  // A personal Story is stored visibility="public" but addressed to followers,
  // with communityApId NULL (community stories are gated by a separate branch).
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/story1`,
    type: "Story",
    attributedTo: author,
    content: "",
    attachmentsJson: JSON.stringify([
      { type: "Image", url: MEDIA_URL, r2_key: R2_KEY },
    ]),
    visibility: "public",
    toJson: JSON.stringify([`${author}/followers`]),
    ccJson: "[]",
    audienceJson: "[]",
    isLocal: 1,
  });
  await db.insert(follows).values({
    followerApId,
    followingApId: author,
    status: "accepted",
  });

  // Authenticated non-follower: DENIED despite the story's stored visibility=public.
  const mallory = fakeActor(localApId("mallory"), "mallory");
  expect((await getMedia(db, env, mallory)).status).toEqual(403);
  // Anonymous: denied (the media handler returns 403 for every denial,
  // auth-required included).
  expect((await getMedia(db, env, null)).status).toEqual(403);
  // Accepted follower + author: allowed.
  expect(
    (await getMedia(db, env, fakeActor(followerApId, "bob"))).status,
  ).toEqual(200);
  expect((await getMedia(db, env, fakeActor(author, "alice"))).status).toEqual(
    200,
  );
});

test("followers-visibility media in a PUBLIC community is DENIED to a non-follower member", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const author = await insertLocalActor(db, "alice");
  const member = await insertLocalActor(db, "bob"); // member, NOT a follower
  const follower = await insertLocalActor(db, "carol"); // member AND follower
  await seedUpload(db, env, author);

  const communityApId = `${APP_URL}/ap/groups/town`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "town",
    name: "Town",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "public",
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: author,
  });
  await db.insert(communityMembers).values([
    { communityApId, actorApId: author },
    { communityApId, actorApId: member },
    { communityApId, actorApId: follower },
  ]);
  await db.insert(follows).values({
    followerApId: follower,
    followingApId: author,
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });

  // A community post explicitly restricted to FOLLOWERS (visibility + community
  // are an allowed combo). Its media must follow the followers gate, not just
  // community membership.
  await db.insert(objects).values({
    apId: `${APP_URL}/ap/objects/fc1`,
    type: "Note",
    attributedTo: author,
    content: "followers-only in a public community",
    attachmentsJson: JSON.stringify([
      { type: "Image", url: MEDIA_URL, r2_key: R2_KEY },
    ]),
    visibility: "followers",
    communityApId,
    toJson: JSON.stringify([communityApId, `${communityApId}/followers`]),
    ccJson: "[]",
    audienceJson: JSON.stringify([communityApId]),
    isLocal: 1,
  });

  // A non-follower MEMBER must be DENIED (the leak this fixes) ...
  expect((await getMedia(db, env, fakeActor(member, "bob"))).status).toEqual(
    403,
  );
  // ... anonymous holder of the fanned-out URL too ...
  expect((await getMedia(db, env, null)).status).toEqual(403);
  // ... but a FOLLOWER member is served ...
  expect(
    (await getMedia(db, env, fakeActor(follower, "carol"))).status,
  ).toEqual(200);
  // ... and the author.
  expect((await getMedia(db, env, fakeActor(author, "alice"))).status).toEqual(
    200,
  );
});

// ---------------------------------------------------------------------------
// Audit #22 / finding B — cross-user private-media IDOR via community icon.
//
//   The community-icon authorization branch matched ANY public community whose
//   iconUrl === the requested blob URL, with NO binding to the blob's uploader.
//   So an attacker could create their OWN public community, point its icon at a
//   VICTIM's private blob, and have it served world-readable. The branch is now
//   only honored when the blob's uploader controls that community (creator or
//   member) — the analog of the avatar branch's uploader scoping.
// ---------------------------------------------------------------------------

test("a victim's PRIVATE blob is NOT exposed by an attacker's community icon (IDOR)", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const victim = await insertLocalActor(db, "victim");
  const attacker = await insertLocalActor(db, "attacker");
  // The blob is the VICTIM's, attached to a followers-only post (private). The
  // attacker is NOT a follower, so the icon IDOR would be their only path in.
  await seedUpload(db, env, victim);
  await insertObject(db, {
    id: "secret",
    author: victim,
    visibility: "followers",
    to: [`${victim}/followers`],
    attachments: [{ url: MEDIA_URL, r2_key: R2_KEY }],
  });

  // Attacker stands up THEIR OWN public community and points its icon at the
  // victim's blob (simulating the pre-fix poisoned row). Attacker is the
  // creator+member; the victim is NOT a member.
  const communityApId = `${APP_URL}/ap/groups/evil`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "evil",
    name: "Evil",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "public",
    iconUrl: MEDIA_URL,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: attacker,
  });
  await db
    .insert(communityMembers)
    .values({ communityApId, actorApId: attacker, role: "owner" });

  // Anonymous + a logged-in non-follower must NOT receive the victim's private
  // blob — the icon reference no longer grants public access.
  expect((await getMedia(db, env, null)).status).not.toEqual(200);
  expect(
    (await getMedia(db, env, fakeActor(attacker, "attacker"))).status,
  ).not.toEqual(200);
  // The uploader (victim) still reads it via the real followers-post gate.
  expect((await getMedia(db, env, fakeActor(victim, "victim"))).status).toEqual(
    200,
  );
});

test("a public community's icon uploaded BY a member is still served to anyone", async () => {
  const db = await freshDb();
  const env = envFor(db);
  const owner = await insertLocalActor(db, "owner");
  await seedUpload(db, env, owner); // the icon blob is the owner's own upload

  const communityApId = `${APP_URL}/ap/groups/open2`;
  await db.insert(communities).values({
    apId: communityApId,
    preferredUsername: "open2",
    name: "Open2",
    inbox: `${communityApId}/inbox`,
    outbox: `${communityApId}/outbox`,
    followersUrl: `${communityApId}/followers`,
    visibility: "public",
    iconUrl: MEDIA_URL,
    publicKeyPem: "pub",
    privateKeyPem: "priv",
    createdBy: owner,
  });
  await db
    .insert(communityMembers)
    .values({ communityApId, actorApId: owner, role: "owner" });

  // Legit public community icon (uploader controls the community) → world-readable.
  expect((await getMedia(db, env, null)).status).toEqual(200);
});
