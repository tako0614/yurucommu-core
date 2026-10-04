/**
 * Shared object-delete cascade.
 *
 * D1 enforces foreign keys. This helper also explicitly reaps child edges on
 * libsql connections with FK enforcement disabled, and cancels durable
 * delivery/notification projections that have no object FK.
 *
 * Callers own the final objects delete and counter/fanout side effects.
 * Migration 0003 makes activities.object_ap_id a plain AP-ID string: retain
 * the ledger and target for history/Undo. Migration 0032 atomically withdraws
 * its Create/Update/Announce publication when the caller deletes the object.
 * This helper does not itself commit that withdrawal before object deletion.
 *
 * Used by local deletes, remote Delete, moderation purge and account teardown.
 */

import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import type { D1Statement, Database } from "../../../db/index.ts";
import type { ObjectStore } from "../../runtime/types.ts";
import {
  activities,
  announces,
  bookmarks,
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
import {
  claimedMediaDeletionKeys,
  mediaDeletionIntentForKey,
} from "../../lib/media-deletion-claims.ts";
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
    offset += D1_MAX_BATCH_STATEMENTS - 2
  ) {
    const page = statements.slice(offset, offset + D1_MAX_BATCH_STATEMENTS - 2);
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

/**
 * Discover exact pending deletion identities attached to this source snapshot.
 * This is not an unreferenced proof and never removes metadata. The final
 * claim checks the complete current journal after the source mutation commits.
 */
async function prepareAttachedMediaDeletionForObject(
  db: Database,
  obj: CascadeObject,
): Promise<{ mediaKeys: string[]; mediaDeletionJobs: MediaBlobDeletionJob[] }> {
  if (!obj.attachmentsJson || obj.attachmentsJson === "[]") {
    return { mediaKeys: [], mediaDeletionJobs: [] };
  }
  // Enumerate bounded decoded OLD values, then probe the key index. Never
  // scan every upload belonging to this author for each deleted object.
  const payload = obj.attachmentsJson;
  if (
    payload.length > 16_384 ||
    new TextEncoder().encode(payload).byteLength > 49_152
  ) {
    return { mediaKeys: [], mediaDeletionJobs: [] };
  }
  const attached = await db
    .select({
      r2Key: mediaUploads.r2Key,
      uploaderApId: mediaUploads.uploaderApId,
    })
    .from(mediaUploads)
    .where(
      and(
        eq(mediaUploads.uploaderApId, obj.attributedTo),
        inArray(
          mediaUploads.r2Key,
          sql`(SELECT CASE
      WHEN substr(value.value,1,7)='/media/' THEN 'uploads/'||substr(value.value,8)
      ELSE value.value END
      FROM json_tree(CASE WHEN json_valid(${payload}) THEN ${payload} ELSE '[]' END) AS value
      WHERE value.type='text')`,
        ),
      ),
    );
  return {
    mediaKeys: attached.map((upload) => upload.r2Key),
    mediaDeletionJobs: attached,
  };
}

/** Trailing compatibility helper: physical deletion requires a DB claim. */
export async function purgeMediaBlobs(
  db: Database,
  media: ObjectStore | undefined,
  keys: string[],
): Promise<void> {
  await purgeMediaBlobDeletionJobs(db, media, keys);
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
    const deletableKeys = await claimedMediaDeletionKeys(
      db,
      jobs.map((job) => job.r2Key),
    );
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
    .where(
      lte(
        mediaBlobDeletionJobs.nextAttemptAt,
        new Date(Date.now()).toISOString(),
      ),
    )
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

  const deletableKeys = await claimedMediaDeletionKeys(db, keys);
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
 * Complete pending replacement intent only after the profile/community write.
 * Owning profile mutations and community update batches queue intent atomically;
 * this exact owner lookup additionally preserves old plain local URL intents.
 * A reference-first winner retains metadata/blob; a claim-first winner fences
 * every subsequent reference. Failure retains durable retry authority.
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

    // Pending intent cannot authorize storage. The database claim observes the
    // final desired reference set and removes metadata only when it wins.
    await mediaDeletionIntentForKey(db, r2Key, uploaderApId);
    await purgeMediaBlobDeletionJobs(db, media, [r2Key]);
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
 * `objects`. This prepares durable intent while retaining metadata. Callers
 * delete the source first, then pass these keys and DB to the trailing purge;
 * only the complete current reference proof can claim physical deletion.
 *
 * Does not touch the `objects` row or retained `activities` target strings,
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
 * one D1 batch. Every path retains upload metadata until the final DB claim;
 * pending intent alone never authorizes an external physical deletion.
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
    ? await prepareAttachedMediaDeletionForObject(db, obj)
    : { mediaKeys: [], mediaDeletionJobs: [] };

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
 * records durable pending media intent while retaining upload metadata. The
 * caller removes the source before a trailing purge can claim or delete bytes.
 *
 * The old bulk callers invoked the singular helper once per object. On D1 that
 * meant one attachment read plus eight serial delete round-trips per post: five
 * empty posts took about ten seconds in a real workerd probe and larger domain
 * purges could outlive the request. Here each <=90-id D1-safe chunk issues one
 * atomic bounded statement batch, so latency scales by chunks rather than posts.
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
  const mediaDeletionJobs = new Map<string, MediaBlobDeletionJob>();
  for (const obj of objectsWithAttachments) {
    if (!authorsWithUploads.has(obj.attributedTo)) continue;
    const plan = await prepareAttachedMediaDeletionForObject(db, obj);
    for (const key of plan.mediaKeys) mediaKeys.add(key);
    for (const job of plan.mediaDeletionJobs)
      mediaDeletionJobs.set(job.r2Key, job);
  }
  const now = new Date().toISOString();
  const mediaStatements = insertMany(
    db,
    mediaBlobDeletionJobs,
    [...mediaDeletionJobs.values()].map((job) => ({
      ...job,
      createdAt: now,
      nextAttemptAt: now,
    })),
    { conflict: "ignore" },
  );
  await runMediaJobStatements(db, mediaStatements);

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
