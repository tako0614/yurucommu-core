import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

const HOSTNAME_PATTERN = /^[a-z0-9.-]+$/i;

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

  let orderBy = 'preferred_username ASC';
  switch (sort) {
    case 'followers':
      orderBy = 'follower_count DESC, preferred_username ASC';
      break;
    case 'recent':
      orderBy = 'created_at DESC';
      break;
    case 'relevance':
    default:
      // Relevance: exact match first, then prefix match, then contains
      orderBy = `
        CASE
          WHEN LOWER(preferred_username) = LOWER(?) THEN 0
          WHEN LOWER(preferred_username) LIKE LOWER(?) THEN 1
          ELSE 2
        END,
        follower_count DESC
      `.replace(/\s+/g, ' ');
      break;
  }

  const actors = sort === 'relevance'
    ? await c.env.DB.prepare(`
        SELECT ap_id, preferred_username, name, icon_url, summary, follower_count, created_at
        FROM actors
        WHERE preferred_username LIKE ? OR name LIKE ?
        ORDER BY ${orderBy}
        LIMIT 20
      `).bind(query, `${query}%`, `%${query}%`, `%${query}%`).all()
    : await c.env.DB.prepare(`
        SELECT ap_id, preferred_username, name, icon_url, summary, follower_count, created_at
        FROM actors
        WHERE preferred_username LIKE ? OR name LIKE ?
        ORDER BY ${orderBy}
        LIMIT 20
      `).bind(`%${query}%`, `%${query}%`).all();

  const result = (actors.results || []).map((a: any) => ({
    ...a,
    username: formatUsername(a.ap_id),
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

  let orderBy = 'o.published DESC';
  switch (sort) {
    case 'popular':
      orderBy = 'o.like_count DESC, o.published DESC';
      break;
    case 'recent':
    default:
      orderBy = 'o.published DESC';
      break;
  }

  const posts = await c.env.DB.prepare(`
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.content LIKE ? AND o.visibility = 'public'
      AND (o.audience_json IS NULL OR o.audience_json = '[]')
    ORDER BY ${orderBy}
    LIMIT 50
  `).bind(actor?.ap_id || '', `%${query}%`).all();

  const result = (posts.results || []).map((p: any) => ({
    ap_id: p.ap_id,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url,
    },
    content: p.content,
    published: p.published,
    like_count: p.like_count,
    liked: !!p.liked,
  }));

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
    const wfRes = await fetch(webfingerUrl, { headers: { 'Accept': 'application/jrd+json' } });
    if (!wfRes.ok) return c.json({ actors: [] });

    const wfData = await wfRes.json() as any;
    const actorLink = wfData.links?.find((l: any) => l.rel === 'self' && l.type === 'application/activity+json');
    if (!actorLink?.href) return c.json({ actors: [] });
    if (!isSafeRemoteUrl(actorLink.href)) return c.json({ actors: [] });

    // Fetch actor
    const actorRes = await fetch(actorLink.href, {
      headers: { 'Accept': 'application/activity+json, application/ld+json' }
    });
    if (!actorRes.ok) return c.json({ actors: [] });

    const actorData = await actorRes.json() as any;

    // Cache the actor
    await c.env.DB.prepare(`
      INSERT OR REPLACE INTO actor_cache (ap_id, type, preferred_username, name, summary, icon_url, inbox, outbox, public_key_id, public_key_pem, raw_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      actorData.id,
      actorData.type,
      actorData.preferredUsername,
      actorData.name,
      actorData.summary,
      actorData.icon?.url,
      actorData.inbox,
      actorData.outbox,
      actorData.publicKey?.id,
      actorData.publicKey?.publicKeyPem,
      JSON.stringify(actorData)
    ).run();

    return c.json({
      actors: [{
        ap_id: actorData.id,
        username: `${actorData.preferredUsername}@${safeDomain}`,
        preferred_username: actorData.preferredUsername,
        name: actorData.name,
        summary: actorData.summary,
        icon_url: actorData.icon?.url,
      }]
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

  let orderBy = 'o.published DESC';
  switch (sort) {
    case 'popular':
      orderBy = 'o.like_count DESC, o.published DESC';
      break;
    case 'recent':
    default:
      orderBy = 'o.published DESC';
      break;
  }

  // Search for #tag in content (case-insensitive)
  const hashtagPattern = `#${tag}`;

  const countResult = await c.env.DB.prepare(`
    SELECT COUNT(*) as total FROM objects o
    WHERE o.content LIKE ? AND o.visibility = 'public'
  `).bind(`%${hashtagPattern}%`).first<{ total: number }>();

  const posts = await c.env.DB.prepare(`
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.content LIKE ? AND o.visibility = 'public'
    ORDER BY ${orderBy}
    LIMIT ? OFFSET ?
  `).bind(actor?.ap_id || '', `%${hashtagPattern}%`, limit, offset).all();

  const result = (posts.results || []).map((p: any) => ({
    ap_id: p.ap_id,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url,
    },
    content: p.content,
    published: p.published,
    like_count: p.like_count,
    liked: !!p.liked,
  }));

  return c.json({
    posts: result,
    total: countResult?.total || 0,
    limit,
    offset,
    has_more: offset + result.length < (countResult?.total || 0),
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

  // Extract hashtags from recent public posts and count them
  // This is a simple approach - for large scale, a separate hashtag table would be better
  const posts = await c.env.DB.prepare(`
    SELECT content FROM objects
    WHERE visibility = 'public' AND published > ?
    ORDER BY published DESC
    LIMIT 1000
  `).bind(sinceDate).all();

  // Extract and count hashtags
  const hashtagCounts: Record<string, number> = {};
  const hashtagRegex = /#([a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+)/g;

  for (const post of posts.results || []) {
    const content = (post as any).content || '';
    let match;
    while ((match = hashtagRegex.exec(content)) !== null) {
      const tag = match[1].toLowerCase();
      hashtagCounts[tag] = (hashtagCounts[tag] || 0) + 1;
    }
  }

  // Sort by count and take top N
  const trending = Object.entries(hashtagCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));

  return c.json({ trending });
});

export default search;
