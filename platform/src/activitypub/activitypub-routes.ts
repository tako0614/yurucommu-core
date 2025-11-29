/**
 * ActivityPub route handlers
 *
 * All ActivityPub endpoints are mounted on instance-specific domains
 * (alice.example.com). The SPA is served separately.
 */

import { Hono } from "hono";
import type { Context } from "hono";
import { makeData } from "../server/data-factory";
import {
  generatePersonActor,
  generateGroupActor,
  generateWebFinger,
  generateOrderedCollection,
  generateOrderedCollectionPage,
  generateNoteObject,
  isActivityPubRequest,
  activityPubResponse,
  wrapInCreateActivity,
  ACTIVITYSTREAMS_CONTEXT,
} from "./activitypub";
import { getActorUri, requireInstanceDomain } from "../subdomain";
import { verifySignature, verifyDigest } from "../auth/http-signature";
import { getOrFetchActor, verifyActorOwnsKey } from "./actor-fetch";
import { ensureUserKeyPair } from "../auth/crypto-keys";
import { inboxRateLimitMiddleware, webfingerRateLimitMiddleware } from "../utils/rate-limit";
import { accessTokenGuard } from "../guards";
import { toStoryObject } from "./activitypub-story";
import {
  getDmThreadMessages,
  getChannelMessages,
  handleIncomingDm,
  handleIncomingChannelMessage,
  sendDirectMessage,
  sendChannelMessage,
} from "./chat";
import { releaseStore, queueImmediateDelivery } from "../utils/utils";
import type { Variables } from "../types";
import { processSingleInboxActivity } from "./inbox-worker";
import { deliverSingleQueuedItem } from "./delivery-worker";

type Bindings = {
  DB: D1Database;
  INSTANCE_DOMAIN?: string;
  INSTANCE_NAME?: string;
  INSTANCE_DESCRIPTION?: string;
  INSTANCE_OPEN_REGISTRATIONS?: string | boolean;
};

type ActivityPubContext = Context<{ Bindings: Bindings; Variables: Variables }>;

const app = new Hono<{ Bindings: Bindings; Variables: Variables }>();

const fail = (c: ActivityPubContext, message: string, status = 400) =>
  c.json({ ok: false, error: message }, status as any);

/**
 * Get protocol - always HTTPS in production
 * @deprecated Protocol is always HTTPS, use "https" directly
 */
function getProtocol(_c: ActivityPubContext): string {
  return "https";
}

/**
 * Get instance domain from context or environment
 * Throws error if not configured
 */
function getInstanceDomain(c: ActivityPubContext): string {
  return requireInstanceDomain(c.env);
}

function parseBooleanEnv(value: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

// ============================================
// WebFinger
// ============================================

/**
 * WebFinger endpoint (RFC 7033)
 * GET /.well-known/webfinger?resource=acct:alice@example.com
 *
 * Must be accessible from user subdomain
 */
app.get("/.well-known/webfinger", webfingerRateLimitMiddleware(), async (c) => {
  const store = makeData(c.env as any);
  try {
    const resource = c.req.query("resource");
    console.log(`[WebFinger Server] Incoming request: resource="${resource}", host="${c.req.header("host")}"`);

    if (!resource) {
      console.error(`[WebFinger Server] Missing resource parameter`);
      return c.json({ error: "resource parameter required" }, 400);
    }

    // Parse resource: acct:alice@example.com or https://alice.example.com/ap/users/alice
    let handle: string | null = null;

    if (resource.startsWith("acct:")) {
      // acct:alice@example.com
      const acctPart = resource.slice(5); // Remove "acct:"
      const [user] = acctPart.split("@");
      handle = user;
      console.log(`[WebFinger Server] Parsed acct resource: handle="${handle}"`);
    } else if (resource.startsWith("http://") || resource.startsWith("https://")) {
      // https://alice.example.com/ap/users/alice
      try {
        const url = new URL(resource);
        const match = url.pathname.match(/^\/ap\/users\/([a-z0-9_]{3,20})$/);
        if (match) {
          handle = match[1];
          console.log(`[WebFinger Server] Parsed URI resource: handle="${handle}"`);
        } else {
          console.error(`[WebFinger Server] URI resource did not match pattern: pathname="${url.pathname}"`);
        }
      } catch (err) {
        console.error(`[WebFinger Server] Invalid URL resource:`, err);
      }
    } else {
      console.error(`[WebFinger Server] Unknown resource format: "${resource}"`);
    }

    if (!handle) {
      console.error(`[WebFinger Server] Failed to extract handle from resource="${resource}"`);
      return c.json({ error: "invalid resource format" }, 400);
    }

    // Verify user exists
    const user = await store.getUser(handle);
    console.log(`[WebFinger Server] User lookup: handle="${handle}", found=${!!user}`);

    if (!user) {
      console.error(`[WebFinger Server] User not found: handle="${handle}"`);
      return c.json({ error: "user not found" }, 404);
    }

    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);
    const webfinger = generateWebFinger(handle, instanceDomain, protocol);

    console.log(`[WebFinger Server] Returning WebFinger for handle="${handle}", domain="${instanceDomain}"`);
    console.log(`[WebFinger Server] Response:`, JSON.stringify(webfinger, null, 2));

    return c.json(webfinger, 200, {
      "Content-Type": "application/jrd+json; charset=utf-8",
    });
  } finally {
    await releaseStore(store);
  }
});

