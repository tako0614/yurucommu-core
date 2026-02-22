// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, formatUsername, isLocal, safeJsonParse } from '../../utils';
import { MAX_DM_CONTENT_LENGTH, MAX_DM_PAGE_LIMIT, getConversationId, parseLimit } from './utils';
import { enqueueDeliveryToActor } from '../../lib/delivery/queue';

const dm = new Hono<{ Bindings: Env; Variables: Variables }>();

type Attachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

// --- Shared helpers (file-local) ---

const ACTOR_INFO_SELECT = {
  apId: true,
  preferredUsername: true,
  name: true,
  iconUrl: true,
} as const;

type ActorInfo = { apId: string; preferredUsername: string | null; name: string | null; iconUrl: string | null };

/** Validate trimmed DM content; returns the trimmed string or an error response. */
function validateContent(raw: string | undefined): string | { error: string; status: 400 } {
  const content = raw?.trim();
  if (!content) return { error: 'Message content is required', status: 400 };
  if (content.length > MAX_DM_CONTENT_LENGTH) {
    return { error: `Message too long (max ${MAX_DM_CONTENT_LENGTH} chars)`, status: 400 };
  }
  return content;
}

/** Fetch direct messages the actor is authorized to see, filtered by conversation. */
async function fetchAuthorizedMessages(
  prisma: any,
  actorApId: string,
  conversationId: string,
  limit: number,
  before: string | undefined,
): Promise<Array<any>> {
  const actorApIdJson = JSON.stringify(actorApId);

  const whereClause: Record<string, unknown> = {
    visibility: 'direct',
    type: 'Note',
    conversation: conversationId,
    OR: [
      { attributedTo: actorApId },
      { toJson: { contains: actorApIdJson } },
    ],
  };

  if (before) {
    whereClause.published = { lt: before };
  }

  const messages = await prisma.object.findMany({
    where: whereClause,
    orderBy: { published: 'desc' },
    take: limit,
  });

  // Defence-in-depth: re-validate authorization at the code level
  return messages.filter((msg: any) => {
    if (msg.attributedTo === actorApId) return true;
    const toRecipients = safeJsonParse<string[]>(msg.toJson, []);
    return toRecipients.includes(actorApId);
  });
}

/** Build a map from ap_id -> actor info, checking local actors then cached actors. */
async function resolveAuthorInfoMap(
  prisma: any,
  authorApIds: string[],
): Promise<Map<string, ActorInfo>> {
  const localActors: ActorInfo[] = await prisma.actor.findMany({
    where: { apId: { in: authorApIds } },
    select: ACTOR_INFO_SELECT,
  });
  const localMap = new Map(localActors.map((a) => [a.apId, a]));

  const remoteApIds = authorApIds.filter((id) => !localMap.has(id));
  if (remoteApIds.length > 0) {
    const cached: ActorInfo[] = await prisma.actorCache.findMany({
      where: { apId: { in: remoteApIds } },
      select: ACTOR_INFO_SELECT,
    });
    for (const a of cached) {
      localMap.set(a.apId, a);
    }
  }

  return localMap;
}

/** Map raw DB message rows to the API response shape (chronological order). */
function formatMessages(
  messages: any[],
  authorMap: Map<string, ActorInfo>,
): Array<{
  id: string;
  sender: { ap_id: string; username: string; preferred_username: string | null; name: string | null; icon_url: string | null };
  content: string | null;
  attachments?: Attachment[];
  created_at: string | null;
}> {
  return messages.reverse().map((msg) => {
    const info = authorMap.get(msg.attributedTo);
    return {
      id: msg.apId,
      sender: {
        ap_id: msg.attributedTo,
        username: formatUsername(msg.attributedTo),
        preferred_username: info?.preferredUsername || null,
        name: info?.name || null,
        icon_url: info?.iconUrl || null,
      },
      content: msg.content,
      attachments: safeJsonParse<Attachment[]>(msg.attachmentsJson, []),
      created_at: msg.published,
    };
  });
}

