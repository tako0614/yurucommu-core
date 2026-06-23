// DM requests - list, accept, reject

import { Hono } from "hono";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  activities,
  blocks,
  inbox as inboxTable,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { resolveConversationId } from "./query-helpers.ts";
import {
  buildActorInfoMap,
  findRepliedConversations,
  formatActorProfile,
  type HonoEnv,
  recipientObjectIds,
} from "./conversations-helpers.ts";

// Upper bound on the number of pending-request CONVERSATIONS returned. The list
// is collapsed to one row per conversation in SQL (GROUP BY), so this bounds
// distinct senders, NOT messages — a single high-volume sender can occupy at
// most one slot and can no longer evict every other pending requester.
const MAX_REQUEST_CONVERSATIONS = 500;

const requests = new Hono<HonoEnv>();

// Get message requests (DMs from people we haven't replied to)
requests.get("/requests", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  // Collapse to ONE row per conversation IN SQL (GROUP BY) — the latest message
  // of each — then bound by conversation count. Previously we fetched the 1000
  // most-recent incoming MESSAGES and deduped in JS, so a single sender with
  // >1000 stored DMs filled the whole window and evicted every other pending
  // request (and diverged from the unbounded request_count badge). `max()` with
  // GROUP BY makes the bare columns take their value from each group's latest
  // message (SQLite min/max bare-column rule).
  const latestPerConversation = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      content: objects.content,
      published: sql<string>`max(${objects.published})`,
      conversation: objects.conversation,
    })
    .from(objects)
    .where(
      and(
        eq(objects.visibility, "direct"),
        eq(objects.type, "Note"),
        isNotNull(objects.conversation),
        // Incoming DMs = Notes where this actor is a `to` recipient. Resolved
        // via the indexed object_recipients link (see recipientObjectIds)
        // instead of an unindexable `to_json LIKE '%"<apId>"%'` scan; same
        // recipient-membership semantics.
        inArray(objects.apId, recipientObjectIds(db, actor.ap_id)),
      ),
    )
    .groupBy(objects.conversation)
    .orderBy(desc(sql`max(${objects.published})`))
    .limit(MAX_REQUEST_CONVERSATIONS);

  const allConversations = latestPerConversation
    .map((dm) => dm.conversation)
    .filter((c): c is string => c !== null);
  const repliedConversationsSet = await findRepliedConversations(
    db,
    allConversations,
    actor.ap_id,
  );

  // Keep only unreplied conversations; GROUP BY already guarantees one row each.
  const requestList = latestPerConversation
    .filter(
      (dm) => dm.conversation && !repliedConversationsSet.has(dm.conversation),
    )
    .map((dm) => ({
      id: dm.apId,
      senderApId: dm.attributedTo,
      content: dm.content,
      createdAt: dm.published,
      conversation: dm.conversation,
    }));

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
  // Resolve to the STORED conversation id (legacy- or current-scheme) so a
  // pre-migration thread is actually matched by the deletes below.
  const conversationId = await resolveConversationId(
    db,
    baseUrl,
    actor.ap_id,
    body.sender_ap_id,
  );

  // The set of the sender's messages in this conversation, as a reusable
  // SUBQUERY (never materialised into an `IN (...)`, which would blow D1's
  // 100-bound-parameter ceiling once a spammer has written >~100 messages).
  const senderObjectIds = db
    .select({ apId: objects.apId })
    .from(objects)
    .where(
      and(
        eq(objects.conversation, conversationId),
        eq(objects.attributedTo, body.sender_ap_id),
      ),
    );

  // Drop the inbox + delivery Create activities for those messages FIRST, before
  // the objects vanish. These tables are addressed by AP id with no FK to
  // `objects`, so deleting only the object orphans them — and the notifications
  // query LEFT JOINs the now-missing object (gone → NULL visibility → no longer
  // excluded as "direct"), so each orphan Create would resurface as a blank
  // "mention" notification with a dead link plus an inflated unread badge. This
  // mirrors the DM message-delete cleanup (messages.ts).
  await db
    .delete(inboxTable)
    .where(
      inArray(
        inboxTable.activityApId,
        db
          .select({ apId: activities.apId })
          .from(activities)
          .where(inArray(activities.objectApId, senderObjectIds)),
      ),
    );
  await db
    .delete(activities)
    .where(inArray(activities.objectApId, senderObjectIds));

  // Delete the recipient rows for every message the sender wrote in this
  // conversation (same subquery-not-IN reasoning as above).
  await db
    .delete(objectRecipients)
    .where(inArray(objectRecipients.objectApId, senderObjectIds));

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
