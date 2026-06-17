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
  mediaUploads,
  mutes,
  notDeleted,
  notificationArchived,
  nowIso,
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
import { snapshotAndEnqueueFollowerDeliveries } from "../lib/delivery/queue-batching.ts";
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

// Mastodon-parity profile metadata limits. Mastodon caps profile fields at 4
// rows with bounded name/value lengths; we mirror that to keep the served
// actor document and federated Update(Person) bounded.
const MAX_PROFILE_FIELDS = 4;
const MAX_PROFILE_FIELD_NAME_LENGTH = 255;
const MAX_PROFILE_FIELD_VALUE_LENGTH = 255;
// Bound declared aliases (alsoKnownAs) so the actor document stays bounded.
const MAX_ALSO_KNOWN_AS = 10;
// Personal-portability export caps so a single archive request cannot OOM.
const MAX_EXPORT_POSTS = 5000;
const MAX_EXPORT_RELATIONS = 10000;
const MAX_EXPORT_MEDIA = 10000;

type ProfileField = { name: string; value: string };

/**
 * Sanitize a structured profile fields payload into a bounded array of
 * { name, value } rows. Non-string / empty rows are dropped; the result is
 * capped at MAX_PROFILE_FIELDS with trimmed, length-bounded values.
 */
function sanitizeProfileFields(input: unknown): ProfileField[] {
  if (!Array.isArray(input)) return [];
  const out: ProfileField[] = [];
  for (const row of input) {
    if (out.length >= MAX_PROFILE_FIELDS) break;
    if (!row || typeof row !== "object") continue;
    const name = (row as { name?: unknown }).name;
    const value = (row as { value?: unknown }).value;
    if (typeof name !== "string" || typeof value !== "string") continue;
    const trimmedName = name.trim().slice(0, MAX_PROFILE_FIELD_NAME_LENGTH);
    const trimmedValue = value.trim().slice(0, MAX_PROFILE_FIELD_VALUE_LENGTH);
    if (trimmedName.length === 0 && trimmedValue.length === 0) continue;
    out.push({ name: trimmedName, value: trimmedValue });
  }
  return out;
}

/**
 * Render stored profile fields as PropertyValue attachments for the federated
 * Person object (mirrors the served actor document in routes/activitypub.ts).
 */
