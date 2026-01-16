// Notifications routes for Yurucommu backend
// AP Native: Notifications are derived from inbox (activities addressed to the actor)
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

// Map activity types to notification types
function activityToNotificationType(activityType: string, hasInReplyTo: boolean): string | null {
  switch (activityType) {
    case 'Follow':
      return 'follow';
    case 'Like':
      return 'like';
    case 'Announce':
      return 'announce';
    case 'Create':
      // Create activity for replies or mentions
      return hasInReplyTo ? 'reply' : 'mention';
    default:
      return null;
  }
}

// Get notifications with actor details (AP Native: from inbox + activities)
notifications.get('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  // Query inbox for activities addressed to this actor
  // Exclude own activities (don't notify yourself)
  let query = `
    SELECT
      i.activity_ap_id,
      i.read,
      i.created_at,
      act.type as activity_type,
      act.actor_ap_id,
      act.object_ap_id,
      COALESCE(a.preferred_username, ac.preferred_username) as actor_username,
      COALESCE(a.name, ac.name) as actor_name,
      COALESCE(a.icon_url, ac.icon_url) as actor_icon_url,
      o.content as object_content,
      o.in_reply_to
    FROM inbox i
    JOIN activities act ON i.activity_ap_id = act.ap_id
    LEFT JOIN actors a ON act.actor_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON act.actor_ap_id = ac.ap_id
    LEFT JOIN objects o ON act.object_ap_id = o.ap_id
    WHERE i.actor_ap_id = ?
      AND act.actor_ap_id != ?
      AND act.type IN ('Follow', 'Like', 'Announce', 'Create')
  `;
  const params: any[] = [actor.ap_id, actor.ap_id];

  if (before) {
    query += ` AND i.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY i.created_at DESC LIMIT ?`;
  params.push(limit);

  const result = await c.env.DB.prepare(query).bind(...params).all();

  const notifications_list = (result.results || []).map((n: any) => {
    const notifType = activityToNotificationType(n.activity_type, !!n.in_reply_to);
    return {
      id: n.activity_ap_id,
      type: notifType || n.activity_type.toLowerCase(),
      object_ap_id: n.object_ap_id,
      read: !!n.read,
      created_at: n.created_at,
      actor: {
        ap_id: n.actor_ap_id,
        username: formatUsername(n.actor_ap_id),
        preferred_username: n.actor_username,
        name: n.actor_name,
        icon_url: n.actor_icon_url,
      },
      object_content: n.object_content || '',
    };
  });

  return c.json({ notifications: notifications_list });
});

// Get unread notification count (AP Native: from inbox)
notifications.get('/unread/count', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const result = await c.env.DB.prepare(`
    SELECT COUNT(*) as unread_count
    FROM inbox i
    JOIN activities act ON i.activity_ap_id = act.ap_id
    WHERE i.actor_ap_id = ?
      AND i.read = 0
      AND act.actor_ap_id != ?
      AND act.type IN ('Follow', 'Like', 'Announce', 'Create')
  `).bind(actor.ap_id, actor.ap_id).first<{ unread_count: number }>();

  return c.json({
    count: result?.unread_count || 0,
  });
});

// Mark notifications as read (AP Native: updates inbox)
notifications.post('/read', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ids?: string[]; read_all?: boolean }>();

  if (body.read_all) {
    // Mark all inbox entries as read
    await c.env.DB.prepare(`
      UPDATE inbox SET read = 1
      WHERE actor_ap_id = ?
    `).bind(actor.ap_id).run();
  } else if (body.ids && body.ids.length > 0) {
    // Mark specific activities as read in inbox
    const placeholders = body.ids.map(() => '?').join(',');
    await c.env.DB.prepare(`
      UPDATE inbox SET read = 1
      WHERE actor_ap_id = ? AND activity_ap_id IN (${placeholders})
    `).bind(actor.ap_id, ...body.ids).run();
  } else {
    return c.json({ error: 'Either ids array or read_all flag is required' }, 400);
  }

  return c.json({ success: true });
});

export default notifications;
