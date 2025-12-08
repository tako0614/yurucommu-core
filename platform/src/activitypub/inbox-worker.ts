/**
 * Inbox Worker - Process incoming ActivityPub activities
 *
 * Scheduled worker that processes activities stored in ap_inbox_activities
 * Handles Follow, Accept, Like, Create, Announce, Undo, etc.
 */

import type { DatabaseAPI } from "../db/types";
import { makeData } from "../server/data-factory";
import { getActivityPubAvailability } from "../server/context";
import { getOrFetchActor, fetchRemoteObject } from "./actor-fetch";
import { requireInstanceDomain, getActorUri } from "../subdomain";
import { ACTIVITYSTREAMS_CONTEXT } from "./activitypub";
import { sanitizeHtml } from "../utils/sanitize";
import { handleIncomingDm, handleIncomingChannelMessage } from "./chat";
import { deliverSingleQueuedItem } from "./delivery-worker";
import { applyFederationPolicy, buildActivityPubPolicy } from "./federation-policy";
import type { TakosActivityPubConfig } from "../config/takos-config";
import { createObjectService } from "../app/services/object-service";

export interface Env {
  DB: D1Database;
  INSTANCE_DOMAIN?: string;
  takosConfig?: any;
}

function isActivityPubDisabled(env: Env, feature: string): boolean {
  const availability = getActivityPubAvailability(env);
  if (!availability.enabled) {
    console.warn(
      `[ActivityPub] ${feature} skipped in ${availability.context} context: ${availability.reason}`,
    );
    return true;
  }
  return false;
}

const MAX_BATCH_SIZE = 50;
const STORY_TTL_MS = 24 * 60 * 60 * 1000;

enum InboxStatus {
  Pending = "pending",
  Processing = "processing",
  Processed = "processed",
  Failed = "failed",
}

const ACTIVITY_TYPES = new Set([
  "Follow",
  "Accept",
  "Reject",
  "Like",
  "Create",
  "Announce",
  "Undo",
  "Update",
  "Delete",
  "Flag",
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

const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((v) => typeof v === "string") as string[];
  }
  if (typeof value === "string") return [value];
  return [];
};

const ensureStoryTtl = (note: any): any => {
  const story = (note as any)["takos:story"] ?? (note as any).story;
  if (!story) return note;
  const expiresRaw =
    story?.expiresAt ??
    story?.expires_at ??
    (note as any).expiresAt ??
    (note as any).expires_at;
  const published = typeof note?.published === "string" ? new Date(note.published) : new Date();
  const parsed = expiresRaw ? new Date(expiresRaw) : null;
  const expiresAt =
    parsed && !Number.isNaN(parsed.getTime())
      ? parsed
      : new Date(published.getTime() + STORY_TTL_MS);
  const expiresIso = expiresAt.toISOString();
  return {
    ...note,
    expiresAt: (note as any).expiresAt ?? expiresIso,
    "takos:story": { ...story, expiresAt: expiresIso },
  };
};

function inferVisibility(to: string[], cc: string[], bto: string[] = [], bcc: string[] = []): string {
  const combinedTo = [...to, ...bto];
  const combinedCc = [...cc, ...bcc];
  if (combinedTo.includes(PUBLIC_AUDIENCE)) return "public";
  if (combinedCc.includes(PUBLIC_AUDIENCE)) return "unlisted";
  if (combinedTo.some((r) => r.endsWith("/followers"))) return "followers";
  return "direct";
}

type RecipientSet = { to: string[]; cc: string[]; bto: string[]; bcc: string[] };

function extractRecipients(activity: any, object: any): RecipientSet {
  return {
    to: toStringArray(object?.to ?? activity?.to),
    cc: toStringArray(object?.cc ?? activity?.cc),
    bto: toStringArray(object?.bto ?? activity?.bto),
    bcc: toStringArray(object?.bcc ?? activity?.bcc),
  };
}

function hasPublicAudience(recipients: RecipientSet): boolean {
  return (
    recipients.to.includes(PUBLIC_AUDIENCE) ||
    recipients.cc.includes(PUBLIC_AUDIENCE) ||
    recipients.bto.includes(PUBLIC_AUDIENCE) ||
    recipients.bcc.includes(PUBLIC_AUDIENCE)
  );
}

