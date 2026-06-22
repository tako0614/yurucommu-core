// DM requests - list, accept, reject

import { Hono } from "hono";
import { and, desc, eq, inArray } from "drizzle-orm";
import { blocks, objectRecipients, objects } from "../../../db/index.ts";
import { getConversationId } from "./query-helpers.ts";
import {
  buildActorInfoMap,
  findRepliedConversations,
  formatActorProfile,
  type HonoEnv,
  recipientObjectIds,
} from "./conversations-helpers.ts";

const requests = new Hono<HonoEnv>();

// Get message requests (DMs from people we haven't replied to)
requests.get("/requests", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const incomingDMs = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      content: objects.content,
      published: objects.published,
      conversation: objects.conversation,
    })
    .from(objects)
    .where(
      and(
        eq(objects.visibility, "direct"),
        eq(objects.type, "Note"),
        // Incoming DMs = Notes where this actor is a `to` recipient. Resolved
        // via the indexed object_recipients link (see recipientObjectIds)
        // instead of an unindexable `to_json LIKE '%"<apId>"%'` scan; same
        // recipient-membership semantics.
        inArray(objects.apId, recipientObjectIds(db, actor.ap_id)),
      ),
    )
    .orderBy(desc(objects.published))
    .limit(1000);

  const allConversations = [
    ...new Set(
      incomingDMs
        .map((dm) => dm.conversation)
        .filter((c): c is string => c !== null),
    ),
  ];
  const repliedConversationsSet = await findRepliedConversations(
    db,
    allConversations,
    actor.ap_id,
  );

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

// Reject request = delete messages from a sender and optionally block
requests.post("/requests/reject", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const body = await c.req.json<{ sender_ap_id: string; block?: boolean }>();
  if (!body.sender_ap_id) {
    return c.json({ error: "sender_ap_id is required" }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(
    baseUrl,
    actor.ap_id,
    body.sender_ap_id,
  );

  // Delete the recipient rows for every message the sender wrote in this
  // conversation. Expressed as a SUBQUERY (`objectApId IN (SELECT ...)`) rather
  // than materialising every message id into an `IN (...)`, which would blow
  // D1's 100-bound-parameter ceiling once a sender has written >~100 messages
  // (e.g. a spammer's request rejected after a long thread).
  await db.delete(objectRecipients).where(
    inArray(
      objectRecipients.objectApId,
      db
        .select({ apId: objects.apId })
        .from(objects)
        .where(
          and(
            eq(objects.conversation, conversationId),
            eq(objects.attributedTo, body.sender_ap_id),
          ),
        ),
    ),
  );

  await db
    .delete(objects)
    .where(
      and(
        eq(objects.conversation, conversationId),
        eq(objects.visibility, "direct"),
        eq(objects.attributedTo, body.sender_ap_id),
      ),
    );

  if (body.block) {
    await db
      .insert(blocks)
      .values({
        blockerApId: actor.ap_id,
        blockedApId: body.sender_ap_id,
      })
      .onConflictDoNothing();
  }

  return c.json({ success: true });
});

// Accept request.
//
// In this AP-native DM model there is no separate "accepted" state to persist:
// a conversation is treated as a pending request precisely until the recipient
// sends their first reply (see findRepliedConversations / the /requests list),
// at which point it leaves the request list and the sender becomes a contact.
// There is therefore nothing this endpoint can record server-side that would
// make the request "accepted" without actually sending a reply.
//
// Rather than fake a success that immediately reverts on the next reload (the
// previous behaviour returned { success: true } while changing no state, so the
// request reappeared and no contact was created), respond honestly: acceptance
// is performed by replying via POST /api/dm/user/:encodedApId/messages.
requests.post("/requests/accept", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const body = await c.req.json<{ sender_ap_id: string }>();
  if (!body.sender_ap_id) {
    return c.json({ error: "sender_ap_id is required" }, 400);
  }

  return c.json(
    {
      error: "not_implemented",
      message:
        "Accepting a request is done by replying to the conversation " +
        "(POST /api/dm/user/:encodedApId/messages). There is no separate " +
        "accept action in this DM model.",
    },
    501,
  );
});

export default requests;
