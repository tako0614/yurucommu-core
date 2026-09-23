/**
 * Shared object-delete cascade.
 *
 * Migrations declare `ON DELETE CASCADE` on the object's interaction/edge
 * tables (likes, announces, bookmarks, object_recipients, story_views,
 * story_votes, story_shares), but SQLite enforces foreign keys only when
 * `PRAGMA foreign_keys = ON` is set on the connection — which is NOT reliably
 * the case on every runtime/connection (D1 does not honour it, and the libsql
 * connection is not guaranteed to have it). Deleting an object row therefore
 * orphans those child rows on at least some runtimes.
 *
 * This helper deletes every child row keyed by `objectApId` deterministically,
 * independent of FK enforcement, so the data stays consistent on all runtimes.
 * It does NOT delete the `objects` row itself — callers do that (and own any
 * counter/fanout side effects) — and it intentionally leaves `activities`
 * alone, whose `object_ap_id` is `ON DELETE SET NULL`, not CASCADE.
 *
 * Used by BOTH the local post-delete path (routes.ts `DELETE /posts/:id`) and
 * the remote `handleDelete` inbox path so neither can orphan rows.
 */

import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { D1Statement, Database } from "../../../db/index.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import {
  activities,
  actors,
  announces,
  bookmarks,
  communities,
  D1_MAX_BATCH_STATEMENTS,
  insertMany,
  likes,
  mediaBlobDeletionJobs,
  mediaUploads,
  objectRecipients,
  objects,
  runBatch,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";
import { activityProjectionDeleteStatements } from "../../lib/activity-delete-cascade.ts";
import { chunkForInClause, D1_IN_CHUNK } from "../../lib/chunk.ts";

type CascadeObject = {
  apId: string;
  attributedTo: string;
  attachmentsJson: string;
};

type MediaBlobDeletionJob = {
  r2Key: string;
  uploaderApId: string;
};

function mediaUrlForKey(r2Key: string): string {
  return r2Key.startsWith("uploads/")
    ? `/media/${r2Key.slice("uploads/".length)}`
    : r2Key;
}

/**
 * Re-check queued keys immediately before physical deletion. A profile or
 * community may have reattached a previously failed key after the original
 * post batch; retaining that job is safer than deleting a blob still visible
 * from a live resource. Object references stay owner-scoped, matching
 * reapReplacedMediaUrl: foreign-owner objects do not become authority for an
 * upload they do not own. No unattached-upload scan is used.
 */
async function findReferencedMediaKeys(
  db: Database,
  jobs: readonly MediaBlobDeletionJob[],
): Promise<Set<string>> {
  const referenced = new Set<string>();
  const seen = new Set<string>();
  for (const { r2Key, uploaderApId } of jobs) {
    if (seen.has(r2Key)) continue;
    seen.add(r2Key);
    const mediaUrl = mediaUrlForKey(r2Key);

    // Profile PUTs may retain a valid media URL even when the upload row is
    // absent or owned by a different row. The job's uploader identity is not
    // used to narrow these product-level references.
    const actorReference = await db
      .select({ apId: actors.apId })
      .from(actors)
      .where(or(eq(actors.iconUrl, mediaUrl), eq(actors.headerUrl, mediaUrl)))
      .limit(1)
      .get();
    if (actorReference) {
      referenced.add(r2Key);
      continue;
    }

    const communityReference = await db
      .select({ apId: communities.apId })
      .from(communities)
      .where(
        and(eq(communities.iconUrl, mediaUrl), isNull(communities.deletedAt)),
      )
      .limit(1)
      .get();
    if (communityReference) {
      referenced.add(r2Key);
      continue;
    }

    // Object media ownership is intentionally uploader-scoped. This is the
    // same predicate used by reapReplacedMediaUrl and avoids a full global
    // attachments scan for every queued key.
    const objectReference = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(
        and(
          eq(objects.attributedTo, uploaderApId),
          or(
            sql`instr(${objects.attachmentsJson}, ${r2Key}) > 0`,
            sql`instr(${objects.attachmentsJson}, ${mediaUrl}) > 0`,
          ),
        ),
      )
      .limit(1)
      .get();
    if (objectReference) referenced.add(r2Key);
  }
  return referenced;
}

