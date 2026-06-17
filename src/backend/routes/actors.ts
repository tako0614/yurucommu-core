import { Hono } from "hono";
import { deleteCookie } from "hono/cookie";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  activities,
  actorCache,
  actors,
  announces,
  blocks,
  bookmarks,
  communities,
  communityMembers,
  follows,
  inbox,
  likes,
  mutes,
  notDeleted,
  objectRecipients,
  objects,
  sessions,
  storyViews,
  storyVotes,
} from "../../db/index.ts";
import type { Env, Variables } from "../types.ts";
import {
  activityApId,
  formatUsername,
  generateId,
  parseLimit,
  parseOffset,
  safeJsonParse,
} from "../federation-helpers.ts";
import { enqueueFanoutToFollowers } from "../lib/delivery/queue.ts";
import { CacheTags, CacheTTL, withCache } from "../middleware/cache.ts";
import {
  actorExists,
  createRelation,
  deleteRelation,
  isValidHttpUrl,
  listFollowRelation,
  listRelation,
  loadActorInfoMap,
  loadPostInteractions,
  MAX_ACTOR_POSTS_LIMIT,
  MAX_PROFILE_NAME_LENGTH,
  MAX_PROFILE_SUMMARY_LENGTH,
  MAX_PROFILE_URL_LENGTH,
  requireActor,
  resolveActorApId,
} from "./actors-helpers.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "actors" });

const actorsRoute = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Get all local actors (cached 5 minutes)
actorsRoute.get(
  "/",
  withCache({
    ttl: CacheTTL.ACTOR_PROFILE,
    cacheTag: CacheTags.ACTOR,
  }),
  async (c) => {
    const db = c.get("db");
    const limit = parseLimit(c.req.query("limit"), 100, 500);
    const offset = parseOffset(c.req.query("offset"), 0, 10000);

    const actorsList = await db
      .select({
        apId: actors.apId,
        preferredUsername: actors.preferredUsername,
        name: actors.name,
        summary: actors.summary,
        iconUrl: actors.iconUrl,
        role: actors.role,
        followerCount: actors.followerCount,
        followingCount: actors.followingCount,
        postCount: actors.postCount,
        createdAt: actors.createdAt,
      })
      .from(actors)
      .where(notDeleted(actors))
      .orderBy(asc(actors.createdAt))
      .limit(limit)
      .offset(offset);

    return c.json({
      actors: actorsList.map((a) => ({
        ap_id: a.apId,
        preferred_username: a.preferredUsername,
        name: a.name,
        summary: a.summary,
        icon_url: a.iconUrl,
        role: a.role,
        follower_count: a.followerCount,
        following_count: a.followingCount,
        post_count: a.postCount,
        created_at: a.createdAt,
        username: formatUsername(a.apId),
      })),
    });
  },
);

// Get blocked users for current actor
actorsRoute.get("/me/blocked", async (c) => {
  return listRelation(
    c,
    (db, actorId, limit, offset) =>
      db
        .select({
          blockedApId: blocks.blockedApId,
          createdAt: blocks.createdAt,
        })
        .from(blocks)
        .where(eq(blocks.blockerApId, actorId))
        .orderBy(desc(blocks.createdAt))
        .limit(limit)
        .offset(offset),
    "blockedApId",
    "blocked",
  );
});

// Block a user
actorsRoute.post("/me/blocked", async (c) => {
  return createRelation(c, "block", (db, actorId, targetId) =>
    db
      .insert(blocks)
      .values({ blockerApId: actorId, blockedApId: targetId })
      .onConflictDoNothing(),
  );
});

// Unblock a user
actorsRoute.delete("/me/blocked", async (c) => {
  return deleteRelation(c, "block", (db, actorId, targetId) =>
    db
      .delete(blocks)
      .where(
        and(eq(blocks.blockerApId, actorId), eq(blocks.blockedApId, targetId)),
      ),
  );
});

