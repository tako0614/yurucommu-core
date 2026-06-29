import { Hono } from "hono";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import {
  activities,
  communities,
  communityMembers,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { formatUsername, generateId } from "../../federation-helpers.ts";
import { feedCursorWhere } from "../../lib/feed-cursor.ts";
import { rateLimit, RateLimitConfigs } from "../../middleware/rate-limit.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
} from "../posts/delete-cascade.ts";
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

// D1's batch() (atomic multi-statement) is only on the concrete D1/libsql
// driver, not the shared `Database` union; reach it through a narrow cast.
type Batchable = {
  batch(statements: readonly unknown[]): Promise<unknown>;
};

const messagesRouter = new Hono<{ Bindings: Env; Variables: Variables }>();

/**
 * Enforce post policy against the actor's membership and role.
 * Returns an error message string if denied, or null if allowed.
 *
 * This is a WRITE policy and must only gate POST/PATCH. Read access is
 * governed separately by `checkReadAccess` (membership / `visibility`), so
 * that e.g. a `post_policy: "mods"` community does not lock ordinary members
 * out of reading channels they are entitled to see.
 */
function checkPostPolicy(
  policy: string,
  visibility: string,
  membership: { role: string } | null,
): string | null {
  const role = membership?.role;
  const isManager = role != null && managerRoles.has(role);

  // A non-public community requires membership to WRITE regardless of policy:
  // read is membership-gated (checkReadAccess), so a private community with
  // post_policy="anyone" must not let a non-member who cannot read it post.
  if (visibility !== "public" && !membership) return "Not a community member";
  if (policy !== "anyone" && !membership) return "Not a community member";
  if (policy === "mods" && !isManager) return "Moderator role required";
  if (policy === "owners" && role !== "owner") return "Owner role required";
  return null;
}

/**
 * Authorize READING community messages based on `visibility` and membership,
 * independent of who may post. Public communities are readable by anyone;
 * private communities require membership. Returns an error message string if
 * denied, or null if allowed.
 */
function checkReadAccess(
  visibility: string,
  membership: { role: string } | null,
): string | null {
  if (visibility === "public") return null;
  if (!membership) return "Not a community member";
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

  const community = await db
    .select()
    .from(communities)
    .where(communityWhere(apId, identifier))
    .get();
  if (!community) {
    return c.json({ error: "Community not found" }, 404);
  }

  const membership = await db
    .select()
    .from(communityMembers)
    .where(memberWhere(community.apId, actor.ap_id))
    .get();

  // Read access is governed by community visibility + membership, NOT by the
  // post policy (which only controls who may write).
  const readError = checkReadAccess(
    community.visibility || "public",
    membership ?? null,
  );
  if (readError) {
    return c.json({ error: readError }, 403);
  }

  // Query objects addressed to this community (via object_recipients) with a
  // single INNER JOIN, NOT a two-step "load every recipient id then IN (...)".
  // The old shape materialized the community's ENTIRE chat history into an
  // `objectApIds` array and an `inArray` bound-parameter list every request:
  // memory O(all messages) and — past SQLite's bound-variable ceiling — a hard
  // error on a busy channel. The join filters on the indexed `recipient_ap_id`
  // and pages with LIMIT, so the work is bounded by the page size.
  //
  // The group-chat reader must return CHAT messages only, not community feed
  // posts. Feed posts are stored with `communityApId` set (and are surfaced by
  // the community-scoped feed), whereas chat messages are addressed purely via
  // object_recipients and leave `communityApId` NULL. Filtering on
  // `communityApId IS NULL` keeps the chat object-set disjoint from the feed
  // object-set, matching the unread count in GET /dm/contacts.
  const whereConditions = [
    eq(objectRecipients.recipientApId, community.apId),
    eq(objectRecipients.type, "audience"),
    eq(objects.type, "Note"),
    isNull(objects.communityApId),
  ];
  // Composite (published, apId) cursor so same-millisecond messages aren't
  // skipped on a load-older boundary (see lib/feed-cursor.ts).
  const chatCursor = feedCursorWhere(objects.published, objects.apId, before);
  if (chatCursor) whereConditions.push(chatCursor);

  // Fetch one extra to detect whether an OLDER page exists (powers the thread's
  // "load older" affordance; `before` is the oldest shown message's cursor).
  const fetched = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      content: objects.content,
      published: objects.published,
    })
    .from(objectRecipients)
    .innerJoin(objects, eq(objectRecipients.objectApId, objects.apId))
    .where(and(...whereConditions))
    .orderBy(desc(objects.published), desc(objects.apId))
    .limit(limit + 1);
  const hasMore = fetched.length > limit;
  const messages = hasMore ? fetched.slice(0, limit) : fetched;

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

  return c.json({ messages: result, has_more: hasMore });
});