async function loadMediaBlobDeletionJobs(
  db: Database,
  keys: readonly string[],
): Promise<MediaBlobDeletionJob[]> {
  const jobs: MediaBlobDeletionJob[] = [];
  for (const chunk of chunkForInClause([...new Set(keys)])) {
    jobs.push(
      ...(await db
        .select({
          r2Key: mediaBlobDeletionJobs.r2Key,
          uploaderApId: mediaBlobDeletionJobs.uploaderApId,
        })
        .from(mediaBlobDeletionJobs)
        .where(inArray(mediaBlobDeletionJobs.r2Key, chunk))),
    );
  }
  return jobs;
}

async function runMediaJobStatements(
  db: Database,
  statements: readonly D1Statement[],
): Promise<void> {
  for (
    let offset = 0;
    offset < statements.length;
    offset += D1_MAX_BATCH_STATEMENTS
  ) {
    const page = statements.slice(offset, offset + D1_MAX_BATCH_STATEMENTS);
    if (page.length > 0) {
      await runBatch(db, page as [D1Statement, ...D1Statement[]]);
    }
  }
}

async function deleteMediaBlobDeletionJobRows(
  db: Database,
  keys: readonly string[],
): Promise<void> {
  const statements = chunkForInClause([...new Set(keys)]).map(
    (chunk) =>
      db
        .delete(mediaBlobDeletionJobs)
        .where(inArray(mediaBlobDeletionJobs.r2Key, chunk)) as D1Statement,
  );
  await runMediaJobStatements(db, statements);
}

async function rescheduleMediaBlobDeletionJobs(
  db: Database,
  keys: readonly string[],
  nextAttemptAt: string,
): Promise<void> {
  // The UPDATE has one additional bound value for `next_attempt_at`; leave
  // that column accounted for under the shared 90-parameter safety budget.
  const statements = chunkForInClause([...new Set(keys)], D1_IN_CHUNK - 1).map(
    (chunk) =>
      db
        .update(mediaBlobDeletionJobs)
        .set({ nextAttemptAt })
        .where(inArray(mediaBlobDeletionJobs.r2Key, chunk)) as D1Statement,
  );
  await runMediaJobStatements(db, statements);
}

type DeleteAttachedMediaOptions = {
  /**
   * The prepared canonical post-delete path has not committed the object
   * mutation yet, but still needs reference-safe durable intent. Legacy
   * cascades retain their historical MEDIA-gated behavior.
   */
  preserveSharedReferences?: boolean;
};

/**
 * Reap the `media_uploads` rows attached to a single object.
 *
 * `media_uploads` has no FK column to `objects` — the link is the same one the
 * media auth path uses (`routes/media.ts`): an object references its uploads by
 * embedding the media URL / `r2_key` in `attachments_json`, and each upload is
 * the unique, indexed `r2_key` (`media_uploads_r2_key_idx`) owned by the
 * object's author (`uploader_ap_id`, `media_uploads_uploader_idx`). So we scan
 * the author's uploads (indexed equality) and delete the ones whose `r2_key` is
 * substring-referenced in this object's `attachments_json`, mirroring the
 * `attachmentMatches` semantics. There is no engine-level CASCADE for this edge,
 * so without this the upload rows orphan on every runtime.
 *
 * The caller supplies a still-present object snapshot; this returns silently
 * when that snapshot has no attachments.
 *
 * Legacy callers with a `media` object-store binding return the eligible keys
 * for their existing trailing best-effort purge. The canonical prepared post
 * delete additionally persists those keys as durable jobs in its own atomic
 * object-delete batch; provider failures then remain replayable.
 *
 * A blob is only purged when its `r2_key` is no longer referenced by any OTHER
 * still-present object of the same author (an `r2_key`/media URL can be embedded
 * in more than one object's `attachments_json` even though the `media_uploads`
 * row is unique). Deleting the blob while another object still shows it would
 * data-loss the shared media, so the R2 delete is gated on the reference count
 * dropping to zero. The `media_uploads` row is kept with the blob while another
 * object still references that key; it is removed only for the eligible set.
 */
