import type { Env, LocalUser, Activity } from '../../types';
import { getTenantConfig, getRules, evaluateRules } from '../config';
import { signRequest } from './http-signatures';

function generateId(): string {
  const buffer = new Uint8Array(16);
  crypto.getRandomValues(buffer);
  return Array.from(buffer).map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface ProcessResult {
  success: boolean;
  error?: string;
}

type NormalizedActivity = Activity & { actor: string };

function normalizeActivityType(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const entry = value.find((item) => typeof item === 'string');
    return entry || 'Unknown';
  }
  return 'Unknown';
}

/**
 * Fetch and cache a remote actor
 */
export async function fetchRemoteActor(env: Env, actorUrl: string): Promise<any | null> {
  // Check cache first
  const cached = await env.DB.prepare(
    `SELECT actor_json, fetched_at FROM remote_actors WHERE actor_url = ?`
  ).bind(actorUrl).first<{ actor_json: string; fetched_at: string }>();

  if (cached) {
    const fetchedAt = new Date(cached.fetched_at);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (fetchedAt > hourAgo) {
      return JSON.parse(cached.actor_json);
    }
  }

  try {
    const response = await fetch(actorUrl, {
      headers: {
        'Accept': 'application/activity+json, application/ld+json',
      },
    });

    if (!response.ok) {
      return null;
    }

    const actor = await response.json();

    // Cache the actor
    await env.DB.prepare(`
      INSERT INTO remote_actors (id, actor_url, inbox, shared_inbox, public_key, actor_json)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(actor_url) DO UPDATE SET
        inbox = excluded.inbox,
        shared_inbox = excluded.shared_inbox,
        public_key = excluded.public_key,
        actor_json = excluded.actor_json,
        fetched_at = datetime('now')
    `).bind(
      generateId(),
      actorUrl,
      actor.inbox,
      actor.endpoints?.sharedInbox || null,
      actor.publicKey?.publicKeyPem || '',
      JSON.stringify(actor)
    ).run();

    return actor;
  } catch (error) {
    console.error('Failed to fetch remote actor:', error);
    return null;
  }
}

/**
 * Process a Follow activity
 */
export async function processFollow(
  env: Env,
  activity: NormalizedActivity,
  localUser: LocalUser,
  hostname: string
): Promise<ProcessResult> {
  const followerUrl = activity.actor;
  const followingUrl = activity.object;

  const localActorUrl = `https://${hostname}/users/${localUser.username}`;

  // Verify the follow is for our local user
  if (followingUrl !== localActorUrl) {
    return { success: false, error: 'Follow target is not this user' };
  }

  // Fetch the follower's actor info
  const followerActor = await fetchRemoteActor(env, followerUrl);
  if (!followerActor) {
    return { success: false, error: 'Could not fetch follower actor' };
  }

  const config = await getTenantConfig(env);
  const followStatus = config.federation.autoAcceptFollows ? 'accepted' : 'pending';

  // Record the follow
  const followId = generateId();
  await env.DB.prepare(`
    INSERT INTO follows (id, follower_actor, following_actor, status)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(follower_actor, following_actor) DO UPDATE SET status = excluded.status
  `).bind(followId, followerUrl, localActorUrl, followStatus).run();

  // Create notification
  await env.DB.prepare(`
    INSERT INTO notifications (id, type, actor_url, object_url)
    VALUES (?, 'follow', ?, ?)
  `).bind(generateId(), followerUrl, activity.id).run();

  if (followStatus === 'accepted') {
    // Queue Accept activity
    const acceptActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: `https://${hostname}/activities/${generateId()}`,
      type: 'Accept',
      actor: localActorUrl,
      object: activity,
    };

    await queueDelivery(env, acceptActivity, followerActor.inbox, localUser);
  }

  return { success: true };
}

/**
 * Process an Undo activity
 */
