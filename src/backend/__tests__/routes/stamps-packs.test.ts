import { expect, test } from "bun:test";
import { Hono } from "hono";

import type { Database } from "../../../db/index.ts";
import { mediaUploads, stampRevisions } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import stampPackPublicRoutes from "../../routes/stamp-pack-public.ts";
import stampsRoutes from "../../routes/stamps.ts";
import { sha256Text } from "../../lib/stamp-assets.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const me = { ap_id: "https://test.local/ap/users/me" };
const another = { ap_id: "https://test.local/ap/users/another" };

const ONE_PIXEL_PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSYAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

function memoryMedia() {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    objects,
    binding: {
      async put(
        key: string,
        value: ReadableStream | ArrayBuffer | string,
        options?: { httpMetadata?: { contentType?: string } },
      ) {
        const bytes =
          typeof value === "string"
            ? new TextEncoder().encode(value)
            : value instanceof ArrayBuffer
              ? new Uint8Array(value)
              : new Uint8Array(await new Response(value).arrayBuffer());
        objects.set(key, {
          bytes,
          contentType:
            options?.httpMetadata?.contentType ?? "application/octet-stream",
        });
      },
      async get(key: string) {
        const object = objects.get(key);
        if (!object) return null;
        return {
          body: new Blob([
            object.bytes.buffer.slice(
              object.bytes.byteOffset,
              object.bytes.byteOffset + object.bytes.byteLength,
            ) as ArrayBuffer,
          ]).stream(),
          httpMetadata: { contentType: object.contentType },
          httpEtag: `"${key}"`,
        };
      },
      async head(key: string) {
        const object = objects.get(key);
        return object
          ? { httpMetadata: { contentType: object.contentType } }
          : null;
      },
      async delete(key: string | string[]) {
        for (const item of Array.isArray(key) ? key : [key])
          objects.delete(item);
      },
      async list() {
        return { objects: [], truncated: false };
      },
    },
  };
}

function createApp(db: Database, actor: typeof me | null) {
  const app = new Hono();
  app.use("*", async (c, next) => {
    const setter = c as unknown as {
      set: (key: string, value: unknown) => void;
    };
    setter.set("db", db);
    setter.set("actor", actor);
    await next();
  });
  app.route("/api/stamps", stampsRoutes);
  app.route("/stamp-packs", stampPackPublicRoutes);
  return app;
}

test("GET /api/stamps/packs is an authenticated Core API seam", async () => {
  const { db } = await createTestDb();
  const app = createApp(db, null);

  const response = await app.fetch(
    new Request("https://test.local/api/stamps/packs"),
    {},
  );

  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "Unauthorized" });
});