async function deleteAttachedMediaUploadsForObject(
  db: Database,
  obj: CascadeObject,
  removedObjectApIds: ReadonlySet<string>,
  media?: ObjectStore,
  options?: DeleteAttachedMediaOptions,
): Promise<{
  mediaKeys: string[];
  mediaUploadIds: string[];
  mediaDeletionJobs: MediaBlobDeletionJob[];
}> {
  // No attachment payload: nothing to reap.
  if (!obj.attachmentsJson || obj.attachmentsJson === "[]") {
    return { mediaKeys: [], mediaUploadIds: [], mediaDeletionJobs: [] };
  }

  const attachmentsJson = obj.attachmentsJson;

  // An attachment may reference an upload by EITHER its `r2_key`
  // (`uploads/<id>.<ext>`) OR its served `/media/<id>.<ext>` URL — the auth-path
  // matcher (media.ts attachmentMatches) accepts both, but the GC historically
  // matched only `r2_key`. A stored attachment carrying only the `/media/` URL
  // (any client that omits `r2_key`) therefore slipped the reap and leaked its
  // blob forever. Match BOTH forms here so the GC is symmetric with the auth path.
  // Indexed scan over the author's own uploads, then substring-match the upload
  // identity (r2_key OR /media URL) against the object's attachment payload.
  const candidates = await db
    .select({
      id: mediaUploads.id,
      r2Key: mediaUploads.r2Key,
      uploaderApId: mediaUploads.uploaderApId,
    })
    .from(mediaUploads)
    .where(eq(mediaUploads.uploaderApId, obj.attributedTo));

  const orphaned = candidates.filter(
    (m) =>
      attachmentsJson.includes(m.r2Key) ||
      attachmentsJson.includes(mediaUrlForKey(m.r2Key)),
  );

  if (orphaned.length === 0) {
    return { mediaKeys: [], mediaUploadIds: [], mediaDeletionJobs: [] };
  }

  const preserveSharedReferences =
    options?.preserveSharedReferences ?? Boolean(media);

  // Before any R2 purge, find which keys are still referenced by an object of
  // the same author OUTSIDE the complete set being removed. This matters for a
  // batch containing two posts that share one blob: checking only "another
  // object" would make each target keep the other target's key, then leak the
  // row and blob after both objects disappear.
  const stillReferencedKeys = new Set<string>();
  if (preserveSharedReferences) {
    // Page only matching AP-IDs and stop at the first survivor. A NOT IN list
    // cannot safely carry an unbounded removal set through D1's 100-parameter
    // ceiling; keyset pages keep every query constant-sized without loading a
    // prolific author's complete object history. instr() is literal and avoids
    // D1's long-LIKE complexity failure.
    for (const m of orphaned) {
      let cursor: string | undefined;
      while (true) {
        const referenceMatch = and(
          eq(objects.attributedTo, obj.attributedTo),
          or(
            sql`instr(${objects.attachmentsJson}, ${m.r2Key}) > 0`,
            sql`instr(${objects.attachmentsJson}, ${mediaUrlForKey(m.r2Key)}) > 0`,
          ),
          cursor ? gt(objects.apId, cursor) : undefined,
        );
        const refs = await db
          .select({ apId: objects.apId })
          .from(objects)
          .where(referenceMatch)
          .orderBy(asc(objects.apId))
          .limit(D1_IN_CHUNK);
        if (refs.some((ref) => !removedObjectApIds.has(ref.apId))) {
          stillReferencedKeys.add(m.r2Key);
          break;
        }
        if (refs.length < D1_IN_CHUNK) break;
        cursor = refs.at(-1)?.apId;
        if (!cursor) break;
      }
    }
  }

  // Delete the media_uploads rows whose blob we are actually purging. Rows
  // whose `r2_key` is still referenced by another present object are KEPT (row
  // AND blob) so that, when that final referencer is later deleted, this same
  // candidates scan still finds the row and can GC the now-orphaned blob —
  // otherwise the shared blob would leak permanently once its DB row vanished.
  // The prepared canonical path preserves shared rows even when MEDIA is
  // absent: a missing binding is not permission to lose durable deletion
  // intent or remove a blob still referenced by another object. Legacy
  // cascades retain their historical behavior when no binding is supplied.
  const idsToDelete = preserveSharedReferences
    ? orphaned.filter((m) => !stillReferencedKeys.has(m.r2Key)).map((m) => m.id)
    : orphaned.map((m) => m.id);
  const eligible = preserveSharedReferences
    ? orphaned.filter((m) => !stillReferencedKeys.has(m.r2Key))
    : [];
  // Return the keys whose reference count has now dropped to zero. The caller
  // purges them via purgeMediaBlobs AFTER it deletes the objects row, so the
  // IRREVERSIBLE R2 delete is the trailing step: if the objects-row delete fails
  // the blob is still present and the post is recoverable, rather than the post
  // surviving with a permanently-deleted blob (a broken image with no recovery).
  // Keys still embedded in another present object's `attachments_json` are kept
  // (blob + media_uploads row) so shared media isn't lost.
  return {
    mediaKeys: preserveSharedReferences
      ? orphaned.map((m) => m.r2Key).filter((k) => !stillReferencedKeys.has(k))
      : [],
    mediaUploadIds: idsToDelete,
    mediaDeletionJobs: eligible.map((m) => ({
      r2Key: m.r2Key,
      uploaderApId: m.uploaderApId,
    })),
  };
}

