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

import { eq } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  announces,
  bookmarks,
  likes,
  objectRecipients,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../db/index.ts";

/**
 * Delete all child rows that reference `objectApId` (the object's `ap_id`).
 *
 * Mirrors the `ON DELETE CASCADE` edges declared in the migrations:
 *   likes, announces, bookmarks, object_recipients,
 *   story_views, story_votes, story_shares.
 *
 * Does not touch the `objects` row or `activities` (SET NULL, not CASCADE).
 */
export async function deleteObjectCascade(
  db: Database,
  objectApId: string,
): Promise<void> {
  await db.delete(likes).where(eq(likes.objectApId, objectApId));
  await db.delete(announces).where(eq(announces.objectApId, objectApId));
  await db.delete(bookmarks).where(eq(bookmarks.objectApId, objectApId));
  await db
    .delete(objectRecipients)
    .where(eq(objectRecipients.objectApId, objectApId));
  await db.delete(storyViews).where(eq(storyViews.storyApId, objectApId));
  await db.delete(storyVotes).where(eq(storyVotes.storyApId, objectApId));
  await db.delete(storyShares).where(eq(storyShares.storyApId, objectApId));
}
