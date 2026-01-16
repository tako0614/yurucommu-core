import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import type { Env, Variables } from '../types';
import { actorApId, getDomain, formatUsername } from '../utils';

const actors = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_ACTOR_POSTS_LIMIT = 100;
const MAX_PROFILE_NAME_LENGTH = 50;
const MAX_PROFILE_SUMMARY_LENGTH = 500;
const MAX_PROFILE_URL_LENGTH = 2000;

function parseLimit(value: string | undefined, fallback: number, max: number): number {
  const parsed = parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), max);
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Helper to resolve identifier to AP ID
async function resolveActorApId(
  c: { env: Env },
  identifier: string
): Promise<string | null> {
  const baseUrl = c.env.APP_URL;

  if (identifier.startsWith('http')) {
    return identifier;
  }

  if (identifier.includes('@')) {
    const stripped = identifier.replace(/^@/, '');
    const parts = stripped.split('@');
    const username = parts[0];
    if (!username) return null;
    if (parts.length === 1) {
      return actorApId(baseUrl, username);
    }
    const domain = parts.slice(1).join('@');
    if (!domain) return null;
    if (domain === getDomain(baseUrl)) {
      return actorApId(baseUrl, username);
    }

    const cached = await c.env.DB.prepare(
      'SELECT ap_id FROM actor_cache WHERE preferred_username = ? AND ap_id LIKE ?'
    ).bind(username, `%${domain}%`).first<any>();
    return cached?.ap_id || null;
  }

  return actorApId(baseUrl, identifier);
}

// Get all local actors
actors.get('/', async (c) => {
  const result = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, summary, icon_url, role, follower_count, following_count, post_count, created_at
    FROM actors ORDER BY created_at ASC
  `).all();

  const actorsList = (result.results || []).map((a: any) => ({
    ...a,
    username: formatUsername(a.ap_id),
  }));

  return c.json({ actors: actorsList });
});

// Get blocked users for current actor
actors.get('/me/blocked', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const result = await c.env.DB.prepare(`
    SELECT b.blocked_ap_id,
           COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
           COALESCE(a.name, ac.name) as name,
           COALESCE(a.icon_url, ac.icon_url) as icon_url,
           COALESCE(a.summary, ac.summary) as summary
    FROM blocks b
    LEFT JOIN actors a ON b.blocked_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON b.blocked_ap_id = ac.ap_id
    WHERE b.blocker_ap_id = ?
    ORDER BY b.created_at DESC
  `).bind(actor.ap_id).all();

  const blocked = (result.results || []).map((u: any) => ({
    ap_id: u.blocked_ap_id,
    username: formatUsername(u.blocked_ap_id),
    preferred_username: u.preferred_username,
    name: u.name,
    icon_url: u.icon_url,
    summary: u.summary,
  }));

  return c.json({ blocked });
});

// Block a user
actors.post('/me/blocked', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  if (body.ap_id === actor.ap_id) return c.json({ error: 'Cannot block yourself' }, 400);

  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO blocks (blocker_ap_id, blocked_ap_id)
    VALUES (?, ?)
  `).bind(actor.ap_id, body.ap_id).run();

  return c.json({ success: true });
});

// Unblock a user
actors.delete('/me/blocked', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);

  await c.env.DB.prepare(`
    DELETE FROM blocks WHERE blocker_ap_id = ? AND blocked_ap_id = ?
  `).bind(actor.ap_id, body.ap_id).run();

  return c.json({ success: true });
});

// Get muted users for current actor
actors.get('/me/muted', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const result = await c.env.DB.prepare(`
    SELECT m.muted_ap_id,
           COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
           COALESCE(a.name, ac.name) as name,
           COALESCE(a.icon_url, ac.icon_url) as icon_url,
           COALESCE(a.summary, ac.summary) as summary
    FROM mutes m
    LEFT JOIN actors a ON m.muted_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON m.muted_ap_id = ac.ap_id
    WHERE m.muter_ap_id = ?
    ORDER BY m.created_at DESC
  `).bind(actor.ap_id).all();

  const muted = (result.results || []).map((u: any) => ({
    ap_id: u.muted_ap_id,
    username: formatUsername(u.muted_ap_id),
    preferred_username: u.preferred_username,
    name: u.name,
    icon_url: u.icon_url,
    summary: u.summary,
  }));

  return c.json({ muted });
});

// Mute a user
actors.post('/me/muted', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  if (body.ap_id === actor.ap_id) return c.json({ error: 'Cannot mute yourself' }, 400);

  await c.env.DB.prepare(`
    INSERT OR IGNORE INTO mutes (muter_ap_id, muted_ap_id)
    VALUES (?, ?)
  `).bind(actor.ap_id, body.ap_id).run();

  return c.json({ success: true });
});

