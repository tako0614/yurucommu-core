import type { PrismaClient } from '../../generated/prisma';
import type { Env, Actor } from '../types';
import { activityApId, fetchWithTimeout, generateId, isLocal, isSafeRemoteUrl, signRequest } from '../utils';

interface SenderActor {
  apId: string;
  privateKeyPem: string;
}

const MAX_DELIVERY_ATTEMPTS = 3;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 30000;
const DELIVERY_CONCURRENCY_LIMIT = 10;

function calculateBackoffDelay(attempt: number): number {
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Deliver an activity to a specific recipient's inbox.
 * Looks up the recipient in actor_cache, validates the inbox URL,
 * then delivers with HTTP Signature and retry with exponential backoff.
 */
export async function deliverActivity(
  prisma: PrismaClient,
  senderActor: SenderActor,
  recipientApId: string,
  activity: object
): Promise<boolean> {
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

  const inboxUrl = cachedActor.inbox;
  const keyId = `${senderActor.apId}#main-key`;
  const body = JSON.stringify(activity);

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < MAX_DELIVERY_ATTEMPTS; attempt++) {
    try {
      const headers = await signRequest(senderActor.privateKeyPem, keyId, 'POST', inboxUrl, body);
      const response = await fetchWithTimeout(inboxUrl, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/activity+json' },
        body,
        timeout: 15000,
      });

      if (response.ok) return true;

      // 4xx (except 429) are non-retryable
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        console.warn(`[deliverActivity] Non-retryable ${response.status} to ${recipientApId}`);
        return false;
      }

      console.warn(`[deliverActivity] Attempt ${attempt + 1}/${MAX_DELIVERY_ATTEMPTS} failed (${response.status}) to ${recipientApId}`);
      lastError = new Error(`HTTP ${response.status}`);
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      console.warn(`[deliverActivity] Attempt ${attempt + 1}/${MAX_DELIVERY_ATTEMPTS} failed to ${recipientApId}:`, e);
    }

    if (attempt < MAX_DELIVERY_ATTEMPTS - 1) {
      await sleep(calculateBackoffDelay(attempt));
    }
  }

  console.error(`[deliverActivity] All ${MAX_DELIVERY_ATTEMPTS} attempts failed to ${recipientApId}:`, lastError);
  return false;
}

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
 * Safely join a base URL and a path segment.
 * Returns the path unchanged if it is already an absolute URL.
 */
function safeUrlJoin(baseUrl: string, path: string): string {
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const cleanBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = path.startsWith('/') ? path : '/' + path;

  try {
    const base = new URL(cleanBase);
    return base.origin + base.pathname.replace(/\/+$/, '') + normalizedPath;
  } catch {
    return cleanBase + normalizedPath;
  }
}

/**
 * Convert a Story to ActivityPub format
 */
export function storyToActivityPub(story: StoryData, actor: Actor, baseUrl: string): object {
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
 * Deliver an activity to all remote followers of an actor
 */
export async function deliverToFollowers(
  activity: object,
  actor: Actor,
  env: Env,
  prisma: PrismaClient
): Promise<void> {
  const followers = await prisma.follow.findMany({
    where: { followingApId: actor.ap_id, status: 'accepted' },
    select: { followerApId: true },
    distinct: ['followerApId'],
  });

  const remoteApIds = followers
    .filter((f) => !isLocal(f.followerApId, env.APP_URL))
    .map((f) => f.followerApId);

  const sender: SenderActor = {
    apId: actor.ap_id,
    privateKeyPem: actor.private_key_pem,
  };

  await deliverActivityToMany(prisma, sender, remoteApIds, activity);
}

/**
 * Deliver an activity to multiple recipients with bounded concurrency.
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
 * Deliver an activity to followers and persist it as an outbound record.
 */
async function deliverAndStore(
  activity: Record<string, unknown>,
  activityType: string,
  objectApId: string,
  actor: Actor,
  env: Env,
  prisma: PrismaClient
): Promise<void> {
  await deliverToFollowers(activity, actor, env, prisma);

  await prisma.activity.create({
    data: {
      apId: activity['id'] as string,
      type: activityType,
      actorApId: actor.ap_id,
      objectApId,
      rawJson: JSON.stringify(activity),
      direction: 'outbound',
    },
  });
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

  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    'id': activityApId(baseUrl, generateId()),
    'type': 'Create',
    'actor': actor.ap_id,
    'published': story.published,
    'to': [`${actor.ap_id}/followers`],
    'object': storyObject,
  };

  await deliverAndStore(activity, 'Create', story.apId, actor, env, prisma);
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
  const activity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    'id': activityApId(env.APP_URL, generateId()),
    'type': 'Delete',
    'actor': actor.ap_id,
    'to': ['https://www.w3.org/ns/activitystreams#Public'],
    'object': storyApId,
  };

  await deliverAndStore(activity, 'Delete', storyApId, actor, env, prisma);
}
