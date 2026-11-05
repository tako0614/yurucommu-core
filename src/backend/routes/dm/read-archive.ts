// DM read status and archive management

import { Hono } from "hono";
import type { Context } from "hono";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  communities,
  communityMembers,
  dmCommunityReadStatus,
  dmReadStatus,
  objects,
} from "../../../db/index.ts";
import { resolveConversationId } from "./query-helpers.ts";
import {
  peerArchivedSql,
  otherParticipantSql,
  setPeerArchived,
} from "../../lib/talk-peer-archives.ts";
import { isActorBlockedStrict } from "../../lib/blocklist.ts";
import {
  BodyTooLargeError,
  capRequestBodyStream,
} from "../../middleware/body-limit.ts";
import {
  acknowledgeObservedReads,
  ambiguousLegacyThreadSql,
  applyLegacyTalkRead,
  hasObservedReads,
  initializeObservedReads,
  MAX_OBSERVED_READ_IDS,
  ObservedReadConflict,
  parseObservedReadIds,
  type TalkReadScope,
} from "../../lib/talk-read-receipts.ts";
import {
  emitRealtimeBestEffort,
  emitUnreadSnapshot,
  runRealtimeAfterResponse,
} from "../../runtime/realtime-hub.ts";
import {
  buildActorInfoMap,
  byTimeDesc,
  dmWhereForActor,
  formatActorProfile,
  groupConversations,
  type HonoEnv,
  parseOtherApId,
  uniqueValues,
} from "./conversations-helpers.ts";

const readArchive = new Hono<HonoEnv>();

async function observedScope(
  c: Context<HonoEnv>,
): Promise<TalkReadScope | Response> {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");
  const target = parseOtherApId(c);
  if (!target) return c.json({ error: "ap_id required" }, 400);
  const kind = c.req.param("kind");
  if (kind === "user") {
    if (await isActorBlockedStrict(db, target))
      return c.json({ error: "User not found" }, 404);
    return {
      viewer: actor.ap_id,
      kind,
      target,
      epoch: "",
      thread: await resolveConversationId(
        db,
        c.env.APP_URL,
        actor.ap_id,
        target,
      ),
    };
  }
  if (kind !== "community") return c.json({ error: "Not found" }, 404);
  const community = await db
    .select({ apId: communities.apId })
    .from(communities)
    .where(and(eq(communities.apId, target), isNull(communities.deletedAt)))
    .get();
  if (!community) return c.json({ error: "Community not found" }, 404);
  const member = await db
    .select({ joinedAt: communityMembers.joinedAt })
    .from(communityMembers)
    .where(
      and(
        eq(communityMembers.communityApId, target),
        eq(communityMembers.actorApId, actor.ap_id),
      ),
    )
    .get();
  if (!member) return c.json({ error: "Not a community member" }, 403);
  return {
    viewer: actor.ap_id,
    kind,
    target,
    thread: target,
    epoch: member.joinedAt,
  };
}

readArchive.post("/:kind/:encodedApId/read-observed/init", async (c) => {
  const scope = await observedScope(c);
  if (scope instanceof Response) return scope;
  try {
    await initializeObservedReads(c.get("db"), scope);
  } catch (error) {
    if (error instanceof ObservedReadConflict)
      return c.json({ error: error.message }, 409);
    throw error;
  }
  return c.json({
    success: true,
    read_observed: { version: 1, max_ids: MAX_OBSERVED_READ_IDS },
  });
});

readArchive.post("/:kind/:encodedApId/read-observed", async (c) => {
  const scope = await observedScope(c);
  if (scope instanceof Response) return scope;
  let text: string;
  try {
    text = await capRequestBodyStream(c.req.raw, 32768).text();
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return c.json({ error: "Observed read body too large" }, 413);
    throw error;
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const ids = parseObservedReadIds(body);
  if (!ids)
    return c.json(
      { error: `Expected 1-${MAX_OBSERVED_READ_IDS} unique message_ids` },
      400,
    );
  try {
    await acknowledgeObservedReads(c.get("db"), scope, ids);
  } catch (error) {
    if (error instanceof ObservedReadConflict)
      return c.json({ error: error.message }, 409);
    throw error;
  }
  await runRealtimeAfterResponse(c, () =>
    emitUnreadSnapshot(c.env, scope.viewer),
  );
  return c.json({ success: true, message_ids: ids });
});

// Mark conversation as read
readArchive.post("/user/:encodedApId/read", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: "ap_id required" }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = await resolveConversationId(
    db,
    baseUrl,
    actor.ap_id,
    otherApId,
  );
  const now = new Date().toISOString();

  const scope: TalkReadScope = {
    viewer: actor.ap_id,
    kind: "user",
    target: otherApId,
    thread: conversationId,
    epoch: "",
  };
  await applyLegacyTalkRead(
    db,
    scope,
    db
      .insert(dmReadStatus)
      .select(
        sql`SELECT ${actor.ap_id}, ${conversationId}, ${now} WHERE NOT ${ambiguousLegacyThreadSql(scope)}`,
      )
      .onConflictDoUpdate({
        target: [dmReadStatus.actorApId, dmReadStatus.conversationId],
        set: { lastReadAt: now },
      }),
    now,
  );
  const exact = await hasObservedReads(db, scope);

  // Live read receipt for the partner's open thread + refreshed unread badge
  // for the reader's OTHER tabs/devices.
  await runRealtimeAfterResponse(c, async () => {
    if (!exact)
      await emitRealtimeBestEffort(c.env, [
        {
          actorApId: otherApId,
          type: "talk.read",
          data: {
            other_ap_id: actor.ap_id,
            conversation_id: conversationId,
            last_read_at: now,
          },
        },
      ]);
    await emitUnreadSnapshot(c.env, actor.ap_id);
  });

  return c.json({ success: true, last_read_at: now });
});

