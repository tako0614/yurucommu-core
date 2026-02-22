import type { Context } from 'hono';
import type { Env, Variables } from '../../../types';
import type { PrismaClient, Actor as PrismaActor } from '../../../../generated/prisma';
import {
  activityApId,
  generateId,
  isLocal,
  isSafeRemoteUrl,
  objectApId,
  fetchWithTimeout,
} from '../../../utils';
import { enqueueDeliveryToActor } from '../../../lib/delivery/queue';
import {
  Activity,
  StoryOverlay,
  getActivityObject,
  getActivityObjectId,
} from '../inbox-types';

type ActivityContext = Context<{ Bindings: Env; Variables: Variables }>;

/**
 * Prisma transaction client type. Extracted from PrismaClient.$transaction callback parameter.
 * Works for both the top-level PrismaClient and the tx parameter inside $transaction callbacks.
 */
type PrismaTx = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];

// ---------------------------------------------------------------------------
// Inline helpers (not exported; reduce repetition within this file)
// ---------------------------------------------------------------------------

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

function isStoryType(type: string | string[] | undefined): boolean {
  if (!type) return false;
  return Array.isArray(type) ? type.includes('Story') : type === 'Story';
}

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

/** Upsert an activity record and create an inbox entry for a local actor. */
async function upsertActivityAndNotify(
  tx: PrismaTx,
  activityId: string,
  type: string,
  actorApId: string,
  objectApId: string,
  rawActivity: Activity,
  recipientApId: string
): Promise<void> {
  const now = new Date().toISOString();

  await tx.activity.upsert({
    where: { apId: activityId },
    update: {},
    create: {
      apId: activityId,
      type,
      actorApId,
      objectApId,
      rawJson: JSON.stringify(rawActivity),
    },
  });

  await tx.inbox.create({
    data: {
      actorApId: recipientApId,
      activityApId: activityId,
      read: 0,
      createdAt: now,
    },
  });
}

/**
 * Find a record by activityApId, then delete it using its compound key.
 * Returns the deleted record (or null if not found).
 */
async function findAndDeleteByActivityId<
  T extends { actorApId: string; objectApId: string },
>(
  tx: {
    findFirst: (args: { where: { activityApId: string } }) => Promise<T | null>;
    delete: (args: { where: { actorApId_objectApId: { actorApId: string; objectApId: string } } }) => Promise<T>;
  },
  activityApId: string
): Promise<T | null> {
  const record = await tx.findFirst({ where: { activityApId } });
  if (!record) return null;
  await tx.delete({
    where: {
      actorApId_objectApId: {
        actorApId: record.actorApId,
        objectApId: record.objectApId,
      },
    },
  });
  return record;
}

/** Find a follow by activityApId and return it (or null). */
async function findFollowByActivityId(
  prisma: PrismaClient | PrismaTx,
  activityApId: string
): Promise<{ followerApId: string; followingApId: string; status: string } | null> {
  return prisma.follow.findFirst({ where: { activityApId } });
}

/** Delete a follow using its compound key. */
async function deleteFollowByCompoundKey(
  prisma: PrismaClient | PrismaTx,
  followerApId: string,
  followingApId: string
): Promise<void> {
  await prisma.follow.delete({
    where: { followerApId_followingApId: { followerApId, followingApId } },
  });
}

/**
 * Lookup the owner of an object and, if local, notify via upsertActivityAndNotify.
 * Accepts both PrismaClient and transaction client since the methods used are common.
 * Returns the attributedTo value, or null if the object was not found.
 */
async function notifyLocalObjectOwner(
  tx: PrismaClient | PrismaTx,
  objectApId: string,
  activityId: string,
  activityType: string,
  actorApId: string,
  rawActivity: Activity,
  baseUrl: string
): Promise<string | null> {
  const obj = await tx.object.findUnique({
    where: { apId: objectApId },
    select: { attributedTo: true },
  });
  if (!obj) return null;

  if (isLocal(obj.attributedTo, baseUrl)) {
    await upsertActivityAndNotify(
      tx as PrismaTx, activityId, activityType, actorApId, objectApId, rawActivity, obj.attributedTo
    );
  }
  return obj.attributedTo;
}

