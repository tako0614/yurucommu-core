// ActivityPub helper functions for Yurucommu
// Provides utilities for delivering activities to followers

import type { Env, Actor } from '../types';
import type { PrismaClient } from '../../generated/prisma';
import { generateId, activityApId, isLocal, signRequest, isSafeRemoteUrl } from '../utils';

/**
 * Actor information needed to send an activity
 */
interface SenderActor {
  apId: string;
  privateKeyPem: string;
}

/**
 * Deliver an activity to a specific recipient's inbox
 * Handles: actor cache lookup, URL safety check, signing, and delivery
 *
 * @param prisma - PrismaClient instance
 * @param senderActor - Actor sending the activity (needs apId and privateKeyPem)
 * @param recipientApId - AP ID of the recipient to look up in actor_cache
 * @param activity - The activity object to deliver
 * @returns Promise<boolean> - true if delivery succeeded, false otherwise
 */
export async function deliverActivity(
  prisma: PrismaClient,
  senderActor: SenderActor,
  recipientApId: string,
  activity: object
): Promise<boolean> {
  try {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: recipientApId },
      select: { inbox: true },
    });

    if (!cachedActor?.inbox) {
      return false;
    }

    if (!isSafeRemoteUrl(cachedActor.inbox)) {
      console.warn(`[deliverActivity] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
      return false;
    }

    const keyId = `${senderActor.apId}#main-key`;
    const body = JSON.stringify(activity);
    const headers = await signRequest(senderActor.privateKeyPem, keyId, 'POST', cachedActor.inbox, body);

    const response = await fetch(cachedActor.inbox, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/activity+json' },
      body,
    });

    return response.ok;
  } catch (e) {
    console.error(`[deliverActivity] Failed to deliver to ${recipientApId}:`, e);
    return false;
  }
}

// Story data from database after transformation
interface StoryData {
  apId: string;
  attributedTo: string;
  attachment: {
    type: string;
    mediaType: string;
    url: string;
    r2_key: string;
  };
  displayDuration: string;
  overlays?: unknown[];
  endTime: string;
  published: string;
}

/**
 * Convert a Story to ActivityPub format
 */
export function storyToActivityPub(story: StoryData, actor: Actor, baseUrl: string): object {
  // Build full attachment URL
  const attachmentUrl = story.attachment.url.startsWith('http')
    ? story.attachment.url
    : `${baseUrl}${story.attachment.url}`;

  return {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      {
        'story': 'https://yurucommu.com/ns/story#',
        'Story': 'story:Story',
        'displayDuration': 'story:displayDuration',
        'overlays': { '@id': 'story:overlays', '@container': '@list' },
        'position': 'story:position'
      }
    ],
    'id': story.apId,
    'type': ['Story', 'Note'],
    'attributedTo': actor.ap_id,
    'published': story.published,
    'endTime': story.endTime,
    'to': [`${actor.ap_id}/followers`],
    'attachment': [{
      'type': story.attachment.type,
      'mediaType': story.attachment.mediaType,
      'url': attachmentUrl,
    }],
    'displayDuration': story.displayDuration,
    ...(story.overlays && story.overlays.length > 0 ? { 'overlays': story.overlays } : {}),
  };
}

/**
 * Deliver an activity to all followers of an actor
 */
export async function deliverToFollowers(
  activity: object,
  actor: Actor,
  env: Env,
  prisma: PrismaClient
): Promise<void> {
  const baseUrl = env.APP_URL;

  // Get all accepted followers
  const followers = await prisma.follow.findMany({
    where: {
      followingApId: actor.ap_id,
      status: 'accepted',
    },
    select: {
      followerApId: true,
    },
    distinct: ['followerApId'],
  });

  // Filter to remote followers only
  const remoteFollowers = followers.filter(
    (f) => !isLocal(f.followerApId, baseUrl)
  );

  // Deliver to each remote follower's inbox using the centralized delivery function
  const senderActor: SenderActor = {
    apId: actor.ap_id,
    privateKeyPem: actor.private_key_pem,
  };

  for (const follower of remoteFollowers) {
    await deliverActivity(prisma, senderActor, follower.followerApId, activity);
  }
}

/**
 * Send Create(Story) activity to followers
 */
export async function sendCreateStoryActivity(
  story: StoryData,
  actor: Actor,
  env: Env,
  prisma: PrismaClient
): Promise<void> {
  const baseUrl = env.APP_URL;
  const storyObject = storyToActivityPub(story, actor, baseUrl);

  const activityId = activityApId(baseUrl, generateId());
  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    'id': activityId,
    'type': 'Create',
    'actor': actor.ap_id,
    'published': story.published,
    'to': [`${actor.ap_id}/followers`],
    'object': storyObject,
  };

  // Deliver to followers
  await deliverToFollowers(activity, actor, env, prisma);

  // Store outbound activity
  await prisma.activity.create({
    data: {
      apId: activityId,
      type: 'Create',
      actorApId: actor.ap_id,
      objectApId: story.apId,
      rawJson: JSON.stringify(activity),
      direction: 'outbound',
    },
  });
}

/**
 * Send Delete(Story) activity to followers
 */
export async function sendDeleteStoryActivity(
  storyApId: string,
  actor: Actor,
  env: Env,
  prisma: PrismaClient
): Promise<void> {
  const baseUrl = env.APP_URL;
  const activityId = activityApId(baseUrl, generateId());

  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    'id': activityId,
    'type': 'Delete',
    'actor': actor.ap_id,
    'to': ['https://www.w3.org/ns/activitystreams#Public'],
    'object': storyApId,
  };

  // Deliver to followers
  await deliverToFollowers(activity, actor, env, prisma);

  // Store outbound activity
  await prisma.activity.create({
    data: {
      apId: activityId,
      type: 'Delete',
      actorApId: actor.ap_id,
      objectApId: storyApId,
      rawJson: JSON.stringify(activity),
      direction: 'outbound',
    },
  });
}