test("GET /api/stamps/packs returns only the actor's installed immutable release", async () => {
  const { db, client } = await createTestDb();
  const now = "2026-08-10T00:00:00.000Z";
  const packId = "https://test.local/stamp-packs/cat";
  const releaseId = `${packId}/releases/1`;
  const stampId = `${packId}/stamps/okay`;
  const revisionId = `${stampId}/revisions/rev-1`;
  const foreignPackId = "https://test.local/stamp-packs/foreign";

  await client.executeMultiple(`
    INSERT INTO stamp_packs (
      id, publisher_actor_id, slug, name_json, current_release_id,
      visibility, status, created_at, updated_at
    ) VALUES (
      '${packId}', '${me.ap_id}', 'cat', '{"ja":"ゆるねこ"}',
      '${releaseId}', 'public', 'published', '${now}', '${now}'
    );
    INSERT INTO stamp_pack_releases (
      id, pack_id, release_number, manifest_sha256, published_at
    ) VALUES ('${releaseId}', '${packId}', 1, '${"a".repeat(64)}', '${now}');
    INSERT INTO stamps (
      id, pack_id, stamp_key, current_revision_id, sort_order, enabled
    ) VALUES ('${stampId}', '${packId}', 'okay', '${revisionId}', 0, 1);
    INSERT INTO stamp_revisions (
      id, stamp_id, revision_digest, asset_url, asset_r2_key, media_type,
      width, height, asset_sha256, alt_json, tags_json, animated, created_at
    ) VALUES (
      '${revisionId}', '${stampId}', 'sha256:${"b".repeat(64)}',
      '/media/stamps/${"c".repeat(64)}.webp',
      'stamps/sha256/cc/${"c".repeat(64)}.webp', 'image/webp', 512, 512,
      '${"c".repeat(64)}', '{"ja":"了解！"}', '["了解","OK"]', 0, '${now}'
    );
    INSERT INTO stamp_release_items (
      release_id, stamp_id, revision_id, sort_order
    ) VALUES ('${releaseId}', '${stampId}', '${revisionId}', 0);
    INSERT INTO stamp_entitlements (
      actor_ap_id, pack_id, can_install, can_send, source, granted_at
    ) VALUES ('${me.ap_id}', '${packId}', 1, 1, 'free', '${now}');
    INSERT INTO stamp_installations (
      actor_ap_id, pack_id, installed_release_id, auto_update, sort_order,
      installed_at
    ) VALUES ('${me.ap_id}', '${packId}', '${releaseId}', 1, 0, '${now}');

    INSERT INTO stamp_packs (
      id, publisher_actor_id, slug, name_json, current_release_id,
      visibility, status, created_at, updated_at
    ) VALUES (
      '${foreignPackId}', '${another.ap_id}', 'foreign', '{"ja":"他人"}',
      '${foreignPackId}/releases/1', 'public', 'published', '${now}', '${now}'
    );
    INSERT INTO stamp_installations (
      actor_ap_id, pack_id, installed_release_id, auto_update, sort_order,
      installed_at
    ) VALUES (
      '${another.ap_id}', '${foreignPackId}', '${foreignPackId}/releases/1',
      1, 0, '${now}'
    );
  `);

  const response = await createApp(db, me).fetch(
    new Request("https://test.local/api/stamps/packs"),
    {},
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    packs: [
      {
        id: packId,
        share_url: packId,
        publisher_actor_id: me.ap_id,
        slug: "cat",
        name: { ja: "ゆるねこ" },
        description: null,
        release: {
          id: releaseId,
          number: 1,
          published_at: now,
        },
        rights: ["install", "send"],
        stamps: [
          {
            id: stampId,
            key: "okay",
            favorite: false,
            recent: null,
            revision: {
              id: revisionId,
              digest: `sha256:${"b".repeat(64)}`,
              asset: {
                url: `/media/stamps/${"c".repeat(64)}.webp`,
                media_type: "image/webp",
                width: 512,
                height: 512,
                sha256: "c".repeat(64),
              },
              alt: { ja: "了解！" },
              tags: ["了解", "OK"],
            },
          },
        ],
      },
    ],
  });
});

