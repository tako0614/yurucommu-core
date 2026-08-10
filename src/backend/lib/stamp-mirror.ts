import { and, eq, isNull, lt, lte, or, sql } from "drizzle-orm";

import {
  messageStampRefs,
  runBatch,
  stampAssetMirrors,
  type D1Statement,
} from "../../db/index.ts";
import type { Env } from "../types.ts";
import { fetchWithTimeout } from "./federation-fetch.ts";
import { mirrorRemoteStampAsset } from "./stamp-assets.ts";

const MAX_MIRROR_ATTEMPTS = 5;

export async function mirrorPendingStampAssets(
  env: Env,
  limit = 4,
  fetcher: typeof fetchWithTimeout = fetchWithTimeout,
): Promise<number> {
  if (!env.DB_INSTANCE || !env.MEDIA || limit < 1) return 0;
  const db = env.DB_INSTANCE;
  const now = new Date();
  const nowIso = now.toISOString();
  const staleFetchingAt = new Date(now.getTime() - 5 * 60_000).toISOString();
  const candidates = await db
    .select()
    .from(stampAssetMirrors)
    .where(
      and(
        lt(stampAssetMirrors.attempts, MAX_MIRROR_ATTEMPTS),
        or(
          eq(stampAssetMirrors.status, "pending"),
          and(
            eq(stampAssetMirrors.status, "failed"),
            or(
              lte(stampAssetMirrors.nextAttemptAt, nowIso),
              isNull(stampAssetMirrors.nextAttemptAt),
            ),
          ),
          and(
            eq(stampAssetMirrors.status, "fetching"),
            lt(stampAssetMirrors.updatedAt, staleFetchingAt),
          ),
        ),
      ),
    )
    .limit(Math.min(limit, 8));

  let mirrored = 0;
  for (const candidate of candidates) {
    const claimed = await db
      .update(stampAssetMirrors)
      .set({
        status: "fetching",
        attempts: sql`${stampAssetMirrors.attempts} + 1`,
        updatedAt: nowIso,
      })
      .where(
        and(
          eq(stampAssetMirrors.assetSha256, candidate.assetSha256),
          eq(stampAssetMirrors.remoteAssetUrl, candidate.remoteAssetUrl),
          eq(stampAssetMirrors.status, candidate.status),
          eq(stampAssetMirrors.updatedAt, candidate.updatedAt),
        ),
      )
      .returning({ attempts: stampAssetMirrors.attempts });
    const attempt = claimed[0]?.attempts;
    if (!attempt) continue;

    const ref = await db
      .select({
        mediaType: messageStampRefs.mediaType,
        width: messageStampRefs.width,
        height: messageStampRefs.height,
      })
      .from(messageStampRefs)
      .where(
        and(
          eq(messageStampRefs.assetSha256, candidate.assetSha256),
          eq(messageStampRefs.remoteAssetUrl, candidate.remoteAssetUrl),
        ),
      )
      .get();
    if (
      !ref ||
      (ref.mediaType !== "image/webp" && ref.mediaType !== "image/png")
    ) {
      await db
        .update(stampAssetMirrors)
        .set({
          status: "blocked",
          lastError: "No valid Message Stamp projection",
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(stampAssetMirrors.assetSha256, candidate.assetSha256),
            eq(stampAssetMirrors.remoteAssetUrl, candidate.remoteAssetUrl),
          ),
        );
      continue;
    }

    try {
      const asset = await mirrorRemoteStampAsset(
        env.MEDIA,
        {
          url: candidate.remoteAssetUrl,
          mediaType: ref.mediaType,
          width: ref.width,
          height: ref.height,
          sha256: candidate.assetSha256,
        },
        fetcher,
      );
      await runBatch(db, [
        db
          .update(stampAssetMirrors)
          .set({
            localAssetR2Key: asset.r2Key,
            mediaType: asset.mediaType,
            status: "ready",
            lastError: null,
            nextAttemptAt: null,
            verifiedAt: nowIso,
            updatedAt: nowIso,
          })
          .where(
            and(
              eq(stampAssetMirrors.assetSha256, candidate.assetSha256),
              eq(stampAssetMirrors.remoteAssetUrl, candidate.remoteAssetUrl),
            ),
          ) as D1Statement,
        db
          .update(messageStampRefs)
          .set({ localAssetR2Key: asset.r2Key })
          .where(
            and(
              eq(messageStampRefs.assetSha256, candidate.assetSha256),
              eq(messageStampRefs.mediaType, asset.mediaType),
              eq(messageStampRefs.width, asset.width),
              eq(messageStampRefs.height, asset.height),
            ),
          ) as D1Statement,
      ]);
      mirrored += 1;
    } catch {
      const exhausted = attempt >= MAX_MIRROR_ATTEMPTS;
      const retryAt = new Date(
        now.getTime() + Math.min(60, 2 ** attempt) * 60_000,
      ).toISOString();
      await db
        .update(stampAssetMirrors)
        .set({
          status: exhausted ? "blocked" : "failed",
          lastError: "Remote Stamp asset failed integrity verification",
          nextAttemptAt: exhausted ? null : retryAt,
          updatedAt: nowIso,
        })
        .where(
          and(
            eq(stampAssetMirrors.assetSha256, candidate.assetSha256),
            eq(stampAssetMirrors.remoteAssetUrl, candidate.remoteAssetUrl),
          ),
        );
    }
  }

  return mirrored;
}