export async function processUndo(
  env: Env,
  activity: NormalizedActivity,
  localUser: LocalUser,
  hostname: string
): Promise<ProcessResult> {
  const innerActivity = activity.object;

  if (!innerActivity || typeof innerActivity !== 'object') {
    return { success: false, error: 'Invalid Undo object' };
  }

  switch (innerActivity.type) {
    case 'Follow':
      // Remove the follow
      await env.DB.prepare(`
        DELETE FROM follows WHERE follower_actor = ? AND following_actor = ?
      `).bind(activity.actor, innerActivity.object).run();
      return { success: true };

    case 'Like':
      // Remove the like
      await env.DB.prepare(`
        DELETE FROM likes WHERE actor_url = ? AND object_url = ?
      `).bind(activity.actor, innerActivity.object).run();
      return { success: true };

    case 'Announce':
      // Remove the announce
      await env.DB.prepare(`
        DELETE FROM announces WHERE actor_url = ? AND object_url = ?
      `).bind(activity.actor, innerActivity.object).run();
      return { success: true };

    default:
      return { success: false, error: `Unknown Undo type: ${innerActivity.type}` };
  }
}

/**
 * Process a Like activity
 */
export async function processLike(
  env: Env,
  activity: NormalizedActivity,
  localUser: LocalUser,
  hostname: string
): Promise<ProcessResult> {
  const config = await getTenantConfig(env);
  if (!config.features.enableLikes) {
    return { success: true };
  }

  const likerUrl = activity.actor;
  const objectUrl = activity.object;

  // Verify the liked object is our post
  if (!objectUrl.startsWith(`https://${hostname}/posts/`)) {
    return { success: false, error: 'Liked object is not from this server' };
  }

  // Record the like
  await env.DB.prepare(`
    INSERT INTO likes (id, actor_url, object_url)
    VALUES (?, ?, ?)
    ON CONFLICT(actor_url, object_url) DO NOTHING
  `).bind(generateId(), likerUrl, objectUrl).run();

  // Create notification
  await env.DB.prepare(`
    INSERT INTO notifications (id, type, actor_url, object_url)
    VALUES (?, 'like', ?, ?)
  `).bind(generateId(), likerUrl, objectUrl).run();

  return { success: true };
}

/**
 * Process an Announce (boost) activity
 */
export async function processAnnounce(
  env: Env,
  activity: NormalizedActivity,
  localUser: LocalUser,
  hostname: string
): Promise<ProcessResult> {
  const config = await getTenantConfig(env);
  if (!config.features.enableBoosts) {
    return { success: true };
  }

  const boosterUrl = activity.actor;
  const objectUrl = activity.object;

  // Verify the boosted object is our post
  if (!objectUrl.startsWith(`https://${hostname}/posts/`)) {
    return { success: false, error: 'Announced object is not from this server' };
  }

  // Record the announce
  await env.DB.prepare(`
    INSERT INTO announces (id, actor_url, object_url)
    VALUES (?, ?, ?)
    ON CONFLICT(actor_url, object_url) DO NOTHING
  `).bind(generateId(), boosterUrl, objectUrl).run();

  // Create notification
  await env.DB.prepare(`
    INSERT INTO notifications (id, type, actor_url, object_url)
    VALUES (?, 'announce', ?, ?)
  `).bind(generateId(), boosterUrl, objectUrl).run();

  return { success: true };
}

/**
 * Process a Create activity (new post/note)
 */
