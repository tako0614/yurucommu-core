import { expect, test } from "bun:test";
import { eq } from "drizzle-orm";

import { messageStampRefs, stampAssetMirrors } from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import type { IObjectStorage } from "../../runtime/types.ts";
import {
  MAX_STAMP_ASSET_BYTES,
  mirrorRemoteStampAsset,
  sha256Hex,
} from "../../lib/stamp-assets.ts";
import { mirrorPendingStampAssets } from "../../lib/stamp-mirror.ts";
import { createTestDb } from "../helpers/d1-semantics.ts";

const PNG = Uint8Array.from(
  atob(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSYAAAAASUVORK5CYII=",
  ),
  (character) => character.charCodeAt(0),
);

function memoryStorage(): IObjectStorage {
  const values = new Map<string, Uint8Array>();
  return {
    async put(key, value) {
      const bytes =
        typeof value === "string"
          ? new TextEncoder().encode(value)
          : value instanceof ArrayBuffer
            ? new Uint8Array(value)
            : new Uint8Array(await new Response(value).arrayBuffer());
      values.set(key, bytes);
    },
    async get(key) {
      const value = values.get(key);
      if (!value) return null;
      const bytes = value.buffer.slice(
        value.byteOffset,
        value.byteOffset + value.byteLength,
      ) as ArrayBuffer;
      return {
        key,
        body: new Blob([bytes]).stream(),
        bodyUsed: false,
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
  };
}

test("remote Stamp assets stop streaming as soon as the byte cap is exceeded", async () => {
  const chunk = new Uint8Array(1024 * 1024);
  const totalChunks = 8;
  let pulls = 0;
  let cancelled = false;
  const responseBody = new ReadableStream<Uint8Array>({
    pull(controller) {
      pulls += 1;
      controller.enqueue(chunk);
      if (pulls === totalChunks) controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });

  expect(MAX_STAMP_ASSET_BYTES).toBe(2 * 1024 * 1024);
  await expect(
    mirrorRemoteStampAsset(
      memoryStorage(),
      {
        url: "https://remote.example/stamps/unbounded.png",
        mediaType: "image/png",
        width: 1,
        height: 1,
        sha256: "a".repeat(64),
      },
      async () =>
        new Response(responseBody, {
          headers: { "Content-Type": "image/png" },
        }),
    ),
  ).rejects.toThrow("Stamp asset is too large");

  expect(cancelled).toBe(true);
  expect(pulls).toBeLessThan(totalChunks);
});

test("pending inbound Stamp asset is verified, mirrored, and projected locally", async () => {
  const { db } = await createTestDb();
  const sha256 = await sha256Hex(PNG);
  const remoteUrl = "https://remote.example/stamps/okay.png";
  const now = "2026-08-10T00:00:00.000Z";
  await db.insert(messageStampRefs).values({
    messageId: "https://remote.example/objects/one",
    stampUri: "https://remote.example/stamp-packs/cat/stamps/okay",
    packUri: "https://remote.example/stamp-packs/cat",
    revisionDigest: `sha256:${"a".repeat(64)}`,
    remoteAssetUrl: remoteUrl,
    mediaType: "image/png",
    width: 1,
    height: 1,
    assetSha256: sha256,
    altText: "了解！",
    createdAt: now,
  });
  await db.insert(stampAssetMirrors).values({
    assetSha256: sha256,
    remoteAssetUrl: remoteUrl,
    mediaType: "image/png",
    status: "pending",
    attempts: 0,
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });
  const fetcher = async (url: string) => {
    expect(url).toBe(remoteUrl);
    return new Response(PNG, {
      headers: { "Content-Type": "image/png" },
    });
  };

  const mirrored = await mirrorPendingStampAssets(
    {
      DB_INSTANCE: db,
      MEDIA: memoryStorage(),
    } as Env,
    1,
    fetcher,
  );
  expect(mirrored).toBe(1);
  const localKey = `stamps/sha256/${sha256.slice(0, 2)}/${sha256}.png`;
  expect(await db.select().from(stampAssetMirrors).get()).toMatchObject({
    status: "ready",
    localAssetR2Key: localKey,
    attempts: 1,
  });
  expect(
    await db
      .select({ localAssetR2Key: messageStampRefs.localAssetR2Key })
      .from(messageStampRefs)
      .where(eq(messageStampRefs.assetSha256, sha256))
      .get(),
  ).toEqual({ localAssetR2Key: localKey });
});

test("a poisoned source URL cannot block another source for the same digest", async () => {
  const { db } = await createTestDb();
  const sha256 = await sha256Hex(PNG);
  const poisonedUrl = "https://evil.example/not-the-image.png";
  const validUrl = "https://author.example/stamps/okay.png";
  const now = "2026-08-10T00:00:00.000Z";

  for (const [suffix, remoteAssetUrl] of [
    ["poisoned", poisonedUrl],
    ["valid", validUrl],
  ] as const) {
    await db.insert(messageStampRefs).values({
      messageId: `https://remote.example/objects/${suffix}`,
      stampUri: `https://remote.example/stamp-packs/cat/stamps/${suffix}`,
      packUri: "https://remote.example/stamp-packs/cat",
      revisionDigest: `sha256:${"b".repeat(64)}`,
      remoteAssetUrl,
      mediaType: "image/png",
      width: 1,
      height: 1,
      assetSha256: sha256,
      altText: "了解！",
      createdAt: now,
    });
    await db.insert(stampAssetMirrors).values({
      assetSha256: sha256,
      remoteAssetUrl,
      mediaType: "image/png",
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    });
  }

  const mirrored = await mirrorPendingStampAssets(
    {
      DB_INSTANCE: db,
      MEDIA: memoryStorage(),
    } as Env,
    2,
    async (url) =>
      url === validUrl
        ? new Response(PNG, {
            headers: { "Content-Type": "image/png" },
          })
        : new Response("not found", { status: 404 }),
  );

  expect(mirrored).toBe(1);
  const states = await db.select().from(stampAssetMirrors);
  expect(
    states.find((candidate) => candidate.remoteAssetUrl === poisonedUrl),
  ).toMatchObject({ status: "failed", attempts: 1 });
  expect(
    states.find((candidate) => candidate.remoteAssetUrl === validUrl),
  ).toMatchObject({ status: "ready", attempts: 1 });
});
