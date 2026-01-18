import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername, isSafeRemoteUrl, normalizeRemoteDomain } from '../utils';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

// Whitelist of allowed sort values for actors
const ALLOWED_ACTOR_SORTS = ['relevance', 'followers', 'recent'] as const;
type ActorSort = typeof ALLOWED_ACTOR_SORTS[number];

// Whitelist of allowed sort values for posts
const ALLOWED_POST_SORTS = ['recent', 'popular'] as const;
type PostSort = typeof ALLOWED_POST_SORTS[number];

// Validate sort parameter against whitelist
function validateActorSort(sort: string | undefined): ActorSort {
  if (sort && ALLOWED_ACTOR_SORTS.includes(sort as ActorSort)) {
    return sort as ActorSort;
  }
  return 'relevance';
}

function validatePostSort(sort: string | undefined): PostSort {
  if (sort && ALLOWED_POST_SORTS.includes(sort as PostSort)) {
    return sort as PostSort;
  }
  return 'recent';
}

type WebFingerLink = {
  rel?: string;
  type?: string;
  href?: string;
};

type WebFingerResponse = {
  links?: WebFingerLink[];
};

type RemoteActor = {
  id: string;
  type?: string;
  preferredUsername?: string;
  name?: string;
  summary?: string;
  icon?: { url?: string };
  inbox?: string;
  outbox?: string;
  publicKey?: { id?: string; publicKeyPem?: string };
};

/**
 * Search local actors by username or name
 * GET /api/search/actors?q=query&sort=relevance|followers|recent
 */
search.get('/actors', async (c) => {
  const query = c.req.query('q')?.trim();
  const sort = validateActorSort(c.req.query('sort'));
  if (!query) return c.json({ actors: [] });

  const prisma = c.get('prisma');
  const lowerQuery = query.toLowerCase();

  // Build orderBy based on sort parameter
  let orderBy: { followerCount?: 'desc'; createdAt?: 'desc'; preferredUsername?: 'asc' };
  switch (sort) {
    case 'followers':
      orderBy = { followerCount: 'desc' };
      break;
    case 'recent':
      orderBy = { createdAt: 'desc' };
      break;
    case 'relevance':
    default:
      // For relevance, we'll fetch and sort in memory
      orderBy = { followerCount: 'desc' };
      break;
  }

  // Fetch actors that match the query
  const actors = await prisma.actor.findMany({
    where: {
      OR: [
        { preferredUsername: { contains: query } },
        { name: { contains: query } },
      ],
    },
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      iconUrl: true,
      summary: true,
      followerCount: true,
      createdAt: true,
    },
    orderBy,
    take: 20,
  });

  // For relevance sorting, sort in memory
  let sortedActors = actors;
  if (sort === 'relevance') {
    sortedActors = actors.sort((a, b) => {
      const aUsername = a.preferredUsername.toLowerCase();
      const bUsername = b.preferredUsername.toLowerCase();

      // Exact match first
      const aExact = aUsername === lowerQuery ? 0 : 1;
      const bExact = bUsername === lowerQuery ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;

      // Prefix match second
      const aPrefix = aUsername.startsWith(lowerQuery) ? 0 : 1;
      const bPrefix = bUsername.startsWith(lowerQuery) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;

      // Then by follower count
      return b.followerCount - a.followerCount;
    });
  }

  const result = sortedActors.map((a) => ({
    ap_id: a.apId,
    preferred_username: a.preferredUsername,
    name: a.name,
    icon_url: a.iconUrl,
    summary: a.summary,
    follower_count: a.followerCount,
    created_at: a.createdAt,
    username: formatUsername(a.apId),
  }));

  return c.json({ actors: result });
});

/**
 * Search posts by content
 * GET /api/search/posts?q=query&sort=recent|popular
 */
