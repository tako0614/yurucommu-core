import type { Database } from '../../../../db/index.ts';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { actors, objects, follows, likes, activities } from '../../../../db/index.ts';
import {
  activityApId,
  generateId,
  isLocal,
} from '../../../federation-helpers.ts';
import { enqueueDeliveryToActor } from '../../../lib/delivery/queue.ts';
import {
  type ActivityContext,
  type Activity,
  getActivityObject,
  getActivityObjectId,
} from '../inbox-types.ts';
import {
  upsertActivityAndNotify,
  findFollowByActivityId,
  deleteFollowByCompoundKey,
  findAndDeleteInteractionByActivityId,
  undoInteraction,
} from './inbox-shared-helpers.ts';

type ActorRow = typeof actors.$inferSelect;

// ---------------------------------------------------------------------------
// Follow handler
// ---------------------------------------------------------------------------

export async function handleFollow(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string,
  baseUrl: string
) {
  const db = c.get('db');

  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Determine if we need to approve
  const status = recipient.isPrivate ? 'pending' : 'accepted';
  const now = new Date().toISOString();

  // Use insert + onConflictDoNothing to atomically create follow record (prevents race condition)
  const insertResult = await db.insert(follows)
    .values({
      followerApId: actor,
      followingApId: recipient.apId,
      status,
      activityApId: activityId,
      acceptedAt: status === 'accepted' ? now : null,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  // If insert returned nothing, the follow already existed
  const isNewFollow = !!insertResult;
  if (!isNewFollow) return;

  // Update counts if accepted
  if (status === 'accepted') {
    await db.update(actors)
      .set({ followerCount: sql`${actors.followerCount} + 1` })
      .where(eq(actors.apId, recipient.apId));
  }

  // Store activity and add to inbox (AP Native notification)
  await upsertActivityAndNotify(
    db, activityId, 'Follow', actor, recipient.apId, activity, recipient.apId
  );

  // Send Accept response
  // If the recipient requires approval, do NOT auto-accept.
  if (status === 'accepted' && !isLocal(actor, baseUrl)) {
    const acceptId = activityApId(baseUrl, generateId());
    const acceptActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: acceptId,
      type: 'Accept',
      actor: recipient.apId,
      object: activityId,
    };

    // Store accept activity before enqueue.
    await db.insert(activities)
      .values({
        apId: acceptId,
        type: 'Accept',
        actorApId: recipient.apId,
        objectApId: activityId,
        rawJson: JSON.stringify(acceptActivity),
        direction: 'outbound',
      });

    // Outbound delivery must be async (no remote POST in request path).
    await enqueueDeliveryToActor(c.env, acceptId, actor);
  }
}

// ---------------------------------------------------------------------------
// Accept handler
// ---------------------------------------------------------------------------

export async function handleAccept(c: ActivityContext, activity: Activity) {
  const db = c.get('db');
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  const follow = await findFollowByActivityId(db, followId);
  if (!follow || follow.status === 'accepted') return;

  const now = new Date().toISOString();

  try {
    await db.update(follows)
      .set({ status: 'accepted', acceptedAt: now })
      .where(
        and(
          eq(follows.followerApId, follow.followerApId),
          eq(follows.followingApId, follow.followingApId),
        )
      );

    await db.update(actors)
      .set({ followingCount: sql`${actors.followingCount} + 1` })
      .where(eq(actors.apId, follow.followerApId));
    await db.update(actors)
      .set({ followerCount: sql`${actors.followerCount} + 1` })
      .where(eq(actors.apId, follow.followingApId));
  } catch (e) {
    console.error('[ActivityPub] Error in handleAccept:', e);
  }
}

// ---------------------------------------------------------------------------
// Reject handler
// ---------------------------------------------------------------------------

export async function handleReject(c: ActivityContext, activity: Activity) {
  const db = c.get('db');
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  const follow = await findFollowByActivityId(db, followId);
  if (!follow) return;

  await deleteFollowByCompoundKey(db, follow.followerApId, follow.followingApId);
}

// ---------------------------------------------------------------------------
// Undo handler
// ---------------------------------------------------------------------------

export async function handleUndo(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string,
  _baseUrl: string
) {
  const db = c.get('db');
  const activityObject = getActivityObject(activity);
  const objectType = activityObject?.type;
  const objectId = getActivityObjectId(activity);

  // If object is just a string (activity ID), try to find the original activity
  if (!objectType && objectId) {
    const resolved = await resolveUndoByActivityId(db, objectId, actor, recipient);
    if (resolved) return;
  }

  if (objectType === 'Follow') {
    await undoFollow(db, objectId, actor, recipient);
  } else if (objectType === 'Like') {
    await undoLike(db, objectId, activityObject, actor, recipient);
  } else if (objectType === 'Announce') {
    await undoAnnounce(db, objectId, activityObject, actor);
  }
}

// ---------------------------------------------------------------------------
// Undo sub-handlers (internal)
// ---------------------------------------------------------------------------

/**
 * When the Undo object is a bare ID string, look up the original activity
 * and undo it based on its stored type.
 * Returns true if handled (caller should return), false otherwise.
 */
async function resolveUndoByActivityId(
  db: Database,
  objectId: string,
  actor: string,
  recipient: ActorRow
): Promise<boolean> {
  const originalActivity = await db.select({
    type: activities.type,
    objectApId: activities.objectApId,
    actorApId: activities.actorApId,
  })
    .from(activities)
    .where(eq(activities.apId, objectId))
    .get();
  if (!originalActivity) return false;

  if (originalActivity.actorApId && originalActivity.actorApId !== actor) {
    console.warn(`[ActivityPub] Undo actor mismatch: ${actor} tried to undo activity by ${originalActivity.actorApId}`);
    return true;
  }

  if (originalActivity.type === 'Follow') {
    const follow = await findFollowByActivityId(db, objectId);
    if (follow) {
      await deleteFollowByCompoundKey(db, follow.followerApId, follow.followingApId);
    }
    await db.update(actors)
      .set({ followerCount: sql`${actors.followerCount} - 1` })
      .where(eq(actors.apId, recipient.apId));
    return true;
  }

  if ((originalActivity.type === 'Like' || originalActivity.type === 'Announce') && originalActivity.objectApId) {
    const kind = originalActivity.type === 'Like' ? 'like' as const : 'announce' as const;
    const countField = kind === 'like' ? 'likeCount' as const : 'announceCount' as const;
    await findAndDeleteInteractionByActivityId(db, kind, objectId);
    await db.update(objects)
      .set({ [countField]: sql`${objects[countField]} - 1` })
      .where(eq(objects.apId, originalActivity.objectApId));
    return true;
  }

  return true;
}

async function undoFollow(
  db: Database,
  objectId: string | null,
  actor: string,
  recipient: ActorRow
): Promise<void> {
  const follow = objectId ? await findFollowByActivityId(db, objectId) : null;

  if (follow) {
    await deleteFollowByCompoundKey(db, follow.followerApId, follow.followingApId);
  } else {
    await db.delete(follows)
      .where(and(eq(follows.followerApId, actor), eq(follows.followingApId, recipient.apId)));
  }

  await db.update(actors)
    .set({ followerCount: sql`${actors.followerCount} - 1` })
    .where(eq(actors.apId, recipient.apId));
}

async function undoLike(
  db: Database,
  objectId: string | null,
  activityObject: ReturnType<typeof getActivityObject>,
  actor: string,
  recipient: ActorRow
): Promise<void> {
  const handled = await undoInteraction(
    db, 'like', 'likeCount', activityObject?.object, objectId, actor
  );
  if (handled) return;

  // Last resort: delete any like from this actor for the recipient's objects
  const recipientObjects = await db.select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.attributedTo, recipient.apId));
  if (recipientObjects.length > 0) {
    await db.delete(likes)
      .where(
        and(
          eq(likes.actorApId, actor),
          inArray(likes.objectApId, recipientObjects.map((o) => o.apId)),
        )
      );
  }
}

async function undoAnnounce(
  db: Database,
  objectId: string | null,
  activityObject: ReturnType<typeof getActivityObject>,
  actor: string
): Promise<void> {
  await undoInteraction(db, 'announce', 'announceCount', activityObject?.object, objectId, actor);
}
