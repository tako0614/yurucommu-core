import { Hono } from "hono";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import {
  activities,
  communities,
  communityMembers,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { formatUsername, generateId } from "../../federation-helpers.ts";
import {
  batchLoadActorInfo,
  communityWhere,
  fetchCommunityId,
  managerRoles,
  memberWhere,
  resolveCommunityApId,
} from "./membership-shared.ts";

const MAX_COMMUNITY_MESSAGE_LENGTH = 5000;
const MAX_COMMUNITY_MESSAGES_LIMIT = 100;

const messagesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Enforce post policy against the actor's membership and role.
 * Returns an error message string if denied, or null if allowed.
 */
function checkPostPolicy(
  policy: string,
  membership: { role: string } | null,
): string | null {
  const role = membership?.role;
  const isManager = role != null && managerRoles.has(role);

  if (policy !== "anyone" && !membership) return "Not a community member";
  if (policy === "mods" && !isManager) return "Moderator role required";
  if (policy === "owners" && role !== "owner") return "Owner role required";
  return null;
}

// GET /api/communities/:name/messages - Get chat messages
messagesRouter.get("/:identifier/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const identifier = c.req.param("identifier")!;
  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const apId = resolveCommunityApId(baseUrl, identifier);
  const rawLimit = parseInt(c.req.query("limit") || "50", 10);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(rawLimit, 1), MAX_COMMUNITY_MESSAGES_LIMIT)
    : 50;
  const before = c.req.query("before");

  const community = await db.select().from(communities)
    .where(communityWhere(apId, identifier))
    .get();
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }

  const membership = await db.select().from(communityMembers)
    .where(memberWhere(community.apId, actor.ap_id))
    .get();

  const policyError = checkPostPolicy(
    community.postPolicy || "members",
    membership ?? null,
  );
  if (policyError) {
    return c.json({ error: policyError }, 403);
  }

  // Query objects addressed to this community (via object_recipients)
  const recipients = await db.select({
    objectApId: objectRecipients.objectApId,
  })
    .from(objectRecipients)
    .where(and(
      eq(objectRecipients.recipientApId, community.apId),
      eq(objectRecipients.type, "audience"),
    ));

  const objectApIds = recipients.map((r) => r.objectApId);
  if (objectApIds.length === 0) {
    return c.json({ messages: [] });
  }

  const whereConditions = [
    inArray(objects.apId, objectApIds),
    eq(objects.type, "Note"),
  ];
  if (before) {
    whereConditions.push(lt(objects.published, before));
  }

  const messages = await db.select().from(objects)
    .where(and(...whereConditions))
    .orderBy(desc(objects.published))
    .limit(limit);

  const senderApIds = [...new Set(messages.map((msg) => msg.attributedTo))];
  const actorInfoMap = await batchLoadActorInfo(db, senderApIds);

  const result = messages.reverse().map((msg) => {
    const senderInfo = actorInfoMap.get(msg.attributedTo);
    return {
      id: msg.apId,
      sender: {
        ap_id: msg.attributedTo,
        username: formatUsername(msg.attributedTo),
        preferred_username: senderInfo?.preferredUsername || null,
        name: senderInfo?.name || null,
        icon_url: senderInfo?.iconUrl || null,
      },
      content: msg.content,
      created_at: msg.published,
    };
  });

  return c.json({ messages: result });
});