/**
 * Best-effort purge of unreferenced R2 blobs, intended as the TRAILING step
 * after the objects row has been deleted (see deleteObjectCascade's return).
 * R2 errors never propagate — a failed purge degrades to a leaked blob, the
 * system's already-accepted media failure mode.
 */
export async function purgeMediaBlobs(
  media: ObjectStore | undefined,
  keys: string[],
): Promise<void> {
  if (!media || keys.length === 0) return;
  try {
    await media.delete(keys);
  } catch {
    // Swallow: storage purge is best-effort and must not fail the delete flow.
  }
}

/**
 * Complete a canonical deletion job after its owning object batch commits.
 * Physical deletion remains trailing and job rows are removed only after the
 * ObjectStore acknowledges the whole key set. A missing binding, provider
 * failure, partial failure, or process loss leaves the durable rows for the
 * scheduled drain.
 */
export async function purgeMediaBlobDeletionJobs(
  db: Database,
  media: ObjectStore | undefined,
  keys: readonly string[],
): Promise<void> {
  if (!media || keys.length === 0) return;
  try {
    const jobs = await loadMediaBlobDeletionJobs(db, keys);
    if (jobs.length === 0) return;
    const referencedKeys = await findReferencedMediaKeys(db, jobs);
    const deletableKeys = jobs
      .map((job) => job.r2Key)
      .filter((key) => !referencedKeys.has(key));
    if (deletableKeys.length === 0) return;
    await media.delete(deletableKeys);
    await deleteMediaBlobDeletionJobRows(db, deletableKeys);
  } catch {
    // Keep every job on either storage or DB failure. The retention drain will
    // replay the idempotent delete instead of acknowledging lost intent.
  }
}

const MEDIA_BLOB_DELETION_DRAIN_LIMIT = 50;
const MEDIA_BLOB_DELETION_RETRY_DELAY_MS = 60_000;

/**
 * Drain at most one bounded page of durable media deletion jobs. This is the
 * final retention step so a missing MEDIA binding or storage failure rejects
 * only this step while all earlier retention work remains committed.
 */
