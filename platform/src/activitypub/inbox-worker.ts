/**
 * Inbox Worker - Process incoming ActivityPub activities
 *
 * Scheduled worker that processes activities stored in ap_inbox_activities
 * Handles Follow, Accept, Like, Create, Announce, Undo, etc.
 */

import type { DatabaseAPI } from "../db/types";
import { makeData } from "../server/data-factory";
import { getOrFetchActor } from "./actor-fetch";
import { requireInstanceDomain, getActorUri } from "../subdomain";
import { ACTIVITYSTREAMS_CONTEXT } from "./activitypub";
import { sanitizeHtml } from "../utils/sanitize";

export interface Env {
  DB: D1Database;
  INSTANCE_DOMAIN?: string;
}

const MAX_BATCH_SIZE = 50;

enum InboxStatus {
  Pending = "pending",
  Processing = "processing",
  Processed = "processed",
  Failed = "failed",
}

const ACTIVITY_TYPES = new Set([
  "Follow",
  "Accept",
  "Like",
  "Create",
  "Announce",
  "Undo",
]);

/**
 * Extract type from activity.type which can be string or array
 */
function extractType(obj: any): string | null {
  if (!obj || !obj.type) return null;
  if (typeof obj.type === "string") return obj.type;
  if (Array.isArray(obj.type) && obj.type.length > 0) {
    return typeof obj.type[0] === "string" ? obj.type[0] : null;
  }
  return null;
}

/**
 * Extract actor URI from activity.actor which can be string, object, or array
 */
function extractActorUri(actor: any): string | null {
  if (!actor) return null;
  if (typeof actor === "string") return actor;
  if (Array.isArray(actor) && actor.length > 0) {
    return extractActorUri(actor[0]);
  }
  if (actor.id && typeof actor.id === "string") return actor.id;
  return null;
}

/**
 * Validate actor URI to prevent SSRF attacks
 */
function validateActorUri(uri: string): boolean {
  try {
    const url = new URL(uri);

    // Only allow HTTP(S)
    if (!url.protocol.match(/^https?:$/)) {
      console.error(`Invalid protocol in actor URI: ${url.protocol}`);
      return false;
    }

    // Reject localhost and internal IPs
    const hostname = url.hostname.toLowerCase();
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') {
      console.error(`Actor URI points to localhost: ${hostname}`);
      return false;
    }

    // Reject private IP ranges (RFC 1918)
    if (hostname.startsWith('10.') ||
        hostname.startsWith('172.16.') || hostname.startsWith('172.17.') ||
        hostname.startsWith('172.18.') || hostname.startsWith('172.19.') ||
        hostname.startsWith('172.2') || hostname.startsWith('172.3') ||
        hostname.startsWith('192.168.')) {
      console.error(`Actor URI uses private IP range: ${hostname}`);
      return false;
    }

    // Reject link-local addresses
    if (hostname.startsWith('169.254.')) {
      console.error(`Actor URI uses link-local address: ${hostname}`);
      return false;
    }

    // Require at least one dot in hostname (basic TLD check)
    if (!hostname.includes('.')) {
      console.error(`Actor URI hostname missing TLD: ${hostname}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Invalid actor URI format: ${uri}`, error);
    return false;
  }
}

function isUniqueConstraint(error: unknown): boolean {
  if (!error) return false;
  const err = error as { code?: string; message?: string };
  if (err.code === "P2002") return true;
  return typeof err.message === "string" && /unique constraint/i.test(err.message);
}

function isLocalHostname(hostname: string, instanceDomain: string): boolean {
  return hostname.toLowerCase() === instanceDomain.toLowerCase();
}

