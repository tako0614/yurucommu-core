import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { communityApId, generateId, formatUsername } from '../../utils';
import { MAX_COMMUNITY_MESSAGE_LENGTH, MAX_COMMUNITY_MESSAGES_LIMIT, managerRoles } from './utils';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

type CommunityRow = {
  ap_id: string;
  post_policy: string | null;
};

type CommunityIdRow = {
  ap_id: string;
};

type CommunityMemberRow = {
  role: 'owner' | 'moderator' | 'member';
};

type CommunityMessageRow = {
  ap_id: string;
  content: string;
  published: string;
  attributed_to: string;
  sender_preferred_username: string | null;
  sender_name: string | null;
  sender_icon_url: string | null;
};

type MessageRow = {
  ap_id: string;
  attributed_to: string;
};

// GET /api/communities/:name/messages - Get chat messages (AP Native: uses objects with audience)
communities.get('/:identifier/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const rawLimit = parseInt(c.req.query('limit') || '50', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_COMMUNITY_MESSAGES_LIMIT)
    : 50;
  const before = c.req.query('before');

  // Get community
  const community = await c.env.DB.prepare('SELECT * FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<CommunityRow>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check membership
  const membership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

  const policy = community.post_policy || 'members';
  const role = membership?.role;
  const isManager = role === 'owner' || role === 'moderator';

  if (policy !== 'anyone' && !membership) {
    return c.json({ error: 'Not a community member' }, 403);
  }
  if (policy === 'mods' && !isManager) {
    return c.json({ error: 'Moderator role required' }, 403);
  }
  if (policy === 'owners' && role !== 'owner') {
    return c.json({ error: 'Owner role required' }, 403);
  }

  // Query objects addressed to this community (via object_recipients or audience_json)
  let query = `
    SELECT o.ap_id, o.content, o.published,
           o.attributed_to,
           COALESCE(a.preferred_username, ac.preferred_username) as sender_preferred_username,
           COALESCE(a.name, ac.name) as sender_name,
           COALESCE(a.icon_url, ac.icon_url) as sender_icon_url
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.type = 'Note'
      AND EXISTS (
        SELECT 1 FROM object_recipients orec
        WHERE orec.object_ap_id = o.ap_id
          AND orec.recipient_ap_id = ?
          AND orec.type = 'audience'
      )
  `;
  const params: Array<string | number | null> = [community.ap_id];

  if (before) {
    query += ' AND o.published < ?';
    params.push(before);
  }

  query += ' ORDER BY o.published DESC LIMIT ?';
  params.push(limit);

  const messages = await c.env.DB.prepare(query).bind(...params).all<CommunityMessageRow>();

  const result = (messages.results || []).reverse().map((msg: CommunityMessageRow) => ({
    id: msg.ap_id,
    sender: {
      ap_id: msg.attributed_to,
      username: formatUsername(msg.attributed_to),
      preferred_username: msg.sender_preferred_username,
      name: msg.sender_name,
      icon_url: msg.sender_icon_url,
    },
    content: msg.content,
    created_at: msg.published,
  }));

  return c.json({ messages: result });
});

