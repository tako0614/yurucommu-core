import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';

const search = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Search local actors by username or name
 * GET /api/search/actors?q=query
 */
search.get('/actors', async (c) => {
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ actors: [] });

  // Search local actors
  const actors = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, icon_url, summary
    FROM actors
    WHERE preferred_username LIKE ? OR name LIKE ?
    ORDER BY preferred_username ASC
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
 * GET /api/search/posts?q=query
 */
search.get('/posts', async (c) => {
  const actor = c.get('actor');
  const query = c.req.query('q')?.trim();
  if (!query) return c.json({ posts: [] });

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
    ORDER BY o.published DESC
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

  try {
    // WebFinger lookup
    const webfingerUrl = `https://${domain}/.well-known/webfinger?resource=acct:${username}@${domain}`;
    const wfRes = await fetch(webfingerUrl, { headers: { 'Accept': 'application/jrd+json' } });
    if (!wfRes.ok) return c.json({ actors: [] });

    const wfData = await wfRes.json() as any;
    const actorLink = wfData.links?.find((l: any) => l.rel === 'self' && l.type === 'application/activity+json');
    if (!actorLink?.href) return c.json({ actors: [] });

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
        username: `${actorData.preferredUsername}@${domain}`,
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

export default search;