// Get muted users for current actor
actorsRoute.get("/me/muted", async (c) => {
  return listRelation(
    c,
    (db, actorId, limit, offset) =>
      db
        .select({
          mutedApId: mutes.mutedApId,
          createdAt: mutes.createdAt,
        })
        .from(mutes)
        .where(eq(mutes.muterApId, actorId))
        .orderBy(desc(mutes.createdAt))
        .limit(limit)
        .offset(offset),
    "mutedApId",
    "muted",
  );
});

// Mute a user
actorsRoute.post("/me/muted", async (c) => {
  return createRelation(c, "mute", (db, actorId, targetId) =>
    db
      .insert(mutes)
      .values({ muterApId: actorId, mutedApId: targetId })
      .onConflictDoNothing(),
  );
});

// Unmute a user
actorsRoute.delete("/me/muted", async (c) => {
  return deleteRelation(c, "mute", (db, actorId, targetId) =>
    db
      .delete(mutes)
      .where(and(eq(mutes.muterApId, actorId), eq(mutes.mutedApId, targetId))),
  );
});

// Delete own account (local only)
actorsRoute.post("/me/delete", async (c) => {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const actorApIdVal = actor.ap_id;
  const db = c.get("db");
  const baseUrl = c.env.APP_URL;

  try {
    // Federate account deletion BEFORE local teardown so remote followers
    // learn the actor is gone. We persist a Delete(actor) activity and enqueue
    // fan-out to followers while the follower graph and the activity row still
    // exist; the activity row is intentionally preserved through teardown
    // (excluded from the activities delete below) so the delivery consumer can
    // still read its rawJson after the actor's other rows are gone.
    const deleteActivityId = activityApId(baseUrl, generateId());
    const deleteActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: deleteActivityId,
      type: "Delete",
      actor: actorApIdVal,
      to: ["https://www.w3.org/ns/activitystreams#Public"],
      cc: [actor.followers_url],
      object: actorApIdVal,
    };
    try {
      await db.insert(activities).values({
        apId: deleteActivityId,
        type: "Delete",
        actorApId: actorApIdVal,
        objectApId: actorApIdVal,
        rawJson: JSON.stringify(deleteActivity),
        direction: "outbound",
      });
      await enqueueFanoutToFollowers(c.env, deleteActivityId, actorApIdVal);
    } catch (err) {
      // Federation is best-effort; never block local account deletion on it.
      log.error("Failed to enqueue account Delete federation", {
        event: "actors.account.delete_federation_failed",
        actor: actorApIdVal,
        error: err,
      });
    }

    // Phase 1: remove dependent records sequentially.
    await db.delete(sessions).where(eq(sessions.memberId, actorApIdVal));

    await db
      .delete(follows)
      .where(
        or(
          eq(follows.followerApId, actorApIdVal),
          eq(follows.followingApId, actorApIdVal),
        ),
      );

    await db
      .delete(blocks)
      .where(
        or(
          eq(blocks.blockerApId, actorApIdVal),
          eq(blocks.blockedApId, actorApIdVal),
        ),
      );
    await db
      .delete(mutes)
      .where(
        or(
          eq(mutes.muterApId, actorApIdVal),
          eq(mutes.mutedApId, actorApIdVal),
        ),
      );

    await db.delete(likes).where(eq(likes.actorApId, actorApIdVal));
    await db.delete(bookmarks).where(eq(bookmarks.actorApId, actorApIdVal));
    await db.delete(announces).where(eq(announces.actorApId, actorApIdVal));

    await db.delete(inbox).where(eq(inbox.actorApId, actorApIdVal));

    const memberships = await db
      .select({
        communityApId: communityMembers.communityApId,
      })
      .from(communityMembers)
      .where(eq(communityMembers.actorApId, actorApIdVal));
    const communityApIds = memberships.map((m) => m.communityApId);
    if (communityApIds.length > 0) {
      await db
        .update(communities)
        .set({ memberCount: sql`${communities.memberCount} - 1` })
        .where(inArray(communities.apId, communityApIds));
    }
    await db
      .delete(communityMembers)
      .where(eq(communityMembers.actorApId, actorApIdVal));

    await db
      .delete(objectRecipients)
      .where(eq(objectRecipients.recipientApId, actorApIdVal));
    // Preserve the federation Delete activity so the async delivery consumer
    // can still read its rawJson; all other activities by this actor go.
    await db
      .delete(activities)
      .where(
        and(
          eq(activities.actorApId, actorApIdVal),
          ne(activities.apId, deleteActivityId),
        ),
      );

    const authoredObjects = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.attributedTo, actorApIdVal));
    const objectIds = authoredObjects.map((o) => o.apId);

    if (objectIds.length > 0) {
      await db.delete(likes).where(inArray(likes.objectApId, objectIds));
      await db
        .delete(announces)
        .where(inArray(announces.objectApId, objectIds));
      await db
        .delete(bookmarks)
        .where(inArray(bookmarks.objectApId, objectIds));
      await db
        .delete(storyVotes)
        .where(inArray(storyVotes.storyApId, objectIds));
      await db
        .delete(storyViews)
        .where(inArray(storyViews.storyApId, objectIds));
    }

    // Phase 2: explicit ordered hard-delete to satisfy trigger expectations.
    await db.delete(objects).where(eq(objects.attributedTo, actorApIdVal));
    await db.delete(actors).where(eq(actors.apId, actorApIdVal));

    deleteCookie(c, "session");

    return c.json({ success: true });
  } catch (error) {
    log.error("Account deletion failed", {
      event: "actors.account.delete_failed",
      actor: actorApIdVal,
      error,
    });
    return c.json({ error: "Account deletion failed" }, 500);
  }
});