function normalizeLocalObjectUri(objectUri: string, instanceDomain: string): string | null {
  try {
    const url = new URL(objectUri);
    if (!isLocalHostname(url.hostname, instanceDomain)) {
      return null;
    }
    if (!url.pathname.startsWith("/ap/objects/")) {
      return null;
    }

    url.pathname = url.pathname.replace(/\/+$/, "");
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

async function markActivityStatus(
  db: DatabaseAPI,
  id: string,
  status: InboxStatus,
  errorMessage?: string,
): Promise<void> {
  const processed_at = (status === InboxStatus.Processed || status === InboxStatus.Failed)
    ? new Date()
    : undefined;

  try {
    await db.updateApInboxActivityStatus(id, status, errorMessage, processed_at);
  } catch (error) {
    console.error(`Failed to update inbox activity ${id} status to ${status}`, error);
  }
}

async function processActivity(
  db: DatabaseAPI,
  env: Env,
  localUserId: string,
  activity: any,
): Promise<void> {
  const type = extractType(activity);

  switch (type) {
    case "Follow":
      await handleIncomingFollow(db, env, localUserId, activity);
      break;
    case "Accept":
      await handleIncomingAccept(db, localUserId, activity);
      break;
    case "Like":
      await handleIncomingLike(db, env, localUserId, activity);
      break;
    case "Create":
      await handleIncomingCreate(db, env, localUserId, activity);
      break;
    case "Announce":
      await handleIncomingAnnounce(db, env, localUserId, activity);
      break;
    case "Undo":
      await handleIncomingUndo(db, localUserId, activity);
      break;
    default:
      console.warn(`Unhandled activity type: ${type}`);
  }
}

/**
 * Check if actor URI is local (same instance) and extract handle
 */
function parseActorUri(actorUri: string, instanceDomain: string): {
  isLocal: boolean;
  handle?: string;
} {
  try {
    const url = new URL(actorUri);
    const hostname = url.hostname.toLowerCase();

    if (isLocalHostname(hostname, instanceDomain)) {
      const pathMatch = url.pathname.match(/\/ap\/users\/([a-z0-9_]{3,20})$/);
      if (pathMatch) {
        return { isLocal: true, handle: pathMatch[1] };
      }
    }

    return { isLocal: false };
  } catch {
    return { isLocal: false };
  }
}

/**
 * Handle incoming Follow activity
 */
async function handleIncomingFollow(
  db: DatabaseAPI,
  env: Env,
  localUserId: string,
  activity: any,
): Promise<void> {
  const followerUri = extractActorUri(activity.actor);
  if (!followerUri || !validateActorUri(followerUri)) {
    console.error("Follow activity has invalid actor URI");
    return;
  }

  // Fetch follower actor info
  const follower = await getOrFetchActor(followerUri, env);
  if (!follower) {
    console.error(`Failed to fetch follower: ${followerUri}`);
    return;
  }

  const inboxUrl = follower.inbox ?? follower.endpoints?.sharedInbox;
  if (!inboxUrl) {
    console.warn(`Follower ${followerUri} has no inbox endpoint`);
    return;
  }

  // All follow requests require approval by default
  const status = "pending";
  const activityId = typeof activity.id === "string" ? activity.id : crypto.randomUUID();

  await db.upsertApFollower({
    local_user_id: localUserId,
    remote_actor_id: followerUri,
    activity_id: activityId,
    status,
    accepted_at: null,
  });

  console.log(`✓ Follow from ${followerUri} -> ${localUserId} (${status})`);
}

/**
 * Send Accept activity in response to Follow
 */
async function sendAcceptActivity(
  db: DatabaseAPI,
  env: Env,
  localUserId: string,
  followActivity: any,
  targetInbox: string,
): Promise<void> {
  const instanceDomain = requireInstanceDomain(env);
  const actorUri = getActorUri(localUserId, instanceDomain);
  const activityId = `https://${instanceDomain}/ap/activities/accept-${crypto.randomUUID()}`;

  // Only include essential properties from followActivity to avoid @context issues
  const acceptActivity = {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "Accept",
    id: activityId,
    actor: actorUri,
    object: followActivity.id || followActivity, // Prefer just the ID reference
    published: new Date().toISOString(),
  };

  // Store in outbox
  await db.upsertApOutboxActivity({
    local_user_id: localUserId,
    activity_id: activityId,
    activity_type: "Accept",
    activity_json: JSON.stringify(acceptActivity),
    object_id: followActivity.id ?? null,
    object_type: "Follow",
  });

  // Enqueue delivery
  await db.createApDeliveryQueueItem({
    activity_id: activityId,
    target_inbox_url: targetInbox,
    status: "pending",
  });

  console.log(`✓ Queued Accept activity to ${targetInbox}`);
}

/**
 * Handle incoming Accept activity (for Follow)
 */
async function handleIncomingAccept(
  db: DatabaseAPI,
  localUserId: string,
  activity: any,
): Promise<void> {
  // Extract the Follow activity from the Accept
  const followActivity = activity.object;
  if (!followActivity || followActivity.type !== "Follow") {
    console.error("Accept activity does not contain Follow object");
    return;
  }

  const followedUri = typeof followActivity.object === "string"
    ? followActivity.object
    : followActivity.object?.id;

  if (!followedUri) {
    console.error("Accept activity missing follow target");
    return;
  }

  // Update following relationship to accepted
  await db.updateApFollowsStatus(localUserId, followedUri, "accepted", new Date());

  console.log(`✓ Accept received for follow to ${followedUri}`);
}

/**
 * Handle incoming Like activity
 */
async function handleIncomingLike(
  db: DatabaseAPI,
  env: Env,
  _localUserId: string,
  activity: any,
): Promise<void> {
  const actorUri = extractActorUri(activity.actor);
  const objectUri = typeof activity.object === "string" ? activity.object : activity.object?.id;

  if (!actorUri || !validateActorUri(actorUri)) {
    console.error("Like activity has invalid actor URI");
    return;
  }

  if (!objectUri) {
    console.error("Like activity missing object");
    return;
  }

  const instanceDomain = requireInstanceDomain(env);
  const normalizedObjectUri = normalizeLocalObjectUri(objectUri, instanceDomain);
  if (!normalizedObjectUri) {
    console.warn(`Like for non-local object: ${objectUri}`);
    return;
  }

  // Check if post exists
  const post = await db.findPostByApObjectId(normalizedObjectUri);
  if (!post) {
    console.warn(`Like for non-existent post: ${normalizedObjectUri}`);
    return;
  }

  // Determine if actor is local or remote
  const actorParsed = parseActorUri(actorUri, instanceDomain);
  let userId: string;

  if (actorParsed.isLocal && actorParsed.handle) {
    // Local actor: use handle as user_id
    userId = actorParsed.handle;
  } else {
    // Remote actor: fetch and use @handle@domain format
    const actor = await getOrFetchActor(actorUri, env);
    const actorHandle = actor?.preferredUsername || actorUri.split("/").pop() || "unknown";
    const actorDomain = new URL(actorUri).hostname;
    userId = `@${actorHandle}@${actorDomain}`;
  }

  // Extract emoji from activity (Misskey compat) or use default
  const emoji = activity.content || activity._misskey_reaction || "❤️";

  // Store reaction
  await db.createApReaction({
    post_id: post.id,
    user_id: userId,
    emoji,
    ap_activity_id: activity.id ?? null,
  });

  console.log(`✓ Like from ${actorUri} (${userId}) on post ${post.id} [${emoji}]`);
}

/**
 * Handle incoming Create activity (Note, Article, etc.)
 */
async function handleIncomingCreate(
  db: DatabaseAPI,
  env: Env,
  localUserId: string,
  activity: any,
): Promise<void> {
  const object = activity.object;
  if (!object) {
    console.error("Create activity missing object");
    return;
  }

  const objectType = extractType(object);
  const actorUri = extractActorUri(activity.actor);

  if (!actorUri || !validateActorUri(actorUri)) {
    console.error("Create activity has invalid actor URI");
    return;
  }

  // Handle Note (post or comment)
  if (objectType === "Note") {
    const inReplyTo = typeof object.inReplyTo === "string" ? object.inReplyTo : object.inReplyTo?.id;

    if (inReplyTo) {
      // This is a comment/reply
      await handleIncomingComment(db, env, localUserId, object, actorUri, inReplyTo);
    } else {
      // This is a standalone post (mention, etc.)
      await handleIncomingPost(db, env, localUserId, object, actorUri);
    }
  }

  console.log(`✓ Create activity processed: ${objectType}`);
}

/**
 * Handle incoming post (Note without inReplyTo)
 */
async function handleIncomingPost(
  db: DatabaseAPI,
  env: Env,
  localRecipientId: string,
  note: any,
  actorUri: string,
): Promise<void> {
  const objectId = typeof note.id === "string" ? note.id : null;
  const content = sanitizeHtml(note.content || "");
  const published = note.published ? new Date(note.published) : new Date();
  const communityId = localRecipientId.startsWith("group:")
    ? localRecipientId.slice("group:".length)
    : null;

  // Determine if actor is local or remote
  const instanceDomain = requireInstanceDomain(env);
  const actorParsed = parseActorUri(actorUri, instanceDomain);
  let authorId: string;

  if (actorParsed.isLocal && actorParsed.handle) {
    // Local actor: use handle as author_id
    authorId = actorParsed.handle;
  } else {
    // Remote actor: fetch and use @handle@domain format
    const actor = await getOrFetchActor(actorUri, env);
    const actorHandle = actor?.preferredUsername || "unknown";
    const actorDomain = new URL(actorUri).hostname;
    authorId = `@${actorHandle}@${actorDomain}`;
  }

  const postId = crypto.randomUUID();
  const postResult = await db.createApRemotePost({
    id: postId,
    community_id: communityId,
    attributed_community_id: communityId ?? undefined,
    author_id: authorId,
    text: content,
    created_at: published,
    type: "text",
    media_urls: [],
    ap_object_id: objectId,
    ap_attributed_to: actorUri,
    in_reply_to: null,
  });

  if (postResult.inserted) {
    console.log(`✓ Stored post ${objectId ?? "(generated)"} from ${actorUri} (${authorId})`);
  } else {
    console.log(`ℹ︎ Post ${objectId ?? "(generated)"} already exists, skipping`);
  }
}

/**
 * Handle incoming comment (Note with inReplyTo)
 */
async function handleIncomingComment(
  db: DatabaseAPI,
  env: Env,
  _localUserId: string,
  note: any,
  actorUri: string,
  inReplyTo: string,
): Promise<void> {
  const instanceDomain = requireInstanceDomain(env);

  const normalizedObjectUri = normalizeLocalObjectUri(inReplyTo, instanceDomain);
  if (!normalizedObjectUri) {
    console.warn(`Comment reply to non-local object: ${inReplyTo}`);
    return;
  }

  // Check if post exists
  const post = await db.findPostByApObjectId(normalizedObjectUri);
  if (!post) {
    console.warn(`Comment for non-existent post: ${normalizedObjectUri}`);
    return;
  }

  // Determine if actor is local or remote
  const actorParsed = parseActorUri(actorUri, instanceDomain);
  let authorId: string;

  if (actorParsed.isLocal && actorParsed.handle) {
    // Local actor: use handle as author_id
    authorId = actorParsed.handle;
  } else {
    // Remote actor: fetch and use @handle@domain format
    const actor = await getOrFetchActor(actorUri, env);
    const actorHandle = actor?.preferredUsername || "unknown";
    const actorDomain = new URL(actorUri).hostname;
    authorId = `@${actorHandle}@${actorDomain}`;
  }

  const content = sanitizeHtml(note.content || "");
  const published = note.published ? new Date(note.published) : new Date();

  const commentResult = await db.createApRemoteComment({
    id: crypto.randomUUID(),
    post_id: post.id,
    author_id: authorId,
    text: content,
    created_at: published,
    ap_object_id: typeof note.id === "string" ? note.id : null,
    ap_activity_id: typeof note.id === "string" ? note.id : null,
  });

  if (commentResult.inserted) {
    console.log(`✓ Stored comment on post ${post.id} from ${actorUri} (${authorId})`);
  } else {
    console.log(`ℹ︎ Comment ${note.id ?? "(generated)"} already exists, skipping`);
  }
}

/**
 * Handle incoming Announce activity (boost/reblog)
 */
async function handleIncomingAnnounce(
  db: DatabaseAPI,
  env: Env,
  _localUserId: string,
  activity: any,
): Promise<void> {
  const actorUri = extractActorUri(activity.actor);
  const objectUri = typeof activity.object === "string" ? activity.object : activity.object?.id;

  if (!actorUri || !validateActorUri(actorUri)) {
    console.error("Announce activity has invalid actor URI");
    return;
  }

  if (!objectUri) {
    console.error("Announce activity missing object");
    return;
  }

  // Parse object URI to find local post
  const instanceDomain = requireInstanceDomain(env);
  const normalizedObjectUri = normalizeLocalObjectUri(objectUri, instanceDomain);
  if (!normalizedObjectUri) {
    console.warn(`Announce for non-local object: ${objectUri}`);
    return;
  }

  // Check if post exists
  const post = await db.findPostByApObjectId(normalizedObjectUri);
  if (!post) {
    console.warn(`Announce for non-existent post: ${normalizedObjectUri}`);
    return;
  }

  // Store the Announce activity
  const announceId = typeof activity.id === "string" ? activity.id : null;
  if (!announceId) {
    console.error("Announce activity missing id");
    return;
  }

  // Check if already stored
  const existing = await db.findApAnnounce(announceId);
  if (existing) {
    console.log(`Announce already recorded: ${announceId}`);
    return;
  }

  // Create announce record
  await db.createApAnnounce({
    activity_id: announceId,
    actor_id: actorUri,
    object_id: normalizedObjectUri,
    local_post_id: post.id,
  });

  console.log(`✓ Announce from ${actorUri} for post ${post.id} stored`);
}

/**
 * Handle incoming Undo activity
 */
async function handleIncomingUndo(
  db: DatabaseAPI,
  localUserId: string,
  activity: any,
): Promise<void> {
  const object = activity.object;
  if (!object) {
    console.error("Undo activity missing object");
    return;
  }

  const objectType = extractType(object);
  const actorUri = extractActorUri(activity.actor);

  if (!actorUri || !validateActorUri(actorUri)) {
    console.error("Undo activity has invalid actor URI");
    return;
  }

  switch (objectType) {
    case "Follow":
      // Remove follower
      await db.deleteApFollowers(localUserId, actorUri);
      console.log(`✓ Undo Follow from ${actorUri}`);
      break;

    case "Like":
      // Remove reaction
      if (object.id) {
        await db.deleteApReactionsByActivityId(object.id);
      }
      console.log(`✓ Undo Like: ${object.id}`);
      break;

    case "Announce":
      if (object.id) {
        await db.deleteApAnnouncesByActivityId(object.id);
      }
      console.log(`✓ Undo Announce: ${object.id}`);
      break;

    default:
      console.warn(`Unhandled Undo type: ${objectType}`);
  }
}

/**
 * Process a batch of pending inbox activities
 */
export async function processInboxQueue(env: Env, batchSize = 10): Promise<void> {
  const effectiveBatchSize = Math.min(Math.max(batchSize, 1), MAX_BATCH_SIZE);
  const db = makeData(env);

  try {
    console.log("Inbox worker started (DB API)");

    const claimed = await db.claimPendingInboxActivities(effectiveBatchSize);

    if (!claimed?.activities?.length) {
      console.log("No pending inbox activities");
      return;
    }

    console.log(`Processing ${claimed.activities.length} inbox activities`);

    for (const item of claimed.activities) {
      const startedAt = Date.now();
      try {
        let activity: any;
        try {
          activity = JSON.parse(item.activity_json);
        } catch (parseError) {
          console.error(`Failed to parse inbox activity ${item.id}`, parseError);
          await markActivityStatus(
            db,
            item.id,
            InboxStatus.Failed,
            "invalid activity json",
          );
          continue;
        }

        if (!ACTIVITY_TYPES.has(activity?.type)) {
          console.warn(`Skipping unknown activity type: ${activity?.type}`);
          await markActivityStatus(db, item.id, InboxStatus.Processed);
          continue;
        }

        await db.transaction(async (tx: DatabaseAPI) => {
          await processActivity(tx, env, item.local_user_id, activity);
          await markActivityStatus(tx, item.id, InboxStatus.Processed);
        });

        console.log(
          `✓ Processed activity ${item.id} (${activity.type}) in ${Date.now() - startedAt}ms`,
        );
      } catch (error) {
        console.error(`Failed to process activity ${item.id}:`, error);
        await markActivityStatus(
          db,
          item.id,
          InboxStatus.Failed,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    console.log("Inbox worker completed");
  } catch (error) {
    console.error("Error in inbox worker:", error);
  } finally {
    await db.disconnect();
  }
}

export async function handleInboxScheduled(env: Env, batchSize = 10): Promise<void> {
  await processInboxQueue(env, batchSize);
}