// ============================================
// Actor Endpoint
// ============================================

/**
 * Actor endpoint (Person)
 * GET /ap/users/:handle
 * Accept: application/activity+json
 */
app.get("/ap/users/:handle", async (c) => {
  const handle = c.req.param("handle");
  const isAP = isActivityPubRequest(c);
  console.log(`[Actor Endpoint] GET /ap/users/${handle}, isActivityPubRequest=${isAP}, accept="${c.req.header("accept")}"`);

  // Only respond to ActivityPub requests
  if (!isAP) {
    console.log(`[Actor Endpoint] Redirecting non-AP request to /@${handle}`);
    return c.redirect(`/@${handle}`);
  }

  const store = makeData(c.env as any);
  try {
    // Get user from database
    const user = await store.getUser(handle);
    console.log(`[Actor Endpoint] User lookup: handle="${handle}", found=${!!user}`);

    if (!user) {
      console.error(`[Actor Endpoint] User not found: handle="${handle}"`);
      return fail(c, "user not found", 404);
    }

    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);

    // Get public key from ap_keypairs table
    let publicKeyPem = "";
    try {
      const keypair = await store.getApKeypair(handle);
      if (keypair) {
        publicKeyPem = keypair.public_key_pem;
        console.log(`[Actor Endpoint] Found existing keypair for handle="${handle}"`);
      } else {
        console.log(`[Actor Endpoint] Generating new keypair for handle="${handle}"`);
        const generated = await ensureUserKeyPair(
          store,
          c.env as any,
          handle,
        );
        publicKeyPem = generated.publicKeyPem;
      }
    } catch (error) {
      console.error(`[Actor Endpoint] Failed to fetch keypair for handle="${handle}":`, error);
      return fail(c, "failed to load actor key", 500);
    }

    const actor = generatePersonActor(user, instanceDomain, protocol);

    // Set public key if available
    if (publicKeyPem) {
      actor.publicKey.publicKeyPem = publicKeyPem;
    } else {
      // Generate keypair on first request (will be implemented)
      console.warn(`[Actor Endpoint] No keypair found for user ${handle}, returning actor without key`);
    }

    console.log(`[Actor Endpoint] Returning actor: id="${actor.id}", type="${actor.type}"`);
    return activityPubResponse(c, actor);
  } finally {
    await releaseStore(store);
  }
});

// ============================================
// Group Actor Endpoint
// ============================================

/**
 * Group Actor endpoint (Community)
 * GET /ap/groups/:slug
 * Accept: application/activity+json
 */