// Get posts for a specific actor
actorsRoute.get("/:identifier/posts", async (c) => {
  const currentActor = c.get("actor");
  const identifier = c.req.param("identifier");
  const db = c.get("db");

  const apId = await resolveActorApId(db, c.env.APP_URL, identifier);
  if (!apId) return c.json({ error: "Actor not found" }, 404);

  if (!(await actorExists(db, apId))) {
    return c.json({ error: "Actor not found" }, 404);
  }

  const limit = parseLimit(c.req.query("limit"), 20, MAX_ACTOR_POSTS_LIMIT);
  const before = c.req.query("before");
  const isOwnProfile = currentActor && currentActor.ap_id === apId;

  const conditions = [
    eq(objects.type, "Note"),
    isNull(objects.inReplyTo),
    eq(objects.attributedTo, apId),
  ];
  if (isOwnProfile) {
    conditions.push(ne(objects.visibility, "direct"));
  } else {
    conditions.push(eq(objects.visibility, "public"));
  }
  if (before) {
    conditions.push(lt(objects.published, before));
  }

  const posts = await db
    .select()
    .from(objects)
    .where(and(...conditions))
    .orderBy(desc(objects.published))
    .limit(limit);

  const postApIds = posts.map((p) => p.apId);
  const authorApIds = [...new Set(posts.map((p) => p.attributedTo))];

  const [authorMap, interactions] = await Promise.all([
    loadActorInfoMap(db, authorApIds, "author"),
    loadPostInteractions(db, currentActor?.ap_id ?? null, postApIds),
  ]);

  const resultList = posts.map((p) => {
    const author = authorMap.get(p.attributedTo);
    return {
      ap_id: p.apId,
      type: p.type,
      author: {
        ap_id: p.attributedTo,
        username: formatUsername(p.attributedTo),
        preferred_username: author?.preferredUsername || null,
        name: author?.name || null,
        icon_url: author?.iconUrl || null,
      },
      content: p.content,
      summary: p.summary,
      attachments: safeJsonParse(p.attachmentsJson, []),
      in_reply_to: p.inReplyTo,
      visibility: p.visibility,
      community_ap_id: p.communityApId,
      like_count: p.likeCount,
      reply_count: p.replyCount,
      announce_count: p.announceCount,
      published: p.published,
      liked: interactions.likedIds.has(p.apId),
      bookmarked: interactions.bookmarkedIds.has(p.apId),
      reposted: interactions.repostedIds.has(p.apId),
    };
  });

  return c.json({ posts: resultList });
});