// POST /api/communities/:name/messages - Send a chat message
// Rate-limited as a publish-like write (per-actor), not under the general bucket.
messagesRouter.post(
  "/:identifier/messages",
  rateLimit(RateLimitConfigs.communityMessage),
  async (c) => {
    const actor = c.get("actor");
    if (!actor) return c.json({ error: "Unauthorized" }, 401);

    const identifier = c.req.param("identifier")!;
    const db = c.get("db");
    const baseUrl = c.env.APP_URL;
    const apId = resolveCommunityApId(baseUrl, identifier);
    const body = await c.req.json<{ content: string }>();

    // Guard non-string content before .trim() (else TypeError → 500).
    if (typeof body.content !== "string") {
      return c.json({ error: "Message content is required" }, 400);
    }
    const content = body.content.trim();
    if (!content) {
      return c.json({ error: "Message content is required" }, 400);
    }
    if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
      return c.json(
        {
          error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)`,
        },
        400,
      );
    }

    const community = await db
      .select()
      .from(communities)
      .where(communityWhere(apId, identifier))
      .get();
    if (!community) {
      return c.json({ error: "Community not found" }, 404);
    }

    const membership = await db
      .select()
      .from(communityMembers)
      .where(memberWhere(community.apId, actor.ap_id))
      .get();

    const policyError = checkPostPolicy(
      community.postPolicy || "members",
      community.visibility || "public",
      membership ?? null,
    );
    if (policyError) {
      return c.json(
        {
          error:
            policyError === "Not a community member"
              ? "Not a member"
              : policyError,
        },
        403,
      );
    }

    const objectId = generateId();
    const objectApId = `${baseUrl}/ap/objects/${objectId}`;
    const now = new Date().toISOString();

    const toJson = JSON.stringify([community.apId]);
    const audienceJson = JSON.stringify([community.apId]);

    const activityId = generateId();
    const activityApIdVal = `${baseUrl}/ap/activities/${activityId}`;

    // Persist the chat message atomically: the Note, its community-audience
    // recipient row (which the GET-messages reader joins on), the Create
    // activity, and the community's lastMessageAt. D1 has no interactive
    // transactions; batch() is atomic, so a mid-write failure can no longer
    // leave an orphan Note with no recipient row. The recipient row is a plain
    // Drizzle insert now that recipient_ap_id no longer has a (wrong) FK to
    // actors — a community apId is a valid recipient (migration 0010).
    await (db as unknown as Batchable).batch([
      db.insert(objects).values({
        apId: objectApId,
        type: "Note",
        attributedTo: actor.ap_id,
        content,
        toJson,
        audienceJson,
        visibility: "unlisted",
        published: now,
        isLocal: 1,
      }),
      db.insert(objectRecipients).values({
        objectApId,
        recipientApId: community.apId,
        type: "audience",
        createdAt: now,
      }),
      db.insert(activities).values({
        apId: activityApIdVal,
        type: "Create",
        actorApId: actor.ap_id,
        objectApId,
        rawJson: JSON.stringify({ to: JSON.parse(toJson) }),
      }),
      db
        .update(communities)
        .set({ lastMessageAt: now })
        .where(eq(communities.apId, community.apId)),
    ]);

    return c.json(
      {
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
      },
      201,
    );
  },
);

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
  // Guard non-string content before .trim() (else TypeError → 500).
  if (typeof body.content !== "string") {
    return c.json({ error: "Message content is required" }, 400);
  }
  const content = body.content.trim();
  if (!content) {
    return c.json({ error: "Message content is required" }, 400);
  }
  if (content.length > MAX_COMMUNITY_MESSAGE_LENGTH) {
    return c.json(
      {
        error: `Message too long (max ${MAX_COMMUNITY_MESSAGE_LENGTH} chars)`,
      },
      400,
    );
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

  const message = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
    })
    .from(objects)
    .where(eq(objects.apId, messageId))
    .get();
  if (!message) {
    return c.json({ error: "Message not found" }, 404);
  }

  // Membership / read gate: a kicked or never-member actor must NOT mutate chat
  // content. The author check below is not sufficient — a removed author keeps
  // their message id + authorship and could otherwise keep rewriting a private
  // community's history. Mirrors the GET reader (checkReadAccess) + POST gate.
  const communityRow = await db
    .select({ visibility: communities.visibility })
    .from(communities)
    .where(eq(communities.apId, community.apId))
    .get();
  const membership = await db
    .select({ role: communityMembers.role })
    .from(communityMembers)
    .where(memberWhere(community.apId, actor.ap_id))
    .get();
  const readError = checkReadAccess(
    communityRow?.visibility || "public",
    membership ?? null,
  );
  if (readError) return c.json({ error: readError }, 403);

  if (message.attributedTo !== actor.ap_id) {
    return c.json({ error: "Only the author can edit this message" }, 403);
  }

  await db
    .update(objects)
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

  const message = await db
    .select({
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
  const membership = await db
    .select()
    .from(communityMembers)
    .where(memberWhere(community.apId, actor.ap_id))
    .get();

  // Membership / read gate first: a kicked or never-member author must not keep
  // deleting a private community's history. (A manager is always a member.)
  const communityRow = await db
    .select({ visibility: communities.visibility })
    .from(communities)
    .where(eq(communities.apId, community.apId))
    .get();
  const readError = checkReadAccess(
    communityRow?.visibility || "public",
    membership ?? null,
  );
  if (readError) return c.json({ error: readError }, 403);

  const isAuthor = message.attributedTo === actor.ap_id;
  const isManager = membership && managerRoles.has(membership.role);

  if (!isAuthor && !isManager) {
    return c.json({ error: "Permission denied" }, 403);
  }

  // Route through the shared object cascade so a chat message's interaction rows
  // (likes/announces/bookmarks/object_recipients/story_*) and any attached R2
  // blob + media_uploads row are reaped deterministically — the runtime's
  // ON DELETE CASCADE is not relied upon (self-host libsql may run with FK
  // enforcement off). Then drop the object row and purge blobs last.
  const mediaKeys = await deleteObjectCascade(db, messageId, c.env.MEDIA);
  await db.delete(objects).where(eq(objects.apId, messageId));
  await purgeMediaBlobs(c.env.MEDIA, mediaKeys);

  return c.json({ success: true });
});

export default messagesRouter;