// Unmute a user
actors.delete('/me/muted', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);

  await c.env.DB.prepare(`
    DELETE FROM mutes WHERE muter_ap_id = ? AND muted_ap_id = ?
  `).bind(actor.ap_id, body.ap_id).run();

  return c.json({ success: true });
});

// Delete own account (local only)
actors.post('/me/delete', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const actorApId = actor.ap_id;

  // Remove sessions
  await c.env.DB.prepare('DELETE FROM sessions WHERE member_id = ?').bind(actorApId).run();
  deleteCookie(c, 'session');

  // Remove follow relationships
  await c.env.DB.prepare('DELETE FROM follows WHERE follower_ap_id = ? OR following_ap_id = ?')
    .bind(actorApId, actorApId).run();

  // Remove blocks/mutes
  await c.env.DB.prepare('DELETE FROM blocks WHERE blocker_ap_id = ? OR blocked_ap_id = ?')
    .bind(actorApId, actorApId).run();
  await c.env.DB.prepare('DELETE FROM mutes WHERE muter_ap_id = ? OR muted_ap_id = ?')
    .bind(actorApId, actorApId).run();
  await c.env.DB.prepare('DELETE FROM dm_typing WHERE actor_ap_id = ? OR recipient_ap_id = ?')
    .bind(actorApId, actorApId).run();

  // Remove likes/bookmarks/announces
  await c.env.DB.prepare('DELETE FROM likes WHERE actor_ap_id = ?').bind(actorApId).run();
  await c.env.DB.prepare('DELETE FROM bookmarks WHERE actor_ap_id = ?').bind(actorApId).run();
  await c.env.DB.prepare('DELETE FROM announces WHERE actor_ap_id = ?').bind(actorApId).run();

  // Remove inbox entries
  await c.env.DB.prepare('DELETE FROM inbox WHERE actor_ap_id = ?').bind(actorApId).run();

  // Remove community memberships and adjust member counts
  await c.env.DB.prepare(`
    UPDATE communities
    SET member_count = member_count - 1
    WHERE ap_id IN (SELECT community_ap_id FROM community_members WHERE actor_ap_id = ?)
      AND member_count > 0
  `).bind(actorApId).run();
  await c.env.DB.prepare('DELETE FROM community_members WHERE actor_ap_id = ?').bind(actorApId).run();

  // Remove object recipients and activities related to the actor
  await c.env.DB.prepare('DELETE FROM object_recipients WHERE recipient_ap_id = ?')
    .bind(actorApId).run();
  await c.env.DB.prepare('DELETE FROM activities WHERE actor_ap_id = ?')
    .bind(actorApId).run();

  // Remove objects authored by the actor (posts, stories, DMs)
  await c.env.DB.prepare('DELETE FROM likes WHERE object_ap_id IN (SELECT ap_id FROM objects WHERE attributed_to = ?)')
    .bind(actorApId).run();
  await c.env.DB.prepare('DELETE FROM announces WHERE object_ap_id IN (SELECT ap_id FROM objects WHERE attributed_to = ?)')
    .bind(actorApId).run();
  await c.env.DB.prepare('DELETE FROM bookmarks WHERE object_ap_id IN (SELECT ap_id FROM objects WHERE attributed_to = ?)')
    .bind(actorApId).run();
  await c.env.DB.prepare('DELETE FROM story_votes WHERE story_ap_id IN (SELECT ap_id FROM objects WHERE attributed_to = ?)')
    .bind(actorApId).run();
  await c.env.DB.prepare('DELETE FROM story_views WHERE story_ap_id IN (SELECT ap_id FROM objects WHERE attributed_to = ?)')
    .bind(actorApId).run();
  await c.env.DB.prepare('DELETE FROM objects WHERE attributed_to = ?').bind(actorApId).run();

  // Finally remove actor
  await c.env.DB.prepare('DELETE FROM actors WHERE ap_id = ?').bind(actorApId).run();

  return c.json({ success: true });
});

