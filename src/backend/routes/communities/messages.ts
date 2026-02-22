import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { communityApId, generateId, formatUsername } from '../../utils';
import { MAX_COMMUNITY_MESSAGE_LENGTH, MAX_COMMUNITY_MESSAGES_LIMIT, managerRoles } from './utils';
import { batchLoadActorInfo, fetchCommunityId, memberKey } from './membership-shared';

const communities = new Hono<{ Bindings: Env; Variables: Variables }>();

/** Resolve identifier to apId for community lookup. */
function resolveApId(baseUrl: string, identifier: string): string {
  return identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
}

/** Shared WHERE clause for community lookup by identifier. */
function communityWhere(apId: string, identifier: string) {
  return { OR: [{ apId }, { preferredUsername: identifier }] };
}

/**
 * Enforce post policy against the actor's membership and role.
 * Returns an error message string if denied, or null if allowed.
 */
function checkPostPolicy(
  policy: string,
  membership: { role: string } | null,
): string | null {
  const role = membership?.role;
  const isManager = role === 'owner' || role === 'moderator';

  if (policy !== 'anyone' && !membership) return 'Not a community member';
  if (policy === 'mods' && !isManager) return 'Moderator role required';
  if (policy === 'owners' && role !== 'owner') return 'Owner role required';
  return null;
}

// GET /api/communities/:name/messages - Get chat messages
communities.get('/:identifier/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = resolveApId(baseUrl, identifier);
  const rawLimit = parseInt(c.req.query('limit') || '50', 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_COMMUNITY_MESSAGES_LIMIT)
    : 50;
  const before = c.req.query('before');

  const community = await prisma.community.findFirst({
    where: communityWhere(apId, identifier),
  });
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const membership = await prisma.communityMember.findUnique({
    where: memberKey(community.apId, actor.ap_id),
  });

  const policyError = checkPostPolicy(community.postPolicy || 'members', membership);
  if (policyError) {
    return c.json({ error: policyError }, 403);
  }

  // Query objects addressed to this community (via object_recipients)
  const recipients = await prisma.objectRecipient.findMany({
    where: { recipientApId: community.apId, type: 'audience' },
    select: { objectApId: true },
  });

  const objectApIds = recipients.map((r) => r.objectApId);
  if (objectApIds.length === 0) {
    return c.json({ messages: [] });
  }

  const messages = await prisma.object.findMany({
    where: {
      apId: { in: objectApIds },
      type: 'Note',
      ...(before ? { published: { lt: before } } : {}),
    },
    orderBy: { published: 'desc' },
    take: limit,
  });

  const senderApIds = [...new Set(messages.map((msg) => msg.attributedTo))];
  const actorInfoMap = await batchLoadActorInfo(prisma, senderApIds);

  const result = messages.reverse().map((msg) => {
    const senderInfo = actorInfoMap.get(msg.attributedTo);
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
  });

  return c.json({ messages: result });
});

// POST /api/communities/:name/messages - Send a chat message
communities.post('/:identifier/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const identifier = c.req.param('identifier');
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = resolveApId(baseUrl, identifier);
  const body = await c.req.json<{ content: string }>();

  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: 'Message content is required' }, 400);
  }
  if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)` }, 400);
  }

  const community = await prisma.community.findFirst({
    where: communityWhere(apId, identifier),
  });
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const membership = await prisma.communityMember.findUnique({
    where: memberKey(community.apId, actor.ap_id),
  });

  const policyError = checkPostPolicy(community.postPolicy || 'members', membership);
  if (policyError) {
    return c.json({ error: policyError === 'Not a community member' ? 'Not a member' : policyError }, 403);
  }

  const objectId = generateId();
  const objectApId = `${baseUrl}/ap/objects/${objectId}`;
  const now = new Date().toISOString();

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

  // Using $executeRaw to bypass FK constraint (ObjectRecipient FK expects Actor, not Community)
  await prisma.$executeRaw`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${objectApId}, ${community.apId}, 'audience', ${now})
  `;

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

  const { community } = await fetchCommunityId(c, identifier);
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  const body = await c.req.json<{ content: string }>();
  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: 'Message content is required' }, 400);
  }
  if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
    return c.json({ error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)` }, 400);
  }

  // Check message exists and belongs to community (using $queryRaw since ObjectRecipient FK expects Actor)
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

  if (message.attributedTo !== actor.ap_id) {
    return c.json({ error: 'Only the author can edit this message' }, 403);
  }

  await prisma.object.update({
    where: { apId: messageId },
    data: { content, updated: new Date().toISOString() },
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

  const { community } = await fetchCommunityId(c, identifier);
  if (!community) {
    return c.json({ error: 'Community not found' }, 404);
  }

  // Check message exists and belongs to community
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
    where: memberKey(community.apId, actor.ap_id),
  });

  const isAuthor = message.attributedTo === actor.ap_id;
  const isManager = membership && managerRoles.has(membership.role);

  if (!isAuthor && !isManager) {
    return c.json({ error: 'Permission denied' }, 403);
  }

  await prisma.$executeRaw`DELETE FROM object_recipients WHERE object_ap_id = ${messageId}`;
  await prisma.object.delete({ where: { apId: messageId } });

  return c.json({ success: true });
});


export default communities;
