import type { Context } from 'hono';
import type { Env, Variables } from '../../../types';
import {
  activityApId,
  generateId,
  isLocal,
  objectApId,
} from '../../../utils';
import { enqueueDeliveryToActor } from '../../../lib/delivery/queue';
import type { InstanceActorResult } from '../utils';
import {
  Activity,
  getActivityObject,
  getActivityObjectId,
} from '../inbox-types';

type ActivityContext = Context<{ Bindings: Env; Variables: Variables }>;

export async function handleGroupFollow(
  c: ActivityContext,
  _activity: Activity,
  instanceActor: InstanceActorResult,
  actorApIdStr: string,
  baseUrl: string,
  activityId: string
) {
  const prisma = c.get('prisma');

  const existing = await prisma.follow.findUnique({
    where: {
      followerApId_followingApId: {
        followerApId: actorApIdStr,
        followingApId: instanceActor.apId,
      },
    },
  });
  if (existing) return;

  let status: 'accepted' | 'pending' | 'rejected' = 'accepted';
  if (instanceActor.joinPolicy === 'approval') {
    status = 'pending';
  } else if (instanceActor.joinPolicy === 'invite') {
    status = 'rejected';
  }

  const now = new Date().toISOString();
  await prisma.follow.create({
    data: {
      followerApId: actorApIdStr,
      followingApId: instanceActor.apId,
      status,
      activityApId: activityId,
      acceptedAt: status === 'accepted' ? now : null,
    },
  });

  if (isLocal(actorApIdStr, baseUrl)) return;

  if (status === 'accepted' || status === 'rejected') {
    const responseType = status === 'accepted' ? 'Accept' : 'Reject';
    const responseId = activityApId(baseUrl, generateId());
    const responseActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: responseId,
      type: responseType,
      actor: instanceActor.apId,
      object: activityId,
    };

    await prisma.activity.create({
      data: {
        apId: responseId,
        type: responseType,
        actorApId: instanceActor.apId,
        objectApId: activityId,
        rawJson: JSON.stringify(responseActivity),
        direction: 'outbound',
      },
    });

    // Outbound delivery must be async (no remote POST in request path).
    await enqueueDeliveryToActor(c.env, responseId, actorApIdStr);
  }
}

export async function handleGroupUndo(
  c: ActivityContext,
  activity: Activity,
  instanceActor: InstanceActorResult
) {
  const prisma = c.get('prisma');
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  const follow = await prisma.follow.findFirst({
    where: {
      activityApId: objectId,
      followingApId: instanceActor.apId,
    },
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
    return;
  }

  if (getActivityObject(activity)?.type === 'Follow') {
    await prisma.follow.deleteMany({
      where: {
        followerApId: activity.actor,
        followingApId: instanceActor.apId,
      },
    });
  }
}

export async function handleGroupCreate(
  c: ActivityContext,
  activity: Activity,
  instanceActor: InstanceActorResult,
  actorApIdStr: string,
  baseUrl: string
) {
  const prisma = c.get('prisma');
  const object = getActivityObject(activity);
  if (!object || object.type !== 'Note') return;

  const roomUrl = object.room || activity.room;
  if (!roomUrl || typeof roomUrl !== 'string') return;
  const match = roomUrl.match(/\/ap\/rooms\/([^\/]+)$/);
  if (!match) return;
  const roomId = match[1];

  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { preferredUsername: roomId },
        { apId: roomId },
      ],
    },
    select: { apId: true, preferredUsername: true },
  });
  if (!community) return;

  const postingPolicy = instanceActor.postingPolicy || 'members';
  if (postingPolicy !== 'anyone') {
    const follow = await prisma.follow.findUnique({
      where: {
        followerApId_followingApId: {
          followerApId: actorApIdStr,
          followingApId: instanceActor.apId,
        },
        status: 'accepted',
      },
    });
    if (!follow) return;
    if (postingPolicy === 'mods' || postingPolicy === 'owners') return;
  }

  const objectId = object.id || objectApId(baseUrl, generateId());
  const existing = await prisma.object.findUnique({
    where: { apId: objectId },
  });
  if (existing) return;

  const attachments = object.attachment ? JSON.stringify(object.attachment) : '[]';
  const now = object.published || new Date().toISOString();

  await prisma.object.create({
    data: {
      apId: objectId,
      type: 'Note',
      attributedTo: actorApIdStr,
      content: object.content || '',
      summary: object.summary || null,
      attachmentsJson: attachments,
      visibility: 'group',
      communityApId: community.apId,
      published: now,
      isLocal: 0,
    },
  });

  // Using $executeRaw with INSERT OR IGNORE since ObjectRecipient FK expects Actor, not Community
  await prisma.$executeRaw`
    INSERT OR IGNORE INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${objectId}, ${community.apId}, 'audience', ${now})
  `;
}
