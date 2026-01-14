// Notifications routes for Yurucommu backend
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

// Get notifications with actor details
notifications.get('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  let query = `
    SELECT n.*,
           COALESCE(a.preferred_username, ac.preferred_username) as actor_username,
           COALESCE(a.name, ac.name) as actor_name,
           COALESCE(a.icon_url, ac.icon_url) as actor_icon_url,
           COALESCE(o.content, '') as object_content
    FROM notifications n
    LEFT JOIN actors a ON n.actor_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON n.actor_ap_id = ac.ap_id
    LEFT JOIN objects o ON n.object_ap_id = o.ap_id
    WHERE n.recipient_ap_id = ?
  `;
  const params: any[] = [actor.ap_id];

  if (before) {
    query += ` AND n.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY n.created_at DESC LIMIT ?`;
  params.push(limit);

  const result = await c.env.DB.prepare(query).bind(...params).all();

  const notifications_list = (result.results || []).map((n: any) => ({
    id: n.id,
    type: n.type,
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
    object_content: n.object_content,
  }));

  return c.json({ notifications: notifications_list });
});

// Get unread notification count
notifications.get('/unread/count', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const result = await c.env.DB.prepare(`
    SELECT COUNT(*) as unread_count FROM notifications
    WHERE recipient_ap_id = ? AND read = 0
  `).bind(actor.ap_id).first<{ unread_count: number }>();

  return c.json({
    count: result?.unread_count || 0,
  });
});

// Mark notifications as read (supports specific IDs or all)
notifications.post('/read', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ids?: string[]; read_all?: boolean }>();

  if (body.read_all) {
    // Mark all notifications as read
    await c.env.DB.prepare(`
      UPDATE notifications SET read = 1
      WHERE recipient_ap_id = ?
    `).bind(actor.ap_id).run();
  } else if (body.ids && body.ids.length > 0) {
    // Mark specific notifications as read
    const placeholders = body.ids.map(() => '?').join(',');
    await c.env.DB.prepare(`
      UPDATE notifications SET read = 1
      WHERE recipient_ap_id = ? AND id IN (${placeholders})
    `).bind(actor.ap_id, ...body.ids).run();
  } else {
    return c.json({ error: 'Either ids array or read_all flag is required' }, 400);
  }

  return c.json({ success: true });
});

export default notifications;