function hasAnyRecipients(recipients: RecipientSet): boolean {
  return (
    recipients.to.length > 0 ||
    recipients.cc.length > 0 ||
    recipients.bto.length > 0 ||
    recipients.bcc.length > 0
  );
}

async function resolveObjectById(db: DatabaseAPI, objectId: string, instanceDomain: string): Promise<any | null> {
  const normalized = normalizeLocalObjectUri(objectId, instanceDomain) || objectId;
  if (db.getObject) {
    const direct = await db.getObject(normalized).catch(() => null);
    if (direct) return direct;
  }
  if (db.getObjectByLocalId) {
    const local = await db.getObjectByLocalId(normalized).catch(() => null);
    if (local) return local;
  }
  if (db.findPostByApObjectId) {
    return db.findPostByApObjectId(normalized).catch(() => null);
  }
  return null;
}

async function saveRemoteNote(
  db: DatabaseAPI,
  env: Env,
  note: any,
  actorUri: string,
  options: { inReplyTo?: string | null; context?: string | null } = {},
): Promise<string | null> {
  const hydrated = ensureStoryTtl(note);
  const to = toStringArray(hydrated.to);
  const cc = toStringArray(hydrated.cc);
  const bto = toStringArray(hydrated.bto);
  const bcc = toStringArray(hydrated.bcc);
  const objectId = typeof hydrated.id === "string" ? hydrated.id : crypto.randomUUID();
  const context =
    typeof options.context === "string"
      ? options.context
      : (typeof hydrated.context === "string" ? hydrated.context : null);
  const inReplyTo =
    options.inReplyTo ?? (typeof hydrated.inReplyTo === "string" ? hydrated.inReplyTo : null);
  const visibility = inferVisibility(to, cc, bto, bcc);
  const payload = {
    ...hydrated,
    type: extractType(hydrated) || "Note",
    id: objectId,
    actor: actorUri,
    to,
    cc,
    bto,
    bcc,
    context,
    inReplyTo,
    visibility,
  };

  // Prefer ObjectService for normalization (tags/poll/story TTL/recipients)
  try {
    const objects = createObjectService(env as any);
    const stored = await objects.receiveRemote({ userId: null } as any, payload);
    return stored?.id ?? objectId;
  } catch (error) {
    console.warn("[ActivityPub] ObjectService receiveRemote failed, falling back to DB", error);
  }

  if (db.createObject) {
    try {
      await db.createObject({
        id: objectId,
        local_id: null,
        type: extractType(hydrated) || "Note",
        actor: actorUri,
        published: hydrated.published ? new Date(hydrated.published) : new Date(),
        updated: hydrated.updated ?? null,
        to: to.length ? to : null,
        cc: cc.length ? cc : null,
        bto,
        bcc,
        context,
        in_reply_to: inReplyTo,
        content: payload,
        is_local: 0,
        visibility,
      } as any);
      return objectId;
    } catch (error) {
      if (isUniqueConstraint(error)) return objectId;
      throw error;
    }
  }

  if (db.createApRemotePost) {
    await db.createApRemotePost({
      id: payload.local_id ?? undefined,
      community_id: payload.context ?? undefined,
      attributed_community_id: payload.context ?? undefined,
      author_id: actorUri,
      text: typeof note.content === "string" ? note.content : "",
      content_warning: typeof note.summary === "string" ? note.summary : null,
      sensitive: (note as any).sensitive,
      created_at: payload.published ?? new Date(),
      ap_object_id: payload.id,
      ap_attributed_to: actorUri,
      ap_activity_id: typeof note.id === "string" ? note.id : null,
      in_reply_to: payload.in_reply_to,
    });
    return payload.id;
  }

  return null;
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
      await handleIncomingAccept(db, env, localUserId, activity);
      break;
    case "Reject":
      await handleIncomingReject(db, env, localUserId, activity);
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
      await handleIncomingUndo(db, env, localUserId, activity);
      break;
    case "Update":
      await handleIncomingUpdate(db, env, localUserId, activity);
      break;
    case "Delete":
      await handleIncomingDelete(db, env, localUserId, activity);
      break;
    case "Flag":
      await handleIncomingFlag(db, env, localUserId, activity);
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

function parseDomain(uri: string): string | null {
  try {
    return new URL(uri).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function resolveActivityPubPolicy(env: any): ReturnType<typeof buildActivityPubPolicy> {
  const activitypubConfig: TakosActivityPubConfig | null =
    (env as any)?.takosConfig?.activitypub ?? (env as any)?.activitypub ?? null;
  return buildActivityPubPolicy({
    env,
    config: activitypubConfig,
  });
}

function isFederationDomainAllowed(actorUri: string, env: any): boolean {
  const hostname = parseDomain(actorUri);
  if (!hostname) return false;
  const decision = applyFederationPolicy(actorUri, resolveActivityPubPolicy(env));
  if (decision.allowed) return true;
  const reason = decision.reason === "blocked" ? "blocked instance" : "not on allowlist";
  console.warn(`[federation] denied for ${hostname}: ${reason}`);
  return false;
}

function isRemoteActorAllowed(actorUri: string, env: any): boolean {
  if (!validateActorUri(actorUri)) {
    return false;
  }
  return isFederationDomainAllowed(actorUri, env);
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
  const targetUser = await db.getUser(localUserId).catch(() => null);
  if (!targetUser) {
    console.warn(`Follow activity received for unknown user: ${localUserId}`);
    return;
  }

  const followerUri = extractActorUri(activity.actor);
  if (!followerUri || !isRemoteActorAllowed(followerUri, env)) {
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

  // Create notification for the local user
  try {
    const remoteHandle = follower.preferredUsername || followerUri.split("/").pop() || "unknown";
    const remoteDomain = new URL(followerUri).hostname;
    const remoteUserId = `@${remoteHandle}@${remoteDomain}`;

    await db.addNotification({
      id: crypto.randomUUID(),
      user_id: localUserId,
      type: "follow_request",
      actor_id: remoteUserId,
      ref_type: "user",
      ref_id: remoteUserId,
      message: `${remoteUserId} sent you a follow request`,
      created_at: new Date(),
      read: false,
    });
    console.log(`✓ Notification created for ${localUserId} about follow from ${remoteUserId}`);
  } catch (error) {
    console.error("Failed to create notification for follow request", error);
  }
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
  if (isActivityPubDisabled(env, "Accept follow")) {
    return;
  }

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
  const deliveryResult = await db.createApDeliveryQueueItem({
    activity_id: activityId,
    target_inbox_url: targetInbox,
    status: "pending",
  });

  // Deliver immediately (Accept activities should be instant)
  if (deliveryResult?.id) {
    try {
      await deliverSingleQueuedItem(env, deliveryResult.id);
      console.log(`✓ Immediately delivered Accept activity to ${targetInbox}`);
    } catch (error) {
      console.warn(`Failed to immediately deliver Accept, will retry via scheduled worker:`, error);
      // Delivery remains queued for scheduled worker to retry
    }
  } else {
    console.log(`✓ Queued Accept activity to ${targetInbox} (will be delivered by scheduled worker)`);
  }
}

/**
 * Handle incoming Accept activity (for Follow)
 */
async function handleIncomingAccept(
  db: DatabaseAPI,
  env: Env,
  localUserId: string,
  activity: any,
): Promise<void> {
  const actorUri = extractActorUri(activity.actor);
  if (!actorUri || !isRemoteActorAllowed(actorUri, env)) {
    console.error("Accept activity has invalid actor URI");
    return;
  }

  // Extract Follow info (robust to object or string)
  const followActivity = activity.object;
  const followActivityId =
    typeof followActivity === "string"
      ? followActivity
      : typeof followActivity === "object"
        ? followActivity.id
        : null;

  const followedUri =
    typeof followActivity === "object"
      ? typeof followActivity.object === "string"
        ? followActivity.object
        : followActivity.object?.id
      : null;

  if (!followActivityId && !followedUri) {
    console.error("Accept activity does not contain Follow object");
    return;
  }

  if (!followedUri) {
    console.warn("Accept activity missing follow target; falling back to actor URI");
  }

  // Update following relationship to accepted
  const targetUri = followedUri || actorUri;
  await db.updateApFollowsStatus(localUserId, targetUri, "accepted", new Date());

  // Fetch remote actor info for notification
  const remoteActor = await getOrFetchActor(actorUri, env);
  if (remoteActor) {
    const remoteHandle = remoteActor.preferredUsername || actorUri.split("/").pop() || "unknown";
    const remoteDomain = new URL(actorUri).hostname;
    const remoteUserId = `@${remoteHandle}@${remoteDomain}`;

    // Send notification to local user
    try {
      await db.addNotification({
        id: crypto.randomUUID(),
        user_id: localUserId,
        type: "follow_accepted",
        actor_id: remoteUserId,
        ref_type: "user",
        ref_id: remoteUserId,
        message: `${remoteUserId} accepted your follow request`,
        created_at: new Date(),
        read: false,
      });
      console.log(`✓ Notification sent to ${localUserId} for follow acceptance from ${remoteUserId}`);
    } catch (error) {
      console.error("Failed to create notification for follow acceptance", error);
    }
  }

  console.log(`✓ Accept received for follow to ${followedUri}`);
}

/**
 * Handle incoming Reject activity (for Follow)
 */
async function handleIncomingReject(
  db: DatabaseAPI,
  env: Env,
  localUserId: string,
  activity: any,
): Promise<void> {
  const actorUri = extractActorUri(activity.actor);
  if (!actorUri || !isRemoteActorAllowed(actorUri, env)) {
    console.error("Reject activity has invalid actor URI");
    return;
  }

  // Extract Follow info (robust to object or string)
  const followActivity = activity.object;
  const followActivityId =
    typeof followActivity === "string"
      ? followActivity
      : typeof followActivity === "object"
        ? followActivity.id
        : null;

  const followedUri =
    typeof followActivity === "object"
      ? typeof followActivity.object === "string"
        ? followActivity.object
        : followActivity.object?.id
      : null;

  if (!followActivityId && !followedUri) {
    console.error("Reject activity does not contain Follow object");
    return;
  }

  if (!followedUri) {
    console.warn("Reject activity missing follow target; falling back to actor URI");
  }

  // Update following relationship to rejected
  const targetUri = followedUri || actorUri;
  await db.updateApFollowsStatus(localUserId, targetUri, "rejected", new Date());

  // Fetch remote actor info for notification
  const remoteActor = await getOrFetchActor(actorUri, env);
  if (remoteActor) {
    const remoteHandle = remoteActor.preferredUsername || actorUri.split("/").pop() || "unknown";
    const remoteDomain = new URL(actorUri).hostname;
    const remoteUserId = `@${remoteHandle}@${remoteDomain}`;

    // Send notification to local user
    try {
      await db.addNotification({
        id: crypto.randomUUID(),
        user_id: localUserId,
        type: "follow_rejected",
        actor_id: remoteUserId,
        ref_type: "user",
        ref_id: remoteUserId,
        message: `${remoteUserId} rejected your follow request`,
        created_at: new Date(),
        read: false,
      });
      console.log(`✓ Notification sent to ${localUserId} for follow rejection from ${remoteUserId}`);
    } catch (error) {
      console.error("Failed to create notification for follow rejection", error);
    }
  }

  console.log(`✓ Reject received for follow to ${followedUri}`);
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

  if (!actorUri || !isRemoteActorAllowed(actorUri, env)) {
    console.error("Like activity has invalid actor URI");
    return;
  }

  if (!objectUri) {
    console.error("Like activity missing object");
    return;
  }

  const instanceDomain = requireInstanceDomain(env);
  // Try to normalize as local URI first
  const localUri = normalizeLocalObjectUri(objectUri, instanceDomain);
  const targetObjectId = localUri || objectUri;

  // Check if post exists
  const object = await resolveObjectById(db, targetObjectId, instanceDomain);
  if (!object) {
    console.warn(`Like for non-existent object: ${targetObjectId}`);
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

  const reactionId = typeof activity.id === "string" ? activity.id : crypto.randomUUID();
  const likeTo = toStringArray(activity.to);
  const likeCc = toStringArray(activity.cc);
  const likeBto = toStringArray(activity.bto);
  const likeBcc = toStringArray(activity.bcc);

  if (db.createObject) {
    await db.createObject({
      id: reactionId,
      local_id: null,
      type: "Like",
      actor: actorUri,
      content: {
        object: object.id ?? targetObjectId,
        emoji,
      },
      published: activity.published ? new Date(activity.published) : new Date(),
      to: likeTo,
      cc: likeCc,
      bto: likeBto,
      bcc: likeBcc,
      context: (activity as any).context ?? null,
      in_reply_to: null,
      is_local: 0,
      visibility: inferVisibility(likeTo, likeCc, likeBto, likeBcc),
    } as any);
  } else {
    await db.createApReaction({
      post_id: object.id ?? targetObjectId,
      user_id: userId,
      emoji,
      ap_activity_id: reactionId,
    });
  }

  console.log(`✓ Like from ${actorUri} (${userId}) on object ${object.id ?? targetObjectId} [${emoji}]`);
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

  if (!actorUri || !isRemoteActorAllowed(actorUri, env)) {
    console.error("Create activity has invalid actor URI");
    return;
  }

  // Handle Note (post, comment, or chat message)
  if (objectType === "Note") {
    // Check if this is a chat message by examining context and audience
    const recipients = extractRecipients(activity, object);
    const context = object.context;
    const hasPublic = hasPublicAudience(recipients);
    
    // Channel message: has context pointing to a channel
    if (context && typeof context === "string" && context.includes("/ap/channels/")) {
      await handleIncomingChannelMessage(env, activity);
      console.log(`✓ Channel message processed from ${actorUri}`);
      return;
    }
    
    // Direct message: no Public audience and has explicit recipients (including bto/bcc)
    if (!hasPublic && hasAnyRecipients(recipients)) {
      const normalized = {
        ...activity,
        to: recipients.to,
        cc: recipients.cc,
        bto: recipients.bto,
        bcc: recipients.bcc,
        object: {
          ...object,
          to: recipients.to,
          cc: recipients.cc,
          bto: recipients.bto,
          bcc: recipients.bcc,
        },
      };
      await handleIncomingDm(env, normalized);
      console.log(`✓ Direct message processed from ${actorUri}`);
      return;
    }
    
    // Otherwise, handle as regular post or comment
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
  const communityId = localRecipientId.startsWith("group:")
    ? localRecipientId.slice("group:".length)
    : null;
  const sanitizedNote = {
    ...note,
    content: sanitizeHtml(note.content || ""),
  };

  const storedId = await saveRemoteNote(db, env, sanitizedNote, actorUri, {
    context: sanitizedNote.context ?? communityId,
    inReplyTo: null,
  });

  if (storedId) {
    console.log(`✓ Stored post ${storedId} from ${actorUri}`);
  } else {
    console.log(`ℹ︎ Post ${note.id ?? "(generated)"} already exists, skipping`);
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

  const localUri = normalizeLocalObjectUri(inReplyTo, instanceDomain);
  const targetObjectId = localUri || inReplyTo;

  // Check if post exists
  let post = await resolveObjectById(db, targetObjectId, instanceDomain);
  if (!post) {
    // Thread resolution: try to fetch parent post if it's remote
    if (!localUri) {
      console.log(`Fetching missing parent post: ${targetObjectId}`);
      const remoteObject = await fetchRemoteObject(targetObjectId);
      if (remoteObject && remoteObject.type === "Note") {
        // Recursively handle the parent post
        // Note: We pass a dummy localUserId because we just want to store it
        await handleIncomingPost(db, env, "system", remoteObject, remoteObject.attributedTo || remoteObject.actor);
        // Try to find it again
        post = await resolveObjectById(db, targetObjectId, instanceDomain);
      }
    }
    
    if (!post) {
      console.warn(`Comment for non-existent post: ${targetObjectId}`);
      return;
    }
  }

  const sanitizedNote = { ...note, content: sanitizeHtml(note.content || "") };
  const storedId = await saveRemoteNote(db, env, sanitizedNote, actorUri, {
    inReplyTo: post.id ?? targetObjectId,
    context: post.context ?? null,
  });

  if (storedId) {
    console.log(`✓ Stored comment on object ${post.id ?? targetObjectId} from ${actorUri}`);
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

  if (!actorUri || !isRemoteActorAllowed(actorUri, env)) {
    console.error("Announce activity has invalid actor URI");
    return;
  }

  if (!objectUri) {
    console.error("Announce activity missing object");
    return;
  }

  // Parse object URI to find local post
  const instanceDomain = requireInstanceDomain(env);
  const localUri = normalizeLocalObjectUri(objectUri, instanceDomain);
  const targetObjectId = localUri || objectUri;

  // Check if post exists
  const object = await resolveObjectById(db, targetObjectId, instanceDomain);
  if (!object) {
    console.warn(`Announce for non-existent object: ${targetObjectId}`);
    return;
  }

  // Store the Announce activity
  const announceId = typeof activity.id === "string" ? activity.id : crypto.randomUUID();

  // Check if already stored
  const existing = db.findApAnnounce ? await db.findApAnnounce(announceId) : await resolveObjectById(db, announceId, instanceDomain);
  if (existing) {
    console.log(`Announce already recorded: ${announceId}`);
    return;
  }

  const to = toStringArray(activity.to);
  const cc = toStringArray(activity.cc);
  const bto = toStringArray(activity.bto);
  const bcc = toStringArray(activity.bcc);

  if (db.createObject) {
    await db.createObject({
      id: announceId,
      local_id: null,
      type: "Announce",
      actor: actorUri,
      content: { object: targetObjectId },
      published: activity.published ? new Date(activity.published) : new Date(),
      to: to.length ? to : null,
      cc: cc.length ? cc : null,
      bto,
      bcc,
      context: null,
      in_reply_to: null,
      is_local: 0,
      visibility: inferVisibility(to, cc, bto, bcc),
    } as any);
  } else if (db.createApAnnounce) {
    await db.createApAnnounce({
      activity_id: announceId,
      actor_id: actorUri,
      object_id: targetObjectId,
      local_post_id: object.id ?? undefined,
    });
  }

  console.log(`✓ Announce from ${actorUri} for object ${object.id ?? targetObjectId} stored`);
}

/**
 * Handle incoming Undo activity
 */
async function handleIncomingUndo(
  db: DatabaseAPI,
  env: Env,
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

  if (!actorUri || !isRemoteActorAllowed(actorUri, env)) {
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
        if (db.deleteObject) {
          await db.deleteObject(object.id).catch(() => undefined);
        } else if (db.deleteApReactionsByActivityId) {
          await db.deleteApReactionsByActivityId(object.id);
        }
      }
      console.log(`✓ Undo Like: ${object.id}`);
      break;

    case "Announce":
      if (object.id) {
        if (db.deleteObject) {
          await db.deleteObject(object.id).catch(() => undefined);
        } else if (db.deleteApAnnouncesByActivityId) {
          await db.deleteApAnnouncesByActivityId(object.id);
        }
      }
      console.log(`✓ Undo Announce: ${object.id}`);
      break;

    default:
      console.warn(`Unhandled Undo type: ${objectType}`);
  }
}

/**
 * Handle incoming Update activity
 */
async function handleIncomingUpdate(
  db: DatabaseAPI,
  env: Env,
  _localUserId: string,
  activity: any,
): Promise<void> {
  const object = activity.object;
  if (!object) return;

  const objectId = typeof object === "string" ? object : object.id;
  const objectType = extractType(object);
  const actorUri = extractActorUri(activity.actor);

  if (!actorUri || !isRemoteActorAllowed(actorUri, env)) return;

  // Update Actor (Profile update)
  if (objectId === actorUri || objectType === "Person" || objectType === "Service") {
    // Force refresh actor data
    await getOrFetchActor(actorUri, env, true);
    console.log(`✓ Updated actor profile: ${actorUri}`);
    return;
  }

  // Update Note (Post edit)
  if (objectType === "Note") {
    const instanceDomain = requireInstanceDomain(env);
    const normalizedObjectId = objectId
      ? normalizeLocalObjectUri(objectId, instanceDomain) || objectId
      : null;

    let noteObject: any = objectType === "Note" && typeof object === "object" ? object : null;
    if (!noteObject && objectId) {
      noteObject = await fetchRemoteObject(objectId);
    }

    if (!noteObject || extractType(noteObject) !== "Note") {
      console.warn(`Update activity did not contain a Note object for ${objectId}`);
      return;
    }

    const storedObject = normalizedObjectId
      ? await resolveObjectById(db, normalizedObjectId, instanceDomain)
      : null;
    if (!storedObject) {
      console.warn(`Update for unknown object ${normalizedObjectId ?? objectId}`);
      return;
    }

    const objectActor = storedObject.actor;
    const parsedActor = parseActorUri(actorUri, instanceDomain);
    if (objectActor && objectActor !== actorUri && parsedActor?.handle && objectActor !== parsedActor.handle) {
      console.warn(`Update actor mismatch for object ${storedObject.id}: ${actorUri} !== ${objectActor}`);
      return;
    }

    const sanitizedContent = sanitizeHtml(noteObject.content || "");
    const to = toStringArray(noteObject.to);
    const cc = toStringArray(noteObject.cc);
    const bto = toStringArray(noteObject.bto);
    const bcc = toStringArray(noteObject.bcc);
    const normalizedNote = ensureStoryTtl({
      ...noteObject,
      type: extractType(noteObject) || "Note",
      content: sanitizedContent,
      to,
      cc,
      bto,
      bcc,
    });

    let updated = false;
    try {
      const objects = createObjectService(env as any);
      await objects.receiveRemote({ userId: null } as any, {
        ...normalizedNote,
        id: storedObject.id ?? normalizedObjectId ?? objectId,
        actor: actorUri,
      });
      updated = true;
    } catch (error) {
      console.warn(`[ActivityPub] ObjectService update failed for ${objectId}, falling back`, error);
    }

    if (!updated && db.updateObject) {
      await db.updateObject(storedObject.id, {
        content: { ...noteObject, content: sanitizedContent },
        updated: new Date(),
        to: to.length ? to : undefined,
        cc: cc.length ? cc : undefined,
        bto,
        bcc,
        in_reply_to: typeof noteObject.inReplyTo === "string" ? noteObject.inReplyTo : undefined,
        visibility: inferVisibility(to, cc, bto, bcc),
      });
      updated = true;
    }

    if (updated) {
      console.log(`✓ Updated object ${storedObject.id} from ${actorUri}`);
    }
  }
}

/**
 * Handle incoming Delete activity
 */
async function handleIncomingDelete(
  db: DatabaseAPI,
  env: Env,
  _localUserId: string,
  activity: any,
): Promise<void> {
  const object = activity.object;
  if (!object) return;

  const objectId = typeof object === "string" ? object : object.id;
  const actorUri = extractActorUri(activity.actor);

  if (!actorUri || !isRemoteActorAllowed(actorUri, env)) return;

  const instanceDomain = requireInstanceDomain(env);
  const target = await resolveObjectById(db, objectId, instanceDomain);
  if (target) {
    const parsedActor = parseActorUri(actorUri, instanceDomain);
    const actorMatches = !target.actor ||
      target.actor === actorUri ||
      (parsedActor?.handle && target.actor === parsedActor.handle);
    if (!actorMatches) {
      console.warn(`⚠ Unauthorized delete attempt for ${objectId} by ${actorUri}`);
      return;
    }
    if (db.deleteObject) {
      await db.deleteObject(target.id);
    } else if (db.updateObject) {
      await db.updateObject(target.id, { deleted_at: new Date().toISOString() });
    }
    console.log(`✓ Deleted object ${objectId}`);
    return;
  }

  console.log(`ℹ︎ Received delete for unknown object ${objectId}`);
}

/**
 * Handle incoming Flag activity (Report)
 */
async function handleIncomingFlag(
  db: DatabaseAPI,
  env: Env,
  _localUserId: string,
  activity: any,
): Promise<void> {
  const actorUri = extractActorUri(activity.actor);
  if (!actorUri || !isRemoteActorAllowed(actorUri, env)) {
    console.error("Flag activity has invalid actor URI");
    return;
  }

  // Object can be string (URI) or array of strings/objects
  const objects = Array.isArray(activity.object) ? activity.object : [activity.object];
  
  for (const object of objects) {
    const objectUri = typeof object === "string" ? object : object.id;
    if (!objectUri) continue;

    // Extract reason
    const content = sanitizeHtml(activity.content || "");

    // Try to identify target actor from object URI
    // If object is a post, we might want to find the author
    // For now, we store the object URI as target_object_id and also as target_actor_id if it looks like an actor
    // But to be safe, we just store what we have.
    
    await db.createReport({
      id: crypto.randomUUID(),
      reporter_actor_id: actorUri,
      target_actor_id: objectUri, // In many cases Flag targets the user URI directly
      target_object_id: objectUri,
      reason: content,
      status: "pending",
      created_at: new Date(),
      updated_at: new Date(),
    });
    
    console.log(`✓ Report received from ${actorUri} against ${objectUri}`);
  }
}

/**
 * Process a batch of pending inbox activities
 */
export async function processInboxQueue(env: Env, batchSize = 10): Promise<void> {
  if (isActivityPubDisabled(env, "inbox queue")) {
    return;
  }

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

        // D1 does not support interactive transactions
        // Process activity and mark status sequentially
        await processActivity(db, env, item.local_user_id, activity);
        await markActivityStatus(db, item.id, InboxStatus.Processed);

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
  if (isActivityPubDisabled(env, "inbox worker (scheduled)")) {
    return;
  }
  await processInboxQueue(env, batchSize);
}

/**
 * Process a single inbox activity immediately by ID
 * Used for immediate processing when activity is received
 */
export async function processSingleInboxActivity(
  db: DatabaseAPI,
  env: Env,
  activityId: string,
): Promise<void> {
  if (isActivityPubDisabled(env, "inbox activity processing")) {
    return;
  }

  const activities = await db.queryRaw<{
    id: string;
    local_user_id: string;
    activity_json: string;
    activity_type: string;
  }>(
    `SELECT id, local_user_id, activity_json, activity_type
     FROM ap_inbox_activities
     WHERE id = ?
     LIMIT 1`,
    activityId,
  );

  if (!activities || activities.length === 0) {
    console.warn(`Activity ${activityId} not found for immediate processing`);
    return;
  }

  const item = activities[0];

  try {
    let activity: any;
    try {
      activity = JSON.parse(item.activity_json);
    } catch (parseError) {
      console.error(`Failed to parse inbox activity ${item.id}`, parseError);
      await markActivityStatus(db, item.id, InboxStatus.Failed, "invalid activity json");
      return;
    }

    if (!ACTIVITY_TYPES.has(activity?.type)) {
      console.warn(`Skipping unknown activity type: ${activity?.type}`);
      await markActivityStatus(db, item.id, InboxStatus.Processed);
      return;
    }

    // Process the activity
    await processActivity(db, env, item.local_user_id, activity);
    await markActivityStatus(db, item.id, InboxStatus.Processed);

    console.log(`✓ Immediately processed activity ${item.id} (${activity.type})`);
  } catch (error) {
    console.error(`Failed to immediately process activity ${item.id}:`, error);
    await markActivityStatus(
      db,
      item.id,
      InboxStatus.Failed,
      error instanceof Error ? error.message : String(error),
    );
    throw error; // Re-throw so caller knows it failed
  }
}

// Internal hooks exported only for testing
export const _test = {
  extractType,
  extractActorUri,
  validateActorUri,
  normalizeLocalObjectUri,
  processActivity,
};
