import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import {
  remoteStampPackCache,
  stampPackReleases,
  stampPacks,
  stampRevisions,
} from "../../../db/index.ts";
import type { IObjectStorage } from "../../runtime/types.ts";
import { refreshRemoteStampPack } from "../../lib/stamp-pack-import.ts";
import { sha256Hex } from "../../lib/stamp-assets.ts";
import {
  buildStampPackManifest,
  parseRemoteStampPackManifest,
  STAMP_PACK_SCHEMA,
} from "../../lib/stamp-manifest.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSYAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

test("remote manifest cannot claim a logical Stamp id outside its Pack namespace", async () => {
  const packId = "https://remote.example/stamp-packs/cat";
  const assetSha256 = await sha256Hex(PNG);
  const manifest = buildStampPackManifest({
    baseUrl: "https://remote.example",
    id: packId,
    release: 1,
    name: { en: "Cat" },
    publisher: "https://remote.example/users/alice",
    visibility: "public",
    stamps: [
      {
        id: "https://victim.example/stamp-packs/dog/stamps/okay",
        key: "okay",
        revision: `sha256:${"a".repeat(64)}`,
        alt: { en: "Okay" },
        tags: [],
        asset: {
          url: "https://cdn.remote.example/cat/okay.png",
          mediaType: "image/png",
          width: 1,
          height: 1,
          sha256: assetSha256,
        },
      },
    ],
  });

  expect(parseRemoteStampPackManifest(manifest, packId)).toBeNull();
});

test("remote manifest cannot name a publisher Actor on another origin", async () => {
  const packId = "https://attacker.example/stamp-packs/cat";
  const assetSha256 = await sha256Hex(PNG);
  const manifest = buildStampPackManifest({
    baseUrl: "https://attacker.example",
    id: packId,
    release: 1,
    name: { en: "Impersonated Cat" },
    publisher: "https://victim.example/users/alice",
    visibility: "public",
    stamps: [
      {
        id: `${packId}/stamps/okay`,
        key: "okay",
        revision: `sha256:${"a".repeat(64)}`,
        alt: { en: "Okay" },
        tags: [],
        asset: {
          url: "https://cdn.attacker.example/cat/okay.png",
          mediaType: "image/png",
          width: 1,
          height: 1,
          sha256: assetSha256,
        },
      },
    ],
  });

  expect(parseRemoteStampPackManifest(manifest, packId)).toBeNull();
});

function memoryStorage() {
  const values = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const storage = {
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
      values.set(key, {
        bytes,
        contentType:
          options?.httpMetadata?.contentType ?? "application/octet-stream",
      });
    },
    async get(key: string) {
      const value = values.get(key);
      if (!value) return null;
      const bytes = value.bytes.buffer.slice(
        value.bytes.byteOffset,
        value.bytes.byteOffset + value.bytes.byteLength,
      ) as ArrayBuffer;
      return {
        key,
        body: new Blob([bytes]).stream(),
        bodyUsed: false,
        httpMetadata: { contentType: value.contentType },
        async arrayBuffer() {
          return bytes;
        },
        async text() {
          return new TextDecoder().decode(bytes);
        },
        async json<T>() {
          return JSON.parse(new TextDecoder().decode(bytes)) as T;
        },
      };
    },
    async head() {
      return null;
    },
    async delete() {},
    async list() {
      return { objects: [], truncated: false };
    },
  } as IObjectStorage;
  return { storage, values };
}

