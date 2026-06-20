/**
 * Post query helpers and shared utilities
 *
 * Extracted from base.ts to reduce file size. Contains:
 * - Type definitions
 * - Inline helpers (validation, author resolution, interaction flags)
 * - Addressing logic for ActivityPub delivery
 */

import type { Database } from "../../../db/index.ts";
import {
  activities,
  actorCache,
  bookmarks,
  likes,
  objects,
} from "../../../db/index.ts";
import { and, eq, inArray, or } from "drizzle-orm";
import type { Env } from "../../types.ts";
import { formatUsername, objectApId } from "../../federation-helpers.ts";
import { formatPost, PostRow } from "./transformers.ts";
import {
  enqueueFanoutToCommunity,
  enqueueFanoutToFollowers,
} from "../../lib/delivery/queue.ts";
import { isRecord, parseJsonObject } from "../../lib/parse-helpers.ts";
import { logger } from "../../lib/logger.ts";

const log = logger.child({ component: "posts.queries" });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PostAttachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

export type CreatePostBody = {
  content: string;
  summary?: string;
  attachments?: PostAttachment[];
  in_reply_to?: string;
  visibility?: string;
  community_ap_id?: string;
};

export type PostDetailRow = PostRow & {
  to_json?: string | null;
  bookmarked?: number;
};

export type MentionFailure = {
  mention: string;
  stage: "resolve" | "persist_activity" | "persist_inbox";
  reason: string;
};

/** An ActivityStreams `Mention` tag entry for an outbound Note/Create. */
export type MentionTag = {
  type: "Mention";
  href: string;
  name: string;
};

/** An ActivityStreams `Hashtag` tag entry for an outbound Note/Create. */
export type HashtagTag = {
  type: "Hashtag";
  href: string;
  name: string;
};

/** Any tag persisted to objects.tagsJson / emitted on a Note's `tag`. */
export type PostTag = MentionTag | HashtagTag;

/**
 * Result of resolving the @mentions in a post: per-mention failures, the
 * `Mention` tag array to attach to the outbound Note/Create, and the resolved
 * actor IRIs (local + remote) that must be added to `cc` and — for remote
 * actors — delivered to.
 */
export type ProcessMentionsResult = {
  failures: MentionFailure[];
  tags: PostTag[];
  /** All resolved mentioned actor IRIs (local + remote), de-duplicated. */
  mentionedActorApIds: string[];
  /** Resolved remote mentioned actor IRIs that need direct inbox delivery. */
  remoteMentionedActorApIds: string[];
};

/** Merge extra recipient IRIs into a cc array, de-duplicating and dropping empties. */
export function mergeCc(cc: string[], extra: string[]): string[] {
  const seen = new Set(cc);
  const out = [...cc];
  for (const iri of extra) {
    if (iri && !seen.has(iri)) {
      seen.add(iri);
      out.push(iri);
    }
  }
  return out;
}

export type AuthorInfo = {
  preferredUsername: string | null;
  name: string | null;
  iconUrl: string | null;
};

/** Shape returned by Drizzle relational query with author. */
export type PostWithAuthor = {
  apId: string;
  type: string;
  attributedTo: string;
  content: string;
  summary: string | null;
  attachmentsJson: string | null;
  inReplyTo: string | null;
  visibility: string;
  communityApId: string | null;
  likeCount: number;
  replyCount: number;
  announceCount: number;
  published: string;
  toJson?: string | null;
  author: AuthorInfo | null;
};

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

export { isRecord, parseJsonObject };

/**
 * Validate that a raw field is either absent, null, or a string.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateOptionalString(
  raw: Record<string, unknown>,
  field: string,
): string | null {
  const value = raw[field];
  if (value !== undefined && value !== null && typeof value !== "string") {
    return `${field} must be a string`;
  }
  return null;
}

/** Shared Drizzle relational `with` for loading a post's local author info. */
export const AUTHOR_WITH = {
  author: {
    columns: {
      preferredUsername: true,
      name: true,
      iconUrl: true,
    },
  },
} as const;

/** Build an `or` condition that matches either the full apId or the raw postId. */
export function postWhereByIdOrApId(baseUrl: string, postId: string) {
  return or(
    eq(objects.apId, objectApId(baseUrl, postId)),
    eq(objects.apId, postId),
  );
}

/**
 * Resolve author info from a Drizzle post's local author or a cached-author map.
 * Returns { preferredUsername, name, iconUrl } with nulls as fallback.
 */
export function resolveAuthor(
  localAuthor: AuthorInfo | null | undefined,
  attributedTo: string,
  cachedAuthorMap?: Map<string, AuthorInfo>,
): AuthorInfo {
  if (localAuthor?.preferredUsername) return localAuthor;
  const cached = cachedAuthorMap?.get(attributedTo);
  if (cached) return cached;
  return { preferredUsername: null, name: null, iconUrl: null };
}