// Get actor by AP ID or username
actorsRoute.get("/:identifier", async (c) => {
  const currentActor = c.get("actor");
  const identifier = c.req.param("identifier");
  const baseUrl = c.env.APP_URL;
  const db = c.get("db");

  // For @user@remote-domain, we may need to return cached data directly
  // (resolveActorApId only returns an apId when the cache has a match)
  const apId = await resolveActorApId(db, baseUrl, identifier);
  if (!apId) return c.json({ error: "Actor not found" }, 404);

  // Try local actor first
  const localActor = await db
    .select({
      apId: actors.apId,
      preferredUsername: actors.preferredUsername,
      name: actors.name,
      summary: actors.summary,
      iconUrl: actors.iconUrl,
      headerUrl: actors.headerUrl,
      role: actors.role,
      followerCount: actors.followerCount,
      followingCount: actors.followingCount,
      postCount: actors.postCount,
      isPrivate: actors.isPrivate,
      createdAt: actors.createdAt,
    })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();

  if (!localActor) {
    const cachedActor = await db
      .select()
      .from(actorCache)
      .where(eq(actorCache.apId, apId))
      .get();
    if (!cachedActor) return c.json({ error: "Actor not found" }, 404);

    return c.json({
      actor: {
        ap_id: cachedActor.apId,
        preferred_username: cachedActor.preferredUsername,
        name: cachedActor.name,
        summary: cachedActor.summary,
        icon_url: cachedActor.iconUrl,
        username: formatUsername(cachedActor.apId),
        is_following: false,
        is_followed_by: false,
      },
    });
  }

  // Check follow status if logged in and viewing a different actor
  let is_following = false;
  let is_followed_by = false;

  if (currentActor && currentActor.ap_id !== apId) {
    const [followingStatus, followedByStatus] = await Promise.all([
      db
        .select({ followerApId: follows.followerApId })
        .from(follows)
        .where(
          and(
            eq(follows.followerApId, currentActor.ap_id),
            eq(follows.followingApId, apId),
            eq(follows.status, "accepted"),
          ),
        )
        .get(),
      db
        .select({ followerApId: follows.followerApId })
        .from(follows)
        .where(
          and(
            eq(follows.followerApId, apId),
            eq(follows.followingApId, currentActor.ap_id),
            eq(follows.status, "accepted"),
          ),
        )
        .get(),
    ]);
    is_following = !!followingStatus;
    is_followed_by = !!followedByStatus;
  }

  return c.json({
    actor: {
      ap_id: localActor.apId,
      preferred_username: localActor.preferredUsername,
      name: localActor.name,
      summary: localActor.summary,
      icon_url: localActor.iconUrl,
      header_url: localActor.headerUrl,
      role: localActor.role,
      follower_count: localActor.followerCount,
      following_count: localActor.followingCount,
      post_count: localActor.postCount,
      is_private: localActor.isPrivate,
      created_at: localActor.createdAt,
      username: formatUsername(localActor.apId),
      is_following,
      is_followed_by,
    },
  });
});