app.get("/ap/groups/:slug", async (c) => {
  if (!isActivityPubRequest(c)) {
    return c.redirect(`/communities/${c.req.param("slug")}`);
  }

  const store = makeData(c.env as any);
  try {
    const slug = c.req.param("slug");
    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);

    const community = await store.getCommunity(slug);
    if (!community) {
      return fail(c, "community not found", 404);
    }

    const ownerHandle = community.created_by || slug;
    let groupPublicKey: string | undefined;

    if (ownerHandle) {
      try {
        const keypair = await ensureUserKeyPair(
          store,
          c.env as any,
          ownerHandle,
        );
        groupPublicKey = keypair.publicKeyPem;
      } catch (error) {
        console.warn(
          `Failed to ensure keypair for group ${slug}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    const groupActor = generateGroupActor(
      community,
      ownerHandle,
      instanceDomain,
      protocol,
      groupPublicKey,
    );
    return activityPubResponse(c, groupActor);
  } finally {
    await releaseStore(store);
  }
});

/**
 * Group Outbox
 * GET /ap/groups/:slug/outbox
 */
app.get("/ap/groups/:slug/outbox", async (c) => {
  const store = makeData(c.env as any);
  try {
    const slug = c.req.param("slug");
    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);
    const outboxUrl = `${protocol}://${instanceDomain}/ap/groups/${slug}/outbox`;

    const community = await store.getCommunity(slug);
    if (!community) {
      return fail(c, "community not found", 404);
    }

    const page = c.req.query("page");

    if (!page) {
      const totalItems = await store.countPostsByCommunity(slug);

      const collection = generateOrderedCollection(
        outboxUrl,
        totalItems,
        `${outboxUrl}?page=1`
      );

      return activityPubResponse(c, collection);
    }

    const limit = 20;
    const pageNum = parseInt(page) || 1;
    const offset = (pageNum - 1) * limit;

    const totalItems = await store.countPostsByCommunity(slug);
    const posts = await store.listPostsByCommunityPage(slug, limit, offset);

    const orderedItems = (posts || []).map((post: any) => {
      const noteObject = generateNoteObject(
        post,
        {
          id: post.author_id,
          display_name: post.display_name,
          avatar_url: post.avatar_url,
        },
        instanceDomain,
        protocol,
      );

      const activityId = post.ap_activity_id ||
        `https://${instanceDomain}/ap/activities/create-${post.id}`;
      const actorUri = getActorUri(post.author_id, instanceDomain);

      return wrapInCreateActivity(noteObject, actorUri, activityId);
    });

    const collectionPage = generateOrderedCollectionPage(
      `${outboxUrl}?page=${pageNum}`,
      outboxUrl,
      orderedItems,
      totalItems,
      offset,
      orderedItems.length === limit ? `${outboxUrl}?page=${pageNum + 1}` : undefined,
      pageNum > 1 ? `${outboxUrl}?page=${pageNum - 1}` : undefined
    );

    return activityPubResponse(c, collectionPage);
  } finally {
    await releaseStore(store);
  }
});

/**
 * Group Followers Collection
 * GET /ap/groups/:slug/followers
 *
 * Returns the list of members (followers) of a community.
 * Access control: Only group members (accepted followers) can view the followers list
 */
app.get("/ap/groups/:slug/followers", accessTokenGuard, async (c) => {
  const store = makeData(c.env as any);
  try {
    const slug = c.req.param("slug");
    const viewer = c.get("activityPubUser");

    if (!viewer) {
      return fail(c, "unauthorized", 401);
    }

    const community = await store.getCommunity(slug);
    if (!community) {
      return fail(c, "community not found", 404);
    }

    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);
    const followersUrl = `${protocol}://${instanceDomain}/ap/groups/${slug}/followers`;
    const localGroupId = `group:${slug}`;

    // Check if viewer is a member (accepted follower) or the owner
    const isOwner = viewer.id === community.created_by;
    const isMember = await store.findApFollower(localGroupId, getActorUri(viewer.id, instanceDomain, protocol));

    if (!isOwner && (!isMember || isMember.status !== "accepted")) {
      return fail(c, "forbidden - only members can view followers", 403);
    }

    const page = c.req.query("page");

    if (!page) {
      // Return collection metadata
      const totalItems = await store.countApFollowers(localGroupId, "accepted");

      const collection = generateOrderedCollection(
        followersUrl,
        totalItems,
        `${followersUrl}?page=1`
      );

      return activityPubResponse(c, collection);
    }

    // Return paginated items
    const limit = 100;
    const pageNum = parseInt(page) || 1;
    const offset = (pageNum - 1) * limit;

    const totalItems = await store.countApFollowers(localGroupId, "accepted");
    const followers = await store.listApFollowers(localGroupId, "accepted", limit, offset);

    const orderedItems = followers.map(
      (f: { remote_actor_id: string }) => f.remote_actor_id,
    );

    const collectionPage = generateOrderedCollectionPage(
      `${followersUrl}?page=${pageNum}`,
      followersUrl,
      orderedItems,
      totalItems,
      offset,
      orderedItems.length === limit ? `${followersUrl}?page=${pageNum + 1}` : undefined,
      pageNum > 1 ? `${followersUrl}?page=${pageNum - 1}` : undefined
    );

    return activityPubResponse(c, collectionPage);
  } finally {
    await releaseStore(store);
  }
});

/**
 * Group Inbox
 * POST /ap/groups/:slug/inbox
 */
app.post("/ap/groups/:slug/inbox", inboxRateLimitMiddleware(), async (c) => {
  const store = makeData(c.env as any);
  try {
    const slug = c.req.param("slug");
    const community = await store.getCommunity(slug);
    if (!community) {
      return fail(c, "community not found", 404);
    }

    const bodyText = await c.req.text();
    let activity: any;
    try {
      activity = JSON.parse(bodyText);
    } catch (error) {
      console.error("Failed to parse group inbox activity JSON:", error);
      return fail(c, "invalid JSON", 400);
    }

    if (!activity || !activity.type) {
      return fail(c, "invalid activity", 400);
    }

    const actorId = typeof activity.actor === "string" ? activity.actor : activity.actor?.id;
    if (!actorId) {
      return fail(c, "missing actor", 400);
    }

    const signatureHeader = c.req.header("signature");
    if (!signatureHeader) {
      console.warn(`Group inbox request without signature from ${actorId}`);
      return fail(c, "missing signature", 401);
    }

    const keyIdMatch = signatureHeader.match(/keyId="([^"]+)"/);
    if (!keyIdMatch) {
      console.error("Failed to extract keyId from signature");
      return fail(c, "invalid signature format", 401);
    }
    const keyId = keyIdMatch[1];

    const fetcher = fetch;
    const ownsKey = await verifyActorOwnsKey(actorId, keyId, c.env as any, fetcher);
    if (!ownsKey) {
      console.error(`Actor ${actorId} does not own key ${keyId}`);
      return fail(c, "key ownership verification failed", 403);
    }

    const actor = await getOrFetchActor(actorId, c.env as any, false, fetcher);
    if (!actor || !actor.publicKey) {
      console.error(`Failed to fetch actor or public key: ${actorId}`);
      return fail(c, "could not verify signature", 403);
    }

    // Digest header is REQUIRED for POST requests per ActivityPub spec
    const digestHeader = c.req.header("digest");
    if (!digestHeader) {
      console.error("Missing required Digest header for POST");
      return fail(c, "digest header required for POST requests", 400);
    }

    const digestValid = await verifyDigest(c, bodyText);
    if (!digestValid) {
      console.error("Digest verification failed");
      return fail(c, "digest verification failed", 403);
    }

    const signatureValid = await verifySignature(c, actor.publicKey.publicKeyPem);
    if (!signatureValid) {
      console.error("HTTP signature verification failed");
      return fail(c, "signature verification failed", 403);
    }

    console.log(`✓ Group ${slug} inbox verified ${activity.type} from ${actorId}`);

    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);
    const groupUri = `${protocol}://${instanceDomain}/ap/groups/${slug}`;
    const localGroupId = `group:${slug}`;

    if (activity.type === "Follow") {
      const followObject = typeof activity.object === "string"
        ? activity.object
        : activity.object?.id;
      const followerActor = actorId;
      const followActivityId = typeof activity.id === "string"
        ? activity.id
        : crypto.randomUUID();
      const ownerHandle = community.created_by;

      if (!ownerHandle) {
        console.error(`Community ${slug} missing owner; cannot accept follow`);
        return fail(c, "community misconfigured", 500);
      }

      if (followObject !== groupUri) {
        console.warn(`Follow activity target mismatch for group ${slug}: ${followObject}`);
        return fail(c, "invalid follow target", 400);
      }

      // Invite-only: reject follow requests and instruct caller to use Invite
      const rejectActivityId = `${groupUri}/activities/reject-${crypto.randomUUID()}`;
      const rejectActivity = {
        "@context": ACTIVITYSTREAMS_CONTEXT,
        type: "Reject",
        id: rejectActivityId,
        actor: groupUri,
        object: activity,
        published: new Date().toISOString(),
      };

      const targetInbox = actor.inbox || actor.endpoints?.sharedInbox;
      if (targetInbox) {
        try {
          await queueImmediateDelivery(store, c.env as any, {
            id: crypto.randomUUID(),
            activity_id: rejectActivityId,
            target_inbox_url: targetInbox,
            status: "pending",
            created_at: new Date(),
          });
        } catch (error) {
          console.error(
            `Failed to enqueue Reject delivery for group ${slug}:`,
            error instanceof Error ? error.message : error,
          );
        }
      }

      console.warn(`Group ${slug} is invite-only; rejected Follow from ${followerActor}`);
      return fail(c, "invite-only community; use direct invite", 403);

      return c.json({}, 403);
    }

    const follower = await store.findApFollower(localGroupId, actorId);
    if (!follower || follower.status !== "accepted") {
      console.warn(`Rejecting group activity from non-member ${actorId} to ${slug}`);
      return fail(c, "forbidden", 403);
    }

    const activityId = typeof activity.id === "string" ? activity.id : crypto.randomUUID();
    const idempotencyKey = `${localGroupId}:${activityId}`;

    const inboxResult = await store.createApInboxActivity({
      local_user_id: localGroupId,
      remote_actor_id: actorId,
      activity_id: activityId,
      activity_type: activity.type,
      activity_json: bodyText,
      status: "pending",
      created_at: new Date(),
    });

    if (inboxResult) {
      console.log(`Stored ${activity.type} activity from ${actorId} for group ${slug} (key: ${idempotencyKey})`);
    } else {
      console.log(`Activity ${activityId} already queued for group ${slug} (idempotent, key: ${idempotencyKey})`);
    }

    // Return 202 Accepted immediately (idempotent response)
    return c.json({}, 202);
  } finally {
    await releaseStore(store);
  }
});