/**
 * Resolve author info with an async fallback to actorCache.
 * Used for single-post lookups where a batch-loaded map is unavailable.
 */
export async function resolveAuthorWithCache(
  localAuthor: AuthorInfo | null | undefined,
  attributedTo: string,
  db: Database,
): Promise<AuthorInfo> {
  if (localAuthor?.preferredUsername) return localAuthor;
  const cached = await db
    .select({
      preferredUsername: actorCache.preferredUsername,
      name: actorCache.name,
      iconUrl: actorCache.iconUrl,
    })
    .from(actorCache)
    .where(eq(actorCache.apId, attributedTo))
    .get();
  return cached ?? { preferredUsername: null, name: null, iconUrl: null };
}

/** Convert a Drizzle object row + resolved author into a PostRow for formatPost. */
export function toPostRow(
  post: {
    apId: string;
    type: string;
    attributedTo: string;
    content: string;
    summary: string | null;
    attachmentsJson: string | null;
    inReplyTo: string | null;
    visibility: string;
    communityApId: string | null;
    likeCount: number;
    replyCount: number;
    announceCount: number;
    published: string;
    updated?: string | null;
    toJson?: string | null;
  },
  author: AuthorInfo,
  flags: { liked: boolean; bookmarked?: boolean },
): PostRow & { to_json?: string | null; bookmarked?: number } {
  return {
    ap_id: post.apId,
    type: post.type,
    attributed_to: post.attributedTo,
    author_username: author.preferredUsername,
    author_name: author.name,
    author_icon_url: author.iconUrl,
    content: post.content,
    summary: post.summary,
    attachments_json: post.attachmentsJson,
    in_reply_to: post.inReplyTo,
    visibility: post.visibility,
    community_ap_id: post.communityApId,
    like_count: post.likeCount,
    reply_count: post.replyCount,
    announce_count: post.announceCount,
    published: post.published,
    updated: post.updated ?? null,
    liked: flags.liked ? 1 : 0,
    ...(flags.bookmarked !== undefined
      ? { bookmarked: flags.bookmarked ? 1 : 0 }
      : {}),
    ...(post.toJson !== undefined ? { to_json: post.toJson } : {}),
  };
}

type Visibility = "public" | "unlisted" | "followers" | "direct";

function assertNever(x: never): never {
  throw new Error(`Unhandled visibility: ${JSON.stringify(x)}`);
}

function classifyVisibility(value: string): Visibility {
  switch (value) {
    case "public":
    case "unlisted":
    case "followers":
    case "direct":
      return value;
    default:
      // Unknown visibility (e.g. from external AP server) — fail closed
      // by treating as direct (no public delivery, equivalent to the
      // previous `{to:[], cc:[]}` default).
      return "direct";
  }
}

const PUBLIC_URL = "https://www.w3.org/ns/activitystreams#Public";

/** Compute to/cc fields from visibility for ActivityPub delivery. */
export function buildAddressing(
  visibility: string,
  followersUrl: string,
): { to: string[]; cc: string[] } {
  const publicUrl = PUBLIC_URL;
  const narrowed = classifyVisibility(visibility);
  switch (narrowed) {
    case "public":
      return { to: [publicUrl], cc: [followersUrl] };
    case "unlisted":
      return { to: [followersUrl], cc: [publicUrl] };
    case "followers":
      return { to: [followersUrl], cc: [] };
    case "direct":
      return { to: [], cc: [] };
    default:
      return assertNever(narrowed);
  }
}

export type CommunityAddressingTarget = {
  apId: string;
  followersUrl: string;
};

/**
 * Compute the stored object addressing (to/cc/audience) for a post.
 *
 * For a community-scoped post the reach is the COMMUNITY, not the open public
 * timeline: the community Group actor and its followers collection are placed
 * in `to`, and the community is recorded in `audience`. Because the public /
 * home feed filters on `audienceJson = "[]"`, a non-empty audience is exactly
 * what keeps the post out of those feeds while keeping it visible in the
 * community-scoped feed (which filters by `communityApId`). `#Public` is
 * downgraded to `cc` (unlisted-style) so the post is not boosted into the
 * federated public stream even when the post visibility is "public".
 *
 * For a non-community post this returns empty arrays, preserving the prior
 * object defaults (the activity-level addressing in the Create still drives
 * follower delivery).
 */