search.get('/posts', async (c) => {
  const actor = c.get('actor');
  const query = c.req.query('q')?.trim();
  const sort = validatePostSort(c.req.query('sort'));
  if (!query) return c.json({ posts: [] });

  const prisma = c.get('prisma');

  // Build orderBy based on sort parameter
  let orderBy: { likeCount?: 'desc'; published?: 'desc' }[];
  switch (sort) {
    case 'popular':
      orderBy = [{ likeCount: 'desc' }, { published: 'desc' }];
      break;
    case 'recent':
    default:
      orderBy = [{ published: 'desc' }];
      break;
  }

  // Fetch posts that match the query
  const posts = await prisma.object.findMany({
    where: {
      content: { contains: query },
      visibility: 'public',
      OR: [
        { audienceJson: { equals: '[]' } },
      ],
    },
    orderBy,
    take: 50,
  });

  // Batch load author info to avoid N+1 queries
  const authorApIds = [...new Set(posts.map((p) => p.attributedTo))];

  const [localAuthors, cachedAuthors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  // Create lookup maps
  const localAuthorMap = new Map(localAuthors.map((a) => [a.apId, a]));
  const cachedAuthorMap = new Map(cachedAuthors.map((a) => [a.apId, a]));

  // Batch load likes if user is logged in
  const likedPostIds = new Set<string>();
  if (actor?.ap_id) {
    const postApIds = posts.map((p) => p.apId);
    const likes = await prisma.like.findMany({
      where: {
        actorApId: actor.ap_id,
        objectApId: { in: postApIds },
      },
      select: { objectApId: true },
    });
    likes.forEach((l) => likedPostIds.add(l.objectApId));
  }

  // Map posts to result format
  const result = posts.map((p) => {
    const author = localAuthorMap.get(p.attributedTo) || cachedAuthorMap.get(p.attributedTo);

    return {
      ap_id: p.apId,
      author: {
        ap_id: p.attributedTo,
        username: formatUsername(p.attributedTo),
        preferred_username: author?.preferredUsername || null,
        name: author?.name || null,
        icon_url: author?.iconUrl || null,
      },
      content: p.content,
      published: p.published,
      like_count: p.likeCount,
      liked: likedPostIds.has(p.apId),
    };
  });

  return c.json({ posts: result });
});

/**
 * Search remote actors via WebFinger
 * Parses @user@domain format, fetches and caches actor
 * GET /api/search/remote?q=@user@domain
 */
search.get('/remote', async (c) => {
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ actors: [] });

  // Parse @user@domain format
  const match = query.match(/^@?([^@]+)@([^@]+)$/);
  if (!match) return c.json({ actors: [] });

  const [, username, domain] = match;
  const safeDomain = normalizeRemoteDomain(domain);
  if (!safeDomain) return c.json({ actors: [] });

  try {
    // WebFinger lookup
    const webfingerUrl = `https://${safeDomain}/.well-known/webfinger?resource=acct:${username}@${safeDomain}`;
    const wfRes = await fetch(webfingerUrl, { headers: { Accept: 'application/jrd+json' } });
    if (!wfRes.ok) return c.json({ actors: [] });

    const wfData = (await wfRes.json()) as WebFingerResponse;
    const actorLink = wfData.links?.find((l) => l.rel === 'self' && l.type === 'application/activity+json');
    if (!actorLink?.href) return c.json({ actors: [] });
    if (!isSafeRemoteUrl(actorLink.href)) return c.json({ actors: [] });

    // Fetch actor
    const actorRes = await fetch(actorLink.href, {
      headers: { Accept: 'application/activity+json, application/ld+json' },
    });
    if (!actorRes.ok) return c.json({ actors: [] });

    const actorData = (await actorRes.json()) as RemoteActor;

    // Cache the actor using Prisma upsert
    const prisma = c.get('prisma');
    await prisma.actorCache.upsert({
      where: { apId: actorData.id },
      create: {
        apId: actorData.id,
        type: actorData.type || 'Person',
        preferredUsername: actorData.preferredUsername || null,
        name: actorData.name || null,
        summary: actorData.summary || null,
        iconUrl: actorData.icon?.url || null,
        inbox: actorData.inbox || '',
        outbox: actorData.outbox || null,
        publicKeyId: actorData.publicKey?.id || null,
        publicKeyPem: actorData.publicKey?.publicKeyPem || null,
        rawJson: JSON.stringify(actorData),
      },
      update: {
        type: actorData.type || 'Person',
        preferredUsername: actorData.preferredUsername || null,
        name: actorData.name || null,
        summary: actorData.summary || null,
        iconUrl: actorData.icon?.url || null,
        inbox: actorData.inbox || '',
        outbox: actorData.outbox || null,
        publicKeyId: actorData.publicKey?.id || null,
        publicKeyPem: actorData.publicKey?.publicKeyPem || null,
        rawJson: JSON.stringify(actorData),
      },
    });

    return c.json({
      actors: [
        {
          ap_id: actorData.id,
          username: `${actorData.preferredUsername}@${safeDomain}`,
          preferred_username: actorData.preferredUsername,
          name: actorData.name,
          summary: actorData.summary,
          icon_url: actorData.icon?.url,
        },
      ],
    });
  } catch (e) {
    console.error('Remote search failed:', e);
    return c.json({ actors: [] });
  }
});