// Mark a community (group chat) as read for the current viewer.
// Mirrors the one-to-one DM read endpoint above; the unread baseline used by
// GET /contacts is the recorded `last_read_at`.
readArchive.post("/community/:encodedApId/read", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const communityApId = parseOtherApId(c);
  if (!communityApId) return c.json({ error: "ap_id required" }, 400);

  // Only track read state for communities that actually exist; otherwise an
  // arbitrary AP-ID could accumulate orphan rows.
  const community = await db
    .select({ apId: communities.apId })
    .from(communities)
    .where(
      and(eq(communities.apId, communityApId), isNull(communities.deletedAt)),
    )
    .get();
  if (!community) return c.json({ error: "Community not found" }, 404);

  // Only members may track a read position for a community group chat: the
  // unread baseline is meaningless for non-members and would let an arbitrary
  // actor write read-status rows for communities they cannot see.
  const membership = await db
    .select({
      actorApId: communityMembers.actorApId,
      joinedAt: communityMembers.joinedAt,
    })
    .from(communityMembers)
    .where(
      and(
        eq(communityMembers.communityApId, communityApId),
        eq(communityMembers.actorApId, actor.ap_id),
      ),
    )
    .get();
  if (!membership) return c.json({ error: "Not a community member" }, 403);

  const now = new Date().toISOString();
  const scope: TalkReadScope = {
    viewer: actor.ap_id,
    kind: "community",
    target: communityApId,
    thread: communityApId,
    epoch: membership.joinedAt,
  };
  await applyLegacyTalkRead(
    db,
    scope,
    db
      .insert(dmCommunityReadStatus)
      .values({
        actorApId: actor.ap_id,
        communityApId,
        lastReadAt: now,
      })
      .onConflictDoUpdate({
        target: [
          dmCommunityReadStatus.actorApId,
          dmCommunityReadStatus.communityApId,
        ],
        set: { lastReadAt: now },
      }),
    now,
  );

  // Refresh the reader's unread badge on their other tabs/devices.
  await runRealtimeAfterResponse(c, () =>
    emitUnreadSnapshot(c.env, actor.ap_id),
  );

  return c.json({
    success: true,
    last_read_at: now,
  });
});

// Archive a conversation (hide from inbox)
readArchive.post("/user/:encodedApId/archive", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: "ap_id required" }, 400);

  const baseUrl = c.env.APP_URL;
  // Preserve the stored ID as provenance, while peer identity prevents an old
  // collision from hiding another participant's conversation.
  const conversationId = await resolveConversationId(
    db,
    baseUrl,
    actor.ap_id,
    otherApId,
  );
  const now = new Date().toISOString();

  try {
    await setPeerArchived(
      db,
      {
        viewer: actor.ap_id,
        kind: "user",
        target: otherApId,
        thread: conversationId,
        epoch: "",
      },
      true,
      now,
    );
  } catch (error) {
    if (error instanceof ObservedReadConflict)
      return c.json({ error: error.message }, 409);
    throw error;
  }

  return c.json({ success: true, archived_at: now });
});

// Unarchive a conversation
readArchive.delete("/user/:encodedApId/archive", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: "ap_id required" }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = await resolveConversationId(
    db,
    baseUrl,
    actor.ap_id,
    otherApId,
  );

  try {
    await setPeerArchived(
      db,
      {
        viewer: actor.ap_id,
        kind: "user",
        target: otherApId,
        thread: conversationId,
        epoch: "",
      },
      false,
      new Date().toISOString(),
    );
  } catch (error) {
    if (error instanceof ObservedReadConflict)
      return c.json({ error: error.message }, 409);
    throw error;
  }

  return c.json({ success: true });
});

// Get archived conversations
readArchive.get("/archived", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const other = otherParticipantSql(sql`${actor.ap_id}`);

  const dmObjects = await db
    .select({
      conversation: objects.conversation,
      attributedTo: objects.attributedTo,
      toJson: objects.toJson,
      published: sql<string>`MAX(${objects.published})`,
    })
    .from(objects)
    .where(
      and(
        dmWhereForActor(db, actor.ap_id),
        peerArchivedSql(
          sql`${actor.ap_id}`,
          other,
          sql`${objects.conversation}`,
        ),
      ),
    )
    .groupBy(objects.conversation, other)
    .orderBy(desc(sql`MAX(${objects.published})`))
    .limit(2000);

  const conversationMap = groupConversations(
    dmObjects,
    actor.ap_id,
    () => true,
    (id, peer) => JSON.stringify([id, peer]),
  );

  const otherApIds = uniqueValues(conversationMap, (c) => c.otherApId);
  const actorInfoMap = await buildActorInfoMap(db, otherApIds);

  const archived = Array.from(conversationMap.values())
    .map((conv) => ({
      ...formatActorProfile(conv.otherApId, actorInfoMap.get(conv.otherApId)),
      conversation_id: conv.conversation,
      last_message_at: conv.lastMessageAt,
    }))
    .sort((a, b) => byTimeDesc(a.last_message_at, b.last_message_at));

  return c.json({ archived });
});

export default readArchive;
