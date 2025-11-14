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
import { releaseStore } from "../utils/utils";
import type { Variables } from "../types";

type Bindings = {
  DB: D1Database;
  INSTANCE_DOMAIN?: string;
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
    if (!resource) {
      return c.json({ error: "resource parameter required" }, 400);
    }

    // Parse resource: acct:alice@example.com or https://alice.example.com/ap/users/alice
    let handle: string | null = null;

    if (resource.startsWith("acct:")) {
      // acct:alice@example.com
      const acctPart = resource.slice(5); // Remove "acct:"
      const [user] = acctPart.split("@");
      handle = user;
    } else if (resource.startsWith("http://") || resource.startsWith("https://")) {
      // https://alice.example.com/ap/users/alice
      try {
        const url = new URL(resource);
        const match = url.pathname.match(/^\/ap\/users\/([a-z0-9_]{3,20})$/);
        if (match) {
          handle = match[1];
        }
      } catch {
        // Invalid URL
      }
    }

    if (!handle) {
      return c.json({ error: "invalid resource format" }, 400);
    }

    // Verify user exists
    const user = await store.getUser(handle);
    if (!user) {
      return c.json({ error: "user not found" }, 404);
    }

    const instanceDomain = getInstanceDomain(c);
    const protocol = getProtocol(c);
    const webfinger = generateWebFinger(handle, instanceDomain, protocol);

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
  // Only respond to ActivityPub requests
  if (!isActivityPubRequest(c)) {
    return c.redirect(`/@${c.req.param("handle")}`);
  }

  const store = makeData(c.env as any);
  try {
    const handle = c.req.param("handle");

    // Get user from database
    const user = await store.getUser(handle);
    if (!user) {
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
      }
    } catch (error) {
      console.error("Failed to fetch keypair:", error);
    }

    const actor = generatePersonActor(user, instanceDomain, protocol);

    // Set public key if available
    if (publicKeyPem) {
      actor.publicKey.publicKeyPem = publicKeyPem;
    } else {
      // Generate keypair on first request (will be implemented)
      console.warn(`No keypair found for user ${handle}, returning actor without key`);
    }

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
      orderedItems.length === limit ? `${outboxUrl}?page=${pageNum + 1}` : undefined,
      pageNum > 1 ? `${outboxUrl}?page=${pageNum - 1}` : undefined
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

    const ownsKey = await verifyActorOwnsKey(actorId, keyId, c.env as any);
    if (!ownsKey) {
      console.error(`Actor ${actorId} does not own key ${keyId}`);
      return fail(c, "key ownership verification failed", 403);
    }

    const actor = await getOrFetchActor(actorId, c.env as any);
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

      await store.upsertApFollower({
        local_user_id: localGroupId,
        remote_actor_id: followerActor,
        activity_id: followActivityId,
        status: "accepted",
        created_at: new Date(),
        accepted_at: new Date(),
      });

      try {
        await ensureUserKeyPair(
          store,
          c.env as any,
          ownerHandle,
        );
      } catch (error) {
        console.error(
          `Failed to ensure owner keypair for group ${slug}:`,
          error instanceof Error ? error.message : error,
        );
      }

      const acceptActivityId = `${groupUri}/activities/accept-${crypto.randomUUID()}`;
      const acceptActivity = {
        "@context": ACTIVITYSTREAMS_CONTEXT,
        type: "Accept",
        id: acceptActivityId,
        actor: groupUri,
        object: activity,
        published: new Date().toISOString(),
      };

      try {
        await store.upsertApOutboxActivity({
          local_user_id: ownerHandle,
          activity_id: acceptActivityId,
          activity_type: "Accept",
          activity_json: JSON.stringify(acceptActivity),
          object_id: followActivityId,
          object_type: "Follow",
        });
      } catch (error) {
        console.error(
          `Failed to record Accept activity for group ${slug}:`,
          error instanceof Error ? error.message : error,
        );
      }

      const targetInbox = actor.inbox || actor.endpoints?.sharedInbox;
      if (targetInbox) {
        try {
          await store.createApDeliveryQueueItem({
            activity_id: acceptActivityId,
            target_inbox_url: targetInbox,
            status: "pending",
          });
          console.log("✓ Queued Accept activity to:", targetInbox);
        } catch (error) {
          console.error(
            `Failed to enqueue Accept delivery for group ${slug}:`,
            error instanceof Error ? error.message : error,
          );
        }
      } else {
        console.warn(
          `No inbox found for follower ${followerActor}; Accept not queued`,
        );
      }

      return c.json({}, 202);
    }

    const follower = await store.findApFollower(localGroupId, actorId);
    if (!follower || follower.status !== "accepted") {
      console.warn(`Rejecting group activity from non-member ${actorId} to ${slug}`);
      return fail(c, "forbidden", 403);
    }

    const activityId = typeof activity.id === "string" ? activity.id : crypto.randomUUID();

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
      console.log(`Stored ${activity.type} activity from ${actorId} for group ${slug}`);
    } else {
      console.log(`Activity ${activityId} already queued for group ${slug}`);
    }

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

    const followers = await store.listApFollowers(handle, "accepted", limit, offset);

    const orderedItems = followers.map(
      (f: { remote_actor_id: string }) => f.remote_actor_id,
    );

    const collectionPage = generateOrderedCollectionPage(
      `${followersUrl}?page=${pageNum}`,
      followersUrl,
      orderedItems,
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

    const following = await store.listApFollows(handle, "accepted", limit, offset);

    const orderedItems = following.map(
      (f: { remote_actor_id: string }) => f.remote_actor_id,
    );

    const collectionPage = generateOrderedCollectionPage(
      `${followingUrl}?page=${pageNum}`,
      followingUrl,
      orderedItems,
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
    const ownsKey = await verifyActorOwnsKey(actorId, keyId, c.env as any);
    if (!ownsKey) {
      console.error(`Actor ${actorId} does not own key ${keyId}`);
      return fail(c, "key ownership verification failed", 403);
    }

    // Fetch actor and get public key
    const actor = await getOrFetchActor(actorId, c.env as any);
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
    const follower = await store.findApFollower(handle, actorId);

    // Only accept activities from accepted followers
    if (!follower || follower.status !== "accepted") {
      console.warn(`Rejecting activity from non-friend actor ${actorId} to account ${handle}`);
      return fail(c, "forbidden", 403);
    }

    // Store in inbox for processing (冪等性を保証)
    const activityId = activity.id || crypto.randomUUID();

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
      console.log(`Stored ${activity.type} activity from ${actorId} in inbox for ${handle}`);
    } else {
      console.log(`Activity ${activityId} already received (idempotent)`);
    }

    // Return 202 Accepted immediately
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
  if (body?.object?.type === "DirectMessage") {
    await sendDirectMessage(c.env, handle, body.to || [], body.object.content || "", body.object.inReplyTo);
    return activityPubResponse(c, { ok: true }, 202);
  }
  if (body?.object?.type === "ChannelMessage") {
    const channelUri = body.object.channel;
    const parts = channelUri?.split("/ap/channels/")[1]?.split("/") || [];
    if (parts.length >= 2) {
      const [communityId, channelId] = parts;
      await sendChannelMessage(c.env, handle, communityId, channelId, body.cc || [], body.object.content || "", body.object.inReplyTo);
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

app.get("/ap/channels/:communityId/:channelId/messages", accessTokenGuard, async (c) => {
  const items = await getChannelMessages(c.env, c.req.param("communityId"), c.req.param("channelId"), 50);
  return activityPubResponse(c, {
    "@context": ACTIVITYSTREAMS_CONTEXT,
    type: "OrderedCollection",
    orderedItems: items,
  });
});

export default app;
