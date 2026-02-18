import type { Context } from 'hono';
import type { Env, Variables } from '../../../types';
import type { Actor as PrismaActor } from '../../../../generated/prisma';
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === 'P2002'
  );
}

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
    update: {}, // No update if already exists
    create: {
      followerApId: actor,
      followingApId: recipient.apId,
      status,
      activityApId: activityId,
      acceptedAt: status === 'accepted' ? now : null,
    },
  });

  // If this was an existing follow, the createdAt will be in the past
  // Only proceed with count updates and notifications for new follows
  const isNewFollow = result.activityApId === activityId;

  // Only update counts and send notifications for new follows
  if (!isNewFollow) return;

  // Update counts if accepted
  if (status === 'accepted') {
    await prisma.actor.update({
      where: { apId: recipient.apId },
      data: { followerCount: { increment: 1 } },
    });
  }

  // Store activity and add to inbox (AP Native notification)
  await prisma.activity.upsert({
    where: { apId: activityId },
    update: {},
    create: {
      apId: activityId,
      type: 'Follow',
      actorApId: actor,
      objectApId: recipient.apId,
      rawJson: JSON.stringify(activity),
    },
  });

  await prisma.inbox.create({
    data: {
      actorApId: recipient.apId,
      activityApId: activityId,
      read: 0,
      createdAt: now,
    },
  });

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

  // Find the follow by activity_ap_id
  const follow = await prisma.follow.findFirst({
    where: { activityApId: followId },
  });

  if (!follow) return;

  // Skip if already accepted (idempotency)
  if (follow.status === 'accepted') {
    return;
  }

  const now = new Date().toISOString();

  // HIGH #16: Use transaction for atomic follow update and count updates
  try {
    await prisma.$transaction(async (tx) => {
      // Update follow status to accepted
      await tx.follow.update({
        where: {
          followerApId_followingApId: {
            followerApId: follow.followerApId,
            followingApId: follow.followingApId,
          },
        },
        data: {
          status: 'accepted',
          acceptedAt: now,
        },
      });

      // Update counts atomically
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
    const originalActivity = await prisma.activity.findUnique({
      where: { apId: objectId },
      select: { type: true, objectApId: true },
    });

    if (originalActivity) {
      // Handle based on original activity type
      if (originalActivity.type === 'Follow') {
        const follow = await prisma.follow.findFirst({
          where: { activityApId: objectId },
        });
        if (follow) {
          await prisma.follow.delete({
            where: {
              followerApId_followingApId: {
                followerApId: follow.followerApId,
                followingApId: follow.followingApId,
              },
            },
          });
        }
        await prisma.actor.update({
          where: { apId: recipient.apId },
          data: { followerCount: { decrement: 1 } },
        });
      } else if (originalActivity.type === 'Like' && originalActivity.objectApId) {
        const like = await prisma.like.findFirst({
          where: { activityApId: objectId },
        });
        if (like) {
          await prisma.like.delete({
            where: {
              actorApId_objectApId: {
                actorApId: like.actorApId,
                objectApId: like.objectApId,
              },
            },
          });
        }
        await prisma.object.update({
          where: { apId: originalActivity.objectApId },
          data: { likeCount: { decrement: 1 } },
        });
      } else if (originalActivity.type === 'Announce' && originalActivity.objectApId) {
        const announce = await prisma.announce.findFirst({
          where: { activityApId: objectId },
        });
        if (announce) {
          await prisma.announce.delete({
            where: {
              actorApId_objectApId: {
                actorApId: announce.actorApId,
                objectApId: announce.objectApId,
              },
            },
          });
        }
        await prisma.object.update({
          where: { apId: originalActivity.objectApId },
          data: { announceCount: { decrement: 1 } },
        });
      }
      return;
    }
  }

  if (objectType === 'Follow') {
    // Undo follow
    if (objectId) {
      // Try to find by activity_ap_id first
      const follow = await prisma.follow.findFirst({
        where: { activityApId: objectId },
      });
      if (follow) {
        await prisma.follow.delete({
          where: {
            followerApId_followingApId: {
              followerApId: follow.followerApId,
              followingApId: follow.followingApId,
            },
          },
        });
      } else {
        // Fallback: delete by actor pair
        await prisma.follow.deleteMany({
          where: {
            followerApId: actor,
            followingApId: recipient.apId,
          },
        });
      }
    } else {
      await prisma.follow.deleteMany({
        where: {
          followerApId: actor,
          followingApId: recipient.apId,
        },
      });
    }

    // Update counts
    await prisma.actor.update({
      where: { apId: recipient.apId },
      data: { followerCount: { decrement: 1 } },
    });
  } else if (objectType === 'Like') {
    // Undo like - find the original liked object from the Like activity
    const likedObjectId = activityObject?.object;
    if (likedObjectId) {
      await prisma.like.deleteMany({
        where: {
          actorApId: actor,
          objectApId: likedObjectId,
        },
      });

      // Update like count
      await prisma.object.update({
        where: { apId: likedObjectId },
        data: { likeCount: { decrement: 1 } },
      });
    } else if (objectId) {
      // Fallback: try to find by activity_ap_id
      const like = await prisma.like.findFirst({
        where: { activityApId: objectId },
      });
      if (like) {
        await prisma.like.delete({
          where: {
            actorApId_objectApId: {
              actorApId: like.actorApId,
              objectApId: like.objectApId,
            },
          },
        });
        await prisma.object.update({
          where: { apId: like.objectApId },
          data: { likeCount: { decrement: 1 } },
        });
      } else {
        // Last resort: try to delete any like from this actor for the recipient's objects
        const recipientObjects = await prisma.object.findMany({
          where: { attributedTo: recipient.apId },
          select: { apId: true },
        });
        const objectApIds = recipientObjects.map((o) => o.apId);
        await prisma.like.deleteMany({
          where: {
            actorApId: actor,
            objectApId: { in: objectApIds },
          },
        });
      }
    }
  } else if (objectType === 'Announce') {
    // Undo announce (repost)
    const announcedObjectId = activityObject?.object;
    if (announcedObjectId) {
      await prisma.announce.deleteMany({
        where: {
          actorApId: actor,
          objectApId: announcedObjectId,
        },
      });

      // Update announce count
      await prisma.object.update({
        where: { apId: announcedObjectId },
        data: { announceCount: { decrement: 1 } },
      });
    } else if (objectId) {
      // Fallback: try to find by activity_ap_id
      const announce = await prisma.announce.findFirst({
        where: { activityApId: objectId },
      });
      if (announce) {
        await prisma.announce.delete({
          where: {
            actorApId_objectApId: {
              actorApId: announce.actorApId,
              objectApId: announce.objectApId,
            },
          },
        });
        await prisma.object.update({
          where: { apId: announce.objectApId },
          data: { announceCount: { decrement: 1 } },
        });
      }
    }
  }
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

  const activityId = activity.id || activityApId(baseUrl, generateId());
  const likedObj = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true },
  });
  if (!likedObj) return;

  const shouldNotify = isLocal(likedObj.attributedTo, baseUrl);
  const now = new Date().toISOString();

  const created = await prisma.$transaction(async (tx) => {
    try {
      await tx.like.create({
        data: {
          actorApId: actor,
          objectApId: objectId,
          activityApId: activityId,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) return false;
      throw error;
    }

    await tx.object.update({
      where: { apId: objectId },
      data: { likeCount: { increment: 1 } },
    });

    if (shouldNotify) {
      await tx.activity.upsert({
        where: { apId: activityId },
        update: {},
        create: {
          apId: activityId,
          type: 'Like',
          actorApId: actor,
          objectApId: objectId,
          rawJson: JSON.stringify(activity),
        },
      });

      await tx.inbox.create({
        data: {
          actorApId: likedObj.attributedTo,
          activityApId: activityId,
          read: 0,
          createdAt: now,
        },
      });
    }

    return true;
  });

  if (!created) return;
}

function isStoryType(type: string | string[] | undefined): boolean {
  if (!type) return false;
  if (Array.isArray(type)) {
    return type.includes('Story');
  }
  return type === 'Story';
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
  const now = new Date().toISOString();

  const created = await prisma.$transaction(async (tx) => {
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
      if (isUniqueConstraintError(error)) return false;
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
      await tx.activity.upsert({
        where: { apId: replyActivityId },
        update: {},
        create: {
          apId: replyActivityId,
          type: 'Create',
          actorApId: actor,
          objectApId: objectId,
          rawJson: JSON.stringify(activity),
        },
      });

      await tx.inbox.create({
        data: {
          actorApId: parentObj.attributedTo,
          activityApId: replyActivityId,
          read: 0,
          createdAt: now,
        },
      });
    }

    return true;
  });

  if (!created) return;
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
    return; // Ignore stories without attachment
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
  let overlays: StoryOverlay[] | undefined = undefined;
  if (object.overlays) {
    if (!Array.isArray(object.overlays)) {
      overlays = undefined; // Ignore invalid format
    } else {
      // Simple validation: position is required
      const filtered = (object.overlays as StoryOverlay[]).filter((o: StoryOverlay) =>
        o && o.position &&
        typeof o.position.x === 'number' &&
        typeof o.position.y === 'number'
      );
      overlays = filtered.length > 0 ? filtered : undefined;
    }
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
    overlays: overlays,
  };

  const now = new Date().toISOString();
  const endTime = object.endTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // DB save
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

  // Increment post count for actor in cache (ignore errors if actor not in cache)
  try {
    await prisma.actorCache.update({
      where: { apId: actor },
      data: {
        // ActorCache doesn't have postCount field, so this is a no-op
        // In the original code, this was also likely ineffective
      },
    });
  } catch {
    // Ignore if actor cache doesn't exist
  }
}