function fieldsToAttachments(
  fields: ProfileField[],
): Array<{ type: "PropertyValue"; name: string; value: string }> {
  return fields.map((f) => ({
    type: "PropertyValue",
    name: f.name,
    value: f.value,
  }));
}

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
    // learn the actor is gone. We persist a Delete(actor) activity and
    // SNAPSHOT the follower inboxes into per-endpoint delivery jobs while the
    // follower graph and the activity row still exist. A plain async
    // fanout_followers message would be processed AFTER teardown deletes the
    // `follows` rows below, so the consumer would read an empty follower graph
    // and reach zero remote followers; resolving endpoints synchronously here
    // captures the graph before it is gone. The Delete activity row is
    // intentionally preserved through teardown (excluded from the activities
    // delete below) so the deliver_endpoint consumer can still read its
    // rawJson after the actor's other rows are gone.
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
      // Snapshot follower inboxes into delivery jobs NOW, before the `follows`
      // rows are deleted in Phase 1 below.
      await snapshotAndEnqueueFollowerDeliveries(
        db,
        c.env,
        deleteActivityId,
        actorApIdVal,
      );
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
    // Notification rows for this actor: inbox (above) is the live notification
    // source; the archived projection must go too so no per-actor notification
    // data survives the deletion.
    await db
      .delete(notificationArchived)
      .where(eq(notificationArchived.actorApId, actorApIdVal));

    // Media: hard-delete the actor's uploads and best-effort purge the backing
    // R2 objects so blobs do not leak. The DB rows are removed regardless of
    // whether the object-store delete succeeds (R2 has its own GC fallback via
    // the orphaned-key audit); never block deletion on storage availability.
    const uploads = await db
      .select({ r2Key: mediaUploads.r2Key })
      .from(mediaUploads)
      .where(eq(mediaUploads.uploaderApId, actorApIdVal));
    if (uploads.length > 0) {
      const media = c.env.MEDIA;
      if (media) {
        const keys = uploads.map((u) => u.r2Key);
        try {
          await media.delete(keys);
        } catch (err) {
          log.error("Failed to purge R2 objects for deleted account", {
            event: "actors.account.delete_media_purge_failed",
            actor: actorApIdVal,
            count: keys.length,
            error: err,
          });
        }
      }
      await db
        .delete(mediaUploads)
        .where(eq(mediaUploads.uploaderApId, actorApIdVal));
    }

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

    // Tombstone the actor identity instead of hard-deleting the row. The queued
    // Delete(actor) deliver_endpoint jobs (snapshotted above) sign with THIS
    // actor's private key when they later drain; a hard delete would destroy the
    // signing material and the Delete could never be signed/delivered. We keep
    // only what the delivery signer needs (apId + keyId-deriving fields +
    // privateKeyPem/publicKeyPem) and scrub every piece of personal data. The
    // `deletedAt` tombstone excludes this row from all federation-serving and
    // counting queries (which filter `notDeleted(actors)`), and all auth paths
    // are already severed because the sessions were deleted in Phase 1. A later
    // sweep can hard-delete tombstones after the Delete jobs have drained.
    await db
      .update(actors)
      .set({
        name: null,
        summary: null,
        iconUrl: null,
        headerUrl: null,
        takosUserId: null,
        followerCount: 0,
        followingCount: 0,
        postCount: 0,
        fieldsJson: "[]",
        alsoKnownAsJson: "[]",
        movedTo: null,
        ownerActorApId: null,
        deletedAt: nowIso(),
      })
      .where(eq(actors.apId, actorApIdVal));

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
    fields?: Array<{ name?: unknown; value?: unknown }>;
    also_known_as?: unknown;
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

  // Structured profile metadata (PropertyValue). Sanitized + capped so the
  // served actor document and federated Update(Person) stay bounded.
  let nextFields: ProfileField[] | undefined;
  if (body.fields !== undefined) {
    nextFields = sanitizeProfileFields(body.fields);
    updates.fieldsJson = JSON.stringify(nextFields);
  }

  // Account-migration aliases (alsoKnownAs). Accept an array of AP-ID URLs the
  // account claims; bound + validate so a Move target can reference us.
  let nextAlsoKnownAs: string[] | undefined;
  if (body.also_known_as !== undefined) {
    if (!Array.isArray(body.also_known_as)) {
      return c.json({ error: "also_known_as must be an array" }, 400);
    }
    const aliases: string[] = [];
    for (const raw of body.also_known_as) {
      if (aliases.length >= MAX_ALSO_KNOWN_AS) break;
      if (typeof raw !== "string") continue;
      const trimmed = raw.trim();
      if (trimmed.length === 0) continue;
      if (!isValidHttpUrl(trimmed)) {
        return c.json({ error: `Invalid alsoKnownAs entry: ${trimmed}` }, 400);
      }
      if (!aliases.includes(trimmed)) aliases.push(trimmed);
    }
    nextAlsoKnownAs = aliases;
    updates.alsoKnownAsJson = JSON.stringify(aliases);
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: "No fields to update" }, 400);
  }

  const db = c.get("db");
  await db.update(actors).set(updates).where(eq(actors.apId, actor.ap_id));

  // The `actor` context snapshot predates the new columns, so to federate a
  // faithful Person we read the current persisted values when the request did
  // not itself supply them.
  if (nextFields === undefined || nextAlsoKnownAs === undefined) {
    const persisted = await db
      .select({
        fieldsJson: actors.fieldsJson,
        alsoKnownAsJson: actors.alsoKnownAsJson,
      })
      .from(actors)
      .where(eq(actors.apId, actor.ap_id))
      .get();
    if (nextFields === undefined) {
      nextFields = sanitizeProfileFields(
        safeJsonParse(persisted?.fieldsJson, []),
      );
    }
    if (nextAlsoKnownAs === undefined) {
      const parsed = safeJsonParse<string[]>(persisted?.alsoKnownAsJson, []);
      nextAlsoKnownAs = Array.isArray(parsed)
        ? parsed.filter((a): a is string => typeof a === "string")
        : [];
    }
  }

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
  if (nextFields && nextFields.length > 0) {
    personObject.attachment = fieldsToAttachments(nextFields);
  }
  if (nextAlsoKnownAs && nextAlsoKnownAs.length > 0) {
    personObject.alsoKnownAs = nextAlsoKnownAs;
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

// Initiate an account migration: declare the destination and federate a
// Move(actor -> target) to followers. The destination must already list this
// account in its own `alsoKnownAs` (verified by remote servers); we persist
// `moved_to` so the served actor document advertises the migration and emit
// the Move so followers can re-follow the target.
actorsRoute.post("/me/move", async (c) => {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const body = await c.req
    .json<{ target?: unknown }>()
    .catch(() => ({}) as { target?: unknown });
  const target = typeof body.target === "string" ? body.target.trim() : "";
  if (target.length === 0) {
    return c.json({ error: "target is required" }, 400);
  }
  if (!isValidHttpUrl(target)) {
    return c.json({ error: "Invalid move target" }, 400);
  }
  if (target === actor.ap_id) {
    return c.json({ error: "Cannot move an account to itself" }, 400);
  }

  const db = c.get("db");
  const baseUrl = c.env.APP_URL;

  await db
    .update(actors)
    .set({ movedTo: target })
    .where(eq(actors.apId, actor.ap_id));

  // Federate Move(actor) addressed to followers so they migrate their follow.
  const moveActivityId = activityApId(baseUrl, generateId());
  const moveActivity = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id: moveActivityId,
    type: "Move",
    actor: actor.ap_id,
    object: actor.ap_id,
    target,
    to: ["https://www.w3.org/ns/activitystreams#Public"],
    cc: [actor.followers_url],
  };

  try {
    await db.insert(activities).values({
      apId: moveActivityId,
      type: "Move",
      actorApId: actor.ap_id,
      objectApId: actor.ap_id,
      rawJson: JSON.stringify(moveActivity),
      direction: "outbound",
    });
    await enqueueFanoutToFollowers(c.env, moveActivityId, actor.ap_id);
  } catch (err) {
    // Federation is best-effort; the local moved_to marker already persisted.
    log.error("Failed to enqueue account Move federation", {
      event: "actors.account.move_federation_failed",
      actor: actor.ap_id,
      error: err,
    });
  }

  return c.json({ success: true, moved_to: target });
});

