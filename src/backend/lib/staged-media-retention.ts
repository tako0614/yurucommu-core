import { sql } from "drizzle-orm";
import {
  mediaUploadLifetimes,
  rawBatchStatement,
  runBatch,
  type Database,
} from "../../db/index.ts";

/** A new, settled upload can be attached for seven days before collection. */
export const STAGED_MEDIA_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const STAGED_MEDIA_DRAIN_LIMIT = 50;
const REFERENCE_BACKFILL_PAGE = 10;

/**
 * Index at most ten legacy rows per source family. Source triggers are already
 * active, including for inserts behind the cursor. The current payload page,
 * cursor advance and completion proof commit in one atomic batch; no payload
 * read outside that batch can overwrite a newer reference. Ambiguous legacy
 * rows become durable blockers, never guesses or silently skipped sources.
 */
export async function backfillStagedMediaReferences(
  db: Database,
): Promise<void> {
  for (const [kind, table, payload] of [
    ["object", "objects", "attachments_json"],
    ["actor", "actors", "json_array(icon_url,header_url)"],
    ["community", "communities", "json_array(icon_url)"],
  ] as const) {
    const journal = await db.get<{ complete: number }>(sql`SELECT complete
      FROM media_staged_backfill WHERE source_kind=${kind}`);
    if (!journal) throw new Error("Media reference backfill authority missing");
    if (journal.complete) continue;
    // Only constants from the three owning source families enter raw SQL.
    const source = sql.raw(table);
    const value = sql.raw(payload);
    await runBatch(db, [
      rawBatchStatement(
        db,
        sql`INSERT INTO media_staged_source_inputs
        (source_kind,source_id,payload,is_json,allow_ambiguous)
        SELECT ${kind},ap_id,coalesce(${value},'[]'),1,1 FROM ${source}
        WHERE ap_id>=coalesce((SELECT cursor FROM media_staged_backfill WHERE source_kind=${kind}),'')
          AND ((SELECT cursor FROM media_staged_backfill WHERE source_kind=${kind}) IS NULL
          OR ap_id>(SELECT cursor FROM media_staged_backfill WHERE source_kind=${kind}))
        ORDER BY ap_id LIMIT ${REFERENCE_BACKFILL_PAGE}`,
      ),
      rawBatchStatement(
        db,
        sql`UPDATE media_staged_backfill SET cursor=coalesce((
        SELECT max(ap_id) FROM (
          SELECT ap_id FROM ${source} WHERE ap_id>=coalesce(media_staged_backfill.cursor,'')
            AND (media_staged_backfill.cursor IS NULL OR ap_id>media_staged_backfill.cursor)
          ORDER BY ap_id LIMIT ${REFERENCE_BACKFILL_PAGE}
        )
      ),cursor) WHERE source_kind=${kind}`,
      ),
      rawBatchStatement(
        db,
        sql`UPDATE media_staged_backfill SET complete=1
        WHERE source_kind=${kind} AND NOT EXISTS (
          SELECT 1 FROM ${source} WHERE ap_id>=coalesce(media_staged_backfill.cursor,'')
            AND (media_staged_backfill.cursor IS NULL OR ap_id>media_staged_backfill.cursor)
        )`,
      ),
    ]);
  }
}

/**
 * Commit at most one page of never-published upload deletion intents. Migration
 * 0034's reference/publication triggers are the authority: a stale selection
 * cannot claim a published key. Its claim trigger removes exact metadata and
 * creates the durable job in the same statement. Storage is touched only by the
 * trailing deletion-job drain. Unknown putting attempts and legacy uploads
 * have no lifetime and cannot enter this collector.
 */
export async function claimExpiredStagedMedia(db: Database): Promise<number> {
  await backfillStagedMediaReferences(db);
  const now = new Date(Date.now()).toISOString();
  const rows = await db
    .update(mediaUploadLifetimes)
    .set({ state: "deleting" })
    .where(
      sql`${mediaUploadLifetimes.r2Key} IN (
      SELECT lifetime.r2_key FROM media_upload_lifetimes AS lifetime
      WHERE lifetime.state = 'staged' AND lifetime.expires_at <= ${now}
        AND NOT EXISTS (
          SELECT 1 FROM media_staged_references AS reference
          WHERE reference.r2_key = lifetime.r2_key
        )
        AND NOT EXISTS (SELECT 1 FROM media_staged_ambiguity LIMIT 1)
        AND (SELECT count(*) FROM media_staged_backfill)=3
        AND NOT EXISTS (SELECT 1 FROM media_staged_backfill WHERE complete=0)
        AND NOT EXISTS (SELECT 1 FROM objects WHERE ap_id IS NULL LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM actors WHERE ap_id IS NULL LIMIT 1)
        AND NOT EXISTS (SELECT 1 FROM communities WHERE ap_id IS NULL LIMIT 1)
        AND NOT EXISTS (
          SELECT 1 FROM media_upload_attempts AS attempt
          WHERE attempt.r2_key = lifetime.r2_key
        )
        AND EXISTS (
          SELECT 1 FROM media_uploads AS upload
          WHERE upload.id = lifetime.upload_id AND upload.r2_key = lifetime.r2_key
            AND upload.uploader_ap_id = lifetime.uploader_ap_id
        )
        AND NOT EXISTS (
          SELECT 1 FROM account_deletion_targets AS target
          WHERE target.actor_ap_id = lifetime.uploader_ap_id
        )
      ORDER BY lifetime.expires_at, lifetime.r2_key
      LIMIT ${STAGED_MEDIA_DRAIN_LIMIT}
    )`,
    )
    .returning({ r2Key: mediaUploadLifetimes.r2Key });
  return rows.length;
}
