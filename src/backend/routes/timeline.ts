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

// Helper to get author info from either local actors or actor cache
async function getAuthorInfo(
  prisma: ReturnType<typeof import('../lib/db').getPrismaD1>,
  apId: string
): Promise<{ preferredUsername: string | null; name: string | null; iconUrl: string | null }> {
  const localActor = await prisma.actor.findUnique({
    where: { apId },
    select: { preferredUsername: true, name: true, iconUrl: true },
  });
  if (localActor) return localActor;

  const cachedActor = await prisma.actorCache.findUnique({
    where: { apId },
    select: { preferredUsername: true, name: true, iconUrl: true },
  });
  return cachedActor || { preferredUsername: null, name: null, iconUrl: null };
}

// Helper to check interaction status
async function getInteractionStatus(
  prisma: ReturnType<typeof import('../lib/db').getPrismaD1>,
  viewerApId: string,
  objectApId: string
): Promise<{ liked: boolean; bookmarked: boolean; reposted: boolean }> {
  if (!viewerApId) {
    return { liked: false, bookmarked: false, reposted: false };
  }

  const [likeExists, bookmarkExists, announceExists] = await Promise.all([
    prisma.like.findUnique({
      where: { actorApId_objectApId: { actorApId: viewerApId, objectApId } },
      select: { actorApId: true },
    }),
    prisma.bookmark.findUnique({
      where: { actorApId_objectApId: { actorApId: viewerApId, objectApId } },
      select: { actorApId: true },
    }),
    prisma.announce.findUnique({
      where: { actorApId_objectApId: { actorApId: viewerApId, objectApId } },
      select: { actorApId: true },
    }),
  ]);

  return {
    liked: !!likeExists,
    bookmarked: !!bookmarkExists,
    reposted: !!announceExists,
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

  // Get author info and interaction status for each post
  const result = await Promise.all(
    actualResults.map(async (p) => {
      const [author, interactions] = await Promise.all([
        getAuthorInfo(prisma, p.attributedTo),
        getInteractionStatus(prisma, viewerApId, p.apId),
      ]);

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
        liked: interactions.liked,
        bookmarked: interactions.bookmarked,
        reposted: interactions.reposted,
      };
    })
  );

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

  // Get author info and interaction status for each post
  const result = await Promise.all(
    actualResults.map(async (p) => {
      const [author, interactions] = await Promise.all([
        getAuthorInfo(prisma, p.attributedTo),
        getInteractionStatus(prisma, viewerApId, p.apId),
      ]);

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
        liked: interactions.liked,
        bookmarked: interactions.bookmarked,
        reposted: interactions.reposted,
      };
    })
  );

  return c.json({ posts: result, limit, offset, has_more });
});

export default timeline;