// Get posts for a specific actor
actors.get('/:identifier/posts', async (c) => {
  const currentActor = c.get('actor');
  const identifier = c.req.param('identifier');
  const apId = await resolveActorApId(c, identifier);
  if (!apId) return c.json({ error: 'Actor not found' }, 404);

  // Ensure actor exists (local or cached)
  const actorExists = await c.env.DB.prepare('SELECT ap_id FROM actors WHERE ap_id = ?')
    .bind(apId).first<any>();
  const cachedExists = actorExists ? null : await c.env.DB.prepare('SELECT ap_id FROM actor_cache WHERE ap_id = ?')
    .bind(apId).first<any>();
  if (!actorExists && !cachedExists) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  const limit = parseLimit(c.req.query('limit'), 20, MAX_ACTOR_POSTS_LIMIT);
  const before = c.req.query('before');

  let query = `
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked,
           EXISTS(SELECT 1 FROM bookmarks b WHERE b.object_ap_id = o.ap_id AND b.actor_ap_id = ?) as bookmarked,
           EXISTS(SELECT 1 FROM announces ann WHERE ann.object_ap_id = o.ap_id AND ann.actor_ap_id = ?) as reposted
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.type = 'Note'
      AND o.in_reply_to IS NULL
      AND o.visibility != 'direct'
      AND o.attributed_to = ?
  `;
  const params: any[] = [currentActor?.ap_id || '', currentActor?.ap_id || '', currentActor?.ap_id || '', apId];

  if (!currentActor || currentActor.ap_id !== apId) {
    query += ` AND o.visibility = 'public'`;
  }

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY o.published DESC LIMIT ?`;
  params.push(limit);

  const posts = await c.env.DB.prepare(query).bind(...params).all();

  const result = (posts.results || []).map((p: any) => ({
    ap_id: p.ap_id,
    type: p.type,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url,
    },
    content: p.content,
    summary: p.summary,
    attachments: JSON.parse(p.attachments_json || '[]'),
    in_reply_to: p.in_reply_to,
    visibility: p.visibility,
    community_ap_id: p.community_ap_id,
    like_count: p.like_count,
    reply_count: p.reply_count,
    announce_count: p.announce_count,
    published: p.published,
    liked: !!p.liked,
    bookmarked: !!p.bookmarked,
    reposted: !!p.reposted,
  }));

  return c.json({ posts: result });
});

// Get actor by AP ID or username
actors.get('/:identifier', async (c) => {
  const currentActor = c.get('actor');
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;

  // Check if identifier is a full AP ID or just username
  let apId: string;
  if (identifier.startsWith('http')) {
    apId = identifier;
  } else if (identifier.includes('@')) {
    // Handle @username@domain format
    const stripped = identifier.replace(/^@/, '');
    const parts = stripped.split('@');
    const username = parts[0];
    if (!username) {
      return c.json({ error: 'Actor not found' }, 404);
    }
    if (parts.length === 1) {
      apId = actorApId(baseUrl, username);
    } else {
      const domain = parts.slice(1).join('@');
      if (!domain) {
        return c.json({ error: 'Actor not found' }, 404);
      }
      if (domain === getDomain(baseUrl)) {
        apId = actorApId(baseUrl, username);
      } else {
        // Remote actor - check cache
        const cached = await c.env.DB.prepare('SELECT * FROM actor_cache WHERE preferred_username = ? AND ap_id LIKE ?')
          .bind(username, `%${domain}%`).first<any>();
        if (cached) {
          return c.json({ actor: { ...cached, username: formatUsername(cached.ap_id as string) } });
        }
        return c.json({ error: 'Actor not found' }, 404);
      }
    }
  } else {
    apId = actorApId(baseUrl, identifier);
  }

  // Try local actors first
  let actor = await c.env.DB.prepare(`
    SELECT ap_id, preferred_username, name, summary, icon_url, header_url, role,
           follower_count, following_count, post_count, is_private, created_at
    FROM actors WHERE ap_id = ?
  `).bind(apId).first<any>();

  if (!actor) {
    // Try actor cache (remote)
    actor = await c.env.DB.prepare('SELECT * FROM actor_cache WHERE ap_id = ?').bind(apId).first();
    if (!actor) return c.json({ error: 'Actor not found' }, 404);
  }

  // Check follow status if logged in
  let is_following = false;
  let is_followed_by = false;

  if (currentActor && currentActor.ap_id !== apId) {
    const followStatus = await c.env.DB.prepare(`
      SELECT
        EXISTS(SELECT 1 FROM follows WHERE follower_ap_id = ? AND following_ap_id = ? AND status = 'accepted') as is_following,
        EXISTS(SELECT 1 FROM follows WHERE follower_ap_id = ? AND following_ap_id = ? AND status = 'accepted') as is_followed_by
    `).bind(currentActor.ap_id, apId, apId, currentActor.ap_id).first<any>();

    if (followStatus) {
      is_following = !!followStatus.is_following;
      is_followed_by = !!followStatus.is_followed_by;
    }
  }

  return c.json({
    actor: {
      ...actor,
      username: formatUsername(actor.ap_id),
      is_following,
      is_followed_by,
    }
  });
});

// Update own profile
actors.put('/me', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ name?: string; summary?: string; icon_url?: string; header_url?: string; is_private?: boolean }>();

  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length > MAX_PROFILE_NAME_LENGTH) {
      return c.json({ error: `Name too long (max ${MAX_PROFILE_NAME_LENGTH} chars)` }, 400);
    }
    updates.push('name = ?');
    values.push(name);
  }
  if (body.summary !== undefined) {
    const summary = body.summary.trim();
    if (summary.length > MAX_PROFILE_SUMMARY_LENGTH) {
      return c.json({ error: `Summary too long (max ${MAX_PROFILE_SUMMARY_LENGTH} chars)` }, 400);
    }
    updates.push('summary = ?');
    values.push(summary.length > 0 ? summary : null);
  }
  if (body.icon_url !== undefined) {
    const iconUrl = body.icon_url.trim();
    if (iconUrl.length > MAX_PROFILE_URL_LENGTH) {
      return c.json({ error: `Icon URL too long (max ${MAX_PROFILE_URL_LENGTH} chars)` }, 400);
    }
    if (iconUrl.length > 0 && !isValidHttpUrl(iconUrl)) {
      return c.json({ error: 'Invalid icon_url' }, 400);
    }
    updates.push('icon_url = ?');
    values.push(iconUrl.length > 0 ? iconUrl : null);
  }
  if (body.header_url !== undefined) {
    const headerUrl = body.header_url.trim();
    if (headerUrl.length > MAX_PROFILE_URL_LENGTH) {
      return c.json({ error: `Header URL too long (max ${MAX_PROFILE_URL_LENGTH} chars)` }, 400);
    }
    if (headerUrl.length > 0 && !isValidHttpUrl(headerUrl)) {
      return c.json({ error: 'Invalid header_url' }, 400);
    }
    updates.push('header_url = ?');
    values.push(headerUrl.length > 0 ? headerUrl : null);
  }
  if (body.is_private !== undefined) { updates.push('is_private = ?'); values.push(body.is_private ? 1 : 0); }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);

  updates.push("updated_at = datetime('now')");
  values.push(actor.ap_id);

  await c.env.DB.prepare(`UPDATE actors SET ${updates.join(', ')} WHERE ap_id = ?`).bind(...values).run();

  return c.json({ success: true });
});

// Get actor's followers
actors.get('/:identifier/followers', async (c) => {
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : actorApId(baseUrl, identifier);
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const followers = await c.env.DB.prepare(`
    SELECT f.follower_ap_id, f.created_at,
           COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
           COALESCE(a.name, ac.name) as name,
           COALESCE(a.icon_url, ac.icon_url) as icon_url,
           COALESCE(a.summary, ac.summary) as summary
    FROM follows f
    LEFT JOIN actors a ON f.follower_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON f.follower_ap_id = ac.ap_id
    WHERE f.following_ap_id = ? AND f.status = 'accepted'
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(apId, limit, offset).all();

  const countResult = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM follows WHERE following_ap_id = ? AND status = 'accepted'"
  ).bind(apId).first<any>();

  const result = (followers.results || []).map((f: any) => ({
    ap_id: f.follower_ap_id,
    username: formatUsername(f.follower_ap_id),
    preferred_username: f.preferred_username,
    name: f.name,
    icon_url: f.icon_url,
    summary: f.summary,
  }));

  return c.json({
    followers: result,
    total: countResult?.total || 0,
    limit,
    offset,
    has_more: offset + result.length < (countResult?.total || 0),
  });
});

