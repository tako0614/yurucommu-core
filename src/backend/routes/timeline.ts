// Timeline routes for Yurucommu backend
import { Hono } from 'hono';
import { eq, and, or, ne, lt, desc, inArray, notInArray, isNull } from 'drizzle-orm';
import type { Database } from '../../db';
import { actors, actorCache, objects, follows, likes, bookmarks, announces, blocks, mutes } from '../../db';
import type { Env, Variables } from '../types';
import { formatUsername, parseLimit, parseOffset, safeJsonParse } from '../utils';
import { withCache, CacheTTL, CacheTags } from '../middleware/cache';

const timeline = new Hono<{ Bindings: Env; Variables: Variables }>();
const MAX_BLOCK_MUTE_FILTER_ENTRIES = 1000;

type Attachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

type AuthorInfo = { preferredUsername: string | null; name: string | null; iconUrl: string | null };
const NULL_AUTHOR: AuthorInfo = { preferredUsername: null, name: null, iconUrl: null };

// Batch helper to get author info from either local actors or actor cache
// This avoids N+1 queries by fetching all authors at once
async function batchGetAuthorInfo(
  db: Database,
  apIds: string[]
): Promise<Map<string, AuthorInfo>> {
  if (apIds.length === 0) return new Map();

  const uniqueApIds = [...new Set(apIds)];

  const [localActors, cachedActors] = await Promise.all([
    db.select({
      apId: actors.apId,
      preferredUsername: actors.preferredUsername,
      name: actors.name,
      iconUrl: actors.iconUrl,
    })
      .from(actors)
      .where(inArray(actors.apId, uniqueApIds)),
    db.select({
      apId: actorCache.apId,
      preferredUsername: actorCache.preferredUsername,
      name: actorCache.name,
      iconUrl: actorCache.iconUrl,
    })
      .from(actorCache)
      .where(inArray(actorCache.apId, uniqueApIds)),
  ]);

  const result = new Map<string, AuthorInfo>();

  // Cached actors first; local actors override
  for (const a of cachedActors) {
    result.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
  }
  for (const a of localActors) {
    result.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
  }

  return result;
}

// Batch helper to check interaction status for multiple objects
// This avoids N+1 queries by fetching all interactions at once
async function batchGetInteractionStatus(
  db: Database,
  viewerApId: string,
  objectApIds: string[]
): Promise<{ likedSet: Set<string>; bookmarkedSet: Set<string>; repostedSet: Set<string> }> {
  if (!viewerApId || objectApIds.length === 0) {
    return { likedSet: new Set(), bookmarkedSet: new Set(), repostedSet: new Set() };
  }

  const [likeRows, bookmarkRows, announceRows] = await Promise.all([
    db.select({ objectApId: likes.objectApId })
      .from(likes)
      .where(and(eq(likes.actorApId, viewerApId), inArray(likes.objectApId, objectApIds))),
    db.select({ objectApId: bookmarks.objectApId })
      .from(bookmarks)
      .where(and(eq(bookmarks.actorApId, viewerApId), inArray(bookmarks.objectApId, objectApIds))),
    db.select({ objectApId: announces.objectApId })
      .from(announces)
      .where(and(eq(announces.actorApId, viewerApId), inArray(announces.objectApId, objectApIds))),
  ]);

  return {
    likedSet: new Set(likeRows.map((l) => l.objectApId)),
    bookmarkedSet: new Set(bookmarkRows.map((b) => b.objectApId)),
    repostedSet: new Set(announceRows.map((a) => a.objectApId)),
  };
}

// Helper to get blocked and muted users
async function getBlockedAndMutedUsers(
  db: Database,
  viewerApId: string
): Promise<{ blockedApIds: string[]; mutedApIds: string[] }> {
  if (!viewerApId) {
    return { blockedApIds: [], mutedApIds: [] };
  }

  const [blockRows, muteRows] = await Promise.all([
    db.select({ blockedApId: blocks.blockedApId })
      .from(blocks)
      .where(eq(blocks.blockerApId, viewerApId))
      .limit(MAX_BLOCK_MUTE_FILTER_ENTRIES),
    db.select({ mutedApId: mutes.mutedApId })
      .from(mutes)
      .where(eq(mutes.muterApId, viewerApId))
      .limit(MAX_BLOCK_MUTE_FILTER_ENTRIES),
  ]);

  return {
    blockedApIds: blockRows.map((b) => b.blockedApId),
    mutedApIds: muteRows.map((m) => m.mutedApId),
  };
}

// Merge blocked + muted AP IDs into a single deduplicated exclusion list
function buildExcludedApIds(blockedApIds: string[], mutedApIds: string[]): string[] {
  return Array.from(new Set([...blockedApIds, ...mutedApIds]));
}

// Paginate a fetched-with-extra-1 result set and determine has_more
function paginateResults<T>(rows: T[], limit: number): { results: T[]; has_more: boolean } {
  const has_more = rows.length > limit;
  return { results: has_more ? rows.slice(0, limit) : rows, has_more };
}

