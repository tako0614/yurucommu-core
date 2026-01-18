import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/i;

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

function parseIPv4(hostname: string): number[] | null {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return null;
  const parts = hostname.split('.').map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return null;
  return parts;
}

function isPrivateIPv4(hostname: string): boolean {
  const parts = parseIPv4(hostname);
  if (!parts) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 192 && b === 0 && c === 0) return true;
  if (a === 192 && b === 0 && c === 2) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower.endsWith('.localhost') ||
    lower.endsWith('.local') ||
    lower.endsWith('.localdomain') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }
  if (lower.includes(':')) return true;
  if (isPrivateIPv4(lower)) return true;
  return false;
}

function normalizeRemoteDomain(domain: string): string | null {
  const trimmed = domain.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(`https://${trimmed}`);
    if (parsed.username || parsed.password) return null;
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    const hostname = parsed.hostname;
    if (!HOSTNAME_PATTERN.test(hostname)) return null;
    if (!hostname.includes('.')) return null;
    if (isBlockedHostname(hostname)) return null;
    return parsed.host;
  } catch {
    return null;
  }
}

function isSafeRemoteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.username || parsed.password) return false;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    if (!HOSTNAME_PATTERN.test(parsed.hostname)) return false;
    if (isBlockedHostname(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * Search local actors by username or name
 * GET /api/search/actors?q=query&sort=relevance|followers|recent
 */
search.get('/actors', async (c) => {
  const query = c.req.query('q')?.trim();
  const sort = c.req.query('sort') || 'relevance';
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
  const sort = c.req.query('sort') || 'recent';
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

  // Fetch author info and like status for each post
  const result = await Promise.all(
    posts.map(async (p) => {
      // Try local actor first
      const localAuthor = await prisma.actor.findUnique({
        where: { apId: p.attributedTo },
        select: { preferredUsername: true, name: true, iconUrl: true },
      });

      // Try cached actor if not local
      const cachedAuthor = localAuthor
        ? null
        : await prisma.actorCache.findUnique({
            where: { apId: p.attributedTo },
            select: { preferredUsername: true, name: true, iconUrl: true },
          });

      const author = localAuthor || cachedAuthor;

      // Check if current user has liked this post
      let liked = false;
      if (actor?.ap_id) {
        const likeExists = await prisma.like.findUnique({
          where: {
            actorApId_objectApId: {
              actorApId: actor.ap_id,
              objectApId: p.apId,
            },
          },
        });
        liked = !!likeExists;
      }

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
        liked,
      };
    })
  );

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
  const sort = c.req.query('sort') || 'recent';
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

  // Fetch author info and like status for each post
  const result = await Promise.all(
    posts.map(async (p) => {
      // Try local actor first
      const localAuthor = await prisma.actor.findUnique({
        where: { apId: p.attributedTo },
        select: { preferredUsername: true, name: true, iconUrl: true },
      });

      // Try cached actor if not local
      const cachedAuthor = localAuthor
        ? null
        : await prisma.actorCache.findUnique({
            where: { apId: p.attributedTo },
            select: { preferredUsername: true, name: true, iconUrl: true },
          });

      const author = localAuthor || cachedAuthor;

      // Check if current user has liked this post
      let liked = false;
      if (actor?.ap_id) {
        const likeExists = await prisma.like.findUnique({
          where: {
            actorApId_objectApId: {
              actorApId: actor.ap_id,
              objectApId: p.apId,
            },
          },
        });
        liked = !!likeExists;
      }

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
        liked,
      };
    })
  );

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