/** Look up a direct-message Note that the actor owns (for edit/delete). */
async function findOwnedDmMessage(
  prisma: any,
  messageId: string,
  actorApId: string,
): Promise<{ apId: string; attributedTo: string; conversation: string | null } | { error: string; status: 403 | 404 }> {
  const message = await prisma.object.findFirst({
    where: { apId: messageId, visibility: 'direct', type: 'Note' },
    select: { apId: true, attributedTo: true, conversation: true },
  });
  if (!message) return { error: 'Message not found', status: 404 };
  if (message.attributedTo !== actorApId) return { error: 'Forbidden', status: 403 };
  return message;
}

// --- Route handlers ---

dm.get('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  const limit = parseLimit(c.req.query('limit'), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query('before');
  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

  const filteredMessages = await fetchAuthorizedMessages(prisma, actor.ap_id, conversationId, limit, before);
  const authorApIds = [...new Set(filteredMessages.map((m: any) => m.attributedTo))];
  const authorMap = await resolveAuthorInfoMap(prisma, authorApIds);
  const result = formatMessages(filteredMessages, authorMap);

  return c.json({ messages: result, conversation_id: conversationId });
});

// Send message to a specific user (creates Note with direct visibility)
dm.post('/user/:encodedApId/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const otherApId = decodeURIComponent(c.req.param('encodedApId'));
  const body = await c.req.json<{ content: string }>();
  const baseUrl = c.env.APP_URL;

  const contentOrError = validateContent(body.content);
  if (typeof contentOrError !== 'string') {
    return c.json({ error: contentOrError.error }, contentOrError.status);
  }
  const content = contentOrError;

  // Verify other user exists (check both local actors and cached remote actors)
  const localActor = await prisma.actor.findUnique({
    where: { apId: otherApId },
    select: { apId: true, inbox: true },
  });
  const cachedActor = !localActor
    ? await prisma.actorCache.findUnique({
        where: { apId: otherApId },
        select: { apId: true, inbox: true },
      })
    : null;

  const otherActor = localActor || cachedActor;
  if (!otherActor) return c.json({ error: 'User not found' }, 404);

  const messageId = generateId();
  const apId = objectApId(baseUrl, messageId);
  const now = new Date().toISOString();
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

  const toJson = JSON.stringify([otherApId]);
  const ccJson = JSON.stringify([]);

  const isRecipientLocal = !!localActor;
  const localActivityId = isRecipientLocal ? activityApId(baseUrl, generateId()) : null;
  const remoteActivityId = !isRecipientLocal ? activityApId(baseUrl, generateId()) : null;
  const remoteCreateActivity = remoteActivityId
    ? {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: remoteActivityId,
        type: 'Create',
        actor: actor.ap_id,
        to: [otherApId],
        object: {
          id: apId,
          type: 'Note',
          attributedTo: actor.ap_id,
          to: [otherApId],
          content,
          published: now,
          conversation: conversationId,
        },
      }
    : null;

  try {
    await prisma.$transaction(async (tx: any) => {
      await tx.object.create({
        data: {
          apId,
          type: 'Note',
          attributedTo: actor.ap_id,
          content,
          visibility: 'direct',
          toJson,
          ccJson,
          conversation: conversationId,
          published: now,
          isLocal: 1,
        },
      });

      if (isRecipientLocal) {
        await tx.objectRecipient.upsert({
          where: { objectApId_recipientApId: { objectApId: apId, recipientApId: otherApId } },
          create: { objectApId: apId, recipientApId: otherApId, type: 'to' },
          update: {},
        });

        await tx.activity.create({
          data: {
            apId: localActivityId!,
            type: 'Create',
            actorApId: actor.ap_id,
            objectApId: apId,
            rawJson: JSON.stringify({ type: 'Create', actor: actor.ap_id, object: apId }),
            direction: 'inbound',
          },
        });

        await tx.inbox.create({
          data: { actorApId: otherApId, activityApId: localActivityId! },
        });
      } else if (remoteActivityId && remoteCreateActivity) {
        await tx.activity.create({
          data: {
            apId: remoteActivityId,
            type: 'Create',
            actorApId: actor.ap_id,
            objectApId: apId,
            rawJson: JSON.stringify(remoteCreateActivity),
            direction: 'outbound',
          },
        });
      }
    });
  } catch (e) {
    console.error('[DM] Failed to insert message:', e);
    return c.json({ error: 'Failed to send message' }, 500);
  }

  if (!isLocal(otherApId, baseUrl) && remoteActivityId) {
    await enqueueDeliveryToActor(c.env, remoteActivityId, otherApId);
  }

  return c.json({
    message: {
      id: apId,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url,
      },
      content,
      created_at: now,
    },
    conversation_id: conversationId,
  }, 201);
});