// ============================================
// Outbox
// ============================================

/**
 * Outbox collection
 * GET /ap/users/:handle/outbox
 */
app.get("/ap/users/:handle/outbox", accessTokenGuard, async (c) => {
  const store = makeData(c.env as any);
  try {
    const handle = c.req.param("handle");
    const viewer = c.get("activityPubUser");
    if (!viewer || viewer.id !== handle) {
      return fail(c, "handle mismatch", 404);
    }

    const user = await store.getUser(handle);
    if (!user) {
      return fail(c, "user not found", 404);
    }

    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);
    const outboxUrl = `${protocol}://${instanceDomain}/ap/users/${handle}/outbox`;

    const page = c.req.query("page");

    if (!page) {
      // Return collection metadata from ap_outbox_activities
      const totalItems = await store.countApOutboxActivities(handle);

      const collection = generateOrderedCollection(
        outboxUrl,
        totalItems,
        `${outboxUrl}?page=1`
      );

      return activityPubResponse(c, collection);
    }

    // Return paginated items from ap_outbox_activities
    const limit = 20;
    const pageNum = parseInt(page) || 1;
    const offset = (pageNum - 1) * limit;

    const totalItems = await store.countApOutboxActivities(handle);
    const activities = await store.listApOutboxActivitiesPage(handle, limit, offset);

    const orderedItems = (activities || []).map((row: any) => {
      try {
        return JSON.parse(row.activity_json);
      } catch (e) {
        console.error("Failed to parse activity JSON", e);
        return null;
      }
    }).filter(Boolean);

    const collectionPage = generateOrderedCollectionPage(
      `${outboxUrl}?page=${pageNum}`,
      outboxUrl,
      orderedItems,
      totalItems,
      offset,
      orderedItems.length === limit ? `${outboxUrl}?page=${pageNum + 1}` : undefined,
      pageNum > 1 ? `${outboxUrl}?page=${pageNum - 1}` : undefined
    );

    return activityPubResponse(c, collectionPage);
  } finally {
    await releaseStore(store);
  }
});

