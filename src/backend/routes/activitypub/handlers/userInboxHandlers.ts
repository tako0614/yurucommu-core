import type { Context } from 'hono';
import type { Env, Variables } from '../../../types';
import type { Actor as PrismaActor } from '../../../../generated/prisma';
import {
  activityApId,
  generateId,
  isLocal,
  isSafeRemoteUrl,
  objectApId,
  signRequest,
  fetchWithTimeout,
} from '../../../utils';
import {
  Activity,
  StoryOverlay,
  getActivityObject,
  getActivityObjectId,
} from '../inbox-types';

type ActivityContext = Context<{ Bindings: Env; Variables: Variables }>;

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
  if (!isLocal(actor, baseUrl)) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: actor },
      select: { inbox: true },
    });
    if (cachedActor?.inbox) {
      if (!isSafeRemoteUrl(cachedActor.inbox)) {
        console.warn(`[ActivityPub] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
        return;
      }
      const acceptId = activityApId(baseUrl, generateId());
      const acceptActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: acceptId,
        type: 'Accept',
        actor: recipient.apId,
        object: activityId,
      };

      const keyId = `${recipient.apId}#main-key`;
      const headers = await signRequest(
        recipient.privateKeyPem,
        keyId,
        'POST',
        cachedActor.inbox,
        JSON.stringify(acceptActivity)
      );

      try {
        await fetchWithTimeout(cachedActor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(acceptActivity),
          timeout: 15000, // 15 second timeout for ActivityPub federation
        });
      } catch (e) {
        console.error('Failed to send Accept:', e);
      }

      // Store accept activity
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
    }
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

  // Use upsert to atomically create or update like record (prevents race condition)
  const result = await prisma.like.upsert({
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

  // Only proceed with count updates and notifications for new likes
  const isNewLike = result.activityApId === activityId;
  if (!isNewLike) return;

  // Update like count on object
  await prisma.object.update({
    where: { apId: objectId },
    data: { likeCount: { increment: 1 } },
  });

  // Store activity and add to inbox (AP Native notification)
  const likedObj = await prisma.object.findUnique({
    where: { apId: objectId },
    select: { attributedTo: true },
  });
  if (likedObj && isLocal(likedObj.attributedTo, baseUrl)) {
    const now = new Date().toISOString();
    await prisma.activity.upsert({
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

    await prisma.inbox.create({
      data: {
        actorApId: likedObj.attributedTo,
        activityApId: activityId,
        read: 0,
        createdAt: now,
      },
    });
  }
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

  // Insert object
  const attachments = object.attachment ? JSON.stringify(object.attachment) : '[]';
  await prisma.object.create({
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
      published: object.published || new Date().toISOString(),
      isLocal: 0,
    },
  });

  // Increment post count for actor
  await prisma.actor.update({
    where: { apId: actor },
    data: { postCount: { increment: 1 } },
  });

  // If it's a reply, update reply count and add to inbox
  if (object.inReplyTo) {
    await prisma.object.update({
      where: { apId: object.inReplyTo },
      data: { replyCount: { increment: 1 } },
    });

    // Add to inbox for reply notification (AP Native)
    const parentObj = await prisma.object.findUnique({
      where: { apId: object.inReplyTo },
      select: { attributedTo: true },
    });
    if (parentObj && isLocal(parentObj.attributedTo, baseUrl)) {
      const activityId = activity.id || activityApId(baseUrl, generateId());
      const now = new Date().toISOString();

      await prisma.activity.upsert({
        where: { apId: activityId },
        update: {},
        create: {
          apId: activityId,
          type: 'Create',
          actorApId: actor,
          objectApId: objectId,
          rawJson: JSON.stringify(activity),
        },
      });

      await prisma.inbox.create({
        data: {
          actorApId: parentObj.attributedTo,
          activityApId: activityId,
          read: 0,
          createdAt: now,
        },
      });
    }
  }
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

  // If it's a Story, also delete related votes and views
  if (delObj.type === 'Story') {
    await prisma.storyVote.deleteMany({
      where: { storyApId: objectId },
    });
    await prisma.storyView.deleteMany({
      where: { storyApId: objectId },
    });
    await prisma.like.deleteMany({
      where: { objectApId: objectId },
    });
  }

  // Delete object
  await prisma.object.delete({
    where: { apId: objectId },
  });

  // Update post count
  await prisma.actor.update({
    where: { apId: delObj.attributedTo },
    data: { postCount: { decrement: 1 } },
  });

  // Delete associated likes and replies (for Notes)
  if (delObj.type !== 'Story') {
    await prisma.like.deleteMany({
      where: { objectApId: objectId },
    });
  }
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
