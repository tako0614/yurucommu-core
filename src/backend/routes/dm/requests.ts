// DM requests - list, accept, reject

import { Hono } from "hono";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  or,
  sql,
} from "drizzle-orm";
import {
  activities,
  blocks,
  objects,
  runBatch,
  type D1Statement,
} from "../../../db/index.ts";
import { createGuardedDatabase } from "../../../db/guarded-writes.ts";
import { admissionGuard } from "../../lib/account-deletion-admission.ts";
import { resolveConversationId } from "./query-helpers.ts";
import {
  buildActorInfoMap,
  formatActorProfile,
  type HonoEnv,
  recipientObjectIds,
} from "./conversations-helpers.ts";
import { operatorActorNotBlockedSql } from "../../lib/blocklist.ts";
import { activityDeleteCascadeStatements } from "../../lib/activity-delete-cascade.ts";
import {
  prepareObjectsDeleteCascade,
  purgeMediaBlobs,
} from "../posts/delete-cascade.ts";

// Bound pending (stored conversation, sender) pairs, not messages. Historical
// conversation IDs could collide across peers, so conversation alone is not a
// sender identity. Filter replied pairs before the cap, not after it.
const MAX_REQUEST_PAIRS = 500;
// Forty (id, attachment snapshot) pairs plus owner/pending assertions remain
// below D1's 100 parameters. All page effects also fit one guarded batch.
const REJECT_PAGE_SIZE = 40;

class RequestChangedError extends Error {}

const requests = new Hono<HonoEnv>();

// Get message requests (DMs from people we haven't replied to)
requests.get("/requests", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  // Select the latest message per pending conversation/sender pair in SQL.
  // A flood of messages occupies one slot per pair; replied pairs occupy none.
  // SQLite's max()/GROUP BY rule takes the bare columns from a latest message.
  const latestRequests = await db
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
        operatorActorNotBlockedSql(sql`${objects.attributedTo}`),
        sql`NOT EXISTS (
          SELECT 1 FROM object_recipients reply_to
          JOIN objects reply ON reply.ap_id = reply_to.object_ap_id
          WHERE reply_to.recipient_ap_id = ${objects.attributedTo} AND reply_to.type = 'to'
            AND reply.conversation = ${objects.conversation}
            AND reply.attributed_to = ${actor.ap_id}
            AND reply.visibility = 'direct' AND reply.type = 'Note'
        )`,
      ),
    )
    .groupBy(objects.conversation, objects.attributedTo)
    .orderBy(desc(sql`max(${objects.published})`))
    .limit(MAX_REQUEST_PAIRS);

  const requestList = latestRequests.map((dm) => ({
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
requests.on(
  "POST",
  ["/requests/reject", "/requests/reject-pending"],
  async (c) => {
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

    // One exact owner predicate, including the authenticated recipient, for every
    // cleanup stage. The same sender's DM to another local recipient may share a
    // historical conversation ID; that is not this viewer's request to delete.
    // A legacy/corrupt public row can also share the conversation string;
    // omitting the direct-Note scope from
    // only the Activity/recipient subqueries would delete that survivor's
    // projections while leaving its object behind.
    const senderMessageWhere = (afterApId?: string) =>
      and(
        eq(objects.conversation, conversationId),
        eq(objects.visibility, "direct"),
        eq(objects.type, "Note"),
        eq(objects.attributedTo, body.sender_ap_id),
        inArray(objects.apId, recipientObjectIds(db, actor.ap_id)),
        afterApId ? gt(objects.apId, afterApId) : undefined,
      );

    const pending = sql`NOT EXISTS (
    SELECT 1 FROM object_recipients reply_to
    JOIN objects reply ON reply.ap_id=reply_to.object_ap_id
    WHERE reply_to.recipient_ap_id=${body.sender_ap_id} AND reply_to.type='to'
      AND reply.conversation=${conversationId} AND reply.attributed_to=${actor.ap_id}
      AND reply.visibility='direct' AND reply.type='Note'
  )`;

    try {
      // Also reject a stale empty page: acceptance must not become a false ACK.
      const available = await db
        .select({ pending })
        .from(sql`(SELECT 1)`)
        .get();
      if (!available?.pending) throw new RequestChangedError();
      let cursor: string | undefined;
      while (true) {
        const page = await db
          .select({ apId: objects.apId })
          .from(objects)
          .where(senderMessageWhere(cursor))
          .orderBy(asc(objects.apId))
          .limit(REJECT_PAGE_SIZE);
        if (page.length === 0) break;

        const apIds = page.map((row) => row.apId);
        const plan = await prepareObjectsDeleteCascade(db, apIds, c.env.MEDIA);
        if (plan.objects.length !== apIds.length)
          throw new RequestChangedError();
        const unchanged = db
          .select({ count: sql<number>`count(*)` })
          .from(objects)
          .where(
            and(
              senderMessageWhere(),
              or(
                ...plan.objects.map((obj) =>
                  and(
                    eq(objects.apId, obj.apId),
                    eq(objects.attachmentsJson, obj.attachmentsJson),
                  ),
                ),
              ),
            ),
          );
        const guarded = createGuardedDatabase(db, () =>
          admissionGuard(
            db,
            and(pending, sql`(${unchanged})=${apIds.length}`)!,
            () => new RequestChangedError(),
          ),
        );
        // The assertion, activity/projection cleanup, media intents, children and
        // final object deletion commit together. A reply winning before this
        // batch causes zero effects; no caller may split this logical page.
        await runBatch(guarded, [
          ...activityDeleteCascadeStatements(
            db,
            inArray(activities.objectApId, apIds),
          ),
          ...plan.mediaStatements,
          ...plan.batches.flat(),
          db.delete(objects).where(inArray(objects.apId, apIds)) as D1Statement,
        ]);
        await purgeMediaBlobs(db, c.env.MEDIA, plan.mediaKeys);

        cursor = apIds.at(-1);
        if (!cursor || page.length < REJECT_PAGE_SIZE) break;
      }

      if (body.block) {
        const guarded = createGuardedDatabase(db, () =>
          admissionGuard(db, pending, () => new RequestChangedError()),
        );
        await guarded
          .insert(blocks)
          .values({
            blockerApId: actor.ap_id,
            blockedApId: body.sender_ap_id,
          })
          .onConflictDoNothing();
      }
    } catch (error) {
      if (!(error instanceof RequestChangedError)) throw error;
      // Earlier committed pages can remain removed if another device replies
      // between pages. Never acknowledge whole-operation success in that case.
      return c.json(
        {
          error: "request_changed",
          message:
            "The request changed; reload the request list before acting again.",
        },
        409,
      );
    }

    return c.json({ success: true });
  },
);

// Accept request.
//
// In this AP-native DM model there is no separate "accepted" state to persist:
// a conversation is treated as a pending request precisely until the recipient
// sends their first reply to that peer (see the /requests list),
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
