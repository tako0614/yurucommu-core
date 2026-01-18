import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { communityApId, generateId, formatUsername } from '../../utils';
import { MAX_COMMUNITY_MESSAGE_LENGTH, MAX_COMMUNITY_MESSAGES_LIMIT, managerRoles } from './utils';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

// GET /api/communities/:name/messages - Get chat messages (AP Native: uses objects with audience)
communities.get('/:identifier/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
  const rawLimit = parseInt(c.req.query('limit') || '50', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_COMMUNITY_MESSAGES_LIMIT)
    : 50;
  const before = c.req.query('before');

  // Get community
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier },
      ],
    },
  });
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check membership
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityApId_actorApId: {
        communityApId: community.apId,
        actorApId: actor.ap_id,
      },
    },
  });

  const policy = community.postPolicy || 'members';
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

  // Query objects addressed to this community (via object_recipients)
  // First get the object_ap_ids from object_recipients with type 'audience'
  const recipients = await prisma.objectRecipient.findMany({
    where: {
      recipientApId: community.apId,
      type: 'audience',
    },
    select: { objectApId: true },
  });

  const objectApIds = recipients.map((r) => r.objectApId);

  if (objectApIds.length === 0) {
    return c.json({ messages: [] });
  }

  // Query objects that are Notes and addressed to this community
  const messages = await prisma.object.findMany({
    where: {
      apId: { in: objectApIds },
      type: 'Note',
      ...(before ? { published: { lt: before } } : {}),
    },
    orderBy: { published: 'desc' },
    take: limit,
  });

  // Get sender info for each message
  const result = await Promise.all(
    messages.reverse().map(async (msg) => {
      const localActor = await prisma.actor.findUnique({
        where: { apId: msg.attributedTo },
        select: { preferredUsername: true, name: true, iconUrl: true },
      });
      const cachedActor = localActor
        ? null
        : await prisma.actorCache.findUnique({
            where: { apId: msg.attributedTo },
            select: { preferredUsername: true, name: true, iconUrl: true },
          });
      const senderInfo = localActor || cachedActor;

      return {
        id: msg.apId,
        sender: {
          ap_id: msg.attributedTo,
          username: formatUsername(msg.attributedTo),
          preferred_username: senderInfo?.preferredUsername || null,
          name: senderInfo?.name || null,
          icon_url: senderInfo?.iconUrl || null,
        },
        content: msg.content,
        created_at: msg.published,
      };
    })
  );

  return c.json({ messages: result });
});

// POST /api/communities/:name/messages - Send a chat message (AP Native: creates Note addressed to Group)
communities.post('/:identifier/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const prisma = c.get('prisma');
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
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier },
      ],
    },
  });
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const membership = await prisma.communityMember.findUnique({
    where: {
      communityApId_actorApId: {
        communityApId: community.apId,
        actorApId: actor.ap_id,
      },
    },
  });

  const policy = community.postPolicy || 'members';
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
  const toJson = JSON.stringify([community.apId]);
  const audienceJson = JSON.stringify([community.apId]);

  await prisma.object.create({
    data: {
      apId: objectApId,
      type: 'Note',
      attributedTo: actor.ap_id,
      content,
      toJson,
      audienceJson,
      visibility: 'unlisted',
      published: now,
      isLocal: 1,
    },
  });

  // Add to object_recipients for efficient querying
  // Note: ObjectRecipient has a FK relation to Actor, but community is not an Actor
  // Using $executeRaw to bypass FK constraint
  await prisma.$executeRaw`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${objectApId}, ${community.apId}, 'audience', ${now})
  `;

  // Create Create activity
  const activityId = generateId();
  const activityApIdVal = `${baseUrl}/ap/activities/${activityId}`;
  await prisma.activity.create({
    data: {
      apId: activityApIdVal,
      type: 'Create',
      actorApId: actor.ap_id,
      objectApId,
      rawJson: JSON.stringify({ to: JSON.parse(toJson) }),
    },
  });

  // Update last_message_at
  await prisma.community.update({
    where: { apId: community.apId },
    data: { lastMessageAt: now },
  });

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
  const prisma = c.get('prisma');
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
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier },
      ],
    },
    select: { apId: true },
  });
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check message exists and belongs to community (via object_recipients)
  // Using $queryRaw since ObjectRecipient FK expects Actor, not Community
  const recipients = await prisma.$queryRaw<Array<{ object_ap_id: string }>>`
    SELECT object_ap_id FROM object_recipients
    WHERE object_ap_id = ${messageId} AND recipient_ap_id = ${community.apId} AND type = 'audience'
    LIMIT 1
  `;

  if (recipients.length === 0) {
    return c.json({ error: 'Message not found' }, 404);
  }

  const message = await prisma.object.findUnique({
    where: { apId: messageId },
    select: { apId: true, attributedTo: true },
  });

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Only author can edit
  if (message.attributedTo !== actor.ap_id) {
    return c.json({ error: 'Only the author can edit this message' }, 403);
  }

  // Update message
  await prisma.object.update({
    where: { apId: messageId },
    data: {
      content,
      updated: new Date().toISOString(),
    },
  });

  return c.json({ success: true });
});

// DELETE /api/communities/:identifier/messages/:messageId - Delete a message
communities.delete('/:identifier/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const messageId = decodeURIComponent(c.req.param('messageId'));
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);

  // Check community exists
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier },
      ],
    },
    select: { apId: true },
  });
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check message exists and belongs to community
  // Using $queryRaw since ObjectRecipient FK expects Actor, not Community
  const recipientsForDelete = await prisma.$queryRaw<Array<{ object_ap_id: string }>>`
    SELECT object_ap_id FROM object_recipients
    WHERE object_ap_id = ${messageId} AND recipient_ap_id = ${community.apId} AND type = 'audience'
    LIMIT 1
  `;

  if (recipientsForDelete.length === 0) {
    return c.json({ error: 'Message not found' }, 404);
  }

  const message = await prisma.object.findUnique({
    where: { apId: messageId },
    select: { apId: true, attributedTo: true },
  });

  if (!message) {
    return c.json({ error: 'Message not found' }, 404);
  }

  // Check permission: author can delete, or moderator/owner can delete any
  const membership = await prisma.communityMember.findUnique({
    where: {
      communityApId_actorApId: {
        communityApId: community.apId,
        actorApId: actor.ap_id,
      },
    },
  });

  const isAuthor = message.attributedTo === actor.ap_id;
  const isManager = membership && managerRoles.has(membership.role);

  if (!isAuthor && !isManager) {
    return c.json({ error: 'Permission denied' }, 403);
  }

  // Delete message - use $executeRaw for object_recipients since FK expects Actor, not Community
  await prisma.$executeRaw`DELETE FROM object_recipients WHERE object_ap_id = ${messageId}`;
  await prisma.object.delete({ where: { apId: messageId } });

  return c.json({ success: true });
});


export default communities;