export function buildCommunityObjectAddressing(
  visibility: string,
  community: CommunityAddressingTarget | null,
): { to: string[]; cc: string[]; audience: string[] } {
  if (!community) {
    return { to: [], cc: [], audience: [] };
  }
  const narrowed = classifyVisibility(visibility);
  const to = [community.apId, community.followersUrl];
  const cc: string[] = [];
  if (narrowed === "public" || narrowed === "unlisted") {
    cc.push(PUBLIC_URL);
  }
  return { to, cc, audience: [community.apId] };
}

/** Batch-load liked and bookmarked object IDs for a set of posts. */
export async function loadInteractionFlags(
  db: Database,
  actorApId: string | undefined,
  objectApIds: string[],
): Promise<{ likedIds: Set<string>; bookmarkedIds: Set<string> }> {
  if (!actorApId || objectApIds.length === 0) {
    return { likedIds: new Set(), bookmarkedIds: new Set() };
  }
  const [likeRows, bookmarkRows] = await Promise.all([
    db
      .select({ objectApId: likes.objectApId })
      .from(likes)
      .where(
        and(
          eq(likes.actorApId, actorApId),
          inArray(likes.objectApId, objectApIds),
        ),
      ),
    db
      .select({ objectApId: bookmarks.objectApId })
      .from(bookmarks)
      .where(
        and(
          eq(bookmarks.actorApId, actorApId),
          inArray(bookmarks.objectApId, objectApIds),
        ),
      ),
  ]);
  return {
    likedIds: new Set(likeRows.map((l) => l.objectApId)),
    bookmarkedIds: new Set(bookmarkRows.map((b) => b.objectApId)),
  };
}

/**
 * Persist an outbound ActivityPub activity WITHOUT any follower/community
 * fanout. Used when the only recipients are explicit (e.g. a "direct" post
 * whose reach is exactly its mentioned actors), so the activity is on record
 * for direct per-actor delivery but is never broadcast to the follower graph.
 */
export async function persistActivity(
  db: Database,
  activity: { id: string; type: string; actor: string; [key: string]: unknown },
  objectApIdValue: string,
): Promise<void> {
  await db.insert(activities).values({
    apId: activity.id,
    type: activity.type,
    actorApId: activity.actor,
    objectApId: objectApIdValue,
    rawJson: JSON.stringify(activity),
    direction: "outbound",
  });
}

/** Persist an outbound ActivityPub activity and enqueue federation fanout. */
export async function persistAndFanout(
  db: Database,
  env: Env,
  activity: { id: string; type: string; actor: string; [key: string]: unknown },
  objectApIdValue: string,
): Promise<void> {
  await db.insert(activities).values({
    apId: activity.id,
    type: activity.type,
    actorApId: activity.actor,
    objectApId: objectApIdValue,
    rawJson: JSON.stringify(activity),
    direction: "outbound",
  });

  try {
    await enqueueFanoutToFollowers(env, activity.id, activity.actor);
  } catch (err) {
    log.error("Failed to enqueue federation fanout", {
      event: "posts.fanout.enqueue_failed",
      activityType: activity.type,
      activityId: activity.id,
      actor: activity.actor,
      error: err,
    });
  }
}

/**
 * Persist an outbound activity and fan it out to a COMMUNITY's audience
 * (members + community followers) instead of the author's personal followers.
 * Used for community-scoped posts so reach == community.
 */
export async function persistAndFanoutToCommunity(
  db: Database,
  env: Env,
  activity: { id: string; type: string; actor: string; [key: string]: unknown },
  objectApIdValue: string,
  communityApId: string,
): Promise<void> {
  await db.insert(activities).values({
    apId: activity.id,
    type: activity.type,
    actorApId: activity.actor,
    objectApId: objectApIdValue,
    rawJson: JSON.stringify(activity),
    direction: "outbound",
  });

  try {
    await enqueueFanoutToCommunity(env, activity.id, communityApId);
  } catch (err) {
    log.error("Failed to enqueue community federation fanout", {
      event: "posts.fanout.community_enqueue_failed",
      activityType: activity.type,
      activityId: activity.id,
      actor: activity.actor,
      communityApId,
      error: err,
    });
  }
}

/** Batch-load cached authors for posts without a local author join. */
export async function loadCachedAuthorMap(
  db: Database,
  posts: PostWithAuthor[],
): Promise<Map<string, AuthorInfo>> {
  const remoteAttributedTos = [
    ...new Set(posts.filter((p) => !p.author).map((p) => p.attributedTo)),
  ];
  if (remoteAttributedTos.length === 0) return new Map();
  const cachedAuthors = await db
    .select({
      apId: actorCache.apId,
      preferredUsername: actorCache.preferredUsername,
      name: actorCache.name,
      iconUrl: actorCache.iconUrl,
    })
    .from(actorCache)
    .where(inArray(actorCache.apId, remoteAttributedTos));
  return new Map(cachedAuthors.map((a) => [a.apId, a]));
}