/**
 * Generic undo for Like or Announce: delete by direct object ID or fallback
 * to findAndDeleteByActivityId, then decrement the count field.
 * Returns true if the deletion was handled, false otherwise.
 */
async function undoInteraction(
  prisma: PrismaClient,
  model: {
    deleteMany: (args: { where: { actorApId: string; objectApId: string } }) => Promise<unknown>;
    findFirst: (args: { where: { activityApId: string } }) => Promise<{ actorApId: string; objectApId: string } | null>;
    delete: (args: { where: { actorApId_objectApId: { actorApId: string; objectApId: string } } }) => Promise<{ actorApId: string; objectApId: string }>;
  },
  countField: 'likeCount' | 'announceCount',
  directObjectId: string | undefined,
  activityId: string | null,
  actor: string
): Promise<boolean> {
  if (directObjectId) {
    await model.deleteMany({ where: { actorApId: actor, objectApId: directObjectId } });
    await prisma.object.update({
      where: { apId: directObjectId },
      data: { [countField]: { decrement: 1 } },
    });
    return true;
  }

  if (!activityId) return false;

  const record = await findAndDeleteByActivityId(model, activityId);
  if (record) {
    await prisma.object.update({
      where: { apId: record.objectApId },
      data: { [countField]: { decrement: 1 } },
    });
    return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Exported handlers
// ---------------------------------------------------------------------------

// Handle Follow activity
export async function handleFollow(
  c: ActivityContext,
  activity: Activity,
  recipient: PrismaActor,
  actor: string,
  baseUrl: string
) {
  const prisma = c.get('prisma');

  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Determine if we need to approve
  const status = recipient.isPrivate ? 'pending' : 'accepted';
  const now = new Date().toISOString();

  // Use upsert to atomically create or update follow record (prevents race condition)
  const result = await prisma.follow.upsert({
    where: {
      followerApId_followingApId: {
        followerApId: actor,
        followingApId: recipient.apId,
      },
    },
    update: {},
    create: {
      followerApId: actor,
      followingApId: recipient.apId,
      status,
      activityApId: activityId,
      acceptedAt: status === 'accepted' ? now : null,
    },
  });

  // Only proceed with count updates and notifications for new follows
  const isNewFollow = result.activityApId === activityId;
  if (!isNewFollow) return;

  // Update counts if accepted
  if (status === 'accepted') {
    await prisma.actor.update({
      where: { apId: recipient.apId },
      data: { followerCount: { increment: 1 } },
    });
  }

  // Store activity and add to inbox (AP Native notification)
  await upsertActivityAndNotify(
    prisma, activityId, 'Follow', actor, recipient.apId, activity, recipient.apId
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
    await prisma.activity.create({
      data: {
        apId: acceptId,
        type: 'Accept',
        actorApId: recipient.apId,
        objectApId: activityId,
        rawJson: JSON.stringify(acceptActivity),
        direction: 'outbound',
      },
    });

    // Outbound delivery must be async (no remote POST in request path).
    await enqueueDeliveryToActor(c.env, acceptId, actor);
  }
}

// Handle Accept activity
export async function handleAccept(c: ActivityContext, activity: Activity) {
  const prisma = c.get('prisma');
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  const follow = await findFollowByActivityId(prisma, followId);
  if (!follow || follow.status === 'accepted') return;

  const now = new Date().toISOString();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.follow.update({
        where: {
          followerApId_followingApId: {
            followerApId: follow.followerApId,
            followingApId: follow.followingApId,
          },
        },
        data: { status: 'accepted', acceptedAt: now },
      });

      await tx.actor.update({
        where: { apId: follow.followerApId },
        data: { followingCount: { increment: 1 } },
      });
      await tx.actor.update({
        where: { apId: follow.followingApId },
        data: { followerCount: { increment: 1 } },
      });
    });
  } catch (e) {
    console.error('[ActivityPub] Transaction error in handleAccept:', e);
  }
}

