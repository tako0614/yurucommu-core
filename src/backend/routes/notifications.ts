// Notifications routes for Yurucommu backend
// AP Native: Notifications are derived from inbox (activities addressed to the actor)
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

// Map activity types to notification types
function activityToNotificationType(activityType: string, hasInReplyTo: boolean, followStatus?: string | null): string | null {
  switch (activityType) {
    case 'Follow':
      return followStatus === 'pending' ? 'follow_request' : 'follow';
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
// Supports ?type=follow|like|announce|reply|mention filter
// Supports ?archived=true to show archived notifications
notifications.get('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const before = c.req.query('before');
  const typeFilter = c.req.query('type'); // follow, like, announce, reply, mention
  const showArchived = c.req.query('archived') === 'true';

  // Map filter type to activity types
  const typeToActivityType: Record<string, string[]> = {
    'follow': ['Follow'],
    'like': ['Like'],
    'announce': ['Announce'],
    'reply': ['Create'], // Create with in_reply_to
    'mention': ['Create'], // Create without in_reply_to
  };

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
      f.status as follow_status,
      COALESCE(a.preferred_username, ac.preferred_username) as actor_username,
      COALESCE(a.name, ac.name) as actor_name,
      COALESCE(a.icon_url, ac.icon_url) as actor_icon_url,
      o.content as object_content,
      o.in_reply_to,
      EXISTS(SELECT 1 FROM notification_archived na WHERE na.actor_ap_id = ? AND na.activity_ap_id = i.activity_ap_id) as is_archived
    FROM inbox i
    JOIN activities act ON i.activity_ap_id = act.ap_id
    LEFT JOIN actors a ON act.actor_ap_id = a.ap_id
    LEFT JOIN actor_cache ac ON act.actor_ap_id = ac.ap_id
    LEFT JOIN objects o ON act.object_ap_id = o.ap_id
    LEFT JOIN follows f ON f.activity_ap_id = act.ap_id
    WHERE i.actor_ap_id = ?
      AND act.actor_ap_id != ?
      AND act.type IN ('Follow', 'Like', 'Announce', 'Create')
  `;
  const params: any[] = [actor.ap_id, actor.ap_id, actor.ap_id];

  // Filter by type
  if (typeFilter && typeToActivityType[typeFilter]) {
    const actTypes = typeToActivityType[typeFilter];
    query += ` AND act.type IN (${actTypes.map(() => '?').join(',')})`;
    params.push(...actTypes);

    // For reply vs mention distinction
    if (typeFilter === 'reply') {
      query += ` AND o.in_reply_to IS NOT NULL`;
    } else if (typeFilter === 'mention') {
      query += ` AND (o.in_reply_to IS NULL OR act.type != 'Create')`;
    }
  }

  // Filter archived
  if (showArchived) {
    query += ` AND EXISTS(SELECT 1 FROM notification_archived na WHERE na.actor_ap_id = ? AND na.activity_ap_id = i.activity_ap_id)`;
    params.push(actor.ap_id);
  } else {
    query += ` AND NOT EXISTS(SELECT 1 FROM notification_archived na WHERE na.actor_ap_id = ? AND na.activity_ap_id = i.activity_ap_id)`;
    params.push(actor.ap_id);
  }

  if (before) {
    query += ` AND i.created_at < ?`;
    params.push(before);
  }

  query += ` ORDER BY i.created_at DESC LIMIT ? OFFSET ?`;
  params.push(limit + 1, offset);

  const result = await c.env.DB.prepare(query).bind(...params).all();

  // Check if there are more results
  const results = result.results || [];
  const has_more = results.length > limit;
  const actualResults = has_more ? results.slice(0, limit) : results;

  const notifications_list = actualResults.map((n: any) => {
    const notifType = activityToNotificationType(n.activity_type, !!n.in_reply_to, n.follow_status);
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

  return c.json({ notifications: notifications_list, limit, offset, has_more });
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

// Archive notifications
notifications.post('/archive', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ids: string[] }>();
  if (!body.ids || body.ids.length === 0) {
    return c.json({ error: 'ids array is required' }, 400);
  }

  const now = new Date().toISOString();
  for (const id of body.ids) {
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO notification_archived (actor_ap_id, activity_ap_id, archived_at)
      VALUES (?, ?, ?)
    `).bind(actor.ap_id, id, now).run();
  }

  return c.json({ success: true, archived_count: body.ids.length });
});

// Unarchive notifications
notifications.delete('/archive', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ids: string[] }>();
  if (!body.ids || body.ids.length === 0) {
    return c.json({ error: 'ids array is required' }, 400);
  }

  const placeholders = body.ids.map(() => '?').join(',');
  await c.env.DB.prepare(`
    DELETE FROM notification_archived WHERE actor_ap_id = ? AND activity_ap_id IN (${placeholders})
  `).bind(actor.ap_id, ...body.ids).run();

  return c.json({ success: true });
});

// Archive all notifications
notifications.post('/archive/all', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const now = new Date().toISOString();

  // Get all activity IDs from inbox
  const activities = await c.env.DB.prepare(`
    SELECT activity_ap_id FROM inbox WHERE actor_ap_id = ?
  `).bind(actor.ap_id).all();

  let archived_count = 0;
  for (const a of activities.results || []) {
    await c.env.DB.prepare(`
      INSERT OR IGNORE INTO notification_archived (actor_ap_id, activity_ap_id, archived_at)
      VALUES (?, ?, ?)
    `).bind(actor.ap_id, (a as any).activity_ap_id, now).run();
    archived_count++;
  }

  return c.json({ success: true, archived_count });
});

export default notifications;
