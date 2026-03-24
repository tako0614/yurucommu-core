import type { Database } from '../../../../db';
import { eq, and, sql } from 'drizzle-orm';
import { objects, follows, likes, announces, activities, inbox as inboxTable } from '../../../../db';
import { isLocal } from '../../../utils';
import type { Activity } from '../inbox-types';

// ---------------------------------------------------------------------------
// Shared helpers used by multiple inbox handler files
// ---------------------------------------------------------------------------

/** Upsert an activity record and create an inbox entry for a local actor. */
export async function upsertActivityAndNotify(
  db: Database,
  activityId: string,
  type: string,
  actorApId: string,
  objectApIdValue: string,
  rawActivity: Activity,
  recipientApId: string
): Promise<void> {
  const now = new Date().toISOString();

  await db.insert(activities)
    .values({
      apId: activityId,
      type,
      actorApId,
      objectApId: objectApIdValue,
      rawJson: JSON.stringify(rawActivity),
    })
    .onConflictDoNothing();

  await db.insert(inboxTable)
    .values({
      actorApId: recipientApId,
      activityApId: activityId,
      read: 0,
      createdAt: now,
    });
}

/**
 * Find a record by activityApId, then delete it using its compound key.
 * Returns the deleted record (or null if not found).
 */
export async function findAndDeleteLikeByActivityId(
  db: Database,
  activityApIdValue: string
): Promise<{ actorApId: string; objectApId: string } | null> {
  const record = await db.select({ actorApId: likes.actorApId, objectApId: likes.objectApId })
    .from(likes)
    .where(eq(likes.activityApId, activityApIdValue))
    .get();
  if (!record) return null;
  await db.delete(likes)
    .where(and(eq(likes.actorApId, record.actorApId), eq(likes.objectApId, record.objectApId)));
  return record;
}

export async function findAndDeleteAnnounceByActivityId(
  db: Database,
  activityApIdValue: string
): Promise<{ actorApId: string; objectApId: string } | null> {
  const record = await db.select({ actorApId: announces.actorApId, objectApId: announces.objectApId })
    .from(announces)
    .where(eq(announces.activityApId, activityApIdValue))
    .get();
  if (!record) return null;
  await db.delete(announces)
    .where(and(eq(announces.actorApId, record.actorApId), eq(announces.objectApId, record.objectApId)));
  return record;
}

/** Find a follow by activityApId and return it (or null). */
export async function findFollowByActivityId(
  db: Database,
  activityApIdValue: string
): Promise<{ followerApId: string; followingApId: string; status: string } | null> {
  const row = await db.select({
    followerApId: follows.followerApId,
    followingApId: follows.followingApId,
    status: follows.status,
  })
    .from(follows)
    .where(eq(follows.activityApId, activityApIdValue))
    .get();
  return row ?? null;
}

/** Delete a follow using its compound key. */
export async function deleteFollowByCompoundKey(
  db: Database,
  followerApId: string,
  followingApId: string
): Promise<void> {
  await db.delete(follows)
    .where(and(eq(follows.followerApId, followerApId), eq(follows.followingApId, followingApId)));
}

/**
 * Lookup the owner of an object and, if local, notify via upsertActivityAndNotify.
 * Returns the attributedTo value, or null if the object was not found.
 */
export async function notifyLocalObjectOwner(
  db: Database,
  objectApIdValue: string,
  activityId: string,
  activityType: string,
  actorApIdValue: string,
  rawActivity: Activity,
  baseUrl: string
): Promise<string | null> {
  const obj = await db.select({ attributedTo: objects.attributedTo })
    .from(objects)
    .where(eq(objects.apId, objectApIdValue))
    .get();
  if (!obj) return null;

  if (isLocal(obj.attributedTo, baseUrl)) {
    await upsertActivityAndNotify(
      db, activityId, activityType, actorApIdValue, objectApIdValue, rawActivity, obj.attributedTo
    );
  }
  return obj.attributedTo;
}

/**
 * Generic undo for Like or Announce: delete by direct object ID or fallback
 * to findAndDeleteBy ActivityId, then decrement the count field.
 * Returns true if the deletion was handled, false otherwise.
 */
export async function undoInteraction(
  db: Database,
  kind: 'like' | 'announce',
  countField: 'likeCount' | 'announceCount',
  directObjectId: string | undefined,
  activityId: string | null,
  actor: string
): Promise<boolean> {
  if (directObjectId) {
    if (kind === 'like') {
      await db.delete(likes).where(and(eq(likes.actorApId, actor), eq(likes.objectApId, directObjectId)));
    } else {
      await db.delete(announces).where(and(eq(announces.actorApId, actor), eq(announces.objectApId, directObjectId)));
    }
    await db.update(objects)
      .set({ [countField]: sql`${objects[countField]} - 1` })
      .where(eq(objects.apId, directObjectId));
    return true;
  }

  if (!activityId) return false;

  const record = kind === 'like'
    ? await findAndDeleteLikeByActivityId(db, activityId)
    : await findAndDeleteAnnounceByActivityId(db, activityId);
  if (record) {
    await db.update(objects)
      .set({ [countField]: sql`${objects[countField]} - 1` })
      .where(eq(objects.apId, record.objectApId));
    return true;
  }

  return false;
}
