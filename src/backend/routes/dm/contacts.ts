// GET /contacts - List DM contacts and communities

import { Hono } from "hono";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  ne,
  notInArray,
  sql,
} from "drizzle-orm";
import {
  communities,
  communityMembers,
  dmArchivedConversations,
  dmReadStatus,
  objects,
} from "../../../db/index.ts";
import { formatUsername } from "../../federation-helpers.ts";
import {
  buildActorInfoMap,
  byTimeDesc,
  dmWhereForActor,
  findRepliedConversations,
  formatActorProfile,
  groupConversations,
  type HonoEnv,
  recipientToJsonLike,
  uniqueValues,
} from "./conversations-helpers.ts";

const contacts = new Hono<HonoEnv>();

contacts.get("/contacts", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");
  const dmWhere = dmWhereForActor(actor.ap_id);

  // Clean up orphaned read status entries for conversations that no longer exist
  const validConversations = await db
    .selectDistinct({
      conversation: objects.conversation,
    })
    .from(objects)
    .where(dmWhere!);

  const validConversationIds = validConversations
    .map((c) => c.conversation)
    .filter((c): c is string => c !== null);

  if (validConversationIds.length > 0) {
    await db
      .delete(dmReadStatus)
      .where(
        and(
          eq(dmReadStatus.actorApId, actor.ap_id),
          notInArray(dmReadStatus.conversationId, validConversationIds),
        ),
      );
  } else {
    await db
      .delete(dmReadStatus)
      .where(eq(dmReadStatus.actorApId, actor.ap_id));
  }

  // Get archived conversation IDs to exclude
  const archivedConversations = await db
    .select({
      conversationId: dmArchivedConversations.conversationId,
    })
    .from(dmArchivedConversations)
    .where(eq(dmArchivedConversations.actorApId, actor.ap_id));
  const archivedSet = new Set(
    archivedConversations.map((a) => a.conversationId),
  );

  // Get DM conversations for this actor with limit to prevent DoS
  const dmObjects = await db
    .select({
      conversation: objects.conversation,
      attributedTo: objects.attributedTo,
      toJson: objects.toJson,
      published: objects.published,
      content: objects.content,
    })
    .from(objects)
    .where(dmWhere!)
    .orderBy(desc(objects.published))
    .limit(2000);

  const conversationMap = groupConversations(
    dmObjects,
    actor.ap_id,
    (id) => !archivedSet.has(id),
  );

  // Get read status for all conversations
  const readStatuses = await db
    .select()
    .from(dmReadStatus)
    .where(eq(dmReadStatus.actorApId, actor.ap_id));
  const readStatusMap = new Map(
    readStatuses.map((r) => [r.conversationId, r.lastReadAt]),
  );

  // Calculate unread counts for each conversation using batch query
  const conversationIds = Array.from(conversationMap.keys());
  const unreadCounts = new Map<string, number>();

  if (conversationIds.length > 0) {
    // Group conversations by their lastReadAt time for efficient querying
    const lastReadAtMap = new Map<string, string[]>();
    for (const convId of conversationIds) {
      const lastReadAt = readStatusMap.get(convId) || "1970-01-01T00:00:00Z";
      const convIds = lastReadAtMap.get(lastReadAt) || [];
      convIds.push(convId);
      lastReadAtMap.set(lastReadAt, convIds);
    }

    await Promise.all(
      Array.from(lastReadAtMap.entries()).map(async ([lastReadAt, convIds]) => {
        const unreadMessages = await db
          .select({
            conversation: objects.conversation,
            count: count(),
          })
          .from(objects)
          .where(
            and(
              inArray(objects.conversation, convIds),
              eq(objects.visibility, "direct"),
              ne(objects.attributedTo, actor.ap_id),
              sql`${objects.published} > ${lastReadAt}`,
            ),
          )
          .groupBy(objects.conversation);

        for (const msg of unreadMessages) {
          if (msg.conversation) {
            unreadCounts.set(msg.conversation, msg.count);
          }
        }
      }),
    );
  }

  const otherApIds = uniqueValues(conversationMap, (c) => c.otherApId);
  const actorInfoMap = await buildActorInfoMap(db, otherApIds);

  const contactsResult = Array.from(conversationMap.values())
    .map((conv) => ({
      type: "user" as const,
      ...formatActorProfile(conv.otherApId, actorInfoMap.get(conv.otherApId)),
      conversation_id: conv.conversation,
      last_message: conv.lastContent
        ? {
            content: conv.lastContent,
            is_mine: conv.lastSender === actor.ap_id,
          }
        : null,
      last_message_at: conv.lastMessageAt,
      unread_count: unreadCounts.get(conv.conversation) || 0,
    }))
    .sort((a, b) => byTimeDesc(a.last_message_at, b.last_message_at));

  // Get communities the user is a member of (for group chat)
  const communityMemberships = await db
    .select({
      communityApId: communityMembers.communityApId,
      community: {
        apId: communities.apId,
        preferredUsername: communities.preferredUsername,
        name: communities.name,
        iconUrl: communities.iconUrl,
        memberCount: communities.memberCount,
      },
    })
    .from(communityMembers)
    .innerJoin(
      communities,
      eq(communityMembers.communityApId, communities.apId),
    )
    .where(eq(communityMembers.actorApId, actor.ap_id));

  // Batch get last messages for all communities to avoid N+1
  const communityApIds = communityMemberships.map((cm) => cm.community.apId);
  const lastMessagesMap = new Map<
    string,
    { content: string; attributedTo: string; published: string }
  >();

  if (communityApIds.length > 0) {
    const recentMessages = await db
      .select({
        communityApId: objects.communityApId,
        content: objects.content,
        attributedTo: objects.attributedTo,
        published: objects.published,
      })
      .from(objects)
      .where(inArray(objects.communityApId, communityApIds))
      .orderBy(desc(objects.published))
      .limit(communityApIds.length * 10);

    for (const msg of recentMessages) {
      if (msg.communityApId && !lastMessagesMap.has(msg.communityApId)) {
        lastMessagesMap.set(msg.communityApId, {
          content: msg.content,
          attributedTo: msg.attributedTo,
          published: msg.published,
        });
      }
    }
  }

  const communitiesResult = communityMemberships
    .map((cm) => {
      const lastMessage = lastMessagesMap.get(cm.community.apId);
      return {
        type: "community" as const,
        ap_id: cm.community.apId,
        username: formatUsername(cm.community.apId),
        preferred_username: cm.community.preferredUsername,
        name: cm.community.name,
        icon_url: cm.community.iconUrl,
        member_count: cm.community.memberCount,
        last_message: lastMessage?.content
          ? {
              content: lastMessage.content,
              is_mine: lastMessage.attributedTo === actor.ap_id,
            }
          : null,
        last_message_at: lastMessage?.published || null,
      };
    })
    .sort(
      (a, b) =>
        byTimeDesc(a.last_message_at, b.last_message_at) ||
        a.name.localeCompare(b.name),
    );

  // Count pending requests: DMs from people we haven't replied to
  const incomingDMs = await db
    .selectDistinct({
      conversation: objects.conversation,
    })
    .from(objects)
    .where(
      and(
        eq(objects.visibility, "direct"),
        eq(objects.type, "Note"),
        recipientToJsonLike(actor.ap_id),
      ),
    );

  const incomingConversations = incomingDMs
    .map((dm) => dm.conversation)
    .filter((c): c is string => c !== null);

  const repliedConversations = await findRepliedConversations(
    db,
    incomingConversations,
    actor.ap_id,
  );
  const requestCount = incomingConversations.filter(
    (c) => !repliedConversations.has(c),
  ).length;

  return c.json({
    mutual_followers: contactsResult,
    communities: communitiesResult,
    request_count: requestCount,
  });
});

export default contacts;