test("POST /api/stamps/install grants and installs a published free pack", async () => {
  const { db, client } = await createTestDb();
  const now = "2026-08-10T00:00:00.000Z";
  const packId = "https://test.local/stamp-packs/free-cat";
  const releaseId = `${packId}/releases/1`;
  const stampId = `${packId}/stamps/thanks`;
  const revisionId = `${stampId}/revisions/rev-1`;

  await client.executeMultiple(`
    INSERT INTO stamp_packs (
      id, publisher_actor_id, slug, name_json, current_release_id,
      visibility, status, created_at, updated_at
    ) VALUES (
      '${packId}', '${another.ap_id}', 'free-cat', '{"ja":"無料ねこ"}',
      '${releaseId}', 'public', 'published', '${now}', '${now}'
    );
    INSERT INTO stamp_pack_releases (
      id, pack_id, release_number, manifest_sha256, published_at
    ) VALUES ('${releaseId}', '${packId}', 1, '${"d".repeat(64)}', '${now}');
    INSERT INTO stamps (
      id, pack_id, stamp_key, current_revision_id, sort_order, enabled
    ) VALUES ('${stampId}', '${packId}', 'thanks', '${revisionId}', 0, 1);
    INSERT INTO stamp_revisions (
      id, stamp_id, revision_digest, asset_url, asset_r2_key, media_type,
      width, height, asset_sha256, alt_json, tags_json, animated, created_at
    ) VALUES (
      '${revisionId}', '${stampId}', 'sha256:${"e".repeat(64)}',
      '/media/stamps/${"f".repeat(64)}.png',
      'stamps/sha256/ff/${"f".repeat(64)}.png', 'image/png', 256, 256,
      '${"f".repeat(64)}', '{"ja":"ありがとう"}', '["感謝"]', 0, '${now}'
    );
    INSERT INTO stamp_release_items (
      release_id, stamp_id, revision_id, sort_order
    ) VALUES ('${releaseId}', '${stampId}', '${revisionId}', 0);
  `);

  const app = createApp(db, me);
  const installResponse = await app.fetch(
    new Request("https://test.local/api/stamps/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack_id: packId }),
    }),
    {},
  );

  expect(installResponse.status).toBe(200);
  expect(await installResponse.json()).toEqual({
    success: true,
    pack_id: packId,
    release_id: releaseId,
  });

  const listResponse = await app.fetch(
    new Request("https://test.local/api/stamps/packs"),
    {},
  );
  const listed = (await listResponse.json()) as {
    packs: Array<{ id: string; rights: string[] }>;
  };
  expect(listed.packs.map((pack) => pack.id)).toEqual([packId]);
  expect(listed.packs[0]?.rights).toEqual(["install", "send"]);

  const favoriteResponse = await app.fetch(
    new Request("https://test.local/api/stamps/favorite", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stamp_id: stampId, favorite: true }),
    }),
    {},
  );
  expect(favoriteResponse.status).toBe(200);
  const favoriteList = (await (
    await app.fetch(new Request("https://test.local/api/stamps/packs"), {})
  ).json()) as {
    packs: Array<{ stamps: Array<{ favorite: boolean }> }>;
  };
  expect(favoriteList.packs[0]?.stamps[0]?.favorite).toBe(true);

  const uninstallResponse = await app.fetch(
    new Request("https://test.local/api/stamps/install", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack_id: packId }),
    }),
    {},
  );
  expect(uninstallResponse.status).toBe(200);
  const afterUninstall = (await (
    await app.fetch(new Request("https://test.local/api/stamps/packs"), {})
  ).json()) as { packs: unknown[] };
  expect(afterUninstall.packs).toEqual([]);
});

