// GET /contacts - List DM contacts and communities

import { Hono } from "hono";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import {
  communities,
  communityMembers,
  dmArchivedConversations,
  dmCommunityReadStatus,
  dmReadStatus,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { formatUsername } from "../../federation-helpers.ts";
import {
  buildActorInfoMap,
  byTimeDesc,
  findRepliedConversations,
  formatActorProfile,
  groupConversations,
  type HonoEnv,
  parseOtherApId,
  uniqueValues,
} from "./conversations-helpers.ts";

const contacts = new Hono<HonoEnv>();

contacts.get("/contacts", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  // DMs where this actor is the recipient are addressed via the
  // `object_recipients` index (`recipient_ap_id = <actor>`, `type = 'to'`),
  // written on every inbound/outbound DM whose recipient is this local actor
  // (see dm/messages.ts, takos-tools/dm.ts, inbox-content-handlers.ts). Using
  // that index instead of an unindexable `to_json LIKE '%"<apId>"%'` substring
  // scan keeps the same membership semantics (recipient OR author) without a
  // full-table scan.
  const recipientObjectIds = db
    .select({ objectApId: objectRecipients.objectApId })
    .from(objectRecipients)
    .where(
      and(
        eq(objectRecipients.recipientApId, actor.ap_id),
        eq(objectRecipients.type, "to"),
      ),
    );
  const dmWhere = and(
    eq(objects.visibility, "direct"),
    eq(objects.type, "Note"),
    isNotNull(objects.conversation),
    or(
      eq(objects.attributedTo, actor.ap_id),
      inArray(objects.apId, recipientObjectIds),
    ),
  );

  // GET must be side-effect-free: this handler no longer prunes orphaned
  // dm_read_status rows. Read-status cleanup happens on the write paths that
  // delete conversations/messages, not on this read.

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
    .where(dmWhere)
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
      joinedAt: communityMembers.joinedAt,
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

  // Batch get the last CHAT message for all communities to avoid N+1.
  //
  // The community contact's preview must reflect the last group-CHAT message,
  // matching the (chat-vs-feed–separated) unread count below and the chat
  // reader in communities/messages.ts. Chat messages are addressed via the
  // object_recipients audience link and leave `communityApId` NULL, whereas
  // feed posts carry `communityApId`. Querying the audience-linked,
  // `communityApId IS NULL` object-set keeps the preview a chat message and not
  // the last feed post. Communities with no chat message yet get no preview.
  const communityApIds = communityMemberships.map((cm) => cm.community.apId);
  const lastMessagesMap = new Map<
    string,
    { content: string; attributedTo: string; published: string }
  >();

  if (communityApIds.length > 0) {
    const recentMessages = await db
      .select({
        communityApId: objectRecipients.recipientApId,
        content: objects.content,
        attributedTo: objects.attributedTo,
        published: objects.published,
      })
      .from(objects)
      .innerJoin(
        objectRecipients,
        eq(objectRecipients.objectApId, objects.apId),
      )
      .where(
        and(
          inArray(objectRecipients.recipientApId, communityApIds),
          eq(objectRecipients.type, "audience"),
          eq(objects.type, "Note"),
          isNull(objects.communityApId),
        ),
      )
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

  // Per-community read position for the viewer. The unread baseline is the
  // later of the viewer's last-read time and their join time, so a freshly
  // joined member is not blasted with a badge for the whole backlog.
  const communityReadStatuses =
    communityApIds.length > 0
      ? await db
          .select({
            communityApId: dmCommunityReadStatus.communityApId,
            lastReadAt: dmCommunityReadStatus.lastReadAt,
          })
          .from(dmCommunityReadStatus)
          .where(eq(dmCommunityReadStatus.actorApId, actor.ap_id))
      : [];
  const communityReadMap = new Map(
    communityReadStatuses.map((r) => [r.communityApId, r.lastReadAt]),
  );

  // Count unread community CHAT messages (published after the read baseline,
  // not authored by the viewer) per community via the object_recipients
  // audience link.
  //
  // The unread badge must reflect unread group-CHAT messages only, NOT feed
  // posts. A community feed post is stored with `communityApId` set (the
  // community-scoped feed query filters on that column), whereas a group-chat
  // message is addressed purely via object_recipients and leaves
  // `communityApId` NULL. Restricting to `communityApId IS NULL` keeps feed
  // posts out of the chat unread count so reading the feed does not leave a
  // stuck chat badge (and posting to the feed does not bump it).
  const communityUnreadCounts = new Map<string, number>();
  if (communityApIds.length > 0) {
    await Promise.all(
      communityMemberships.map(async (cm) => {
        const communityApId = cm.community.apId;
        const baseline =
          communityReadMap.get(communityApId) ??
          cm.joinedAt ??
          "1970-01-01T00:00:00Z";
        const result = await db
          .select({ count: count() })
          .from(objects)
          .innerJoin(
            objectRecipients,
            eq(objectRecipients.objectApId, objects.apId),
          )
          .where(
            and(
              eq(objectRecipients.recipientApId, communityApId),
              eq(objectRecipients.type, "audience"),
              eq(objects.type, "Note"),
              isNull(objects.communityApId),
              ne(objects.attributedTo, actor.ap_id),
              sql`${objects.published} > ${baseline}`,
            ),
          )
          .get();
        if (result?.count) {
          communityUnreadCounts.set(communityApId, result.count);
        }
      }),
    );
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
        unread_count: communityUnreadCounts.get(cm.community.apId) || 0,
      };
    })
    .sort(
      (a, b) =>
        byTimeDesc(a.last_message_at, b.last_message_at) ||
        a.name.localeCompare(b.name),
    );

  // Count pending requests: DMs from people we haven't replied to.
  //
  // "Incoming" = direct Notes addressed TO this actor, found via the indexed
  // `object_recipients` link (`recipient_ap_id = <actor>`, `type = 'to'`)
  // instead of an unindexable `to_json LIKE` substring scan. This matches the
  // recipient-membership semantics of the conversation list above; the
  // requests are conversations among these for which the actor has not yet
  // replied (see findRepliedConversations).
  const incomingDMs = await db
    .selectDistinct({
      conversation: objects.conversation,
    })
    .from(objects)
    .innerJoin(objectRecipients, eq(objectRecipients.objectApId, objects.apId))
    .where(
      and(
        eq(objects.visibility, "direct"),
        eq(objects.type, "Note"),
        eq(objectRecipients.recipientApId, actor.ap_id),
        eq(objectRecipients.type, "to"),
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

// GET /contact/:encodedApId - Resolve a single DM contact (user or community)
// by AP-ID. Lets a deep-link to a conversation that is not in the loaded
// contact list (e.g. a brand-new thread, or a community the viewer just
// reached) render instead of dead-ending. Returns a minimal DMContact shape.
contacts.get("/contact/:encodedApId", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");

  const apId = parseOtherApId(c);
  if (!apId) return c.json({ error: "ap_id required" }, 400);

  // Community first: a Group AP-ID resolves to a community contact.
  const community = await db
    .select({
      apId: communities.apId,
      preferredUsername: communities.preferredUsername,
      name: communities.name,
      iconUrl: communities.iconUrl,
      memberCount: communities.memberCount,
    })
    .from(communities)
    .where(eq(communities.apId, apId))
    .get();

  if (community) {
    return c.json({
      contact: {
        type: "community" as const,
        ap_id: community.apId,
        username: formatUsername(community.apId),
        preferred_username: community.preferredUsername,
        name: community.name,
        icon_url: community.iconUrl,
        member_count: community.memberCount,
        last_message: null,
        last_message_at: null,
        unread_count: 0,
      },
    });
  }

  // Otherwise treat it as a user (local actor or cached remote actor).
  const infoMap = await buildActorInfoMap(db, [apId]);
  const info = infoMap.get(apId);
  if (!info) return c.json({ error: "Contact not found" }, 404);

  const profile = formatActorProfile(apId, info);
  return c.json({
    contact: {
      type: "user" as const,
      ...profile,
      conversation_id: null,
      last_message: null,
      last_message_at: null,
      unread_count: 0,
    },
  });
});

// GET /unread/count - lightweight unread DM total for the nav badge.
//
// The Messages badge only needs a number, but the badge poller used to hit the
// full `GET /contacts` every 30s, which enriches every contact with actor info
// and last-message previews and sorts the list — far more work than a count.
// This computes the same DM + community-chat unread totals as `/contacts` (so
// the badge stays consistent) in two COUNT(*) joins, with no enrichment, no
// previews, and no 2000-row materialization. A parity test pins the totals to
// the sum of `unread_count` across `/contacts` so the two cannot drift.
//
// - DM unread: direct Notes addressed TO me (via the object_recipients `to`
//   index), not authored by me, published after my per-conversation read time
//   (epoch if never read), excluding archived conversations.
// - Community unread: group-CHAT Notes (audience-linked, communityApId IS NULL —
//   NOT feed posts) in communities I belong to, not mine, after the later of my
//   per-community read time and my join time.
contacts.get("/unread/count", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const db = c.get("db");
  const me = actor.ap_id;

  const dmRow = await db.get<{ c: number }>(sql`
    SELECT COUNT(*) AS c
    FROM objects o
    JOIN object_recipients orp
      ON orp.object_ap_id = o.ap_id
      AND orp.recipient_ap_id = ${me}
      AND orp.type = 'to'
    LEFT JOIN dm_read_status r
      ON r.conversation_id = o.conversation
      AND r.actor_ap_id = ${me}
    WHERE o.visibility = 'direct'
      AND o.type = 'Note'
      AND o.conversation IS NOT NULL
      AND o.attributed_to != ${me}
      AND o.published > COALESCE(r.last_read_at, '1970-01-01T00:00:00Z')
      AND o.conversation NOT IN (
        SELECT conversation_id FROM dm_archived_conversations
        WHERE actor_ap_id = ${me}
      )
  `);

  const communityRow = await db.get<{ c: number }>(sql`
    SELECT COUNT(*) AS c
    FROM community_members cm
    JOIN object_recipients orp
      ON orp.recipient_ap_id = cm.community_ap_id
      AND orp.type = 'audience'
    JOIN objects o
      ON o.ap_id = orp.object_ap_id
      AND o.type = 'Note'
      AND o.community_ap_id IS NULL
      AND o.attributed_to != ${me}
    LEFT JOIN dm_community_read_status r
      ON r.community_ap_id = cm.community_ap_id
      AND r.actor_ap_id = ${me}
    WHERE cm.actor_ap_id = ${me}
      AND o.published > COALESCE(r.last_read_at, cm.joined_at, '1970-01-01T00:00:00Z')
  `);

  const dm = Number(dmRow?.c ?? 0);
  const community = Number(communityRow?.c ?? 0);
  return c.json({ total: dm + community, dm, community });
});

export default contacts;