// Get actor's following
actors.get('/:identifier/following', async (c) => {
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : actorApId(baseUrl, identifier);
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const following = await c.env.DB.prepare(`
    SELECT f.following_ap_id, f.created_at,
           COALESCE(a.preferred_username, ac.preferred_username) as preferred_username,
           COALESCE(a.name, ac.name) as name,
           COALESCE(a.icon_url, ac.icon_url) as icon_url,
           COALESCE(a.summary, ac.summary) as summary
    FROM follows f
    LEFT JOIN actors a ON f.following_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON f.following_ap_id = ac.ap_id
    WHERE f.follower_ap_id = ? AND f.status = 'accepted'
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).bind(apId, limit, offset).all();

  const countResult = await c.env.DB.prepare(
    "SELECT COUNT(*) as total FROM follows WHERE follower_ap_id = ? AND status = 'accepted'"
  ).bind(apId).first<any>();

  const result = (following.results || []).map((f: any) => ({
    ap_id: f.following_ap_id,
    username: formatUsername(f.following_ap_id),
    preferred_username: f.preferred_username,
    name: f.name,
    icon_url: f.icon_url,
    summary: f.summary,
  }));

  return c.json({
    following: result,
    total: countResult?.total || 0,
    limit,
    offset,
    has_more: offset + result.length < (countResult?.total || 0),
  });
});

export default actors;