test("POST /api/stamps/packs publishes owned PNG bytes as an immutable release", async () => {
  const { db } = await createTestDb();
  const media = memoryMedia();
  await media.binding.put("uploads/abc123.png", ONE_PIXEL_PNG.buffer, {
    httpMetadata: { contentType: "image/png" },
  });
  await db.insert(mediaUploads).values({
    id: "abc123",
    r2Key: "uploads/abc123.png",
    uploaderApId: me.ap_id,
    contentType: "image/png",
    size: ONE_PIXEL_PNG.byteLength,
  });

  const response = await createApp(db, me).fetch(
    new Request("https://test.local/api/stamps/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "tiny-cat",
        name: { ja: "ちいさなねこ" },
        visibility: "public",
        stamps: [
          {
            key: "okay",
            source_r2_key: "uploads/abc123.png",
            alt: { ja: "了解！" },
            tags: ["了解", "OK"],
          },
        ],
      }),
    }),
    {
      APP_URL: "https://test.local",
      DB_INSTANCE: db,
      MEDIA: media.binding,
    } as unknown as Env,
  );

  expect(response.status).toBe(201);
  const body = (await response.json()) as {
    pack_id: string;
    release_id: string;
    stamps: Array<{ id: string; revision: string; asset: { url: string } }>;
  };
  expect(body.pack_id).toBe("https://test.local/stamp-packs/tiny-cat");
  expect(body.release_id).toBe(`${body.pack_id}/releases/1`);
  expect(body.stamps).toHaveLength(1);
  expect(body.stamps[0]?.revision).toMatch(/^sha256:[a-f0-9]{64}$/);
  expect(body.stamps[0]?.asset.url).toMatch(
    /^\/media\/stamps\/[a-f0-9]{64}\.png$/,
  );

  const revision = await db.select().from(stampRevisions).get();
  expect(revision).toMatchObject({
    mediaType: "image/png",
    width: 1,
    height: 1,
    altJson: JSON.stringify({ ja: "了解！" }),
    tagsJson: JSON.stringify(["了解", "OK"]),
    animated: false,
  });
  expect(revision?.assetR2Key).toMatch(
    /^stamps\/sha256\/[a-f0-9]{2}\/[a-f0-9]{64}\.png$/,
  );
  expect(media.objects.has(revision!.assetR2Key!)).toBe(true);

  const listed = await createApp(db, me).fetch(
    new Request("https://test.local/api/stamps/packs"),
    {},
  );
  expect(listed.status).toBe(200);
  expect(((await listed.json()) as { packs: unknown[] }).packs).toHaveLength(1);

  const manifestUrl = "https://test.local/stamp-packs/tiny-cat";
  const manifestResponse = await createApp(db, null).fetch(
    new Request(manifestUrl),
    { APP_URL: "https://test.local", DB_INSTANCE: db } as unknown as Env,
  );
  expect(manifestResponse.status).toBe(200);
  expect(manifestResponse.headers.get("Content-Type")).toContain(
    "application/json",
  );
  const manifestText = await manifestResponse.text();
  expect(manifestResponse.headers.get("ETag")).toBe(
    `"sha256-${await sha256Text(manifestText)}"`,
  );
  expect(JSON.parse(manifestText)).toMatchObject({
    schema: "https://yurucommu.com/schemas/stamp-pack/v1",
    id: body.pack_id,
    release: 1,
    publisher: me.ap_id,
    stamps: [
      {
        id: `${body.pack_id}/stamps/okay`,
        key: "okay",
        revision: body.stamps[0]!.revision,
        assets: [
          {
            url: expect.stringMatching(
              /^https:\/\/test\.local\/media\/stamps\/[a-f0-9]{64}\.png$/,
            ),
            mediaType: "image/png",
            width: 1,
            height: 1,
          },
        ],
      },
    ],
  });

  const conditional = await createApp(db, null).fetch(
    new Request(manifestUrl, {
      headers: { "If-None-Match": manifestResponse.headers.get("ETag")! },
    }),
    { APP_URL: "https://test.local", DB_INSTANCE: db } as unknown as Env,
  );
  expect(conditional.status).toBe(304);
});

test("POST /api/stamps/packs keeps the advertised 20-Stamp boundary inside one D1-safe batch", async () => {
  const { db } = await createTestDb();
  const media = memoryMedia();
  await media.binding.put("uploads/b0.png", ONE_PIXEL_PNG.buffer, {
    httpMetadata: { contentType: "image/png" },
  });
  await db.insert(mediaUploads).values({
    id: "b0",
    r2Key: "uploads/b0.png",
    uploaderApId: me.ap_id,
    contentType: "image/png",
    size: ONE_PIXEL_PNG.byteLength,
  });

  const response = await createApp(db, me).fetch(
    new Request("https://test.local/api/stamps/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: "twenty",
        name: { en: "Twenty" },
        visibility: "public",
        stamps: Array.from({ length: 20 }, (_, index) => ({
          key: `stamp_${index}`,
          source_r2_key: "uploads/b0.png",
          alt: { en: `Stamp ${index}` },
          tags: [],
        })),
      }),
    }),
    {
      APP_URL: "https://test.local",
      DB_INSTANCE: db,
      MEDIA: media.binding,
    } as unknown as Env,
  );

  expect(response.status).toBe(201);
  expect(
    ((await response.json()) as { stamps: unknown[] }).stamps,
  ).toHaveLength(20);
});