// ============================================
// Followers Collection
// ============================================

/**
 * Followers collection
 * GET /ap/users/:handle/followers
 */
app.get("/ap/users/:handle/followers", accessTokenGuard, async (c) => {
  const store = makeData(c.env as any);
  try {
    const handle = c.req.param("handle");
    const viewer = c.get("activityPubUser");
    if (!viewer) {
      return fail(c, "unauthorized", 401);
    }

    const user = await store.getUser(handle);
    if (!user) {
      return fail(c, "user not found", 404);
    }

    if (viewer.id !== handle) {
      return fail(c, "forbidden", 403);
    }

    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);
    const followersUrl = `${protocol}://${instanceDomain}/ap/users/${handle}/followers`;

    const page = c.req.query("page");

    if (!page) {
      // Return collection metadata
      const totalItems = await store.countApFollowers(handle, "accepted");

      const collection = generateOrderedCollection(
        followersUrl,
        totalItems,
        `${followersUrl}?page=1`
      );

      return activityPubResponse(c, collection);
    }

    // Return paginated items
    const limit = 100;
    const pageNum = parseInt(page) || 1;
    const offset = (pageNum - 1) * limit;

    const totalItems = await store.countApFollowers(handle, "accepted");
    const followers = await store.listApFollowers(handle, "accepted", limit, offset);

    const orderedItems = followers.map(
      (f: { remote_actor_id: string }) => f.remote_actor_id,
    );

    const collectionPage = generateOrderedCollectionPage(
      `${followersUrl}?page=${pageNum}`,
      followersUrl,
      orderedItems,
      totalItems,
      offset,
      orderedItems.length === limit ? `${followersUrl}?page=${pageNum + 1}` : undefined,
      pageNum > 1 ? `${followersUrl}?page=${pageNum - 1}` : undefined
    );

    return activityPubResponse(c, collectionPage);
  } finally {
    await releaseStore(store);
  }
});

// ============================================
// Following Collection
// ============================================

/**
 * Following collection
 * GET /ap/users/:handle/following
 */
app.get("/ap/users/:handle/following", accessTokenGuard, async (c) => {
  const store = makeData(c.env as any);
  try {
    const handle = c.req.param("handle");
    const viewer = c.get("activityPubUser");
    if (!viewer) {
      return fail(c, "unauthorized", 401);
    }

    const user = await store.getUser(handle);
    if (!user) {
      return fail(c, "user not found", 404);
    }

    if (viewer.id !== handle) {
      return fail(c, "forbidden", 403);
    }

    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);
    const followingUrl = `${protocol}://${instanceDomain}/ap/users/${handle}/following`;

    const page = c.req.query("page");

    if (!page) {
      const totalItems = await store.countApFollows(handle, "accepted");

      const collection = generateOrderedCollection(
        followingUrl,
        totalItems,
        `${followingUrl}?page=1`
      );

      return activityPubResponse(c, collection);
    }

    const limit = 100;
    const pageNum = parseInt(page) || 1;
    const offset = (pageNum - 1) * limit;

    const totalItems = await store.countApFollows(handle, "accepted");
    const following = await store.listApFollows(handle, "accepted", limit, offset);

    const orderedItems = following.map(
      (f: { remote_actor_id: string }) => f.remote_actor_id,
    );

    const collectionPage = generateOrderedCollectionPage(
      `${followingUrl}?page=${pageNum}`,
      followingUrl,
      orderedItems,
      totalItems,
      offset,
      orderedItems.length === limit ? `${followingUrl}?page=${pageNum + 1}` : undefined,
      pageNum > 1 ? `${followingUrl}?page=${pageNum - 1}` : undefined
    );

    return activityPubResponse(c, collectionPage);
  } finally {
    await releaseStore(store);
  }
});

// ============================================
// Inbox (with HTTP Signature verification and rate limiting)
// ============================================

/**
 * Inbox endpoint
 * POST /ap/users/:handle/inbox
 *
 * Receives activities from remote instances
 * Includes HTTP Signature verification and rate limiting
 */
