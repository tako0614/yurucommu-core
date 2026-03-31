// DM requests - list, accept, reject

import { Hono } from 'hono';
import { eq, and, desc, like, inArray } from 'drizzle-orm';
import { objects, objectRecipients, blocks } from '../../../db/index.ts';
import { getConversationId } from './query-helpers.ts';
import {
  type HonoEnv,
  buildActorInfoMap,
  formatActorProfile,
  findRepliedConversations,
} from './conversations-helpers.ts';

const requests = new Hono<HonoEnv>();

// Get message requests (DMs from people we haven't replied to)
requests.get('/requests', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('db');
  const actorApIdJson = JSON.stringify(actor.ap_id);

  const incomingDMs = await db.select({
    apId: objects.apId,
    attributedTo: objects.attributedTo,
    content: objects.content,
    published: objects.published,
    conversation: objects.conversation,
  })
    .from(objects)
    .where(
      and(
        eq(objects.visibility, 'direct'),
        eq(objects.type, 'Note'),
        like(objects.toJson, `%${actorApIdJson}%`),
      ),
    )
    .orderBy(desc(objects.published))
    .limit(1000);

  const allConversations = [...new Set(
    incomingDMs.map((dm) => dm.conversation).filter((c): c is string => c !== null),
  )];
  const repliedConversationsSet = await findRepliedConversations(db, allConversations, actor.ap_id);

  // Filter to only unreplied conversations (one per conversation, most recent first)
  const seenConversations = new Set<string>();
  const requestList: Array<{
    id: string;
    senderApId: string;
    content: string;
    createdAt: string;
    conversation: string | null;
  }> = [];

  for (const dm of incomingDMs) {
    if (!dm.conversation || seenConversations.has(dm.conversation)) continue;
    if (repliedConversationsSet.has(dm.conversation)) continue;

    seenConversations.add(dm.conversation);
    requestList.push({
      id: dm.apId,
      senderApId: dm.attributedTo,
      content: dm.content,
      createdAt: dm.published,
      conversation: dm.conversation,
    });
  }

  const senderApIds = [...new Set(requestList.map((r) => r.senderApId))];
  const actorInfoMap = await buildActorInfoMap(db, senderApIds);

  const result = requestList.map((r) => ({
    id: r.id,
    sender: formatActorProfile(r.senderApId, actorInfoMap.get(r.senderApId)),
    content: r.content,
    created_at: r.createdAt,
    conversation: r.conversation,
  }));

  return c.json({ requests: result });
});

// Accept request = just reply to the message (creates conversation)
// No separate accept action needed in AP model

// Reject request = delete messages from a sender and optionally block
requests.post('/requests/reject', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const db = c.get('db');

  const body = await c.req.json<{ sender_ap_id: string; block?: boolean }>();
  if (!body.sender_ap_id) {
    return c.json({ error: 'sender_ap_id is required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, body.sender_ap_id);

  const messagesToDelete = await db.select({ apId: objects.apId })
    .from(objects)
    .where(
      and(
        eq(objects.conversation, conversationId),
        eq(objects.attributedTo, body.sender_ap_id),
      ),
    );

  const messageApIds = messagesToDelete.map((m) => m.apId);

  if (messageApIds.length > 0) {
    await db.delete(objectRecipients).where(inArray(objectRecipients.objectApId, messageApIds));
  }

  await db.delete(objects).where(
    and(
      eq(objects.conversation, conversationId),
      eq(objects.visibility, 'direct'),
      eq(objects.attributedTo, body.sender_ap_id),
    ),
  );

  if (body.block) {
    await db.insert(blocks)
      .values({
        blockerApId: actor.ap_id,
        blockedApId: body.sender_ap_id,
      })
      .onConflictDoNothing();
  }

  return c.json({ success: true });
});

// Accept request = reply and mark as accepted (alternative to just sending a message)
requests.post('/requests/accept', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ sender_ap_id: string }>();
  if (!body.sender_ap_id) {
    return c.json({ error: 'sender_ap_id is required' }, 400);
  }

  return c.json({ success: true, message: 'Reply to the conversation to accept' });
});

export default requests;