/**
 * Search posts by hashtag
 * GET /api/search/hashtag/:tag?sort=recent|popular
 */
search.get('/hashtag/:tag', async (c) => {
  const actor = c.get('actor');
  const tag = c.req.param('tag')?.trim().replace(/^#/, '');
  const sort = validatePostSort(c.req.query('sort'));
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  if (!tag) return c.json({ posts: [], total: 0 });

  const prisma = c.get('prisma');
  const hashtagPattern = `#${tag}`;

  // Build orderBy based on sort parameter
  let orderBy: { likeCount?: 'desc'; published?: 'desc' }[];
  switch (sort) {
    case 'popular':
      orderBy = [{ likeCount: 'desc' }, { published: 'desc' }];
      break;
    case 'recent':
    default:
      orderBy = [{ published: 'desc' }];
      break;
  }

  // Count total matching posts
  const total = await prisma.object.count({
    where: {
      content: { contains: hashtagPattern },
      visibility: 'public',
    },
  });

  // Fetch posts that contain the hashtag
  const posts = await prisma.object.findMany({
    where: {
      content: { contains: hashtagPattern },
      visibility: 'public',
    },
    orderBy,
    skip: offset,
    take: limit,
  });

  // Batch load author info to avoid N+1 queries
  const authorApIds = [...new Set(posts.map((p) => p.attributedTo))];
  const [localAuthors, cachedAuthors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  const localAuthorMap = new Map(localAuthors.map((a) => [a.apId, a]));
  const cachedAuthorMap = new Map(cachedAuthors.map((a) => [a.apId, a]));

  // Batch load likes if user is logged in
  const likedPostIds = new Set<string>();
  if (actor?.ap_id) {
    const postApIds = posts.map((p) => p.apId);
    const likes = await prisma.like.findMany({
      where: {
        actorApId: actor.ap_id,
        objectApId: { in: postApIds },
      },
      select: { objectApId: true },
    });
    likes.forEach((l) => likedPostIds.add(l.objectApId));
  }

  // Map posts to result format
  const result = posts.map((p) => {
    const author = localAuthorMap.get(p.attributedTo) || cachedAuthorMap.get(p.attributedTo);

    return {
      ap_id: p.apId,
      author: {
        ap_id: p.attributedTo,
        username: formatUsername(p.attributedTo),
        preferred_username: author?.preferredUsername || null,
        name: author?.name || null,
        icon_url: author?.iconUrl || null,
      },
      content: p.content,
      published: p.published,
      like_count: p.likeCount,
      liked: likedPostIds.has(p.apId),
    };
  });

  return c.json({
    posts: result,
    total,
    limit,
    offset,
    has_more: offset + result.length < total,
  });
});

/**
 * Get trending hashtags
 * GET /api/search/hashtags/trending?limit=10&days=7
 */
search.get('/hashtags/trending', async (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') || '10'), 50);
  const days = Math.min(parseInt(c.req.query('days') || '7'), 30);

  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const prisma = c.get('prisma');

  // Fetch recent public posts
  const posts = await prisma.object.findMany({
    where: {
      visibility: 'public',
      published: { gt: sinceDate },
    },
    select: { content: true },
    orderBy: { published: 'desc' },
    take: 1000,
  });

  // Extract and count hashtags
  const hashtagCounts: Record<string, number> = {};
  const hashtagRegex = /#([a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+)/g;

  for (const post of posts) {
    const content = post.content || '';
    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
      const tagName = match[1].toLowerCase();
      hashtagCounts[tagName] = (hashtagCounts[tagName] || 0) + 1;
    }
  }

  // Sort by count and take top N
  const trending = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tagName, count]) => ({ tag: tagName, count }));

  return c.json({ trending });
});

export default search;