app.post("/ap/users/:handle/inbox", inboxRateLimitMiddleware(), async (c) => {
  const store = makeData(c.env as any);
  try {
    const handle = c.req.param("handle");

    const user = await store.getUser(handle);
    if (!user) {
      return fail(c, "user not found", 404);
    }

    // Parse activity
    const bodyText = await c.req.text();
    let activity: any;
    try {
      activity = JSON.parse(bodyText);
    } catch (error) {
      console.error("Failed to parse activity JSON:", error);
      return fail(c, "invalid JSON", 400);
    }

    if (!activity || !activity.type) {
      return fail(c, "invalid activity", 400);
    }

    // Extract actor URI
    const actorId = typeof activity.actor === "string" ? activity.actor : activity.actor?.id;
    if (!actorId) {
      return fail(c, "missing actor", 400);
    }

    // Verify HTTP Signature
    const signatureHeader = c.req.header("signature");
    if (!signatureHeader) {
      console.warn(`Inbox request without signature from ${actorId}`);
      return fail(c, "missing signature", 401);
    }

    // Extract keyId from signature
    const keyIdMatch = signatureHeader.match(/keyId="([^"]+)"/);
    if (!keyIdMatch) {
      console.error("Failed to extract keyId from signature");
      return fail(c, "invalid signature format", 401);
    }
    const keyId = keyIdMatch[1];

    // Verify actor owns the key
    const fetcher = fetch;
    const ownsKey = await verifyActorOwnsKey(actorId, keyId, c.env as any, fetcher);
    if (!ownsKey) {
      console.error(`Actor ${actorId} does not own key ${keyId}`);
      return fail(c, "key ownership verification failed", 403);
    }

    // Fetch actor and get public key
    const actor = await getOrFetchActor(actorId, c.env as any, false, fetcher);
    if (!actor || !actor.publicKey) {
      console.error(`Failed to fetch actor or public key: ${actorId}`);
      return fail(c, "could not verify signature", 403);
    }

    // Verify digest if present
    // Digest header is REQUIRED for POST requests per ActivityPub spec
    const digestHeader = c.req.header("digest");
    if (!digestHeader) {
      console.error("Missing required Digest header for POST");
      return fail(c, "digest header required for POST requests", 400);
    }

    const digestValid = await verifyDigest(c, bodyText);
    if (!digestValid) {
      console.error("Digest verification failed");
      return fail(c, "digest verification failed", 403);
    }

    // Verify HTTP signature
    const signatureValid = await verifySignature(c, actor.publicKey.publicKeyPem);
    if (!signatureValid) {
      console.error("HTTP signature verification failed");
      return fail(c, "signature verification failed", 403);
    }

    console.log(`✓ Verified signature from ${actorId} for activity ${activity.type}`);

    // Check if actor is a friend (accepted follower) - all accounts only accept from friends
    // EXCEPT for Follow (new request), Undo (cancel), Accept/Reject (response to Follow)
    const allowUnauthenticatedTypes = new Set(["Follow", "Undo", "Accept", "Reject"]);
    if (!allowUnauthenticatedTypes.has(activity.type)) {
      const follower = await store.findApFollower(handle, actorId);

      // Only accept activities from accepted followers
      if (!follower || follower.status !== "accepted") {
        console.warn(`Rejecting activity from non-friend actor ${actorId} to account ${handle}`);
        return fail(c, "forbidden", 403);
      }
    }

    // Store in inbox for processing with idempotency key
    const activityId = activity.id || crypto.randomUUID();
    const idempotencyKey = `${handle}:${activityId}`;

    const inboxResult = await store.createApInboxActivity({
      local_user_id: handle,
      remote_actor_id: actorId,
      activity_id: activityId,
      activity_type: activity.type,
      activity_json: JSON.stringify(activity),
      status: "pending",
      created_at: new Date(),
    });

    if (inboxResult) {
      console.log(`Stored ${activity.type} activity from ${actorId} in inbox for ${handle} (key: ${idempotencyKey})`);
      
      // Process inbox activity immediately instead of waiting for scheduled worker
      try {
        await processSingleInboxActivity(store, c.env as any, inboxResult.id);
        console.log(`✓ Immediately processed activity ${activityId} for ${handle}`);
      } catch (procError) {
        console.error(`Failed to immediately process activity ${activityId}:`, procError);
        // Activity remains in pending state for scheduled worker to retry
      }
    } else {
      console.log(`Activity ${activityId} already received for ${handle} (idempotent, key: ${idempotencyKey})`);
    }

    // Return 202 Accepted immediately (idempotent response)
    return c.json({}, 202);
  } catch (error) {
    console.error("Inbox processing error:", error);
    return fail(c, "internal server error", 500);
  } finally {
    await releaseStore(store);
  }
});

app.post("/ap/users/:handle/outbox", accessTokenGuard, async (c) => {
  const handle = c.req.param("handle");
  const body = await c.req.json();
  
  // 標準の Note で DM を判定（to に Public がなく、特定のユーザーのみの場合）
  if (body?.object?.type === "Note" && body?.type === "Create") {
    const to = body.to || [];
    const cc = body.cc || [];
    const hasPublic = to.includes("https://www.w3.org/ns/activitystreams#Public") || 
                      cc.includes("https://www.w3.org/ns/activitystreams#Public");
    
    // context プロパティでチャンネルメッセージかDMかを判定
    const context = body.object.context;
    
    if (context && context.includes("/ap/channels/")) {
      // チャンネルメッセージ
      const parts = context.split("/ap/channels/")[1]?.split("/") || [];
      if (parts.length >= 2) {
        const [communityId, channelName] = parts;
        // Resolve channel name to ID
        const store = makeData(c.env as any);
        try {
          let channel;
          if (store.getChannelByName) {
            channel = await store.getChannelByName(communityId, channelName);
          } else {
            const channels = await store.listChannelsByCommunity(communityId);
            channel = channels.find((c: any) => c.name === channelName);
          }

          if (!channel) {
            return activityPubResponse(c, { ok: false, error: "channel not found" }, 404);
          }
          await sendChannelMessage(c.env, handle, communityId, channel.id, cc, body.object.content || "", body.object.inReplyTo);
          return activityPubResponse(c, { ok: true }, 202);
        } finally {
          await releaseStore(store);
        }
      }
    } else if (!hasPublic && to.length > 0) {
      // DM（Public なし、かつ to が存在）
      await sendDirectMessage(c.env, handle, to, body.object.content || "", body.object.inReplyTo);
      return activityPubResponse(c, { ok: true }, 202);
    }
  }
  
  return activityPubResponse(c, { ok: false, error: "unsupported activity" }, 400);
});