// Handle Undo activity
export async function handleUndo(
  c: ActivityContext,
  activity: Activity,
  recipient: PrismaActor,
  actor: string,
  _baseUrl: string
) {
  const prisma = c.get('prisma');
  const activityObject = getActivityObject(activity);
  const objectType = activityObject?.type;
  const objectId = getActivityObjectId(activity);

  // If object is just a string (activity ID), try to find the original activity
  if (!objectType && objectId) {
    const resolved = await resolveUndoByActivityId(prisma, objectId, actor, recipient);
    if (resolved) return;
  }

  if (objectType === 'Follow') {
    await undoFollow(prisma, objectId, actor, recipient);
  } else if (objectType === 'Like') {
    await undoLike(prisma, objectId, activityObject, actor, recipient);
  } else if (objectType === 'Announce') {
    await undoAnnounce(prisma, objectId, activityObject, actor);
  }
}

/**
 * When the Undo object is a bare ID string, look up the original activity
 * and undo it based on its stored type.
 * Returns true if handled (caller should return), false otherwise.
 */
async function resolveUndoByActivityId(
  prisma: PrismaClient,
  objectId: string,
  actor: string,
  recipient: PrismaActor
): Promise<boolean> {
  const originalActivity = await prisma.activity.findUnique({
    where: { apId: objectId },
    select: { type: true, objectApId: true, actorApId: true },
  });
  if (!originalActivity) return false;

  if (originalActivity.actorApId && originalActivity.actorApId !== actor) {
    console.warn(`[ActivityPub] Undo actor mismatch: ${actor} tried to undo activity by ${originalActivity.actorApId}`);
    return true;
  }

  if (originalActivity.type === 'Follow') {
    const follow = await findFollowByActivityId(prisma, objectId);
    if (follow) {
      await deleteFollowByCompoundKey(prisma, follow.followerApId, follow.followingApId);
    }
    await prisma.actor.update({
      where: { apId: recipient.apId },
      data: { followerCount: { decrement: 1 } },
    });
    return true;
  }

  if (originalActivity.type === 'Like' && originalActivity.objectApId) {
    await findAndDeleteByActivityId(prisma.like, objectId);
    await prisma.object.update({
      where: { apId: originalActivity.objectApId },
      data: { likeCount: { decrement: 1 } },
    });
    return true;
  }

  if (originalActivity.type === 'Announce' && originalActivity.objectApId) {
    await findAndDeleteByActivityId(prisma.announce, objectId);
    await prisma.object.update({
      where: { apId: originalActivity.objectApId },
      data: { announceCount: { decrement: 1 } },
    });
    return true;
  }

  return true;
}

async function undoFollow(
  prisma: PrismaClient,
  objectId: string | null,
  actor: string,
  recipient: PrismaActor
): Promise<void> {
  const follow = objectId ? await findFollowByActivityId(prisma, objectId) : null;

  if (follow) {
    await deleteFollowByCompoundKey(prisma, follow.followerApId, follow.followingApId);
  } else {
    await prisma.follow.deleteMany({
      where: { followerApId: actor, followingApId: recipient.apId },
    });
  }

  await prisma.actor.update({
    where: { apId: recipient.apId },
    data: { followerCount: { decrement: 1 } },
  });
}

async function undoLike(
  prisma: PrismaClient,
  objectId: string | null,
  activityObject: ReturnType<typeof getActivityObject>,
  actor: string,
  recipient: PrismaActor
): Promise<void> {
  const handled = await undoInteraction(
    prisma, prisma.like, 'likeCount', activityObject?.object, objectId, actor
  );
  if (handled) return;

  // Last resort: delete any like from this actor for the recipient's objects
  const recipientObjects = await prisma.object.findMany({
    where: { attributedTo: recipient.apId },
    select: { apId: true },
  });
  await prisma.like.deleteMany({
    where: { actorApId: actor, objectApId: { in: recipientObjects.map((o) => o.apId) } },
  });
}