// Personal-portability data export: a bounded JSON archive of the actor's
// profile + authored posts (outbox-style) + follow graph + media manifest.
// Every collection is capped so a single request cannot OOM the worker; this
// is a portability aid, not a streaming full backup.
actorsRoute.get("/me/export", async (c) => {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;
  const db = c.get("db");
  const actorApIdVal = actor.ap_id;

  const profileRow = await db
    .select({
      apId: actors.apId,
      type: actors.type,
      preferredUsername: actors.preferredUsername,
      name: actors.name,
      summary: actors.summary,
      iconUrl: actors.iconUrl,
      headerUrl: actors.headerUrl,
      isPrivate: actors.isPrivate,
      role: actors.role,
      createdAt: actors.createdAt,
      fieldsJson: actors.fieldsJson,
      alsoKnownAsJson: actors.alsoKnownAsJson,
      movedTo: actors.movedTo,
    })
    .from(actors)
    .where(eq(actors.apId, actorApIdVal))
    .get();

  if (!profileRow) return c.json({ error: "Actor not found" }, 404);

  const [authoredPosts, following, followers, media] = await Promise.all([
    db
      .select()
      .from(objects)
      .where(and(eq(objects.attributedTo, actorApIdVal), notDeleted(objects)))
      .orderBy(desc(objects.published))
      .limit(MAX_EXPORT_POSTS),
    db
      .select({
        followingApId: follows.followingApId,
        status: follows.status,
        createdAt: follows.createdAt,
      })
      .from(follows)
      .where(eq(follows.followerApId, actorApIdVal))
      .orderBy(desc(follows.createdAt))
      .limit(MAX_EXPORT_RELATIONS),
    db
      .select({
        followerApId: follows.followerApId,
        status: follows.status,
        createdAt: follows.createdAt,
      })
      .from(follows)
      .where(eq(follows.followingApId, actorApIdVal))
      .orderBy(desc(follows.createdAt))
      .limit(MAX_EXPORT_RELATIONS),
    db
      .select({
        id: mediaUploads.id,
        r2Key: mediaUploads.r2Key,
        contentType: mediaUploads.contentType,
        size: mediaUploads.size,
        createdAt: mediaUploads.createdAt,
      })
      .from(mediaUploads)
      .where(eq(mediaUploads.uploaderApId, actorApIdVal))
      .orderBy(desc(mediaUploads.createdAt))
      .limit(MAX_EXPORT_MEDIA),
  ]);

  const archive = {
    "@context": "https://www.w3.org/ns/activitystreams",
    exported_at: new Date().toISOString(),
    actor: {
      ap_id: profileRow.apId,
      type: profileRow.type,
      preferred_username: profileRow.preferredUsername,
      name: profileRow.name,
      summary: profileRow.summary,
      icon_url: profileRow.iconUrl,
      header_url: profileRow.headerUrl,
      is_private: profileRow.isPrivate,
      role: profileRow.role,
      created_at: profileRow.createdAt,
      fields: sanitizeProfileFields(safeJsonParse(profileRow.fieldsJson, [])),
      also_known_as: safeJsonParse<string[]>(profileRow.alsoKnownAsJson, []),
      moved_to: profileRow.movedTo,
      username: formatUsername(profileRow.apId),
    },
    outbox: {
      type: "OrderedCollection",
      total_items: authoredPosts.length,
      truncated: authoredPosts.length >= MAX_EXPORT_POSTS,
      ordered_items: authoredPosts.map((p) => ({
        ap_id: p.apId,
        type: p.type,
        content: p.content,
        summary: p.summary,
        attachments: safeJsonParse(p.attachmentsJson, []),
        in_reply_to: p.inReplyTo,
        visibility: p.visibility,
        community_ap_id: p.communityApId,
        published: p.published,
        updated: p.updated,
      })),
    },
    following: {
      total_items: following.length,
      truncated: following.length >= MAX_EXPORT_RELATIONS,
      items: following.map((f) => ({
        ap_id: f.followingApId,
        status: f.status,
        created_at: f.createdAt,
      })),
    },
    followers: {
      total_items: followers.length,
      truncated: followers.length >= MAX_EXPORT_RELATIONS,
      items: followers.map((f) => ({
        ap_id: f.followerApId,
        status: f.status,
        created_at: f.createdAt,
      })),
    },
    media: {
      total_items: media.length,
      truncated: media.length >= MAX_EXPORT_MEDIA,
      items: media.map((m) => ({
        id: m.id,
        key: m.r2Key,
        content_type: m.contentType,
        size: m.size,
        created_at: m.createdAt,
      })),
    },
  };

  c.header(
    "Content-Disposition",
    `attachment; filename="${profileRow.preferredUsername}-export.json"`,
  );
  return c.json(archive);
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