export async function drainMediaBlobDeletionJobs(
  db: Database,
  media: ObjectStore | undefined,
): Promise<number> {
  const jobs = await db
    .select({
      r2Key: mediaBlobDeletionJobs.r2Key,
      uploaderApId: mediaBlobDeletionJobs.uploaderApId,
    })
    .from(mediaBlobDeletionJobs)
    .where(lte(mediaBlobDeletionJobs.nextAttemptAt, new Date().toISOString()))
    .orderBy(
      asc(mediaBlobDeletionJobs.nextAttemptAt),
      asc(mediaBlobDeletionJobs.createdAt),
      asc(mediaBlobDeletionJobs.r2Key),
    )
    .limit(MEDIA_BLOB_DELETION_DRAIN_LIMIT);

  if (jobs.length === 0) return 0;
  const keys = jobs.map((job) => job.r2Key);
  // Move the selected page out of the due set before the external call. This
  // prevents a poison key or a lost acknowledgement from monopolizing the
  // oldest 50 rows and lets newer due work progress on the next pass. A failed
  // DB update fails closed before any storage mutation.
  const nextAttemptAt = new Date(
    Date.now() + MEDIA_BLOB_DELETION_RETRY_DELAY_MS,
  ).toISOString();
  await rescheduleMediaBlobDeletionJobs(db, keys, nextAttemptAt);
  if (!media) {
    throw new Error(
      "media blob deletion retention requires MEDIA for pending jobs",
    );
  }

  const referencedKeys = await findReferencedMediaKeys(db, jobs);
  const deletableKeys = keys.filter((key) => !referencedKeys.has(key));
  if (deletableKeys.length === 0) return 0;
  await media.delete(deletableKeys);
  // The selected page is bounded at 50, below the existing D1-safe
  // 90-parameter budget. A failed delete keeps all jobs because this statement
  // is reached only after ObjectStore success; their next attempt is already
  // delayed by the update above.
  await deleteMediaBlobDeletionJobRows(db, deletableKeys);
  return deletableKeys.length;
}

/**
 * Reap a profile / community image blob that was just REPLACED.
 *
 * Avatar / header / community-icon media is attached to no object, so neither
 * the object-delete GC nor the expired-story reap ever touches it. Replacing the
 * image — a normal, repeatable user action — would otherwise orphan the prior
 * blob + `media_uploads` row in R2 forever (there is no orphaned-key sweep).
 *
 * Call this AFTER the new URL is persisted: it reaps the OLD `/media/...` URL's
 * upload iff that URL is no longer referenced by ANY actor avatar/header, any
 * non-deleted community icon, or any of the uploader's objects' attachments
 * (URL or `r2_key` form). No-op for empty/external URLs or an upload owned by a
 * different actor. Best-effort: never throws into the caller's response path.
 */
export async function reapReplacedMediaUrl(
  db: Database,
  oldUrl: string | null | undefined,
  uploaderApId: string,
  media?: ObjectStore,
): Promise<void> {
  try {
    if (!oldUrl || !oldUrl.startsWith("/media/")) return;
    const filename = oldUrl.slice("/media/".length);
    if (!filename || filename.includes("/") || filename.includes("..")) return;
    const r2Key = `uploads/${filename}`;

    // Only ever reap a blob THIS actor uploaded.
    const owned = await db
      .select({ id: mediaUploads.id })
      .from(mediaUploads)
      .where(
        and(
          eq(mediaUploads.r2Key, r2Key),
          eq(mediaUploads.uploaderApId, uploaderApId),
        ),
      )
      .get();
    if (!owned) return;

    // Reuse the same reference predicate as durable deletion jobs. This keeps
    // actor icon/header, live community icon, and uploader-owned object
    // references aligned across replacement and retry windows.
    const referenced = await findReferencedMediaKeys(db, [
      { r2Key, uploaderApId },
    ]);
    if (referenced.has(r2Key)) return;

    // Unreferenced: drop the DB row, then best-effort purge the blob.
    await db.delete(mediaUploads).where(eq(mediaUploads.id, owned.id));
    await purgeMediaBlobs(media, [r2Key]);
  } catch {
    // Best-effort hygiene: a failure just leaves the prior blob (the existing
    // accepted media failure mode), never breaks the profile/community update.
  }
}

/**
 * Delete all child rows that reference `objectApId` (the object's `ap_id`).
 *
 * Mirrors the `ON DELETE CASCADE` edges declared in the migrations:
 *   likes, announces, bookmarks, object_recipients,
 *   story_views, story_votes, story_shares.
 *
 * Also reaps the object-attached `media_uploads` rows, which have no FK to
 * `objects` and would otherwise orphan (see `deleteAttachedMediaUploads`). When
 * a `media` binding is passed, the backing R2 blobs are best-effort deleted too
 * so storage does not leak; pass `c.env.MEDIA` from the request context.
 *
 * Does not touch the `objects` row or `activities` (SET NULL, not CASCADE),
 * but cancels every durable notification/delivery projection of Activities
 * that target the object.
 */