// POST /api/communities/:name/messages - Send a chat message
messagesRouter.post("/:identifier/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const identifier = c.req.param("identifier")!;
  const db = c.get("db");
  const baseUrl = c.env.APP_URL;
  const apId = resolveCommunityApId(baseUrl, identifier);
  const body = await c.req.json<{ content: string }>();

  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: "Message content is required" }, 400);
  }
  if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
    return c.json({
      error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)`,
    }, 400);
  }

  const community = await db.select().from(communities)
    .where(communityWhere(apId, identifier))
    .get();
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }

  const membership = await db.select().from(communityMembers)
    .where(memberWhere(community.apId, actor.ap_id))
    .get();

  const policyError = checkPostPolicy(
    community.postPolicy || "members",
    membership ?? null,
  );
  if (policyError) {
    return c.json({
      error: policyError === "Not a community member"
        ? "Not a member"
        : policyError,
    }, 403);
  }

  const objectId = generateId();
  const objectApId = `${baseUrl}/ap/objects/${objectId}`;
  const now = new Date().toISOString();

  const toJson = JSON.stringify([community.apId]);
  const audienceJson = JSON.stringify([community.apId]);

  await db.insert(objects).values({
    apId: objectApId,
    type: "Note",
    attributedTo: actor.ap_id,
    content,
    toJson,
    audienceJson,
    visibility: "unlisted",
    published: now,
    isLocal: 1,
  });

  // Insert object_recipient using raw SQL to bypass FK constraint (ObjectRecipient FK expects Actor, not Community)
  await db.run(sql`
    INSERT INTO object_recipients (object_ap_id, recipient_ap_id, type, created_at)
    VALUES (${objectApId}, ${community.apId}, 'audience', ${now})
  `);

  const activityId = generateId();
  const activityApIdVal = `${baseUrl}/ap/activities/${activityId}`;
  await db.insert(activities).values({
    apId: activityApIdVal,
    type: "Create",
    actorApId: actor.ap_id,
    objectApId,
    rawJson: JSON.stringify({ to: JSON.parse(toJson) }),
  });

  await db.update(communities)
    .set({ lastMessageAt: now })
    .where(eq(communities.apId, community.apId));

  return c.json({
    message: {
      id: objectApId,
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

// PATCH /api/communities/:identifier/messages/:messageId - Edit a message
messagesRouter.patch("/:identifier/messages/:messageId", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const identifier = c.req.param("identifier")!;
  const messageId = decodeURIComponent(c.req.param("messageId")!);
  const db = c.get("db");

  const { community } = await fetchCommunityId(c, identifier);
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }

  const body = await c.req.json<{ content: string }>();
  const content = body.content?.trim();
  if (!content) {
    return c.json({ error: "Message content is required" }, 400);
  }
  if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
    return c.json({
      error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)`,
    }, 400);
  }

  // Check message exists and belongs to community (using raw SQL since ObjectRecipient FK expects Actor)
  const recipientRows = await db.all<{ object_ap_id: string }>(sql`
    SELECT object_ap_id FROM object_recipients
    WHERE object_ap_id = ${messageId} AND recipient_ap_id = ${community.apId} AND type = 'audience'
    LIMIT 1
  `);
  if (recipientRows.length === 0) {
    return c.json({ error: "Message not found" }, 404);
  }

  const message = await db.select({
    apId: objects.apId,
    attributedTo: objects.attributedTo,
  })
    .from(objects)
    .where(eq(objects.apId, messageId))
    .get();
  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }

  if (message.attributedTo !== actor.ap_id) {
    return c.json({ error: "Only the author can edit this message" }, 403);
  }

  await db.update(objects)
    .set({ content, updated: new Date().toISOString() })
    .where(eq(objects.apId, messageId));

  return c.json({ success: true });
});

// DELETE /api/communities/:identifier/messages/:messageId - Delete a message
messagesRouter.delete("/:identifier/messages/:messageId", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const identifier = c.req.param("identifier")!;
  const messageId = decodeURIComponent(c.req.param("messageId")!);
  const db = c.get("db");

  const { community } = await fetchCommunityId(c, identifier);
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }

  // Check message exists and belongs to community
  const recipientsForDelete = await db.all<{ object_ap_id: string }>(sql`
    SELECT object_ap_id FROM object_recipients
    WHERE object_ap_id = ${messageId} AND recipient_ap_id = ${community.apId} AND type = 'audience'
    LIMIT 1
  `);
  if (recipientsForDelete.length === 0) {
    return c.json({ error: "Message not found" }, 404);
  }

  const message = await db.select({
    apId: objects.apId,
    attributedTo: objects.attributedTo,
  })
    .from(objects)
    .where(eq(objects.apId, messageId))
    .get();
  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }

  // Check permission: author can delete, or moderator/owner can delete any
  const membership = await db.select().from(communityMembers)
    .where(memberWhere(community.apId, actor.ap_id))
    .get();

  const isAuthor = message.attributedTo === actor.ap_id;
  const isManager = membership && managerRoles.has(membership.role);

  if (!isAuthor && !isManager) {
    return c.json({ error: "Permission denied" }, 403);
  }

  await db.run(
    sql`DELETE FROM object_recipients WHERE object_ap_id = ${messageId}`,
  );
  await db.delete(objects).where(eq(objects.apId, messageId));

  return c.json({ success: true });
});

export default messagesRouter;
