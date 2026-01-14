import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { actorApId, getDomain, formatUsername } from '../utils';

const actors = new Hono<{ Bindings: Env; Variables: Variables }>();

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
    const [username, domain] = identifier.replace(/^@/, '').split('@');
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

  const body = await c.req.json<{ name?: string; summary?: string; icon_url?: string; header_url?: string }>();

  const updates: string[] = [];
  const values: any[] = [];

  if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name); }
  if (body.summary !== undefined) { updates.push('summary = ?'); values.push(body.summary); }
  if (body.icon_url !== undefined) { updates.push('icon_url = ?'); values.push(body.icon_url); }
  if (body.header_url !== undefined) { updates.push('header_url = ?'); values.push(body.header_url); }

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
  `).bind(apId).all();

  const result = (followers.results || []).map((f: any) => ({
    ap_id: f.follower_ap_id,
    username: formatUsername(f.follower_ap_id),
    preferred_username: f.preferred_username,
    name: f.name,
    icon_url: f.icon_url,
    summary: f.summary,
  }));

  return c.json({ followers: result });
});

// Get actor's following
actors.get('/:identifier/following', async (c) => {
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : actorApId(baseUrl, identifier);

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
  `).bind(apId).all();

  const result = (following.results || []).map((f: any) => ({
    ap_id: f.following_ap_id,
    username: formatUsername(f.following_ap_id),
    preferred_username: f.preferred_username,
    name: f.name,
    icon_url: f.icon_url,
    summary: f.summary,
  }));

  return c.json({ following: result });
});

export default actors;