// Update own profile
actorsRoute.put("/me", async (c) => {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const body = await c.req.json<{
    name?: string;
    summary?: string;
    icon_url?: string;
    header_url?: string;
    is_private?: boolean;
  }>();

  const updates: Record<string, string | number | null> = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length > MAX_PROFILE_NAME_LENGTH) {
      return c.json(
        {
          error: `Name too long (max ${MAX_PROFILE_NAME_LENGTH} chars)`,
        },
        400,
      );
    }
    updates.name = name;
  }
  if (body.summary !== undefined) {
    const summary = body.summary.trim();
    if (summary.length > MAX_PROFILE_SUMMARY_LENGTH) {
      return c.json(
        {
          error: `Summary too long (max ${MAX_PROFILE_SUMMARY_LENGTH} chars)`,
        },
        400,
      );
    }
    updates.summary = summary.length > 0 ? summary : null;
  }
  for (const [bodyKey, dbKey, label] of [
    ["icon_url", "iconUrl", "Icon URL"],
    ["header_url", "headerUrl", "Header URL"],
  ] as const) {
    const raw = body[bodyKey];
    if (raw !== undefined) {
      const trimmed = raw.trim();
      if (trimmed.length > MAX_PROFILE_URL_LENGTH) {
        return c.json(
          {
            error: `${label} too long (max ${MAX_PROFILE_URL_LENGTH} chars)`,
          },
          400,
        );
      }
      if (trimmed.length > 0 && !isValidHttpUrl(trimmed)) {
        return c.json({ error: `Invalid ${bodyKey}` }, 400);
      }
      updates[dbKey] = trimmed.length > 0 ? trimmed : null;
    }
  }
  if (body.is_private !== undefined) {
    updates.isPrivate = body.is_private ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const db = c.get("db");
  await db.update(actors).set(updates).where(eq(actors.apId, actor.ap_id));

  // Federate the profile change so remote followers do not see a stale
  // Person. Every field this route can mutate (name / summary / icon /
  // header / is_private) is part of the published actor document, so any
  // applied update is federated-visible: build a fresh Update(Person) from
  // the post-update values and fan it out to followers.
  const baseUrl = c.env.APP_URL;
  const nextName =
    "name" in updates ? (updates.name as string | null) : actor.name;
  const nextSummary =
    "summary" in updates ? (updates.summary as string | null) : actor.summary;
  const nextIconUrl =
    "iconUrl" in updates ? (updates.iconUrl as string | null) : actor.icon_url;
  const nextHeaderUrl =
    "headerUrl" in updates
      ? (updates.headerUrl as string | null)
      : actor.header_url;
  const nextIsPrivate =
    "isPrivate" in updates ? (updates.isPrivate as number) : actor.is_private;

  // Mirror the actor document served at the federation actor endpoint
  // (routes/activitypub.ts) so remote servers receive a consistent Person.
  const personObject: Record<string, unknown> = {
    id: actor.ap_id,
    type: actor.type,
    preferredUsername: actor.preferred_username,
    name: nextName,
    summary: nextSummary,
    inbox: actor.inbox,
    outbox: actor.outbox,
    followers: actor.followers_url,
    following: actor.following_url,
    endpoints: {
      sharedInbox: `${baseUrl}/ap/inbox`,
    },
    publicKey: {
      id: `${actor.ap_id}#main-key`,
      owner: actor.ap_id,
      publicKeyPem: actor.public_key_pem,
    },
    discoverable: !nextIsPrivate,
    manuallyApprovesFollowers: Boolean(nextIsPrivate),
  };
  if (nextIconUrl) {
    personObject.icon = { type: "Image", url: nextIconUrl };
  }
  if (nextHeaderUrl) {
    personObject.image = { type: "Image", url: nextHeaderUrl };
  }

  const updateActivityId = activityApId(baseUrl, generateId());
  const updateActivity = {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      "https://w3id.org/security/v1",
    ],
    id: updateActivityId,
    type: "Update",
    actor: actor.ap_id,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [actor.followers_url],
    object: personObject,
  };

  try {
    await db.insert(activities).values({
      apId: updateActivityId,
      type: "Update",
      actorApId: actor.ap_id,
      objectApId: actor.ap_id,
      rawJson: JSON.stringify(updateActivity),
      direction: "outbound",
    });
    await enqueueFanoutToFollowers(c.env, updateActivityId, actor.ap_id);
  } catch (err) {
    // Federation is best-effort; the local profile update already succeeded.
    log.error("Failed to enqueue profile Update federation", {
      event: "actors.profile.update_federation_failed",
      actor: actor.ap_id,
      error: err,
    });
  }

  return c.json({ success: true });
});

// Get actor's followers
actorsRoute.get("/:identifier/followers", async (c) =>
  listFollowRelation(c, "followers"),
);

// Get actor's following
actorsRoute.get("/:identifier/following", async (c) =>
  listFollowRelation(c, "following"),
);

export default actorsRoute;
