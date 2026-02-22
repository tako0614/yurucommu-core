// Timeline routes for Yurucommu backend
import { Hono } from 'hono';
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
  prisma: ReturnType<typeof import('../lib/db').getPrismaD1>,
  apIds: string[]
): Promise<Map<string, AuthorInfo>> {
  if (apIds.length === 0) return new Map();

  const uniqueApIds = [...new Set(apIds)];

  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: uniqueApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: uniqueApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
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
  prisma: ReturnType<typeof import('../lib/db').getPrismaD1>,
  viewerApId: string,
  objectApIds: string[]
): Promise<{ likedSet: Set<string>; bookmarkedSet: Set<string>; repostedSet: Set<string> }> {
  if (!viewerApId || objectApIds.length === 0) {
    return { likedSet: new Set(), bookmarkedSet: new Set(), repostedSet: new Set() };
  }

  const [likes, bookmarks, announces] = await Promise.all([
    prisma.like.findMany({
      where: { actorApId: viewerApId, objectApId: { in: objectApIds } },
      select: { objectApId: true },
    }),
    prisma.bookmark.findMany({
      where: { actorApId: viewerApId, objectApId: { in: objectApIds } },
      select: { objectApId: true },
    }),
    prisma.announce.findMany({
      where: { actorApId: viewerApId, objectApId: { in: objectApIds } },
      select: { objectApId: true },
    }),
  ]);

  return {
    likedSet: new Set(likes.map((l) => l.objectApId)),
    bookmarkedSet: new Set(bookmarks.map((b) => b.objectApId)),
    repostedSet: new Set(announces.map((a) => a.objectApId)),
  };
}

// Helper to get blocked and muted users
async function getBlockedAndMutedUsers(
  prisma: ReturnType<typeof import('../lib/db').getPrismaD1>,
  viewerApId: string
): Promise<{ blockedApIds: string[]; mutedApIds: string[] }> {
  if (!viewerApId) {
    return { blockedApIds: [], mutedApIds: [] };
  }

  const [blocks, mutes] = await Promise.all([
    prisma.block.findMany({
      where: { blockerApId: viewerApId },
      select: { blockedApId: true },
      take: MAX_BLOCK_MUTE_FILTER_ENTRIES,
    }),
    prisma.mute.findMany({
      where: { muterApId: viewerApId },
      select: { mutedApId: true },
      take: MAX_BLOCK_MUTE_FILTER_ENTRIES,
    }),
  ]);

  return {
    blockedApIds: blocks.map((b) => b.blockedApId),
    mutedApIds: mutes.map((m) => m.mutedApId),
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
  prisma: ReturnType<typeof import('../lib/db').getPrismaD1>,
  posts: Array<Parameters<typeof formatPost>[0]>,
  viewerApId: string,
): Promise<Record<string, unknown>[]> {
  const authorApIds = posts.map((p) => p.attributedTo);
  const postApIds = posts.map((p) => p.apId);

  const [authorMap, interactions] = await Promise.all([
    batchGetAuthorInfo(prisma, authorApIds),
    batchGetInteractionStatus(prisma, viewerApId, postApIds),
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
  const prisma = c.get('prisma');
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);
  const before = c.req.query('before');
  const communityApId = c.req.query('community');
  const viewerApId = actor?.ap_id || '';

  const { blockedApIds, mutedApIds } = await getBlockedAndMutedUsers(prisma, viewerApId);
  const excludedApIds = buildExcludedApIds(blockedApIds, mutedApIds);

  const posts = await prisma.object.findMany({
    where: {
      type: 'Note',
      visibility: 'public',
      inReplyTo: null,
      audienceJson: '[]',
      ...(excludedApIds.length > 0 ? { attributedTo: { notIn: excludedApIds } } : {}),
      ...(communityApId ? { communityApId } : {}),
      ...(before ? { published: { lt: before } } : {}),
    },
    orderBy: { published: 'desc' },
    take: limit + 1,
    skip: offset,
  });

  const { results, has_more } = paginateResults(posts, limit);
  const result = await resolveAndFormatPosts(prisma, results, viewerApId);

  return c.json({ posts: result, limit, offset, has_more });
});

// Get following timeline
// Supports both cursor (before) and offset pagination
// Returns: posts, limit, offset (if used), has_more
timeline.get('/following', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);
  const before = c.req.query('before');
  const viewerApId = actor.ap_id;

  const [{ blockedApIds, mutedApIds }, follows] = await Promise.all([
    getBlockedAndMutedUsers(prisma, viewerApId),
    prisma.follow.findMany({
      where: { followerApId: viewerApId, status: 'accepted' },
      select: { followingApId: true },
    }),
  ]);

  const excludedApIds = buildExcludedApIds(blockedApIds, mutedApIds);
  const followingApIds = follows.map((f) => f.followingApId);
  const allowedAuthors = [viewerApId, ...followingApIds];

  // Own posts: all visibilities except direct
  // Followed users' posts: public, unlisted, or followers visibility
  const posts = await prisma.object.findMany({
    where: {
      type: 'Note',
      inReplyTo: null,
      audienceJson: '[]',
      attributedTo: { in: allowedAuthors },
      ...(excludedApIds.length > 0 ? { NOT: { attributedTo: { in: excludedApIds } } } : {}),
      ...(before ? { published: { lt: before } } : {}),
      AND: [
        {
          OR: [
            { attributedTo: viewerApId },
            {
              AND: [
                { attributedTo: { not: viewerApId } },
                { visibility: { in: ['public', 'unlisted', 'followers'] } },
              ],
            },
          ],
        },
      ],
    },
    orderBy: { published: 'desc' },
    take: limit + 1,
    skip: offset,
  });

  const { results, has_more } = paginateResults(posts, limit);
  const result = await resolveAndFormatPosts(prisma, results, viewerApId);

  return c.json({ posts: result, limit, offset, has_more });
});

export default timeline;