test("remote pack install mirrors assets and revalidates with If-None-Match", async () => {
  const { db } = await createTestDb();
  const { storage, values } = memoryStorage();
  const packId = "https://remote.example/stamp-packs/cat";
  const stampId = `${packId}/stamps/okay`;
  const assetUrl = "https://cdn.remote.example/cat/okay.png";
  const assetSha256 = await sha256Hex(PNG);
  const manifest = buildStampPackManifest({
    baseUrl: "https://remote.example",
    id: packId,
    release: 1,
    name: { ja: "リモートねこ" },
    publisher: "https://remote.example/users/alice",
    visibility: "public",
    stamps: [
      {
        id: stampId,
        key: "okay",
        revision: `sha256:${"a".repeat(64)}`,
        alt: { ja: "了解！" },
        tags: ["了解"],
        asset: {
          url: assetUrl,
          mediaType: "image/png",
          width: 1,
          height: 1,
          sha256: assetSha256,
        },
      },
    ],
  });
  expect(manifest.schema).toBe(STAMP_PACK_SCHEMA);
  const seenIfNoneMatch: Array<string | null> = [];
  const fetcher = async (url: string, options?: RequestInit) => {
    if (url === assetUrl) {
      return new Response(PNG, {
        headers: { "Content-Type": "image/png" },
      });
    }
    expect(url).toBe(packId);
    const headers = new Headers(options?.headers);
    seenIfNoneMatch.push(headers.get("If-None-Match"));
    if (headers.get("If-None-Match") === '"release-1"') {
      return new Response(null, { status: 304 });
    }
    return new Response(JSON.stringify(manifest), {
      headers: {
        "Content-Type": "application/json",
        ETag: '"release-1"',
      },
    });
  };

  const imported = await refreshRemoteStampPack(db, storage, packId, fetcher);
  expect(imported).toMatchObject({
    packId,
    releaseNumber: 1,
    changed: true,
  });
  expect(await db.select().from(stampPacks).get()).toMatchObject({
    id: packId,
    currentReleaseId: `${packId}/releases/1`,
    status: "published",
  });
  expect(await db.select().from(stampPackReleases).get()).toMatchObject({
    releaseNumber: 1,
  });
  const revision = await db.select().from(stampRevisions).get();
  expect(revision).toMatchObject({
    stampId,
    assetUrl: `/media/stamps/${assetSha256}.png`,
    mediaType: "image/png",
    width: 1,
    height: 1,
    assetSha256,
  });
  expect(values.has(revision!.assetR2Key!)).toBe(true);
  expect(await db.select().from(remoteStampPackCache).get()).toMatchObject({
    packId,
    etag: '"release-1"',
  });

  const unchanged = await refreshRemoteStampPack(db, storage, packId, fetcher);
  expect(unchanged.changed).toBe(false);
  expect(seenIfNoneMatch).toEqual([null, '"release-1"']);
  expect(
    await db
      .select({ count: stampPackReleases.releaseNumber })
      .from(stampPackReleases)
      .where(eq(stampPackReleases.packId, packId)),
  ).toHaveLength(1);
});

test("remote pack import keeps the advertised 20-Stamp boundary in one D1-safe batch", async () => {
  const { db } = await createTestDb();
  const { storage } = memoryStorage();
  const packId = "https://remote.example/stamp-packs/twenty";
  const assetUrl = "https://cdn.remote.example/twenty/shared.png";
  const assetSha256 = await sha256Hex(PNG);
  const manifest = buildStampPackManifest({
    baseUrl: "https://remote.example",
    id: packId,
    release: 1,
    name: { en: "Twenty" },
    publisher: "https://remote.example/users/alice",
    visibility: "public",
    stamps: Array.from({ length: 20 }, (_, index) => ({
      id: `${packId}/stamps/stamp_${index}`,
      key: `stamp_${index}`,
      revision: `sha256:${index.toString(16).padStart(64, "0")}`,
      alt: { en: `Stamp ${index}` },
      tags: [],
      asset: {
        url: assetUrl,
        mediaType: "image/png" as const,
        width: 1,
        height: 1,
        sha256: assetSha256,
      },
    })),
  });
  const fetcher = async (url: string) =>
    url === packId
      ? new Response(JSON.stringify(manifest), {
          headers: { "Content-Type": "application/json" },
        })
      : new Response(PNG, { headers: { "Content-Type": "image/png" } });

  const imported = await refreshRemoteStampPack(db, storage, packId, fetcher);

  expect(imported.changed).toBe(true);
  expect(await db.select().from(stampRevisions)).toHaveLength(20);
});