// Handle Delete activity
export async function handleDelete(c: ActivityContext, activity: Activity) {
  const prisma = c.get('prisma');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  // Get activity actor
  const actorId = typeof activity.actor === 'string' ? activity.actor : null;
  if (!actorId) {
    console.warn(`[ActivityPub] Delete activity missing actor`);
    return;
  }

  // Get object before deletion
  const delObj = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true, type: true, replyCount: true },
  });

  if (!delObj) return;

  // HIGH #10: Verify actor owns the object before deleting
  if (delObj.attributedTo !== actorId) {
    console.warn(`[ActivityPub] Delete rejected: actor ${actorId} does not own object ${objectId} (owned by ${delObj.attributedTo})`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    if (delObj.type === 'Story') {
      await tx.storyVote.deleteMany({
        where: { storyApId: objectId },
      });
      await tx.storyView.deleteMany({
        where: { storyApId: objectId },
      });
      await tx.like.deleteMany({
        where: { objectApId: objectId },
      });
    } else {
      await tx.like.deleteMany({
        where: { objectApId: objectId },
      });
    }

    await tx.object.delete({
      where: { apId: objectId },
    });

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

  // Use upsert to atomically create or update announce record (prevents race condition)
  const result = await prisma.announce.upsert({
    where: {
      actorApId_objectApId: {
        actorApId: actor,
        objectApId: objectId,
      },
    },
    update: {}, // No update if already exists
    create: {
      actorApId: actor,
      objectApId: objectId,
      activityApId: activityId,
    },
  });

  // Only proceed with count updates and notifications for new announces
  const isNewAnnounce = result.activityApId === activityId;
  if (!isNewAnnounce) return;

  // Update announce count on object
  await prisma.object.update({
    where: { apId: objectId },
    data: { announceCount: { increment: 1 } },
  });

  // Store activity and add to inbox (AP Native notification)
  const announcedObj = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true },
  });
  if (announcedObj && isLocal(announcedObj.attributedTo, baseUrl)) {
    const now = new Date().toISOString();
    await prisma.activity.upsert({
      where: { apId: activityId },
      update: {},
      create: {
        apId: activityId,
        type: 'Announce',
        actorApId: actor,
        objectApId: objectId,
        rawJson: JSON.stringify(activity),
      },
    });

    await prisma.inbox.create({
      data: {
        actorApId: announcedObj.attributedTo,
        activityApId: activityId,
        read: 0,
        createdAt: now,
      },
    });
  }
}

