// ActivityPub helper functions for Yurucommu
// Provides utilities for delivering activities to followers

import type { Env, Actor } from '../types';
import type { PrismaClient } from '../../generated/prisma';
import { generateId, activityApId, isLocal, signRequest, isSafeRemoteUrl, fetchWithTimeout } from '../utils';

/**
 * Actor information needed to send an activity
 */
interface SenderActor {
  apId: string;
  privateKeyPem: string;
}

/**
 * Retry configuration for activity delivery
 */
const DELIVERY_RETRY_CONFIG = {
  maxAttempts: 3,
  baseDelayMs: 1000, // 1 second initial delay
  maxDelayMs: 30000, // 30 seconds max delay
};

// P07: Concurrency limit for parallel activity delivery
const DELIVERY_CONCURRENCY_LIMIT = 10;

/**
 * Calculate exponential backoff delay
 */
function calculateBackoffDelay(attempt: number): number {
  const delay = DELIVERY_RETRY_CONFIG.baseDelayMs * Math.pow(2, attempt);
  return Math.min(delay, DELIVERY_RETRY_CONFIG.maxDelayMs);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deliver an activity to a specific recipient's inbox
 * Handles: actor cache lookup, URL safety check, signing, and delivery with retry
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
      console.warn(`[deliverActivity] No inbox found for ${recipientApId}`);
      return false;
    }

    if (!isSafeRemoteUrl(cachedActor.inbox)) {
      console.warn(`[deliverActivity] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
      return false;
    }

    const keyId = `${senderActor.apId}#main-key`;
    const body = JSON.stringify(activity);

    // Retry logic with exponential backoff
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < DELIVERY_RETRY_CONFIG.maxAttempts; attempt++) {
      try {
        const headers = await signRequest(senderActor.privateKeyPem, keyId, 'POST', cachedActor.inbox, body);

        const response = await fetchWithTimeout(cachedActor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body,
          timeout: 15000, // 15 second timeout for ActivityPub federation
        });

        if (response.ok) {
          return true;
        }

        // Non-retryable status codes (4xx client errors, except rate limiting)
        if (response.status >= 400 && response.status < 500 && response.status !== 429) {
          console.warn(`[deliverActivity] Delivery failed with non-retryable status ${response.status} to ${recipientApId}`);
          return false;
        }

        // Retryable error (5xx server error or 429 rate limit)
        console.warn(`[deliverActivity] Delivery attempt ${attempt + 1}/${DELIVERY_RETRY_CONFIG.maxAttempts} failed with status ${response.status} to ${recipientApId}`);
        lastError = new Error(`HTTP ${response.status}`);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        console.warn(`[deliverActivity] Delivery attempt ${attempt + 1}/${DELIVERY_RETRY_CONFIG.maxAttempts} failed to ${recipientApId}:`, e);
      }

      // Wait before retry (unless it's the last attempt)
      if (attempt < DELIVERY_RETRY_CONFIG.maxAttempts - 1) {
        const delay = calculateBackoffDelay(attempt);
        await sleep(delay);
      }
    }

    console.error(`[deliverActivity] All ${DELIVERY_RETRY_CONFIG.maxAttempts} delivery attempts failed to ${recipientApId}:`, lastError);
    return false;
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
 * S28: Safely build URL by joining base and path
 * Uses URL constructor for proper handling of path separators
 */
function safeUrlJoin(baseUrl: string, path: string): string {
  // If path is already absolute URL, return as-is
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  try {
    // Validate baseUrl format
    const base = new URL(baseUrl);

    // Normalize: remove trailing slash from base, ensure path has leading slash
    const normalizedBase = base.origin + base.pathname.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : '/' + path;

    return normalizedBase + normalizedPath;
  } catch (error) {
    // If URL parsing fails, fall back to simple concatenation with safety checks
    const cleanBase = baseUrl.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : '/' + path;
    return cleanBase + cleanPath;
  }
}

/**
 * Convert a Story to ActivityPub format
 */
export function storyToActivityPub(story: StoryData, actor: Actor, baseUrl: string): object {
  // S28: Build full attachment URL using safe URL joining
  const attachmentUrl = safeUrlJoin(baseUrl, story.attachment.url);

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

  // P07: Deliver to remote followers in parallel with concurrency limit
  const senderActor: SenderActor = {
    apId: actor.ap_id,
    privateKeyPem: actor.private_key_pem,
  };

  await deliverActivityToMany(prisma, senderActor, remoteFollowers.map(f => f.followerApId), activity);
}

/**
 * P07: Deliver an activity to multiple recipients in parallel with concurrency limit
 * Uses Promise.allSettled for resilience (one failure doesn't stop others)
 */
export async function deliverActivityToMany(
  prisma: PrismaClient,
  senderActor: SenderActor,
  recipientApIds: string[],
  activity: object
): Promise<{ successes: number; failures: number }> {
  if (recipientApIds.length === 0) {
    return { successes: 0, failures: 0 };
  }

  let successes = 0;
  let failures = 0;

  // Process in batches to limit concurrency
  for (let i = 0; i < recipientApIds.length; i += DELIVERY_CONCURRENCY_LIMIT) {
    const batch = recipientApIds.slice(i, i + DELIVERY_CONCURRENCY_LIMIT);
    const results = await Promise.allSettled(
      batch.map(recipientApId => deliverActivity(prisma, senderActor, recipientApId, activity))
    );

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        successes++;
      } else {
        failures++;
      }
    }
  }

  return { successes, failures };
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
