import type { Database } from '../../../../db';
import { eq, and, or, sql } from 'drizzle-orm';
import { actors, objects, follows, likes, announces } from '../../../../db';
import {
  activityApId,
  generateId,
  isLocal,
} from '../../../utils';
import {
  type ActivityContext,
  type Activity,
  getActivityObjectId,
} from '../inbox-types';
import {
  upsertActivityAndNotify,
  notifyLocalObjectOwner,
} from './inbox-shared-helpers';

type ActorRow = typeof actors.$inferSelect;

// ---------------------------------------------------------------------------
// Like handler
// ---------------------------------------------------------------------------

export async function handleLike(
  c: ActivityContext,
  activity: Activity,
  _recipient: ActorRow,
  actor: string,
  baseUrl: string
) {
  const db = c.get('prisma');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  const likedObj = await db.select({ attributedTo: objects.attributedTo })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (!likedObj) return;

  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Try to insert like; if duplicate, skip
  const insertResult = await db.insert(likes)
    .values({
      actorApId: actor,
      objectApId: objectId,
      activityApId: activityId,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (!insertResult) return; // duplicate

  await db.update(objects)
    .set({ likeCount: sql`${objects.likeCount} + 1` })
    .where(eq(objects.apId, objectId));

  if (isLocal(likedObj.attributedTo, baseUrl)) {
    await upsertActivityAndNotify(
      db, activityId, 'Like', actor, objectId, activity, likedObj.attributedTo
    );
  }
}

// ---------------------------------------------------------------------------
// Announce handler (repost/boost)
// ---------------------------------------------------------------------------

export async function handleAnnounce(
  c: ActivityContext,
  activity: Activity,
  _recipient: ActorRow,
  actor: string,
  baseUrl: string
) {
  const db = c.get('prisma');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  const activityId = activity.id || activityApId(baseUrl, generateId());

  const insertResult = await db.insert(announces)
    .values({
      actorApId: actor,
      objectApId: objectId,
      activityApId: activityId,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  const isNewAnnounce = !!insertResult;
  if (!isNewAnnounce) return;

  await db.update(objects)
    .set({ announceCount: sql`${objects.announceCount} + 1` })
    .where(eq(objects.apId, objectId));

  await notifyLocalObjectOwner(db, objectId, activityId, 'Announce', actor, activity, baseUrl);
}

// ---------------------------------------------------------------------------
// Add handler (collection add; used by some servers for membership)
// ---------------------------------------------------------------------------

export async function handleAdd(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string
) {
  const followingApId = resolveCollectionTarget(activity, recipient, actor);
  if (!followingApId) return;

  const db = c.get('prisma');
  const now = new Date().toISOString();
  await db.insert(follows)
    .values({
      followerApId: recipient.apId,
      followingApId,
      status: 'accepted',
      activityApId: activity.id || null,
      acceptedAt: now,
    })
    .onConflictDoUpdate({
      target: [follows.followerApId, follows.followingApId],
      set: {
        status: 'accepted',
        acceptedAt: now,
        activityApId: activity.id || undefined,
      },
    });
}

// ---------------------------------------------------------------------------
// Remove handler (collection remove; used for expulsion/ban)
// ---------------------------------------------------------------------------

export async function handleRemove(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string
) {
  const followingApId = resolveCollectionTarget(activity, recipient, actor);
  if (!followingApId) return;

  const db = c.get('prisma');
  await db.delete(follows)
    .where(
      and(
        eq(follows.followerApId, recipient.apId),
        eq(follows.followingApId, followingApId),
      )
    );
}

// ---------------------------------------------------------------------------
// Block handler (remote actor blocks the recipient)
// ---------------------------------------------------------------------------

export async function handleBlock(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string
) {
  const db = c.get('prisma');
  const blockedId = getActivityObjectId(activity);
  if (!blockedId) return;

  // Only act when the recipient is being blocked.
  if (blockedId !== recipient.apId) return;

  // Best-effort: sever follow relations in both directions.
  await db.delete(follows)
    .where(
      or(
        and(eq(follows.followerApId, recipient.apId), eq(follows.followingApId, actor)),
        and(eq(follows.followerApId, actor), eq(follows.followingApId, recipient.apId)),
      )
    );
}

// ---------------------------------------------------------------------------
// Flag handler (report)
// ---------------------------------------------------------------------------

export async function handleFlag(_c: ActivityContext, activity: Activity, actor: string) {
  const objectId = getActivityObjectId(activity);
  const targetId = getActivityTargetId(activity);
  // No moderation subsystem yet: record is already stored in activities; log for operators.
  console.warn('[ActivityPub] Flag received:', {
    actor,
    object: objectId,
    target: targetId,
    id: activity.id || null,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getActivityTargetId(activity: Activity): string | null {
  const target = activity.target;
  if (!target) return null;
  if (typeof target === 'string') return target;
  return target.id || null;
}

function normalizeCollectionTarget(targetId: string): string {
  if (targetId.endsWith('/followers')) {
    return targetId.slice(0, -'/followers'.length);
  }
  return targetId;
}

/**
 * Resolve the collection target for Add/Remove activities.
 * Returns the normalized followingApId, or null if the activity should be ignored
 * (missing object, object does not target recipient, or missing target).
 */
function resolveCollectionTarget(
  activity: Activity,
  recipient: ActorRow,
  actor: string
): string | null {
  const objectId = getActivityObjectId(activity);
  if (!objectId || objectId !== recipient.apId) return null;

  const targetId = getActivityTargetId(activity);
  return normalizeCollectionTarget(targetId || actor) || null;
}
