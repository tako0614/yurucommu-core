import { and, inArray, or, sql } from "drizzle-orm";
import {
  mediaBlobDeletionClaims,
  mediaBlobDeletionJobs,
  mediaUploadLifetimes,
  type Database,
  type D1Statement,
} from "../../db/index.ts";
import { chunkForInClause } from "./chunk.ts";
import { backfillStagedMediaReferences } from "./staged-media-retention.ts";

/** One pending intent for an exactly selected upload; source mutation owns it. */
export function mediaDeletionIntentForKey(
  db: Database,
  key: string,
  uploader: string,
): D1Statement {
  const now = new Date().toISOString();
  return db
    .insert(mediaBlobDeletionJobs)
    .select(
      sql`
    SELECT r2_key,uploader_ap_id,${now},${now} FROM media_uploads
    WHERE r2_key=${key} AND uploader_ap_id=${uploader}
  `,
    )
    .onConflictDoNothing() as D1Statement;
}

/**
 * The manager may replace the icon; physical deletion intent is restricted to
 * an old upload belonging to that same actor. Read the current source inside
 * the update batch, so a stale HTTP snapshot cannot orphan the actual old key.
 * Another manager's historical icon remains for uploader reconciliation.
 */
export function communityIconDeletionIntent(
  db: Database,
  communityApId: string,
  setterApId: string,
  newIconUrl: string | null,
): D1Statement {
  const now = new Date().toISOString();
  return db
    .insert(mediaBlobDeletionJobs)
    .select(
      sql`
    SELECT upload.r2_key,upload.uploader_ap_id,${now},${now}
    FROM media_uploads AS upload JOIN communities AS community
      ON upload.r2_key='uploads/'||substr(community.icon_url,8)
    WHERE community.ap_id=${communityApId}
      AND upload.uploader_ap_id=${setterApId}
      AND community.icon_url IS NOT ${newIconUrl}
      AND substr(community.icon_url,1,7)='/media/'
  `,
    )
    .onConflictDoNothing() as D1Statement;
}

/** Claim after the full desired source write; never on journal-row removal. */
export async function claimedMediaDeletionKeys(
  db: Database,
  keys: readonly string[],
): Promise<string[]> {
  if (keys.length === 0) return [];
  await backfillStagedMediaReferences(db);
  const claimed = new Set<string>();
  // 90 keys + one timestamp stay below D1's 100-bind limit.
  for (const chunk of chunkForInClause([...new Set(keys)])) {
    await db
      .insert(mediaBlobDeletionClaims)
      .select(
        sql`
      SELECT r2_key,uploader_ap_id,upload_id,${new Date().toISOString()}
      FROM media_blob_deletion_claimable
      WHERE r2_key IN (${sql.join(
        chunk.map((key) => sql`${key}`),
        sql`,`,
      )})
    `,
      )
      .onConflictDoNothing();
    // Includes already-claimed retry jobs and 0034's atomically claimed
    // never-published keys. Neither case reopens its immutable fence.
    const rows = await db
      .select({ r2Key: mediaBlobDeletionJobs.r2Key })
      .from(mediaBlobDeletionJobs)
      .where(
        and(
          inArray(mediaBlobDeletionJobs.r2Key, chunk),
          or(
            sql`EXISTS(SELECT 1 FROM ${mediaBlobDeletionClaims}
            WHERE ${mediaBlobDeletionClaims.r2Key}=${mediaBlobDeletionJobs.r2Key}
              AND ${mediaBlobDeletionClaims.uploaderApId}=${mediaBlobDeletionJobs.uploaderApId})`,
            sql`EXISTS(SELECT 1 FROM ${mediaUploadLifetimes}
            WHERE ${mediaUploadLifetimes.r2Key}=${mediaBlobDeletionJobs.r2Key}
              AND ${mediaUploadLifetimes.uploaderApId}=${mediaBlobDeletionJobs.uploaderApId}
              AND ${mediaUploadLifetimes.state}='deleting')`,
          ),
        ),
      );
    for (const row of rows) claimed.add(row.r2Key);
  }
  return keys.filter((key) => claimed.has(key));
}
