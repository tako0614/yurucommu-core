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

import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import type { IObjectStorage } from "../../runtime/types.ts";
import {
  activities,
  actors,
  announces,
  bookmarks,
  communities,
  inbox as inboxTable,
  likes,
  mediaUploads,
  objectRecipients,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";

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
 * Returns silently when the object row is already gone (caller may delete the
 * object before or after calling this) or has no attachments.
 *
 * When a `media` object-store binding is provided, the backing R2 blobs for the
 * reaped uploads are best-effort deleted by `r2_key` (mirroring the
 * account-delete teardown in `routes/actors.ts`). R2 errors never fail the DB
 * delete; without this the blobs leak forever (there is no orphaned-key GC).
 *
 * A blob is only purged when its `r2_key` is no longer referenced by any OTHER
 * still-present object of the same author (an `r2_key`/media URL can be embedded
 * in more than one object's `attachments_json` even though the `media_uploads`
 * row is unique). Deleting the blob while another object still shows it would
 * data-loss the shared media, so the R2 delete is gated on the reference count
 * dropping to zero. The DB-row delete is unconditional (the reaped rows belong
 * to this object's reap set regardless).
 */
async function deleteAttachedMediaUploads(
  db: Database,
  objectApId: string,
  media?: IObjectStorage,
): Promise<string[]> {
  const obj = await db
    .select({
      attributedTo: objects.attributedTo,
      attachmentsJson: objects.attachmentsJson,
    })
    .from(objects)
    .where(eq(objects.apId, objectApId))
    .get();

  // No object row (already deleted) or no attachment payload: nothing to reap.
  if (!obj || !obj.attachmentsJson || obj.attachmentsJson === "[]") return [];

  const attachmentsJson = obj.attachmentsJson;

  // An attachment may reference an upload by EITHER its `r2_key`
  // (`uploads/<id>.<ext>`) OR its served `/media/<id>.<ext>` URL — the auth-path
  // matcher (media.ts attachmentMatches) accepts both, but the GC historically
  // matched only `r2_key`. A stored attachment carrying only the `/media/` URL
  // (any client that omits `r2_key`) therefore slipped the reap and leaked its
  // blob forever. Match BOTH forms here so the GC is symmetric with the auth path.
  const mediaUrlForKey = (r2Key: string): string =>
    r2Key.startsWith("uploads/")
      ? `/media/${r2Key.slice("uploads/".length)}`
      : r2Key;

  // Indexed scan over the author's own uploads, then substring-match the upload
  // identity (r2_key OR /media URL) against the object's attachment payload.
  const candidates = await db
    .select({ id: mediaUploads.id, r2Key: mediaUploads.r2Key })
    .from(mediaUploads)
    .where(eq(mediaUploads.uploaderApId, obj.attributedTo));

  const orphaned = candidates.filter(
    (m) =>
      attachmentsJson.includes(m.r2Key) ||
      attachmentsJson.includes(mediaUrlForKey(m.r2Key)),
  );

  if (orphaned.length === 0) return [];

  // Before any R2 purge, find which of these `r2_key`s are still referenced by
  // ANOTHER (different `ap_id`), still-present object of the same author. Such
  // a key must NOT have its blob deleted — another object still shows it. We
  // run this read while the rows are still present so an OTHER object whose
  // `attachments_json` happens to point back at this object's reap set is
  // honoured; the lookup is scoped to the author's own objects (indexed) and
  // excludes the object being reaped.
  const stillReferencedKeys = new Set<string>();
  if (media) {
    // For each orphaned key, ask SQL (indexed by attributedTo) whether ANOTHER
    // present object of this author still references it — instead of loading
    // EVERY other object's attachmentsJson into memory and substring-scanning
    // them all (O(objects × keys), unbounded for a prolific author). `orphaned`
    // is only this object's own attachments (a handful), so this is a small,
    // bounded set of indexed lookups. Uses instr() (literal substring), NOT
    // `LIKE '%<key>%'`: a 73-char `uploads/<64-hex>.png` key in a `%...%` pattern
    // exceeds D1's LIKE pattern-complexity limit (SQLITE_ERROR 7500, ~50 chars).
    // Mirrors media.ts findReferencingObject.
    for (const m of orphaned) {
      const ref = await db
        .select({ apId: objects.apId })
        .from(objects)
        .where(
          and(
            eq(objects.attributedTo, obj.attributedTo),
            ne(objects.apId, objectApId),
            or(
              sql`instr(${objects.attachmentsJson}, ${m.r2Key}) > 0`,
              sql`instr(${objects.attachmentsJson}, ${mediaUrlForKey(m.r2Key)}) > 0`,
            ),
          ),
        )
        .get();
      if (ref) stillReferencedKeys.add(m.r2Key);
    }
  }

  // Delete the media_uploads rows whose blob we are actually purging. Rows
  // whose `r2_key` is still referenced by another present object are KEPT (row
  // AND blob) so that, when that final referencer is later deleted, this same
  // candidates scan still finds the row and can GC the now-orphaned blob —
  // otherwise the shared blob would leak permanently once its DB row vanished.
  // Without a `media` binding there is no R2 to GC, so all rows are removed.
  const idsToDelete = media
    ? orphaned.filter((m) => !stillReferencedKeys.has(m.r2Key)).map((m) => m.id)
    : orphaned.map((m) => m.id);
  if (idsToDelete.length > 0) {
    await db.delete(mediaUploads).where(inArray(mediaUploads.id, idsToDelete));
  }

  // Return the keys whose reference count has now dropped to zero. The caller
  // purges them via purgeMediaBlobs AFTER it deletes the objects row, so the
  // IRREVERSIBLE R2 delete is the trailing step: if the objects-row delete fails
  // the blob is still present and the post is recoverable, rather than the post
  // surviving with a permanently-deleted blob (a broken image with no recovery).
  // Keys still embedded in another present object's `attachments_json` are kept
  // (blob + media_uploads row) so shared media isn't lost.
  return media
    ? orphaned.map((m) => m.r2Key).filter((k) => !stillReferencedKeys.has(k))
    : [];
}

/**
 * Best-effort purge of unreferenced R2 blobs, intended as the TRAILING step
 * after the objects row has been deleted (see deleteObjectCascade's return).
 * R2 errors never propagate — a failed purge degrades to a leaked blob, the
 * system's already-accepted media failure mode.
 */
export async function purgeMediaBlobs(
  media: IObjectStorage | undefined,
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
  media?: IObjectStorage,
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

    // Still an actor avatar/header somewhere (e.g. set as both icon and header)?
    const actorRef = await db
      .select({ apId: actors.apId })
      .from(actors)
      .where(or(eq(actors.iconUrl, oldUrl), eq(actors.headerUrl, oldUrl)))
      .get();
    if (actorRef) return;

    // Still a (non-deleted) community icon?
    const communityRef = await db
      .select({ apId: communities.apId })
      .from(communities)
      .where(
        and(eq(communities.iconUrl, oldUrl), isNull(communities.deletedAt)),
      )
      .get();
    if (communityRef) return;

    // Still embedded in one of the uploader's objects' attachments (URL or key)?
    const objectRef = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(
        and(
          eq(objects.attributedTo, uploaderApId),
          or(
            sql`instr(${objects.attachmentsJson}, ${oldUrl}) > 0`,
            sql`instr(${objects.attachmentsJson}, ${r2Key}) > 0`,
          ),
        ),
      )
      .get();
    if (objectRef) return;

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
 * Does not touch the `objects` row or `activities` (SET NULL, not CASCADE).
 */
export async function deleteObjectCascade(
  db: Database,
  objectApId: string,
  media?: IObjectStorage,
): Promise<string[]> {
  // Reap the media_uploads rows + child rows while the object row (and its
  // attachments_json) is still readable. Returns the R2 keys whose blobs are now
  // unreferenced — the caller MUST purge them via purgeMediaBlobs AFTER it has
  // deleted the objects row, so the irreversible R2 delete is the trailing step.
  const mediaKeys = await deleteAttachedMediaUploads(db, objectApId, media);
  await db.delete(likes).where(eq(likes.objectApId, objectApId));
  await db.delete(announces).where(eq(announces.objectApId, objectApId));
  await db.delete(bookmarks).where(eq(bookmarks.objectApId, objectApId));
  await db
    .delete(objectRecipients)
    .where(eq(objectRecipients.objectApId, objectApId));
  await db.delete(storyViews).where(eq(storyViews.storyApId, objectApId));
  await db.delete(storyVotes).where(eq(storyVotes.storyApId, objectApId));
  await db.delete(storyShares).where(eq(storyShares.storyApId, objectApId));

  // Reap NOTIFICATION inbox rows that pointed at this object (a Like / Announce /
  // reply-Create that notified a local user). After the object row is gone the
  // notifications query's leftJoin(objects) yields NULL, so these would otherwise
  // render as dangling notifications (blank content, dead link) AND keep inflating
  // the unread badge (the inbox row stays read=0). Delete the INBOX rows only, via
  // a subquery (D1-param-safe) — NOT the `activities` rows, which may include the
  // outbound federation Delete that must survive to be delivered.
  await db
    .delete(inboxTable)
    .where(
      inArray(
        inboxTable.activityApId,
        db
          .select({ id: activities.apId })
          .from(activities)
          .where(eq(activities.objectApId, objectApId)),
      ),
    );
  return mediaKeys;
}