export async function processCreate(
  env: Env,
  activity: NormalizedActivity,
  localUser: LocalUser,
  hostname: string
): Promise<ProcessResult> {
  const object = activity.object;

  if (!object || typeof object !== 'object') {
    return { success: false, error: 'Invalid Create object' };
  }

  const content = typeof object.content === 'string' ? object.content : '';
  const attachments = Array.isArray(object.attachment)
    ? object.attachment
    : object.attachment
      ? [object.attachment]
      : [];
  const attachmentMediaTypes = attachments
    .map((item: any) => (typeof item?.mediaType === 'string' ? item.mediaType : null))
    .filter((value): value is string => !!value);
  if (!content && attachments.length === 0) {
    return { success: false, error: 'Missing content or attachments' };
  }

  const [config, rules] = await Promise.all([
    getTenantConfig(env),
    getRules(env),
  ]);
  const actorDomain = (() => {
    try {
      return new URL(activity.actor).hostname;
    } catch {
      return undefined;
    }
  })();

  const ruleResult = evaluateRules(rules, {
    content,
    actor: activity.actor,
    domain: actorDomain,
    mediaType:
      typeof object.mediaType === 'string'
        ? object.mediaType
        : attachmentMediaTypes[0],
    language: typeof object.language === 'string' ? object.language : undefined,
  });

  if (ruleResult.action === 'reject' || ruleResult.action === 'silence') {
    return {
      success: false,
      error: ruleResult.message || 'Content rejected by rules',
    };
  }

  if (ruleResult.action === 'warn') {
    console.warn('Inbound content matched warning rule:', ruleResult.message || 'warn');
  }

  // Check if this is a reply to our post
  const inReplyTo = object.inReplyTo;
  if (config.features.enableReplies && inReplyTo && inReplyTo.startsWith(`https://${hostname}/posts/`)) {
    // Create notification for reply
    await env.DB.prepare(`
      INSERT INTO notifications (id, type, actor_url, object_url)
      VALUES (?, 'reply', ?, ?)
    `).bind(generateId(), activity.actor, object.id).run();
  }

  // Check for mentions
  const mentions = object.tag?.filter((t: any) => t.type === 'Mention') || [];
  const localActorUrl = `https://${hostname}/users/${localUser.username}`;

  for (const mention of mentions) {
    if (mention.href === localActorUrl) {
      await env.DB.prepare(`
        INSERT INTO notifications (id, type, actor_url, object_url)
        VALUES (?, 'mention', ?, ?)
      `).bind(generateId(), activity.actor, object.id).run();
      break;
    }
  }

  return { success: true };
}

/**
 * Process a Delete activity
 */
export async function processDelete(
  env: Env,
  activity: NormalizedActivity,
  localUser: LocalUser,
  hostname: string
): Promise<ProcessResult> {
  // Just acknowledge for now
  // Remote deletes are handled by removing cached data
  return { success: true };
}

/**
 * Process an Accept activity (for our Follow request)
 */
export async function processAccept(
  env: Env,
  activity: NormalizedActivity,
  localUser: LocalUser,
  hostname: string
): Promise<ProcessResult> {
  const innerActivity = activity.object;

  const localActorUrl = `https://${hostname}/users/${localUser.username}`;
  const innerType = innerActivity && typeof innerActivity === 'object'
    ? (innerActivity as { type?: unknown }).type
    : null;

  if (!innerActivity || typeof innerActivity !== 'object') {
    // Some implementations send Accept with object as an ID string; accept based on actor.
    await env.DB.prepare(`
      UPDATE follows SET status = 'accepted'
      WHERE follower_actor = ? AND following_actor = ?
    `).bind(localActorUrl, activity.actor).run();
    return { success: true };
  }

  if (innerType === 'Follow') {
    // Update our follow to accepted status
    await env.DB.prepare(`
      UPDATE follows SET status = 'accepted'
      WHERE follower_actor = ? AND following_actor = ?
    `).bind(localActorUrl, activity.actor).run();
  }

  return { success: true };
}

/**
 * Process a Reject activity (for our Follow request)
 */
export async function processReject(
  env: Env,
  activity: NormalizedActivity,
  localUser: LocalUser,
  hostname: string
): Promise<ProcessResult> {
  const localActorUrl = `https://${hostname}/users/${localUser.username}`;

  await env.DB.prepare(`
    UPDATE follows SET status = 'rejected'
    WHERE follower_actor = ? AND following_actor = ?
  `).bind(localActorUrl, activity.actor).run();

  return { success: true };
}

/**
 * Process an incoming activity from the inbox
 */