export async function deleteObjectCascade(
  db: Database,
  objectApId: string,
  media?: ObjectStore,
): Promise<string[]> {
  return await deleteObjectsCascade(db, [objectApId], media);
}

/**
 * Prepare one local object's complete child/projection cleanup without writing
 * it. Local delete owners compose this with counters, the outbound Delete,
 * durable fanout intent, final object removal, and exact media deletion jobs in
 * one D1 batch. This is the only object-cascade path that enqueues these jobs.
 * The legacy deleteObjectCascade/deleteObjectsCascade helpers intentionally do
 * not: they commit metadata before their callers delete object rows.
 */
export async function prepareObjectDeleteCascade(
  db: Database,
  objectApId: string,
  media?: ObjectStore,
): Promise<{
  mediaKeys: string[];
  statements: readonly [D1Statement, ...D1Statement[]];
}> {
  const obj = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      attachmentsJson: objects.attachmentsJson,
    })
    .from(objects)
    .where(eq(objects.apId, objectApId))
    .get();

  const mediaPlan = obj
    ? await deleteAttachedMediaUploadsForObject(
        db,
        obj,
        new Set([objectApId]),
        media,
        { preserveSharedReferences: true },
      )
    : { mediaKeys: [], mediaUploadIds: [], mediaDeletionJobs: [] };

  const mediaDeleteStatements = chunkForInClause(mediaPlan.mediaUploadIds).map(
    (ids) =>
      db
        .delete(mediaUploads)
        .where(inArray(mediaUploads.id, ids)) as D1Statement,
  );
  const mediaDeletionJobCreatedAt = new Date().toISOString();
  const mediaDeletionJobStatements = insertMany(
    db,
    mediaBlobDeletionJobs,
    mediaPlan.mediaDeletionJobs.map(({ r2Key, uploaderApId }) => {
      return {
        r2Key,
        uploaderApId,
        createdAt: mediaDeletionJobCreatedAt,
        nextAttemptAt: mediaDeletionJobCreatedAt,
      };
    }),
    { conflict: "ignore" },
  );

  return {
    mediaKeys: [...new Set(mediaPlan.mediaKeys)],
    statements: [
      ...mediaDeleteStatements,
      ...mediaDeletionJobStatements,
      db.delete(likes).where(eq(likes.objectApId, objectApId)) as D1Statement,
      db
        .delete(announces)
        .where(eq(announces.objectApId, objectApId)) as D1Statement,
      db
        .delete(bookmarks)
        .where(eq(bookmarks.objectApId, objectApId)) as D1Statement,
      db
        .delete(objectRecipients)
        .where(eq(objectRecipients.objectApId, objectApId)) as D1Statement,
      db
        .delete(storyViews)
        .where(eq(storyViews.storyApId, objectApId)) as D1Statement,
      db
        .delete(storyVotes)
        .where(eq(storyVotes.storyApId, objectApId)) as D1Statement,
      db
        .delete(storyShares)
        .where(eq(storyShares.storyApId, objectApId)) as D1Statement,
      ...activityProjectionDeleteStatements(
        db,
        eq(activities.objectApId, objectApId),
      ),
    ] as [D1Statement, ...D1Statement[]],
  };
}

/**
 * Reap every child row for a set of objects without deleting the object rows.
 * This is the set-shaped counterpart to {@link deleteObjectCascade}; callers
 * still own the final object delete and trailing {@link purgeMediaBlobs}. It
 * intentionally does not enqueue durable media jobs because its callers may
 * commit the object mutation separately.
 *
 * The old bulk callers invoked the singular helper once per object. On D1 that
 * meant one attachment read plus eight serial delete round-trips per post: five
 * empty posts took about ten seconds in a real workerd probe and larger domain
 * purges could outlive the request. Here each <=90-id D1-safe chunk issues one
 * atomic twelve-statement batch, so latency scales by chunks rather than posts.
 */
