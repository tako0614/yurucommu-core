/**
 * Takos Tools - DM handlers
 *
 * Handles: yurucommu_send_dm, yurucommu_get_dm_threads,
 *          yurucommu_get_dm_messages
 */

import { eq, and, desc, isNotNull } from 'drizzle-orm';
import { actors, objects, inbox, activities, objectRecipients } from '../../../db/index.ts';
import { activityApId, generateId, objectApId, safeJsonParse } from '../../federation-helpers.ts';
import { getConversationId } from '../dm/query-helpers.ts';
import {
  toolLimit,
  requireString,
  errAuth,
  errRequired,
  errNotFound,
  ok,
  resolveDmPartner,
} from '../takos-tools-response.ts';
import type { ToolContext, Input } from './types.ts';

export async function handleSendDm(c: ToolContext, input: Input, actor: { ap_id: string } | null) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get('db');
  const recipient = requireString(input, 'recipient');
  const content = requireString(input, 'content');
  if (!recipient || !content) return c.json(errRequired('Recipient and content'), 400);

  const target = await db.select({ apId: actors.apId })
    .from(actors)
    .where(eq(actors.preferredUsername, recipient))
    .get();
  if (!target) return c.json(errNotFound('Recipient'), 404);

  const baseUrl = c.env.APP_URL;
  const now = new Date().toISOString();
  const messageId = generateId();
  const apId = objectApId(baseUrl, messageId);
  const conversationId = getConversationId(baseUrl, actor.ap_id, target.apId);
  const toJson = JSON.stringify([target.apId]);
  const ccJson = JSON.stringify([]);
  const actId = activityApId(baseUrl, generateId());

  // Sequential operations (D1 doesn't support interactive transactions)
  await db.insert(objects).values({
    apId, type: 'Note', attributedTo: actor.ap_id, content,
    summary: null, attachmentsJson: '[]', inReplyTo: null,
    conversation: conversationId, visibility: 'direct',
    toJson, ccJson, published: now, isLocal: 1,
  });

  await db.insert(objectRecipients)
    .values({ objectApId: apId, recipientApId: target.apId, type: 'to' })
    .onConflictDoNothing();

  await db.insert(activities).values({
    apId: actId, type: 'Create', actorApId: actor.ap_id,
    objectApId: apId,
    rawJson: JSON.stringify({ type: 'Create', actor: actor.ap_id, object: apId }),
    direction: 'inbound',
  });

  await db.insert(inbox).values({
    actorApId: target.apId, activityApId: actId,
  });

  return c.json(ok({ message_id: apId, conversation_id: conversationId }));
}

export async function handleGetDmThreads(c: ToolContext, input: Input, actor: { ap_id: string } | null) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get('db');
  const limit = toolLimit(input.limit, 20, 50);

  const dms = await db.select({
    attributedTo: objects.attributedTo,
    toJson: objects.toJson,
    published: objects.published,
    content: objects.content,
  })
    .from(objects)
    .where(and(
      eq(objects.visibility, 'direct'),
      eq(objects.type, 'Note'),
      isNotNull(objects.conversation),
    ))
    .orderBy(desc(objects.published))
    .limit(2000);

  // Filter to only messages where actor is sender or recipient, then group by partner
  const threads: Record<string, { partner: string; lastMessage: string; lastDate: string }> = {};

  for (const dm of dms) {
    const partner = resolveDmPartner(dm, actor.ap_id);
    if (partner && !threads[partner]) {
      threads[partner] = {
        partner,
        lastMessage: dm.content || '',
        lastDate: dm.published,
      };
    }
  }

  return c.json(ok({ threads: Object.values(threads).slice(0, limit) }));
}

export async function handleGetDmMessages(c: ToolContext, input: Input, actor: { ap_id: string } | null) {
  if (!actor) return c.json(errAuth(), 401);

  const db = c.get('db');
  const threadId = requireString(input, 'thread_id');
  const limit = toolLimit(input.limit, 50, 100);
  if (!threadId) return c.json(errRequired('Thread ID'), 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, threadId);

  const messages = await db.select()
    .from(objects)
    .where(and(
      eq(objects.visibility, 'direct'),
      eq(objects.type, 'Note'),
      eq(objects.conversation, conversationId),
    ))
    .orderBy(desc(objects.published))
    .limit(limit);

  const filtered = messages.filter((m) => {
    if (m.attributedTo === actor.ap_id) return true;
    return safeJsonParse<string[]>(m.toJson, []).includes(actor.ap_id);
  });

  return c.json(ok({
    messages: filtered.map((m) => ({
      ap_id: m.apId,
      content: m.content,
      from: m.attributedTo,
      published: m.published,
    })),
    conversation_id: conversationId,
  }));
}