// POST /api/communities/:name/messages - Send a chat message (AP Native: creates Note addressed to Group)
communities.post('/:identifier/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json<{ content: string }>();

  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: 'Message content is required' }, 400);
  }
  if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)` }, 400);
  }

  // Check community exists and user is member
  const community = await c.env.DB.prepare('SELECT * FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<CommunityRow>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const membership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

  const policy = community.post_policy || 'members';
  const role = membership?.role;
  const isManager = role === 'owner' || role === 'moderator';

  if (policy !== 'anyone' && !membership) {
    return c.json({ error: 'Not a member' }, 403);
  }
  if (policy === 'mods' && !isManager) {
    return c.json({ error: 'Moderator role required' }, 403);
  }
  if (policy === 'owners' && role !== 'owner') {
    return c.json({ error: 'Owner role required' }, 403);
  }

  const objectId = generateId();
  const objectApId = `${baseUrl}/ap/objects/${objectId}`;
  const now = new Date().toISOString();

  // Create Note object addressed to the Group (AP native)
  // to = [group followers/members], audience = [group]
  const toJson = JSON.stringify([community.ap_id]);
  const audienceJson = JSON.stringify([community.ap_id]);

  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, to_json, audience_json, visibility, published, is_local)
    VALUES (?, 'Note', ?, ?, ?, ?, 'unlisted', ?, 1)
  `).bind(objectApId, actor.ap_id, content, toJson, audienceJson, now).run();

  // Add to object_recipients for efficient querying
  await c.env.DB.prepare(`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (?, ?, 'audience', ?)
  `).bind(objectApId, community.ap_id, now).run();

  // Create Create activity
  const activityId = generateId();
  const activityApId = `${baseUrl}/ap/activities/${activityId}`;
  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, to_json, published, local)
    VALUES (?, 'Create', ?, ?, ?, ?, 1)
  `).bind(activityApId, actor.ap_id, objectApId, toJson, now).run();

  // Update last_message_at
  await c.env.DB.prepare('UPDATE communities SET last_message_at = ? WHERE ap_id = ?')
    .bind(now, community.ap_id).run();

  return c.json({
    message: {
      id: objectApId,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url,
      },
      content,
      created_at: now,
    }
  }, 201);
});

// PATCH /api/communities/:identifier/messages/:messageId - Edit a message
communities.patch('/:identifier/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const messageId = decodeURIComponent(c.req.param('messageId'));
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const body = await c.req.json<{ content: string }>();

  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: 'Message content is required' }, 400);
  }
  if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)` }, 400);
  }

  // Check community exists
  const community = await c.env.DB.prepare('SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<CommunityIdRow>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check message exists and belongs to community
  const message = await c.env.DB.prepare(`
    SELECT o.ap_id, o.attributed_to
    FROM objects o
    JOIN object_recipients orec ON o.ap_id = orec.object_ap_id
    WHERE o.ap_id = ? AND orec.recipient_ap_id = ? AND orec.type = 'audience'
  `).bind(messageId, community.ap_id).first<MessageRow>();

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only author can edit
  if (message.attributed_to !== actor.ap_id) {
    return c.json({ error: 'Only the author can edit this message' }, 403);
  }

  // Update message
  await c.env.DB.prepare(`
    UPDATE objects SET content = ?, updated_at = datetime('now') WHERE ap_id = ?
  `).bind(content, messageId).run();

  return c.json({ success: true });
});

// DELETE /api/communities/:identifier/messages/:messageId - Delete a message
communities.delete('/:identifier/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const messageId = decodeURIComponent(c.req.param('messageId'));
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  // Check community exists
  const community = await c.env.DB.prepare('SELECT ap_id FROM communities WHERE ap_id = ? OR preferred_username = ?')
    .bind(apId, identifier).first<CommunityIdRow>();
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check message exists and belongs to community
  const message = await c.env.DB.prepare(`
    SELECT o.ap_id, o.attributed_to
    FROM objects o
    JOIN object_recipients orec ON o.ap_id = orec.object_ap_id
    WHERE o.ap_id = ? AND orec.recipient_ap_id = ? AND orec.type = 'audience'
  `).bind(messageId, community.ap_id).first<MessageRow>();

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Check permission: author can delete, or moderator/owner can delete any
  const membership = await c.env.DB.prepare(
    'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
  ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRow>();

  const isAuthor = message.attributed_to === actor.ap_id;
  const isManager = membership && managerRoles.has(membership.role);

  if (!isAuthor && !isManager) {
    return c.json({ error: 'Permission denied' }, 403);
  }

  // Delete message
  await c.env.DB.prepare('DELETE FROM object_recipients WHERE object_ap_id = ?').bind(messageId).run();
  await c.env.DB.prepare('DELETE FROM objects WHERE ap_id = ?').bind(messageId).run();

  return c.json({ success: true });
});


export default communities;
