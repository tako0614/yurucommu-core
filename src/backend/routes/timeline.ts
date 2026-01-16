// Timeline routes for Yurucommu backend
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';

const timeline = new Hono<{ Bindings: Env; Variables: Variables }>();

// Get public timeline
// Supports both cursor (before) and offset pagination
// Returns: posts, limit, offset (if used), has_more
timeline.get('/', async (c) => {
  const actor = c.get('actor');
  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const before = c.req.query('before');
  const communityApId = c.req.query('community');

  const viewerApId = actor?.ap_id || '';

  // Build WHERE clause for reuse
  let whereClause = `o.type = 'Note' AND o.visibility = 'public' AND o.in_reply_to IS NULL
      AND (o.audience_json IS NULL OR o.audience_json = '[]')
      AND NOT EXISTS (
        SELECT 1 FROM blocks b WHERE b.blocker_ap_id = ? AND b.blocked_ap_id = o.attributed_to
      )
      AND NOT EXISTS (
        SELECT 1 FROM mutes m WHERE m.muter_ap_id = ? AND m.muted_ap_id = o.attributed_to
      )`;
  const whereParams: any[] = [viewerApId, viewerApId];

  if (communityApId) {
    whereClause += ` AND o.community_ap_id = ?`;
    whereParams.push(communityApId);
  }

  if (before) {
    whereClause += ` AND o.published < ?`;
    whereParams.push(before);
  }

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
    WHERE ${whereClause}
    ORDER BY o.published DESC
    LIMIT ? OFFSET ?
  `;
  const params: any[] = [viewerApId, viewerApId, viewerApId, ...whereParams, limit + 1, offset];

  const posts = await c.env.DB.prepare(query).bind(...params).all();

  // Check if there are more results
  const results = posts.results || [];
  const has_more = results.length > limit;
  const actualResults = has_more ? results.slice(0, limit) : results;

  const result = actualResults.map((p: any) => ({
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

  return c.json({ posts: result, limit, offset, has_more });
});

// Get following timeline
// Supports both cursor (before) and offset pagination
// Returns: posts, limit, offset (if used), has_more
timeline.get('/following', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const before = c.req.query('before');

  const viewerApId = actor.ap_id;

  // Build WHERE clause
  let whereClause = `o.type = 'Note' AND o.in_reply_to IS NULL
      AND (o.attributed_to IN (
        SELECT following_ap_id FROM follows WHERE follower_ap_id = ? AND status = 'accepted'
      ) OR o.attributed_to = ?)
      AND (
        o.attributed_to = ?
        OR o.visibility IN ('public', 'unlisted', 'followers')
      )
      AND (o.audience_json IS NULL OR o.audience_json = '[]')
      AND NOT EXISTS (
        SELECT 1 FROM blocks b WHERE b.blocker_ap_id = ? AND b.blocked_ap_id = o.attributed_to
      )
      AND NOT EXISTS (
        SELECT 1 FROM mutes m WHERE m.muter_ap_id = ? AND m.muted_ap_id = o.attributed_to
      )`;
  const whereParams: any[] = [viewerApId, viewerApId, viewerApId, viewerApId, viewerApId];

  if (before) {
    whereClause += ` AND o.published < ?`;
    whereParams.push(before);
  }

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
    WHERE ${whereClause}
    ORDER BY o.published DESC
    LIMIT ? OFFSET ?
  `;
  const params: any[] = [viewerApId, viewerApId, viewerApId, ...whereParams, limit + 1, offset];

  const posts = await c.env.DB.prepare(query).bind(...params).all();

  // Check if there are more results
  const results = posts.results || [];
  const has_more = results.length > limit;
  const actualResults = has_more ? results.slice(0, limit) : results;

  const result = actualResults.map((p: any) => ({
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
    like_count: p.like_count,
    reply_count: p.reply_count,
    announce_count: p.announce_count,
    published: p.published,
    liked: !!p.liked,
    bookmarked: !!p.bookmarked,
    reposted: !!p.reposted,
  }));

  return c.json({ posts: result, limit, offset, has_more });
});

export default timeline;
