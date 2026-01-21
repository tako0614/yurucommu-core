// Timeline routes for Yurucommu backend
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername, safeJsonParse } from '../utils';
import { withCache, CacheTTL, CacheTags } from '../middleware/cache';

const timeline = new Hono<{ Bindings: Env; Variables: Variables }>();

type Attachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

// Batch helper to get author info from either local actors or actor cache
// This avoids N+1 queries by fetching all authors at once
async function batchGetAuthorInfo(
  prisma: ReturnType<typeof import('../lib/db').getPrismaD1>,
  apIds: string[]
): Promise<Map<string, { preferredUsername: string | null; name: string | null; iconUrl: string | null }>> {
  if (apIds.length === 0) {
    return new Map();
  }

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

  const result = new Map<string, { preferredUsername: string | null; name: string | null; iconUrl: string | null }>();

  // Add cached actors first
  for (const a of cachedActors) {
    result.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
  }

  // Local actors override cached
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
    }),
    prisma.mute.findMany({
      where: { muterApId: viewerApId },
      select: { mutedApId: true },
    }),
  ]);

  return {
    blockedApIds: blocks.map((b) => b.blockedApId),
    mutedApIds: mutes.map((m) => m.mutedApId),
  };
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
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const before = c.req.query('before');
  const communityApId = c.req.query('community');

  const viewerApId = actor?.ap_id || '';

  // Get blocked and muted users for filtering
  const { blockedApIds, mutedApIds } = await getBlockedAndMutedUsers(prisma, viewerApId);
  const excludedApIds = Array.from(new Set([...blockedApIds, ...mutedApIds]));

  // Build the where clause for objects
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

  // Check if there are more results
  const has_more = posts.length > limit;
  const actualResults = has_more ? posts.slice(0, limit) : posts;

  // Batch fetch author info and interaction status to avoid N+1 queries
  const authorApIds = actualResults.map((p) => p.attributedTo);
  const postApIds = actualResults.map((p) => p.apId);

  const [authorMap, interactions] = await Promise.all([
    batchGetAuthorInfo(prisma, authorApIds),
    batchGetInteractionStatus(prisma, viewerApId, postApIds),
  ]);

  // Map posts to result format
  const result = actualResults.map((p) => {
    const author = authorMap.get(p.attributedTo) || { preferredUsername: null, name: null, iconUrl: null };

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
  });

  return c.json({ posts: result, limit, offset, has_more });
});

// Get following timeline
// Supports both cursor (before) and offset pagination
// Returns: posts, limit, offset (if used), has_more
timeline.get('/following', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const before = c.req.query('before');

  const viewerApId = actor.ap_id;

  // Get blocked and muted users for filtering
  const { blockedApIds, mutedApIds } = await getBlockedAndMutedUsers(prisma, viewerApId);
  const excludedApIds = Array.from(new Set([...blockedApIds, ...mutedApIds]));

  // Get the list of users the viewer is following
  const follows = await prisma.follow.findMany({
    where: { followerApId: viewerApId, status: 'accepted' },
    select: { followingApId: true },
  });
  const followingApIds = follows.map((f) => f.followingApId);

  // Include own posts and followed users' posts
  const allowedAuthors = [viewerApId, ...followingApIds];

  // Build the where clause for objects
  // For own posts: all visibilities except direct
  // For followed users: public, unlisted, or followers visibility
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
            // Own posts (all except direct)
            { attributedTo: viewerApId },
            // Followed users' posts with appropriate visibility
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

  // Check if there are more results
  const has_more = posts.length > limit;
  const actualResults = has_more ? posts.slice(0, limit) : posts;

  // Batch fetch author info and interaction status to avoid N+1 queries
  const authorApIds = actualResults.map((p) => p.attributedTo);
  const postApIds = actualResults.map((p) => p.apId);

  const [authorMap, interactions] = await Promise.all([
    batchGetAuthorInfo(prisma, authorApIds),
    batchGetInteractionStatus(prisma, viewerApId, postApIds),
  ]);

  // Map posts to result format
  const result = actualResults.map((p) => {
    const author = authorMap.get(p.attributedTo) || { preferredUsername: null, name: null, iconUrl: null };

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
      like_count: p.likeCount,
      reply_count: p.replyCount,
      announce_count: p.announceCount,
      published: p.published,
      liked: interactions.likedSet.has(p.apId),
      bookmarked: interactions.bookmarkedSet.has(p.apId),
      reposted: interactions.repostedSet.has(p.apId),
    };
  });

  return c.json({ posts: result, limit, offset, has_more });
});

export default timeline;