async function undoAnnounce(
  prisma: PrismaClient,
  objectId: string | null,
  activityObject: ReturnType<typeof getActivityObject>,
  actor: string
): Promise<void> {
  await undoInteraction(prisma, prisma.announce, 'announceCount', activityObject?.object, objectId, actor);
}

// Handle Like activity
export async function handleLike(
  c: ActivityContext,
  activity: Activity,
  _recipient: PrismaActor,
  actor: string,
  baseUrl: string
) {
  const prisma = c.get('prisma');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  const likedObj = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true },
  });
  if (!likedObj) return;

  const activityId = activity.id || activityApId(baseUrl, generateId());

  await prisma.$transaction(async (tx) => {
    try {
      await tx.like.create({
        data: {
          actorApId: actor,
          objectApId: objectId,
          activityApId: activityId,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return;
      throw error;
    }

    await tx.object.update({
      where: { apId: objectId },
      data: { likeCount: { increment: 1 } },
    });

    if (isLocal(likedObj.attributedTo, baseUrl)) {
      await upsertActivityAndNotify(
        tx, activityId, 'Like', actor, objectId, activity, likedObj.attributedTo
      );
    }
  });
}

// Handle Create activity
export async function handleCreate(
  c: ActivityContext,
  activity: Activity,
  _recipient: PrismaActor,
  actor: string,
  baseUrl: string
) {
  const prisma = c.get('prisma');
  const object = getActivityObject(activity);
  if (!object) return;

  // Handle Story type
  if (isStoryType(object.type)) {
    await handleCreateStory(c, activity, actor, baseUrl);
    return;
  }

  // Handle Note type
  if (object.type !== 'Note') return;

  const objectId = object.id || objectApId(baseUrl, generateId());

  // Check if object already exists
  const existing = await prisma.object.findUnique({
    where: { apId: objectId },
  });
  if (existing) return;

  const attachments = object.attachment ? JSON.stringify(object.attachment) : '[]';
  const publishedAt = object.published || new Date().toISOString();
  const parentObj = object.inReplyTo
    ? await prisma.object.findUnique({
        where: { apId: object.inReplyTo },
        select: { attributedTo: true },
      })
    : null;
  const shouldNotifyParent = !!(parentObj && isLocal(parentObj.attributedTo, baseUrl));
  const replyActivityId = shouldNotifyParent ? activity.id || activityApId(baseUrl, generateId()) : null;

  await prisma.$transaction(async (tx) => {
    try {
      await tx.object.create({
        data: {
          apId: objectId,
          type: 'Note',
          attributedTo: actor,
          content: object.content || '',
          summary: object.summary || null,
          attachmentsJson: attachments,
          inReplyTo: object.inReplyTo || null,
          visibility: object.to?.includes('https://www.w3.org/ns/activitystreams#Public') ? 'public' : 'unlisted',
          communityApId: null,
          published: publishedAt,
          isLocal: 0,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return;
      throw error;
    }

    await tx.actor.update({
      where: { apId: actor },
      data: { postCount: { increment: 1 } },
    });

    if (object.inReplyTo) {
      await tx.object.updateMany({
        where: { apId: object.inReplyTo },
        data: { replyCount: { increment: 1 } },
      });
    }

    if (shouldNotifyParent && parentObj && replyActivityId) {
      await upsertActivityAndNotify(
        tx, replyActivityId, 'Create', actor, objectId, activity, parentObj.attributedTo
      );
    }
  });
}

// Handle Create(Story) activity
export async function handleCreateStory(
  c: ActivityContext,
  activity: Activity,
  actor: string,
  baseUrl: string
) {
  const prisma = c.get('prisma');
  const object = getActivityObject(activity);
  if (!object) return;
  const objectId = object.id || objectApId(baseUrl, generateId());

  // Check if story already exists
  const existing = await prisma.object.findUnique({
    where: { apId: objectId },
  });
  if (existing) return;

  // attachment validation (required)
  if (!object.attachment) {
    console.error('Remote story has no attachment:', objectId);
    return;
  }

  // Normalize attachment (handle array or single object)
  const attachmentArray = Array.isArray(object.attachment)
    ? object.attachment
    : [object.attachment];
  const attachment = attachmentArray[0] as { url?: string; mediaType?: string; width?: number; height?: number };

  if (!attachment || !attachment.url) {
    console.error('Remote story attachment has no URL:', objectId);
    return;
  }

  // overlays validation (optional, validate if present)
  let overlays: StoryOverlay[] | undefined;
  if (Array.isArray(object.overlays)) {
    const filtered = (object.overlays as StoryOverlay[]).filter(
      (o: StoryOverlay) =>
        o && o.position &&
        typeof o.position.x === 'number' &&
        typeof o.position.y === 'number'
    );
    if (filtered.length > 0) overlays = filtered;
  }

  // Build attachments_json
  const attachmentData = {
    attachment: {
      r2_key: '', // Remote stories don't have local R2 key
      content_type: attachment.mediaType || 'image/jpeg',
      url: attachment.url,
      width: attachment.width || 1080,
      height: attachment.height || 1920,
    },
    displayDuration: (object as { displayDuration?: string }).displayDuration || 'PT5S',
    overlays,
  };

  const now = new Date().toISOString();
  const endTime = object.endTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await prisma.object.create({
    data: {
      apId: objectId,
      type: 'Story',
      attributedTo: actor,
      content: '',
      attachmentsJson: JSON.stringify(attachmentData),
      endTime,
      published: object.published || now,
      isLocal: 0,
    },
  });
}

// Handle Delete activity
export async function handleDelete(c: ActivityContext, activity: Activity) {
  const prisma = c.get('prisma');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  const actorId = typeof activity.actor === 'string' ? activity.actor : null;
  if (!actorId) {
    console.warn(`[ActivityPub] Delete activity missing actor`);
    return;
  }

  const delObj = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true, type: true, replyCount: true },
  });
  if (!delObj) return;

  // Verify actor owns the object before deleting
  if (delObj.attributedTo !== actorId) {
    console.warn(`[ActivityPub] Delete rejected: actor ${actorId} does not own object ${objectId} (owned by ${delObj.attributedTo})`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    // Story-specific cleanup
    if (delObj.type === 'Story') {
      await tx.storyVote.deleteMany({ where: { storyApId: objectId } });
      await tx.storyView.deleteMany({ where: { storyApId: objectId } });
    }

    // Common cleanup for all object types
    await tx.like.deleteMany({ where: { objectApId: objectId } });

    await tx.object.delete({ where: { apId: objectId } });

    await tx.actor.update({
      where: { apId: delObj.attributedTo },
      data: { postCount: { decrement: 1 } },
    });
  });
}

// Handle Announce activity (repost/boost)
export async function handleAnnounce(
  c: ActivityContext,
  activity: Activity,
  _recipient: PrismaActor,
  actor: string,
  baseUrl: string
) {
  const prisma = c.get('prisma');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  const activityId = activity.id || activityApId(baseUrl, generateId());

  const result = await prisma.announce.upsert({
    where: {
      actorApId_objectApId: {
        actorApId: actor,
        objectApId: objectId,
      },
    },
    update: {},
    create: {
      actorApId: actor,
      objectApId: objectId,
      activityApId: activityId,
    },
  });

  const isNewAnnounce = result.activityApId === activityId;
  if (!isNewAnnounce) return;

  await prisma.object.update({
    where: { apId: objectId },
    data: { announceCount: { increment: 1 } },
  });

  await notifyLocalObjectOwner(prisma, objectId, activityId, 'Announce', actor, activity, baseUrl);
}

// Handle Update activity (edit posts)
export async function handleUpdate(c: ActivityContext, activity: Activity, actor: string) {
  const prisma = c.get('prisma');
  const object = getActivityObject(activity);
  if (!object) return;

  const objectId = object.id;
  if (!objectId) return;

  const existing = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true },
  });
  if (!existing || existing.attributedTo !== actor) return;

  // Update object content
  if (object.type === 'Note') {
    const attachments = object.attachment ? JSON.stringify(object.attachment) : undefined;
    await prisma.object.update({
      where: { apId: objectId },
      data: {
        content: object.content || undefined,
        summary: object.summary || undefined,
        attachmentsJson: attachments || undefined,
        updated: new Date().toISOString(),
      },
    });
  }
}