export async function processActivity(
  env: Env,
  activity: Activity,
  localUser: LocalUser,
  hostname: string
): Promise<ProcessResult> {
  const normalizedActivity = activity as NormalizedActivity;
  const activityType = normalizeActivityType(activity.type);
  switch (activityType) {
    case 'Follow':
      return processFollow(env, normalizedActivity, localUser, hostname);
    case 'Undo':
      return processUndo(env, normalizedActivity, localUser, hostname);
    case 'Like':
      return processLike(env, normalizedActivity, localUser, hostname);
    case 'Announce':
      return processAnnounce(env, normalizedActivity, localUser, hostname);
    case 'Create':
      return processCreate(env, normalizedActivity, localUser, hostname);
    case 'Delete':
      return processDelete(env, normalizedActivity, localUser, hostname);
    case 'Accept':
      return processAccept(env, normalizedActivity, localUser, hostname);
    case 'Reject':
      return processReject(env, normalizedActivity, localUser, hostname);
    default:
      console.log(`Unknown activity type: ${activity.type}`);
      return { success: true }; // Acknowledge unknown activities
  }
}

/**
 * Queue an activity for delivery
 */
export async function queueDelivery(
  env: Env,
  activity: any,
  targetInbox: string,
  localUser: LocalUser
): Promise<void> {
  const id = generateId();
  const now = new Date().toISOString();

  await env.DB.prepare(`
    INSERT INTO outbox_queue (id, activity_json, target_inbox, next_attempt_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    id,
    JSON.stringify(activity),
    targetInbox,
    now,
    now
  ).run();
}

/**
 * Deliver an activity to a remote inbox
 */
export async function deliverActivity(
  env: Env,
  activity: any,
  targetInbox: string,
  localUser: LocalUser,
  hostname: string
): Promise<boolean> {
  const body = JSON.stringify(activity);
  const keyId = `https://${hostname}/users/${localUser.username}#main-key`;

  try {
    const signatureHeaders = await signRequest({
      method: 'POST',
      url: targetInbox,
      body,
      privateKeyPem: localUser.private_key,
      keyId,
    });

    const response = await fetch(targetInbox, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/activity+json',
        'Accept': 'application/activity+json',
        ...signatureHeaders,
      },
      body,
    });

    return response.ok || response.status === 202;
  } catch (error) {
    console.error('Delivery failed:', error);
    return false;
  }
}

/**
 * Process the outbox queue
 */
export async function processOutboxQueue(
  env: Env,
  localUser: LocalUser,
  hostname: string
): Promise<number> {
  const now = new Date().toISOString();

  // Get pending deliveries
  const pending = await env.DB.prepare(`
    SELECT * FROM outbox_queue
    WHERE completed_at IS NULL AND next_attempt_at <= ?
    ORDER BY next_attempt_at
    LIMIT 10
  `).bind(now).all<{
    id: string;
    activity_json: string;
    target_inbox: string;
    attempts: number;
  }>();

  let delivered = 0;

  for (const item of pending.results) {
    const activity = JSON.parse(item.activity_json);
    const success = await deliverActivity(env, activity, item.target_inbox, localUser, hostname);

    if (success) {
      await env.DB.prepare(`
        UPDATE outbox_queue SET completed_at = ? WHERE id = ?
      `).bind(now, item.id).run();
      delivered++;
    } else {
      // Exponential backoff
      const nextAttempts = item.attempts + 1;
      const delay = Math.min(Math.pow(2, nextAttempts) * 60, 86400); // Max 24 hours
      const nextAttemptAt = new Date(Date.now() + delay * 1000).toISOString();

      if (nextAttempts >= 10) {
        // Give up after 10 attempts
        await env.DB.prepare(`
          UPDATE outbox_queue SET completed_at = ?, error = 'Max attempts reached'
          WHERE id = ?
        `).bind(now, item.id).run();
      } else {
        await env.DB.prepare(`
          UPDATE outbox_queue SET attempts = ?, last_attempt_at = ?, next_attempt_at = ?
          WHERE id = ?
        `).bind(nextAttempts, now, nextAttemptAt, item.id).run();
      }
    }
  }

  return delivered;
}