// Format a post row and its resolved author/interaction data into the API response shape
function formatPost(
  p: { apId: string; type: string; attributedTo: string; content: string; summary: string | null; attachmentsJson: string | null; inReplyTo: string | null; visibility: string; communityApId: string | null; likeCount: number; replyCount: number; announceCount: number; published: string | null },
  authorMap: Map<string, AuthorInfo>,
  interactions: { likedSet: Set<string>; bookmarkedSet: Set<string>; repostedSet: Set<string> },
): Record<string, unknown> {
  const author = authorMap.get(p.attributedTo) || NULL_AUTHOR;
  return {
    ap_id: p.apId,
    type: p.type,
    author: {
      ap_id: p.attributedTo,
      username: formatUsername(p.attributedTo),
      preferred_username: author.preferredUsername,
      name: author.name,
      icon_url: author.iconUrl,
    },
    content: p.content,
    summary: p.summary,
    attachments: safeJsonParse<Attachment[]>(p.attachmentsJson, []),
    in_reply_to: p.inReplyTo,
    visibility: p.visibility,
    community_ap_id: p.communityApId,
    like_count: p.likeCount,
    reply_count: p.replyCount,
    announce_count: p.announceCount,
    published: p.published,
    liked: interactions.likedSet.has(p.apId),
    bookmarked: interactions.bookmarkedSet.has(p.apId),
    reposted: interactions.repostedSet.has(p.apId),
  };
}

// Batch-resolve authors and interactions, then format posts for API response
async function resolveAndFormatPosts(
  db: Database,
  posts: Array<Parameters<typeof formatPost>[0]>,
  viewerApId: string,
): Promise<Record<string, unknown>[]> {
  const authorApIds = posts.map((p) => p.attributedTo);
  const postApIds = posts.map((p) => p.apId);

  const [authorMap, interactions] = await Promise.all([
    batchGetAuthorInfo(db, authorApIds),
    batchGetInteractionStatus(db, viewerApId, postApIds),
  ]);

  return posts.map((p) => formatPost(p, authorMap, interactions));
}

// Get public timeline
// Supports both cursor (before) and offset pagination
// Returns: posts, limit, offset (if used), has_more
// Cached for 2 minutes for unauthenticated users
timeline.get('/', withCache({
  ttl: CacheTTL.PUBLIC_TIMELINE,
  cacheTag: CacheTags.TIMELINE,
  queryParamsToInclude: ['limit', 'offset', 'before', 'community'],
}), async (c) => {
  const actor = c.get('actor');
  const db = c.get('prisma');
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);
  const before = c.req.query('before');
  const communityApId = c.req.query('community');
  const viewerApId = actor?.ap_id || '';

  const { blockedApIds, mutedApIds } = await getBlockedAndMutedUsers(db, viewerApId);
  const excludedApIds = buildExcludedApIds(blockedApIds, mutedApIds);

  const conditions = [
    eq(objects.type, 'Note'),
    eq(objects.visibility, 'public'),
    isNull(objects.inReplyTo),
    eq(objects.audienceJson, '[]'),
    isNull(objects.deletedAt),
  ];
  if (excludedApIds.length > 0) conditions.push(notInArray(objects.attributedTo, excludedApIds));
  if (communityApId) conditions.push(eq(objects.communityApId, communityApId));
  if (before) conditions.push(lt(objects.published, before));

  const posts = await db.select().from(objects).where(and(...conditions)).orderBy(desc(objects.published)).limit(limit + 1).offset(offset);

  const { results, has_more } = paginateResults(posts, limit);
  const result = await resolveAndFormatPosts(db, results, viewerApId);

  return c.json({ posts: result, limit, offset, has_more });
});

// Get following timeline
// Supports both cursor (before) and offset pagination
// Returns: posts, limit, offset (if used), has_more
timeline.get('/following', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const db = c.get('prisma');
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);
  const before = c.req.query('before');
  const viewerApId = actor.ap_id;

  const [{ blockedApIds, mutedApIds }, followRows] = await Promise.all([
    getBlockedAndMutedUsers(db, viewerApId),
    db.select({ followingApId: follows.followingApId })
      .from(follows)
      .where(and(eq(follows.followerApId, viewerApId), eq(follows.status, 'accepted'))),
  ]);

  const excludedApIds = buildExcludedApIds(blockedApIds, mutedApIds);
  const followingApIds = followRows.map((f) => f.followingApId);
  const allowedAuthors = [viewerApId, ...followingApIds];

  // Own posts: all visibilities except direct
  // Followed users' posts: public, unlisted, or followers visibility
  const conditions = [
    eq(objects.type, 'Note'),
    isNull(objects.inReplyTo),
    eq(objects.audienceJson, '[]'),
    inArray(objects.attributedTo, allowedAuthors),
    isNull(objects.deletedAt),
    or(
      eq(objects.attributedTo, viewerApId),
      and(
        ne(objects.attributedTo, viewerApId),
        inArray(objects.visibility, ['public', 'unlisted', 'followers']),
      ),
    ),
  ];
  if (excludedApIds.length > 0) conditions.push(notInArray(objects.attributedTo, excludedApIds));
  if (before) conditions.push(lt(objects.published, before));

  const posts = await db.select().from(objects).where(and(...conditions)).orderBy(desc(objects.published)).limit(limit + 1).offset(offset);

  const { results, has_more } = paginateResults(posts, limit);
  const result = await resolveAndFormatPosts(db, results, viewerApId);

  return c.json({ posts: result, limit, offset, has_more });
});

export default timeline;
