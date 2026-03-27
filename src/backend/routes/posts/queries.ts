/**
 * Post query helpers and shared utilities
 *
 * Extracted from base.ts to reduce file size. Contains:
 * - Type definitions
 * - Inline helpers (validation, author resolution, interaction flags)
 * - Addressing logic for ActivityPub delivery
 */

import type { Database } from '../../../db';
import { actorCache, objects, likes, bookmarks, activities } from '../../../db';
import { eq, and, or, inArray } from 'drizzle-orm';
import type { Env } from '../../types';
import { objectApId, formatUsername } from '../../federation-helpers';
import { PostRow, formatPost } from './transformers';
import { enqueueFanoutToFollowers } from '../../lib/delivery/queue';
import { isRecord, parseJsonObject } from '../../lib/parse-helpers';

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
  stage: 'resolve' | 'persist_activity' | 'persist_inbox';
  reason: string;
};

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
export function validateOptionalString(raw: Record<string, unknown>, field: string): string | null {
  const value = raw[field];
  if (value !== undefined && value !== null && typeof value !== 'string') {
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
  const cached = await db.select({
    preferredUsername: actorCache.preferredUsername,
    name: actorCache.name,
    iconUrl: actorCache.iconUrl,
  }).from(actorCache).where(eq(actorCache.apId, attributedTo)).get();
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
    liked: flags.liked ? 1 : 0,
    ...(flags.bookmarked !== undefined ? { bookmarked: flags.bookmarked ? 1 : 0 } : {}),
    ...(post.toJson !== undefined ? { to_json: post.toJson } : {}),
  };
}

/** Compute to/cc fields from visibility for ActivityPub delivery. */
export function buildAddressing(visibility: string, followersUrl: string): { to: string[]; cc: string[] } {
  const publicUrl = 'https://www.w3.org/ns/activitystreams#Public';
  switch (visibility) {
    case 'public':
      return { to: [publicUrl], cc: [followersUrl] };
    case 'unlisted':
      return { to: [followersUrl], cc: [publicUrl] };
    case 'followers':
      return { to: [followersUrl], cc: [] };
    default:
      return { to: [], cc: [] };
  }
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
    db.select({ objectApId: likes.objectApId })
      .from(likes)
      .where(and(eq(likes.actorApId, actorApId), inArray(likes.objectApId, objectApIds))),
    db.select({ objectApId: bookmarks.objectApId })
      .from(bookmarks)
      .where(and(eq(bookmarks.actorApId, actorApId), inArray(bookmarks.objectApId, objectApIds))),
  ]);
  return {
    likedIds: new Set(likeRows.map((l) => l.objectApId)),
    bookmarkedIds: new Set(bookmarkRows.map((b) => b.objectApId)),
  };
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
    direction: 'outbound',
  });

  try {
    await enqueueFanoutToFollowers(env, activity.id, activity.actor);
  } catch (err) {
    console.error(`[Posts] Failed to enqueue ${activity.type} federation fanout:`, err);
  }
}

/** Batch-load cached authors for posts without a local author join. */
export async function loadCachedAuthorMap(
  db: Database,
  posts: PostWithAuthor[],
): Promise<Map<string, AuthorInfo>> {
  const remoteAttributedTos = [...new Set(
    posts.filter((p) => !p.author).map((p) => p.attributedTo)
  )];
  if (remoteAttributedTos.length === 0) return new Map();
  const cachedAuthors = await db.select({
    apId: actorCache.apId,
    preferredUsername: actorCache.preferredUsername,
    name: actorCache.name,
    iconUrl: actorCache.iconUrl,
  }).from(actorCache).where(inArray(actorCache.apId, remoteAttributedTos));
  return new Map(cachedAuthors.map((a) => [a.apId, a]));
}