// ============================================
// Object Endpoint
// ============================================

/**
 * Object endpoint (Note)
 * GET /ap/objects/:id
 */
app.get("/ap/objects/:id", async (c) => {
  const store = makeData(c.env as any);
  try {
    const objectId = c.req.param("id");
    // Find post by ID
    const post = await store.getPostWithAuthor(objectId);

    if (!post) {
      return fail(c, "object not found", 404);
    }
    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);

    const noteObject = generateNoteObject(
      post,
      { id: post.author_id, display_name: post.display_name, avatar_url: post.avatar_url },
      instanceDomain,
      protocol
    );

    return activityPubResponse(c, noteObject);
  } finally {
    await releaseStore(store);
  }
});

app.get("/ap/stories/:id", accessTokenGuard, async (c) => {
  const store = makeData(c.env as any);
  try {
    const storyId = c.req.param("id");
    const story = await store.getStory(storyId);
    if (!story) return fail(c, "story not found", 404);
    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);
    const actor = await store.getUser(story.author_id);
    if (!actor) return fail(c, "author not found", 404);
    const storyObject = toStoryObject(story, story.author_id, instanceDomain, { protocol });
    return activityPubResponse(c, storyObject);
  } finally {
    await releaseStore(store);
  }
});

app.get("/ap/dm/:threadId", accessTokenGuard, async (c) => {
  const threadId = c.req.param("threadId");
  const messages = await getDmThreadMessages(c.env, threadId, 50);
  return activityPubResponse(c, {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "OrderedCollection",
    orderedItems: messages,
  });
});

/**
 * Channel messages endpoint
 * GET /ap/channels/:communityId/:channelName/messages
 * Note: channelId parameter is actually the channel name (not UUID)
 */
app.get("/ap/channels/:communityId/:channelId/messages", accessTokenGuard, async (c) => {
  const items = await getChannelMessages(c.env, c.req.param("communityId"), c.req.param("channelId"), 50);
  return activityPubResponse(c, {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "OrderedCollection",
    orderedItems: items,
  });
});

// ============================================
// NodeInfo
// ============================================

/**
 * NodeInfo discovery endpoint
 * GET /.well-known/nodeinfo
 */
app.get("/.well-known/nodeinfo", (c) => {
  const instanceDomain = getInstanceDomain(c);
  const protocol = getProtocol(c);
  const baseUrl = `${protocol}://${instanceDomain}`;

  return c.json({
    links: [
      {
        rel: "http://nodeinfo.diaspora.software/ns/schema/2.0",
        href: `${baseUrl}/nodeinfo/2.0`,
      },
    ],
  }, 200, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "max-age=3600",
  });
});

/**
 * NodeInfo 2.0 endpoint
 * GET /nodeinfo/2.0
 */
app.get("/nodeinfo/2.0", async (c) => {
  const store = makeData(c.env as any);
  try {
    // Get user count (approximate or exact)
    // Note: countUsers might not be exposed in DatabaseAPI yet, using raw query or fallback
    let userCount = 0;
    try {
      // Assuming we can count users. If not, default to 1 (admin)
      const users = await store.queryRaw("SELECT COUNT(*) as count FROM users");
      userCount = (users[0] as any).count || 0;
    } catch (e) {
      console.warn("Failed to count users for NodeInfo", e);
    }

    const openRegistrations = parseBooleanEnv(
      c.env.INSTANCE_OPEN_REGISTRATIONS as any,
      false,
    );
    const nodeName = (c.env.INSTANCE_NAME || "Takos Instance").toString().trim() || "Takos Instance";
    const nodeDescription = (c.env.INSTANCE_DESCRIPTION || "A Takos instance").toString().trim() || "A Takos instance";

    return c.json({
      version: "2.0",
      software: {
        name: "takos",
        version: "0.1.0",
      },
      protocols: [
        "activitypub",
      ],
      services: {
        inbound: [],
        outbound: [],
      },
      openRegistrations,
      usage: {
        users: {
          total: userCount,
        },
      },
      metadata: {
        nodeName,
        nodeDescription,
      },
    }, 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "max-age=3600",
    });
  } finally {
    await releaseStore(store);
  }
});

// ============================================
// Shared Inbox
// ============================================

/**
 * System-wide Shared Inbox
 * POST /ap/inbox
 * 
 * Receives activities for multiple users on this instance.
 * Improves federation performance by reducing the number of requests.
 */