// Edit a DM message
dm.patch('/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ content: string }>();

  const contentOrError = validateContent(body.content);
  if (typeof contentOrError !== 'string') {
    return c.json({ error: contentOrError.error }, contentOrError.status);
  }
  const content = contentOrError;

  const messageOrError = await findOwnedDmMessage(prisma, c.req.param('messageId'), actor.ap_id);
  if ('error' in messageOrError) {
    return c.json({ error: messageOrError.error }, messageOrError.status);
  }
  const message = messageOrError;

  const now = new Date().toISOString();
  await prisma.object.update({
    where: { apId: message.apId },
    data: { content, updated: now },
  });

  return c.json({
    success: true,
    message: { id: message.apId, content, updated_at: now },
  });
});

// Delete a DM message
dm.delete('/messages/:messageId', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');

  const messageOrError = await findOwnedDmMessage(prisma, c.req.param('messageId'), actor.ap_id);
  if ('error' in messageOrError) {
    return c.json({ error: messageOrError.error }, messageOrError.status);
  }
  const message = messageOrError;

  await prisma.$transaction(async (tx: any) => {
    await tx.objectRecipient.deleteMany({ where: { objectApId: message.apId } });
    await tx.object.delete({ where: { apId: message.apId } });
  });

  return c.json({ success: true });
});

// Legacy endpoints for backwards compatibility

dm.get('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const conversationId = c.req.param('id');
  const limit = parseLimit(c.req.query('limit'), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query('before');

  const filteredMessages = await fetchAuthorizedMessages(prisma, actor.ap_id, conversationId, limit, before);
  const authorApIds = [...new Set(filteredMessages.map((m: any) => m.attributedTo))];
  const authorMap = await resolveAuthorInfoMap(prisma, authorApIds);
  const result = formatMessages(filteredMessages, authorMap);

  return c.json({ messages: result });
});

dm.post('/conversations/:id/messages', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const conversationId = c.req.param('id');
  const body = await c.req.json<{ content: string }>();
  const baseUrl = c.env.APP_URL;

  const contentOrError = validateContent(body.content);
  if (typeof contentOrError !== 'string') {
    return c.json({ error: contentOrError.error }, contentOrError.status);
  }
  const content = contentOrError;

  // Find the other participant from existing messages in this conversation
  const existingMessages = await prisma.object.findMany({
    where: { conversation: conversationId, visibility: 'direct' },
    select: { attributedTo: true, toJson: true },
    take: 10,
  });

  let otherApId: string | null = null;
  for (const msg of existingMessages) {
    const recipients = safeJsonParse<string[]>(msg.toJson, []);
    if (msg.attributedTo === actor.ap_id) {
      if (recipients.length > 0) { otherApId = recipients[0]; break; }
    } else if (recipients.includes(actor.ap_id)) {
      otherApId = msg.attributedTo; break;
    }
  }

  if (!otherApId) return c.json({ error: 'Forbidden' }, 403);

  const messageId = generateId();
  const apId = objectApId(baseUrl, messageId);
  const now = new Date().toISOString();
  const toJson = JSON.stringify([otherApId]);
  const ccJson = JSON.stringify([]);

  const recipientIsLocal = await prisma.actor.findUnique({
    where: { apId: otherApId },
    select: { apId: true },
  });
  const isRecipientLocal = !!recipientIsLocal;

  await prisma.$transaction(async (tx: any) => {
    await tx.object.create({
      data: {
        apId,
        type: 'Note',
        attributedTo: actor.ap_id,
        content,
        visibility: 'direct',
        toJson,
        ccJson,
        conversation: conversationId,
        published: now,
        isLocal: 1,
      },
    });

    if (isRecipientLocal) {
      await tx.objectRecipient.upsert({
        where: { objectApId_recipientApId: { objectApId: apId, recipientApId: otherApId } },
        create: { objectApId: apId, recipientApId: otherApId, type: 'to' },
        update: {},
      });
    }
  });

  return c.json({
    message: {
      id: apId,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url,
      },
      content,
      created_at: now,
    },
  }, 201);
});

// Typing indicator (local only)

export default dm;