export async function deleteObjectsCascade(
  db: Database,
  objectApIds: string[],
  media?: ObjectStore,
): Promise<string[]> {
  const uniqueApIds = [...new Set(objectApIds)];
  if (uniqueApIds.length === 0) return [];

  const cascadeObjects: CascadeObject[] = [];
  for (const chunk of chunkForInClause(uniqueApIds)) {
    cascadeObjects.push(
      ...(await db
        .select({
          apId: objects.apId,
          attributedTo: objects.attributedTo,
          attachmentsJson: objects.attachmentsJson,
        })
        .from(objects)
        .where(inArray(objects.apId, chunk))),
    );
  }
  if (cascadeObjects.length === 0) return [];
  const existingApIds = cascadeObjects.map((obj) => obj.apId);
  const removedObjectApIds = new Set(existingApIds);

  // Remote attachments are normally ordinary remote URLs with no local
  // media_uploads rows. Discover the small set of authors that actually own a
  // managed upload before entering the per-object media GC, otherwise every
  // image post would reintroduce one serial indexed read during defederation.
  const objectsWithAttachments = cascadeObjects.filter(
    (obj) => obj.attachmentsJson && obj.attachmentsJson !== "[]",
  );
  const authorsWithUploads = new Set<string>();
  if (objectsWithAttachments.length > 0) {
    const authors = [
      ...new Set(objectsWithAttachments.map((obj) => obj.attributedTo)),
    ];
    for (const chunk of chunkForInClause(authors)) {
      const rows = await db
        .selectDistinct({ uploaderApId: mediaUploads.uploaderApId })
        .from(mediaUploads)
        .where(inArray(mediaUploads.uploaderApId, chunk));
      for (const row of rows) authorsWithUploads.add(row.uploaderApId);
    }
  }

  const mediaKeys = new Set<string>();
  const mediaUploadIds = new Set<string>();
  for (const obj of objectsWithAttachments) {
    if (!authorsWithUploads.has(obj.attributedTo)) continue;
    const plan = await deleteAttachedMediaUploadsForObject(
      db,
      obj,
      removedObjectApIds,
      media,
    );
    for (const key of plan.mediaKeys) mediaKeys.add(key);
    for (const id of plan.mediaUploadIds) mediaUploadIds.add(id);
  }
  const mediaStatements = chunkForInClause([...mediaUploadIds]).map(
    (ids) =>
      db
        .delete(mediaUploads)
        .where(inArray(mediaUploads.id, ids)) as D1Statement,
  );
  for (
    let offset = 0;
    offset < mediaStatements.length;
    offset += D1_MAX_BATCH_STATEMENTS
  ) {
    const page = mediaStatements.slice(
      offset,
      offset + D1_MAX_BATCH_STATEMENTS,
    );
    await runBatch(db, page as [D1Statement, ...D1Statement[]]);
  }

  for (const chunk of chunkForInClause(existingApIds)) {
    // Cancel every notification/delivery projection of retained Activities
    // that target these objects. A queued Create/Update must not be delivered
    // after its object has disappeared, and an in-flight/terminal push job or
    // claim must not retain that deleted payload. Keep the Activity ledger rows
    // themselves; callers may need history/Undo, and the new outbound Delete
    // Activity is created only after this cascade so it remains unaffected.
    await runBatch(db, [
      db.delete(likes).where(inArray(likes.objectApId, chunk)),
      db.delete(announces).where(inArray(announces.objectApId, chunk)),
      db.delete(bookmarks).where(inArray(bookmarks.objectApId, chunk)),
      db
        .delete(objectRecipients)
        .where(inArray(objectRecipients.objectApId, chunk)),
      db.delete(storyViews).where(inArray(storyViews.storyApId, chunk)),
      db.delete(storyVotes).where(inArray(storyVotes.storyApId, chunk)),
      db.delete(storyShares).where(inArray(storyShares.storyApId, chunk)),
      ...activityProjectionDeleteStatements(
        db,
        inArray(activities.objectApId, chunk),
      ),
    ]);
  }

  return [...mediaKeys];
}
