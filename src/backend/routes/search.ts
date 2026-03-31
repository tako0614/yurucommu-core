import { Hono } from 'hono';
import { and, eq, or, like, desc, gt, inArray, count } from 'drizzle-orm';
import type { Env, Variables } from '../types.ts';
import { formatUsername, isSafeRemoteUrl, normalizeRemoteDomain, parseLimit, parseOffset, fetchWithTimeout } from '../federation-helpers.ts';
import type { Database } from '../../db/index.ts';
import { actors, actorCache, objects, likes } from '../../db/index.ts';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();
const REMOTE_FETCH_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Sort validation
// ---------------------------------------------------------------------------

const ALLOWED_ACTOR_SORTS = ['relevance', 'followers', 'recent'] as const;
type ActorSort = typeof ALLOWED_ACTOR_SORTS[number];

const ALLOWED_POST_SORTS = ['recent', 'popular'] as const;
type PostSort = typeof ALLOWED_POST_SORTS[number];

function validateSort<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  if (value && (allowed as readonly string[]).includes(value)) return value as T;
  return fallback;
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

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

type ActorInfo = { apId: string; preferredUsername: string | null; name: string | null; iconUrl: string | null };

// ---------------------------------------------------------------------------
// Shared helpers (file-local, not exported)
// ---------------------------------------------------------------------------

/** Build orderBy for post queries. */
function postOrderByDrizzle(sort: PostSort) {
  if (sort === 'popular') return [desc(objects.likeCount), desc(objects.published)];
  return [desc(objects.published)];
}

/** Build a merged author lookup map (local actors take priority over cached). */
async function buildAuthorMap(
  db: Database,
  apIds: string[],
): Promise<Map<string, ActorInfo>> {
  const [localAuthors, cachedAuthors] = await Promise.all([
    db.select({
      apId: actors.apId,
      preferredUsername: actors.preferredUsername,
      name: actors.name,
      iconUrl: actors.iconUrl,
    }).from(actors).where(inArray(actors.apId, apIds)),
    db.select({
      apId: actorCache.apId,
      preferredUsername: actorCache.preferredUsername,
      name: actorCache.name,
      iconUrl: actorCache.iconUrl,
    }).from(actorCache).where(inArray(actorCache.apId, apIds)),
  ]);

  const map = new Map<string, ActorInfo>();
  // Insert cached first so local actors override them
  for (const a of cachedAuthors) map.set(a.apId, a);
  for (const a of localAuthors) map.set(a.apId, a);
  return map;
}

/** Load the set of post AP IDs that a given actor has liked. */
async function loadLikedPostIds(
  db: Database,
  actorApId: string | undefined,
  postApIds: string[],
): Promise<Set<string>> {
  if (!actorApId || postApIds.length === 0) return new Set();

  const likeRows = await db
    .select({ objectApId: likes.objectApId })
    .from(likes)
    .where(and(
      eq(likes.actorApId, actorApId),
      inArray(likes.objectApId, postApIds),
    ));
  return new Set(likeRows.map(l => l.objectApId));
}

type PostRow = { apId: string; attributedTo: string; content: string; published: string | null; likeCount: number };

/** Map a raw post + author map + liked set into the API response shape. */
function formatPost(
  post: PostRow,
  authorMap: Map<string, ActorInfo>,
  likedPostIds: Set<string>,
): {
  ap_id: string;
  author: { ap_id: string; username: string; preferred_username: string | null; name: string | null; icon_url: string | null };
  content: string;
  published: string | null;
  like_count: number;
  liked: boolean;
} {
  const author = authorMap.get(post.attributedTo);
  return {
    ap_id: post.apId,
    author: {
      ap_id: post.attributedTo,
      username: formatUsername(post.attributedTo),
      preferred_username: author?.preferredUsername ?? null,
      name: author?.name ?? null,
      icon_url: author?.iconUrl ?? null,
    },
    content: post.content,
    published: post.published,
    like_count: post.likeCount,
    liked: likedPostIds.has(post.apId),
  };
}