app.post("/ap/inbox", inboxRateLimitMiddleware(), async (c) => {
  const store = makeData(c.env as any);
  try {
    // Parse activity
    const bodyText = await c.req.text();
    let activity: any;
    try {
      activity = JSON.parse(bodyText);
    } catch (error) {
      console.error("Failed to parse activity JSON:", error);
      return fail(c, "invalid JSON", 400);
    }

    if (!activity || !activity.type) {
      return fail(c, "invalid activity", 400);
    }

    // Extract actor URI
    const actorId = typeof activity.actor === "string" ? activity.actor : activity.actor?.id;
    if (!actorId) {
      return fail(c, "missing actor", 400);
    }

    // Verify HTTP Signature
    const signatureHeader = c.req.header("signature");
    if (!signatureHeader) {
      console.warn(`Shared inbox request without signature from ${actorId}`);
      return fail(c, "missing signature", 401);
    }

    const keyIdMatch = signatureHeader.match(/keyId="([^"]+)"/);
    if (!keyIdMatch) {
      return fail(c, "invalid signature format", 401);
    }
    const keyId = keyIdMatch[1];

    // Verify actor owns the key
    const fetcher = fetch;
    const ownsKey = await verifyActorOwnsKey(actorId, keyId, c.env as any, fetcher);
    if (!ownsKey) {
      return fail(c, "key ownership verification failed", 403);
    }

    // Fetch actor and get public key
    const actor = await getOrFetchActor(actorId, c.env as any, false, fetcher);
    if (!actor || !actor.publicKey) {
      return fail(c, "could not verify signature", 403);
    }

    // Verify digest
    const digestHeader = c.req.header("digest");
    if (!digestHeader) {
      return fail(c, "digest header required for POST requests", 400);
    }

    const digestValid = await verifyDigest(c, bodyText);
    if (!digestValid) {
      return fail(c, "digest verification failed", 403);
    }

    // Verify HTTP signature
    const signatureValid = await verifySignature(c, actor.publicKey.publicKeyPem);
    if (!signatureValid) {
      return fail(c, "signature verification failed", 403);
    }

    console.log(`✓ Verified shared inbox signature from ${actorId}`);

    // Determine recipients
    const instanceDomain = getInstanceDomain(c);
    const recipients = new Set<string>();
    const activityType = Array.isArray(activity.type)
      ? activity.type[0]
      : typeof activity.type === "string"
        ? activity.type
        : "";
    const objectType = Array.isArray(activity.object?.type)
      ? activity.object?.type?.[0]
      : typeof activity.object?.type === "string"
        ? activity.object.type
        : "";

    const hasPublicAudience = (field: any): boolean => {
      if (!field) return false;
      const targets = Array.isArray(field) ? field : [field];
      return targets.some((target) => target === "https://www.w3.org/ns/activitystreams#Public");
    };

    const addToRecipients = (field: any) => {
      if (!field) return;
      const targets = Array.isArray(field) ? field : [field];
      for (const target of targets) {
        if (typeof target === "string") {
          try {
            const url = new URL(target);
            if (url.hostname === instanceDomain) {
              // Extract handle from /ap/users/:handle
              const match = url.pathname.match(/^\/ap\/users\/([a-z0-9_]{3,20})$/);
              if (match) {
                recipients.add(match[1]);
              }
            }
          } catch {
            // Ignore invalid URLs
          }
        }
      }
    };

    addToRecipients(activity.to);
    addToRecipients(activity.cc);
    addToRecipients(activity.audience);

    if (recipients.size === 0) {
      const isPublicActivity = hasPublicAudience(activity.to) ||
        hasPublicAudience(activity.cc) ||
        hasPublicAudience(activity.audience);

      if (activityType === "Create" && objectType === "Note" && isPublicActivity) {
        const activityId = activity.id || crypto.randomUUID();
        try {
          await store.createApInboxActivity({
            local_user_id: "__public__",
            remote_actor_id: actorId,
            activity_id: activityId,
            activity_type: activity.type,
            activity_json: JSON.stringify(activity),
            status: "pending",
            created_at: new Date(),
          });
          console.log(`✓ Queued public activity ${activityId} for global timeline ingestion`);
        } catch (error) {
          console.error("Failed to queue public shared inbox activity", error);
        }
      } else {
        console.log(`ℹ︎ No local recipients for activity ${activity.id} in shared inbox`);
      }
      return c.json({}, 202);
    }

    console.log(`✓ Distributing activity ${activity.id} to ${recipients.size} local users`);

    // Distribute to each recipient's inbox with idempotency
    const activityId = activity.id || crypto.randomUUID();

    // Use Promise.all to insert in parallel (or use a transaction if strict consistency needed)
    await Promise.all(Array.from(recipients).map(async (handle) => {
      const idempotencyKey = `${handle}:${activityId}`;

      try {
        const result = await store.createApInboxActivity({
          local_user_id: handle,
          remote_actor_id: actorId,
          activity_id: activityId,
          activity_type: activity.type,
          activity_json: JSON.stringify(activity),
          status: "pending",
          created_at: new Date(),
        });

        if (!result) {
          console.log(`Activity ${activityId} already queued for ${handle} (idempotent, key: ${idempotencyKey})`);
        }
      } catch (e) {
        // Ignore duplicate key errors (idempotency)
        console.log(`Activity ${activityId} already queued for ${handle} (idempotent, key: ${idempotencyKey})`);
      }
    }));

    // Return 202 Accepted immediately (idempotent response)
    return c.json({}, 202);
  } catch (error) {
    console.error("Shared inbox processing error:", error);
    return fail(c, "internal server error", 500);
  } finally {
    await releaseStore(store);
  }
});

// ============================================
// Test Route
// ============================================



export default app;