// Handle Reject activity (follow request rejection)
export async function handleReject(c: ActivityContext, activity: Activity) {
  const prisma = c.get('prisma');
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  const follow = await findFollowByActivityId(prisma, followId);
  if (!follow) return;

  await deleteFollowByCompoundKey(prisma, follow.followerApId, follow.followingApId);
}

/**
 * Resolve the collection target for Add/Remove activities.
 * Returns the normalized followingApId, or null if the activity should be ignored
 * (missing object, object does not target recipient, or missing target).
 */
function resolveCollectionTarget(
  activity: Activity,
  recipient: PrismaActor,
  actor: string
): string | null {
  const objectId = getActivityObjectId(activity);
  if (!objectId || objectId !== recipient.apId) return null;

  const targetId = getActivityTargetId(activity);
  return normalizeCollectionTarget(targetId || actor) || null;
}

// Handle Add activity (collection add; used by some servers for membership)
export async function handleAdd(
  c: ActivityContext,
  activity: Activity,
  recipient: PrismaActor,
  actor: string
) {
  const followingApId = resolveCollectionTarget(activity, recipient, actor);
  if (!followingApId) return;

  const prisma = c.get('prisma');
  const now = new Date().toISOString();
  await prisma.follow.upsert({
    where: {
      followerApId_followingApId: {
        followerApId: recipient.apId,
        followingApId,
      },
    },
    update: {
      status: 'accepted',
      acceptedAt: now,
      activityApId: activity.id || undefined,
    },
    create: {
      followerApId: recipient.apId,
      followingApId,
      status: 'accepted',
      activityApId: activity.id || null,
      acceptedAt: now,
    },
  });
}