// Handle Update activity (edit posts)
export async function handleUpdate(c: ActivityContext, activity: Activity, actor: string) {
  const prisma = c.get('prisma');
  const object = getActivityObject(activity);
  if (!object) return;

  const objectId = object.id;
  if (!objectId) return;

  // Verify the actor owns this object
  const existing = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { apId: true, attributedTo: true },
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

  // Find the follow by activity_ap_id and update status
  const follow = await prisma.follow.findFirst({
    where: { activityApId: followId },
  });

  if (!follow) return;

  // Delete the follow record since it was rejected
  await prisma.follow.delete({
    where: {
      followerApId_followingApId: {
        followerApId: follow.followerApId,
        followingApId: follow.followingApId,
      },
    },
  });
}

function getActivityTargetId(activity: Activity): string | null {
  const target = activity.target;
  if (!target) return null;
  if (typeof target === 'string') return target;
  return target.id || null;
}

function normalizeCollectionTarget(targetId: string): string {
  // Common pattern: Group followers collection.
  if (targetId.endsWith('/followers')) {
    return targetId.slice(0, -'/followers'.length);
  }
  return targetId;
}

// Handle Add activity (collection add; used by some servers for membership)
export async function handleAdd(
  c: ActivityContext,
  activity: Activity,
  recipient: PrismaActor,
  actor: string
) {
  const prisma = c.get('prisma');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  // Only apply Add that targets the inbox recipient (defense-in-depth).
  if (objectId !== recipient.apId) return;

  const targetId = getActivityTargetId(activity);
  const followingApId = normalizeCollectionTarget(targetId || actor);
  if (!followingApId) return;

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
  const prisma = c.get('prisma');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  // Only apply Remove that targets the inbox recipient.
  if (objectId !== recipient.apId) return;

  const targetId = getActivityTargetId(activity);
  const followingApId = normalizeCollectionTarget(targetId || actor);
  if (!followingApId) return;

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
    const res = await fetchWithTimeout(newActorApId, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' },
      timeout: 15000,
    });
    if (res.ok) {
      const actorData = await res.json() as RemoteActorDoc;
      if (
        actorData?.id === newActorApId &&
        actorData?.inbox &&
        isSafeRemoteUrl(actorData.inbox)
      ) {
        await prisma.actorCache.upsert({
          where: { apId: actorData.id },
          update: {
            type: actorData.type || 'Person',
            preferredUsername: actorData.preferredUsername || null,
            name: actorData.name || null,
            summary: actorData.summary || null,
            iconUrl: actorData.icon?.url || null,
            inbox: actorData.inbox,
            outbox: actorData.outbox || null,
            sharedInbox: actorData.endpoints?.sharedInbox || null,
            publicKeyId: actorData.publicKey?.id || null,
            publicKeyPem: actorData.publicKey?.publicKeyPem || null,
            rawJson: JSON.stringify(actorData),
            lastFetchedAt: new Date().toISOString(),
          },
          create: {
            apId: actorData.id,
            type: actorData.type || 'Person',
            preferredUsername: actorData.preferredUsername || null,
            name: actorData.name || null,
            summary: actorData.summary || null,
            iconUrl: actorData.icon?.url || null,
            inbox: actorData.inbox,
            outbox: actorData.outbox || null,
            sharedInbox: actorData.endpoints?.sharedInbox || null,
            publicKeyId: actorData.publicKey?.id || null,
            publicKeyPem: actorData.publicKey?.publicKeyPem || null,
            rawJson: JSON.stringify(actorData),
            lastFetchedAt: new Date().toISOString(),
          },
        });
      }
    }
  } catch (e) {
    console.warn('[ActivityPub] Failed to refresh Move target actor cache:', e);
  }

  // Rewrite follow graph references from old -> new in batches.
  const followerRows = await prisma.follow.findMany({
    where: { followerApId: oldActorApId },
    select: {
      followingApId: true,
      status: true,
      activityApId: true,
      createdAt: true,
      acceptedAt: true,
    },
  });

  const followingRows = await prisma.follow.findMany({
    where: { followingApId: oldActorApId },
    select: {
      followerApId: true,
      status: true,
      activityApId: true,
      createdAt: true,
      acceptedAt: true,
    },
  });

  const followerTargets = followerRows.map((row) => row.followingApId);
  const followingSources = followingRows.map((row) => row.followerApId);

  const existingFollowerPairs = followerTargets.length > 0
    ? await prisma.follow.findMany({
        where: {
          followerApId: newActorApId,
          followingApId: { in: followerTargets },
        },
        select: { followingApId: true },
      })
    : [];
  const existingFollowingPairs = followingSources.length > 0
    ? await prisma.follow.findMany({
        where: {
          followerApId: { in: followingSources },
          followingApId: newActorApId,
        },
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
      await tx.follow.createMany({
        data: followerRewrites,
      });
    }

    if (followerRows.length > 0) {
      await tx.follow.deleteMany({
        where: { followerApId: oldActorApId },
      });
    }

    if (followingRewrites.length > 0) {
      await tx.follow.createMany({
        data: followingRewrites,
      });
    }

    if (followingRows.length > 0) {
      await tx.follow.deleteMany({
        where: { followingApId: oldActorApId },
      });
    }
  });
}