/** Enrich posts with author info and like status, returning formatted API results. */
async function enrichPosts(
  db: Database,
  posts: PostRow[],
  actorApId: string | undefined,
): Promise<ReturnType<typeof formatPost>[]> {
  if (posts.length === 0) return [];

  const authorApIds = [...new Set(posts.map((p) => p.attributedTo))];
  const [authorMap, likedPostIds] = await Promise.all([
    buildAuthorMap(db, authorApIds),
    loadLikedPostIds(db, actorApId, posts.map(p => p.apId)),
  ]);

  return posts.map((p) => formatPost(p, authorMap, likedPostIds));
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * Search local actors by username or name
 * GET /api/search/actors?q=query&sort=relevance|followers|recent
 */
search.get('/actors', async (c) => {
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ actors: [] });

  const db = c.get('db');
  const sort = validateSort(c.req.query('sort'), ALLOWED_ACTOR_SORTS, 'relevance');
  const lowerQuery = query.toLowerCase();

  const orderByClause = sort === 'recent'
    ? [desc(actors.createdAt)]
    : [desc(actors.followerCount)];

  const actorRows = await db
    .select({
      apId: actors.apId,
      preferredUsername: actors.preferredUsername,
      name: actors.name,
      iconUrl: actors.iconUrl,
      summary: actors.summary,
      followerCount: actors.followerCount,
      createdAt: actors.createdAt,
    })
    .from(actors)
    .where(
      or(
        like(actors.preferredUsername, '%' + query + '%'),
        like(actors.name, '%' + query + '%'),
      ),
    )
    .orderBy(...orderByClause)
    .limit(20);

  if (sort === 'relevance') {
    actorRows.sort((a, b) => {
      const aUsername = a.preferredUsername.toLowerCase();
      const bUsername = b.preferredUsername.toLowerCase();

      const aExact = aUsername === lowerQuery ? 0 : 1;
      const bExact = bUsername === lowerQuery ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;

      const aPrefix = aUsername.startsWith(lowerQuery) ? 0 : 1;
      const bPrefix = bUsername.startsWith(lowerQuery) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;

      return b.followerCount - a.followerCount;
    });
  }

  const result = actorRows.map((a) => ({
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
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ posts: [] });

  const actor = c.get('actor');
  const db = c.get('db');
  const sort = validateSort(c.req.query('sort'), ALLOWED_POST_SORTS, 'recent');

  const posts = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      content: objects.content,
      published: objects.published,
      likeCount: objects.likeCount,
    })
    .from(objects)
    .where(and(
      like(objects.content, '%' + query + '%'),
      eq(objects.visibility, 'public'),
      eq(objects.audienceJson, '[]'),
    ))
    .orderBy(...postOrderByDrizzle(sort))
    .limit(50);

  return c.json({ posts: await enrichPosts(db, posts, actor?.ap_id) });
});

/**
 * Search remote actors via WebFinger
 * GET /api/search/remote?q=@user@domain
 */
search.get('/remote', async (c) => {
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ actors: [] });

  const match = query.match(/^@?([^@]+)@([^@]+)$/);
  if (!match) return c.json({ actors: [] });

  const [, username, domain] = match;
  const safeDomain = normalizeRemoteDomain(domain);
  if (!safeDomain) return c.json({ actors: [] });

  try {
    // WebFinger lookup
    const webfingerUrl = `https://${safeDomain}/.well-known/webfinger?resource=acct:${username}@${safeDomain}`;
    const wfRes = await fetchWithTimeout(webfingerUrl, {
      headers: { Accept: 'application/jrd+json' },
      timeout: REMOTE_FETCH_TIMEOUT_MS,
    });
    if (!wfRes.ok) return c.json({ actors: [] });

    const wfData = (await wfRes.json()) as WebFingerResponse;
    const actorLink = wfData.links?.find((l) => l.rel === 'self' && l.type === 'application/activity+json');
    if (!actorLink?.href || !isSafeRemoteUrl(actorLink.href)) return c.json({ actors: [] });

    // Fetch actor profile
    const actorRes = await fetchWithTimeout(actorLink.href, {
      headers: { Accept: 'application/activity+json, application/ld+json' },
      timeout: REMOTE_FETCH_TIMEOUT_MS,
    });
    if (!actorRes.ok) return c.json({ actors: [] });

    const actorData = (await actorRes.json()) as RemoteActor;

    // Cache the actor (upsert: check if exists, then insert or update)
    const db = c.get('db');
    const cacheFields = {
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
    };

    const existing = await db
      .select({ apId: actorCache.apId })
      .from(actorCache)
      .where(eq(actorCache.apId, actorData.id))
      .get();

    if (existing) {
      await db.update(actorCache)
        .set(cacheFields)
        .where(eq(actorCache.apId, actorData.id));
    } else {
      await db.insert(actorCache).values({ apId: actorData.id, ...cacheFields });
    }

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
  const tag = c.req.param('tag')?.trim().replace(/^#/, '');
  if (!tag) return c.json({ posts: [], total: 0 });

  const actor = c.get('actor');
  const db = c.get('db');
  const sort = validateSort(c.req.query('sort'), ALLOWED_POST_SORTS, 'recent');
  const limit = parseLimit(c.req.query('limit'), 50, 100);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);
  const hashtagPattern = `#${tag}`;

  const postWhere = and(
    like(objects.content, '%' + hashtagPattern + '%'),
    eq(objects.visibility, 'public'),
  );

  const [totalResult, posts] = await Promise.all([
    db.select({ count: count() })
      .from(objects)
      .where(postWhere)
      .get(),
    db.select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      content: objects.content,
      published: objects.published,
      likeCount: objects.likeCount,
    })
    .from(objects)
    .where(postWhere)
    .orderBy(...postOrderByDrizzle(sort))
    .offset(offset)
    .limit(limit),
  ]);

  const total = totalResult?.count ?? 0;
  const resultPosts = await enrichPosts(db, posts, actor?.ap_id);

  return c.json({
    posts: resultPosts,
    total,
    limit,
    offset,
    has_more: offset + resultPosts.length < total,
  });
});

/**
 * Get trending hashtags
 * GET /api/search/hashtags/trending?limit=10&days=7
 */
search.get('/hashtags/trending', async (c) => {
  const limit = parseLimit(c.req.query('limit'), 10, 50);
  const days = parseLimit(c.req.query('days'), 7, 30);
  const sinceDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const db = c.get('db');

  const posts = await db
    .select({ content: objects.content })
    .from(objects)
    .where(and(
      eq(objects.visibility, 'public'),
      gt(objects.published, sinceDate),
    ))
    .orderBy(desc(objects.published))
    .limit(1000);

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

  const trending = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tagName, count]) => ({ tag: tagName, count }));

  return c.json({ trending });
});

export default search;