// Handle Remove activity (collection remove; used for expulsion/ban)
export async function handleRemove(
  c: ActivityContext,
  activity: Activity,
  recipient: PrismaActor,
  actor: string
) {
  const followingApId = resolveCollectionTarget(activity, recipient, actor);
  if (!followingApId) return;

  const prisma = c.get('prisma');
  await prisma.follow.deleteMany({
    where: {
      followerApId: recipient.apId,
      followingApId,
    },
  });
}

// Handle Block activity (remote actor blocks the recipient)
export async function handleBlock(
  c: ActivityContext,
  activity: Activity,
  recipient: PrismaActor,
  actor: string
) {
  const prisma = c.get('prisma');
  const blockedId = getActivityObjectId(activity);
  if (!blockedId) return;

  // Only act when the recipient is being blocked.
  if (blockedId !== recipient.apId) return;

  // Best-effort: sever follow relations in both directions.
  await prisma.follow.deleteMany({
    where: {
      OR: [
        { followerApId: recipient.apId, followingApId: actor },
        { followerApId: actor, followingApId: recipient.apId },
      ],
    },
  });
}

// Handle Flag activity (report)
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

// Handle Move activity (account migration)
export async function handleMove(c: ActivityContext, activity: Activity, actor: string) {
  const prisma = c.get('prisma');
  const oldActorApId = getActivityObjectId(activity);
  const newActorApId = getActivityTargetId(activity);
  if (!oldActorApId || !newActorApId) return;

  // Only accept self-move. Signature verification already ensures the request is signed,
  // but we also require Move.object to match Move.actor (defense-in-depth).
  if (oldActorApId !== actor) return;
  if (oldActorApId === newActorApId) return;

  if (!isSafeRemoteUrl(newActorApId)) {
    console.warn(`[ActivityPub] Blocked unsafe Move target: ${newActorApId}`);
    return;
  }

  // Refresh/cache the new actor document (best-effort).
  await refreshActorCache(prisma, newActorApId);

  // Rewrite follow graph references from old -> new in batches.
  const followerRows = await prisma.follow.findMany({
    where: { followerApId: oldActorApId },
    select: { followingApId: true, status: true, activityApId: true, createdAt: true, acceptedAt: true },
  });

  const followingRows = await prisma.follow.findMany({
    where: { followingApId: oldActorApId },
    select: { followerApId: true, status: true, activityApId: true, createdAt: true, acceptedAt: true },
  });

  const followerTargets = followerRows.map((row) => row.followingApId);
  const followingSources = followingRows.map((row) => row.followerApId);

  const existingFollowerPairs = followerTargets.length > 0
    ? await prisma.follow.findMany({
        where: { followerApId: newActorApId, followingApId: { in: followerTargets } },
        select: { followingApId: true },
      })
    : [];
  const existingFollowingPairs = followingSources.length > 0
    ? await prisma.follow.findMany({
        where: { followerApId: { in: followingSources }, followingApId: newActorApId },
        select: { followerApId: true },
      })
    : [];

  const existingFollowerTargetSet = new Set(existingFollowerPairs.map((row) => row.followingApId));
  const existingFollowingSourceSet = new Set(existingFollowingPairs.map((row) => row.followerApId));

  const followerRewrites = followerRows
    .filter((row) => !existingFollowerTargetSet.has(row.followingApId))
    .map((row) => ({
      followerApId: newActorApId,
      followingApId: row.followingApId,
      status: row.status,
      activityApId: row.activityApId,
      createdAt: row.createdAt,
      acceptedAt: row.acceptedAt,
    }));
  const followingRewrites = followingRows
    .filter((row) => !existingFollowingSourceSet.has(row.followerApId))
    .map((row) => ({
      followerApId: row.followerApId,
      followingApId: newActorApId,
      status: row.status,
      activityApId: row.activityApId,
      createdAt: row.createdAt,
      acceptedAt: row.acceptedAt,
    }));

  await prisma.$transaction(async (tx) => {
    if (followerRewrites.length > 0) {
      await tx.follow.createMany({ data: followerRewrites });
    }
    if (followerRows.length > 0) {
      await tx.follow.deleteMany({ where: { followerApId: oldActorApId } });
    }
    if (followingRewrites.length > 0) {
      await tx.follow.createMany({ data: followingRewrites });
    }
    if (followingRows.length > 0) {
      await tx.follow.deleteMany({ where: { followingApId: oldActorApId } });
    }
  });
}

