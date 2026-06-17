// DM read status and archive management

import { Hono } from "hono";
import { and, desc, eq } from "drizzle-orm";
import {
  communities,
  communityMembers,
  dmArchivedConversations,
  dmCommunityReadStatus,
  dmReadStatus,
  objects,
} from "../../../db/index.ts";
import { getConversationId, resolveConversationId } from "./query-helpers.ts";
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

  await db
    .insert(dmReadStatus)
    .values({
      actorApId: actor.ap_id,
      conversationId,
      lastReadAt: now,
    })
    .onConflictDoUpdate({
      target: [dmReadStatus.actorApId, dmReadStatus.conversationId],
      set: { lastReadAt: now },
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
    .where(eq(communities.apId, communityApId))
    .get();
  if (!community) return c.json({ error: "Community not found" }, 404);

  // Only members may track a read position for a community group chat: the
  // unread baseline is meaningless for non-members and would let an arbitrary
  // actor write read-status rows for communities they cannot see.
  const membership = await db
    .select({ actorApId: communityMembers.actorApId })
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
  await db
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
    });

  return c.json({ success: true, last_read_at: now });
});

// Archive a conversation (hide from inbox)
readArchive.post("/user/:encodedApId/archive", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const otherApId = parseOtherApId(c);
  if (!otherApId) return c.json({ error: "ap_id required" }, 400);

  const baseUrl = c.env.APP_URL;
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);
  const now = new Date().toISOString();

  await db
    .insert(dmArchivedConversations)
    .values({
      actorApId: actor.ap_id,
      conversationId,
      archivedAt: now,
    })
    .onConflictDoNothing();

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
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);

  await db
    .delete(dmArchivedConversations)
    .where(
      and(
        eq(dmArchivedConversations.actorApId, actor.ap_id),
        eq(dmArchivedConversations.conversationId, conversationId),
      ),
    );

  return c.json({ success: true });
});

// Get archived conversations
readArchive.get("/archived", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const archivedConversations = await db
    .select({
      conversationId: dmArchivedConversations.conversationId,
      archivedAt: dmArchivedConversations.archivedAt,
    })
    .from(dmArchivedConversations)
    .where(eq(dmArchivedConversations.actorApId, actor.ap_id));

  if (archivedConversations.length === 0) {
    return c.json({ archived: [] });
  }

  const archivedSet = new Set(
    archivedConversations.map((a) => a.conversationId),
  );

  const dmObjects = await db
    .select({
      conversation: objects.conversation,
      attributedTo: objects.attributedTo,
      toJson: objects.toJson,
      published: objects.published,
    })
    .from(objects)
    .where(dmWhereForActor(db, actor.ap_id)!)
    .orderBy(desc(objects.published))
    .limit(2000);

  const conversationMap = groupConversations(dmObjects, actor.ap_id, (id) =>
    archivedSet.has(id),
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
