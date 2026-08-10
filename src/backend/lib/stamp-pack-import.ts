import { and, eq, inArray } from "drizzle-orm";

import {
  remoteStampPackCache,
  insertMany,
  runBatch,
  stampAssetMirrors,
  stampInstallations,
  stampPackReleases,
  stampPacks,
  stampReleaseItems,
  stampRevisions,
  stamps,
  type D1Statement,
  type Database,
} from "../../db/index.ts";
import type { IObjectStorage } from "../runtime/types.ts";
import { fetchWithTimeout } from "./federation-fetch.ts";
import { mirrorRemoteStampAsset, sha256Text } from "./stamp-assets.ts";
import { parseRemoteStampPackManifest } from "./stamp-manifest.ts";

export class RemoteStampPackError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 502,
  ) {
    super(message);
    this.name = "RemoteStampPackError";
  }
}

export type RemoteStampPackRefresh = {
  packId: string;
  releaseId: string;
  releaseNumber: number;
  changed: boolean;
};

function remoteSlug(packId: string): string {
  const pathname = new URL(packId).pathname.replace(/\/+$/, "");
  const segment = pathname.slice(pathname.lastIndexOf("/") + 1);
  return (segment || "remote-pack").slice(0, 128);
}

export async function refreshRemoteStampPack(
  db: Database,
  media: IObjectStorage,
  packId: string,
  fetcher: typeof fetchWithTimeout = fetchWithTimeout,
): Promise<RemoteStampPackRefresh> {
  const [cache, current] = await Promise.all([
    db
      .select()
      .from(remoteStampPackCache)
      .where(eq(remoteStampPackCache.packId, packId))
      .get(),
    db
      .select({
        currentReleaseId: stampPacks.currentReleaseId,
        releaseNumber: stampPackReleases.releaseNumber,
      })
      .from(stampPacks)
      .leftJoin(
        stampPackReleases,
        eq(stampPackReleases.id, stampPacks.currentReleaseId),
      )
      .where(eq(stampPacks.id, packId))
      .get(),
  ]);

  const headers = new Headers({
    Accept: "application/json, application/ld+json",
  });
  if (cache?.etag) headers.set("If-None-Match", cache.etag);

  let response: Response;
  try {
    response = await fetcher(packId, { headers, timeout: 15_000 });
  } catch {
    throw new RemoteStampPackError("Remote Stamp pack is unavailable", 502);
  }
  const checkedAt = new Date().toISOString();
  if (response.status === 304) {
    if (!current?.currentReleaseId || current.releaseNumber === null) {
      throw new RemoteStampPackError(
        "Remote Stamp cache has no installed release",
        409,
      );
    }
    await db
      .update(remoteStampPackCache)
      .set({ checkedAt, updatedAt: checkedAt })
      .where(eq(remoteStampPackCache.packId, packId));
    return {
      packId,
      releaseId: current.currentReleaseId,
      releaseNumber: current.releaseNumber,
      changed: false,
    };
  }
  if (response.status === 404) {
    throw new RemoteStampPackError("Remote Stamp pack not found", 404);
  }
  if (!response.ok) {
    throw new RemoteStampPackError("Remote Stamp pack is unavailable", 502);
  }
  const contentType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    contentType &&
    contentType !== "application/json" &&
    contentType !== "application/ld+json"
  ) {
    throw new RemoteStampPackError("Remote Stamp manifest is not JSON", 400);
  }

  const text = await response.text();
  if (!text || text.length > 64 * 1024) {
    throw new RemoteStampPackError("Remote Stamp manifest is too large", 400);
  }
  let rawManifest: unknown;
  try {
    rawManifest = JSON.parse(text);
  } catch {
    throw new RemoteStampPackError("Remote Stamp manifest is invalid", 400);
  }
  const manifest = parseRemoteStampPackManifest(rawManifest, packId);
  if (!manifest) {
    throw new RemoteStampPackError("Remote Stamp manifest is invalid", 400);
  }
  const manifestSha256 = await sha256Text(text);
  const releaseId = `${packId}/releases/${manifest.release}`;
  const existingRelease = await db
    .select({ manifestSha256: stampPackReleases.manifestSha256 })
    .from(stampPackReleases)
    .where(
      and(
        eq(stampPackReleases.packId, packId),
        eq(stampPackReleases.releaseNumber, manifest.release),
      ),
    )
    .get();
  const etagHeader = response.headers.get("ETag");
  const etag = etagHeader && etagHeader.length <= 512 ? etagHeader : undefined;
  if (existingRelease) {
    if (existingRelease.manifestSha256 !== manifestSha256) {
      throw new RemoteStampPackError(
        "Published Stamp release changed without a new release number",
        409,
      );
    }
    await db
      .insert(remoteStampPackCache)
      .values({
        packId,
        manifestUrl: packId,
        etag,
        manifestSha256,
        checkedAt,
        createdAt: cache?.createdAt ?? checkedAt,
        updatedAt: checkedAt,
      })
      .onConflictDoUpdate({
        target: remoteStampPackCache.packId,
        set: { etag, manifestSha256, checkedAt, updatedAt: checkedAt },
      });
    return {
      packId,
      releaseId,
      releaseNumber: manifest.release,
      changed: false,
    };
  }
  if (
    current?.releaseNumber !== null &&
    current?.releaseNumber !== undefined &&
    manifest.release <= current.releaseNumber
  ) {
    throw new RemoteStampPackError(
      "Remote Stamp release number did not advance",
      409,
    );
  }

  const imported = [] as Array<{
    stamp: (typeof manifest.stamps)[number];
    asset: Awaited<ReturnType<typeof mirrorRemoteStampAsset>>;
    revisionId: string;
  }>;
  try {
    for (const stamp of manifest.stamps) {
      const asset = await mirrorRemoteStampAsset(media, stamp.asset, fetcher);
      const revisionKey = await sha256Text(`${stamp.id}\0${stamp.revision}`);
      imported.push({
        stamp,
        asset,
        revisionId: `${packId}/revisions/${revisionKey}`,
      });
    }
  } catch (error) {
    if (error instanceof RemoteStampPackError) throw error;
    throw new RemoteStampPackError(
      "Remote Stamp asset failed integrity verification",
      400,
    );
  }

  const existingRevisionRows = await db
    .select()
    .from(stampRevisions)
    .where(
      inArray(
        stampRevisions.id,
        imported.map((item) => item.revisionId),
      ),
    );
  const existingRevisions = new Map(
    existingRevisionRows.map((revision) => [revision.id, revision]),
  );
  for (const item of imported) {
    const existing = existingRevisions.get(item.revisionId);
    if (
      existing &&
      (existing.stampId !== item.stamp.id ||
        existing.revisionDigest !== item.stamp.revision ||
        existing.assetSha256 !== item.asset.sha256 ||
        existing.mediaType !== item.asset.mediaType ||
        existing.width !== item.asset.width ||
        existing.height !== item.asset.height)
    ) {
      throw new RemoteStampPackError(
        "Remote Stamp revision conflicts with immutable local data",
        409,
      );
    }
  }

  const statements = [
    db
      .insert(stampPacks)
      .values({
        id: packId,
        publisherActorId: manifest.publisher,
        slug: remoteSlug(packId),
        nameJson: JSON.stringify(manifest.name),
        descriptionJson: manifest.description
          ? JSON.stringify(manifest.description)
          : null,
        iconUrl: imported[0]?.asset.url,
        currentReleaseId: releaseId,
        visibility: manifest.visibility,
        status: "published",
        createdAt: checkedAt,
        updatedAt: checkedAt,
      })
      .onConflictDoUpdate({
        target: stampPacks.id,
        set: {
          publisherActorId: manifest.publisher,
          nameJson: JSON.stringify(manifest.name),
          descriptionJson: manifest.description
            ? JSON.stringify(manifest.description)
            : null,
          iconUrl: imported[0]?.asset.url,
          currentReleaseId: releaseId,
          visibility: manifest.visibility,
          status: "published",
          updatedAt: checkedAt,
        },
      }),
    db.insert(stampPackReleases).values({
      id: releaseId,
      packId,
      releaseNumber: manifest.release,
      manifestSha256,
      publishedAt: checkedAt,
    }),
    db.update(stamps).set({ enabled: false }).where(eq(stamps.packId, packId)),
    ...imported.map((item, index) =>
      db
        .insert(stamps)
        .values({
          id: item.stamp.id,
          packId,
          key: item.stamp.key,
          currentRevisionId: item.revisionId,
          sortOrder: index,
          enabled: true,
        })
        .onConflictDoUpdate({
          target: stamps.id,
          set: {
            currentRevisionId: item.revisionId,
            sortOrder: index,
            enabled: true,
          },
        }),
    ),
    ...insertMany(
      db,
      stampRevisions,
      imported.map((item) => ({
        id: item.revisionId,
        stampId: item.stamp.id,
        revisionDigest: item.stamp.revision,
        assetUrl: item.asset.url,
        assetR2Key: item.asset.r2Key,
        mediaType: item.asset.mediaType,
        width: item.asset.width,
        height: item.asset.height,
        assetSha256: item.asset.sha256,
        altJson: JSON.stringify(item.stamp.alt),
        tagsJson: JSON.stringify(item.stamp.tags),
        animated: false,
        createdAt: checkedAt,
      })),
      { conflict: "ignore" },
    ),
    ...insertMany(
      db,
      stampReleaseItems,
      imported.map((item, index) => ({
        releaseId,
        stampId: item.stamp.id,
        revisionId: item.revisionId,
        sortOrder: index,
      })),
    ),
    ...imported.map((item) =>
      db
        .insert(stampAssetMirrors)
        .values({
          assetSha256: item.asset.sha256,
          remoteAssetUrl: item.stamp.asset.url,
          localAssetR2Key: item.asset.r2Key,
          mediaType: item.asset.mediaType,
          status: "ready",
          verifiedAt: checkedAt,
          createdAt: checkedAt,
          updatedAt: checkedAt,
        })
        .onConflictDoUpdate({
          target: [
            stampAssetMirrors.assetSha256,
            stampAssetMirrors.remoteAssetUrl,
          ],
          set: {
            localAssetR2Key: item.asset.r2Key,
            mediaType: item.asset.mediaType,
            status: "ready",
            lastError: null,
            verifiedAt: checkedAt,
            updatedAt: checkedAt,
          },
        }),
    ),
    db
      .update(stampInstallations)
      .set({ installedReleaseId: releaseId, updatedAt: checkedAt })
      .where(
        and(
          eq(stampInstallations.packId, packId),
          eq(stampInstallations.autoUpdate, true),
        ),
      ),
    db
      .insert(remoteStampPackCache)
      .values({
        packId,
        manifestUrl: packId,
        etag,
        manifestSha256,
        checkedAt,
        createdAt: cache?.createdAt ?? checkedAt,
        updatedAt: checkedAt,
      })
      .onConflictDoUpdate({
        target: remoteStampPackCache.packId,
        set: { etag, manifestSha256, checkedAt, updatedAt: checkedAt },
      }),
  ];
  await runBatch(db, statements as unknown as [D1Statement, ...D1Statement[]]);
  return {
    packId,
    releaseId,
    releaseNumber: manifest.release,
    changed: true,
  };
}