/** Fetch a remote actor document and cache it locally. Best-effort (errors are logged, not thrown). */
async function refreshActorCache(
  prisma: PrismaClient,
  actorApId: string
): Promise<void> {
  type RemoteActorDoc = {
    id: string;
    type?: string;
    preferredUsername?: string;
    name?: string;
    summary?: string;
    icon?: { url?: string };
    inbox?: string;
    outbox?: string;
    publicKey?: { id?: string; publicKeyPem?: string };
    endpoints?: { sharedInbox?: string };
  };

  try {
    const res = await fetchWithTimeout(actorApId, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' },
      timeout: 15000,
    });
    if (!res.ok) return;

    const data = await res.json() as RemoteActorDoc;
    if (!data?.id || data.id !== actorApId || !data.inbox || !isSafeRemoteUrl(data.inbox)) return;

    const cacheFields = {
      type: data.type || 'Person',
      preferredUsername: data.preferredUsername || null,
      name: data.name || null,
      summary: data.summary || null,
      iconUrl: data.icon?.url || null,
      inbox: data.inbox,
      outbox: data.outbox || null,
      sharedInbox: data.endpoints?.sharedInbox || null,
      publicKeyId: data.publicKey?.id || null,
      publicKeyPem: data.publicKey?.publicKeyPem || null,
      rawJson: JSON.stringify(data),
      lastFetchedAt: new Date().toISOString(),
    };

    await prisma.actorCache.upsert({
      where: { apId: data.id },
      update: cacheFields,
      create: { apId: data.id, ...cacheFields },
    });
  } catch (e) {
    console.warn('[ActivityPub] Failed to refresh Move target actor cache:', e);
  }
}
