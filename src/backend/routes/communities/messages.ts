import { Hono } from "hono";
import {
  and,
  desc,
  eq,
  getTableColumns,
  isNull,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import {
  activities,
  communities,
  communityMembers,
  dmCommunityReadStatus,
  notificationPushers,
  notificationPushJobs,
  objectRecipients,
  objects,
  type Database,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import {
  formatUsername,
  generateId,
  safeJsonParse,
} from "../../federation-helpers.ts";
import { feedCursorWhere } from "../../lib/feed-cursor.ts";
import {
  type ChatAttachment,
  validateChatAttachments,
} from "../../lib/attachments.ts";
import {
  communityRequiresMembership,
  MEMBERSHIP_REQUIRED_VISIBILITIES,
} from "../../lib/community-visibility.ts";
import { admissionGuard } from "../../lib/account-deletion-admission.ts";
import { bytesToHex } from "../../lib/hex.ts";
import { createGuardedDatabase } from "../../../db/guarded-writes.ts";
import { rateLimit, RateLimitConfigs } from "../../middleware/rate-limit.ts";
import {
  emitRealtimeBestEffort,
  emitUnreadSnapshot,
  isRealtimeAvailable,
  runRealtimeAfterResponse,
} from "../../runtime/realtime-hub.ts";
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
import { operatorActorNotBlockedSql } from "../../lib/blocklist.ts";

const MAX_COMMUNITY_MESSAGE_LENGTH = 5000;
const MAX_COMMUNITY_MESSAGES_LIMIT = 100;
// Cap the per-member read receipts returned alongside a page so a very large
// community's chat reader stays bounded regardless of local-member count.
const MAX_COMMUNITY_READ_STATES = 200;

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
 * This is the new-message WRITE policy. Existing author edits retain their
 * read-access + authorship contract rather than requiring a new posting role. Read access is
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
  if (communityRequiresMembership(visibility) && !membership)
    return "Not a community member";
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
  if (!communityRequiresMembership(visibility)) return null;
  if (!membership) return "Not a community member";
  return null;
}

/** The same current community membership rule as the chat reader. */
function groupReadScope(
  db: Database,
  communityApId: string,
  actorApId: string,
) {
  const member = db
    .select({ id: communityMembers.actorApId })
    .from(communityMembers)
    .where(memberWhere(communityApId, actorApId));
  const group = db
    .select({ id: communities.apId })
    .from(communities)
    .where(
      and(
        eq(communities.apId, communityApId),
        isNull(communities.deletedAt),
        or(
          isNull(communities.visibility),
          notInArray(communities.visibility, [
            ...MEMBERSHIP_REQUIRED_VISIBILITIES,
          ]),
          sql`EXISTS ${member}`,
        ),
      ),
    );
  return sql`EXISTS ${group}`;
}

function groupMessageScope(
  db: Database,
  id: string,
  communityApId: string,
  actorApId: string,
) {
  const addressed = db
    .select({ id: objectRecipients.objectApId })
    .from(objectRecipients)
    .where(
      and(
        eq(objectRecipients.objectApId, objects.apId),
        eq(objectRecipients.recipientApId, communityApId),
        eq(objectRecipients.type, "audience"),
      ),
    );
  return and(
    eq(objects.apId, id),
    eq(objects.type, "Note"),
    isNull(objects.communityApId),
    isNull(objects.deletedAt),
    sql`EXISTS ${addressed}`,
    groupReadScope(db, communityApId, actorApId),
    operatorActorNotBlockedSql(sql`${objects.attributedTo}`),
  );
}

type OwnedGroupMessage = typeof objects.$inferSelect;
class GroupMessageChangedError extends Error {}

async function findOwnedGroupMessage(
  c: Parameters<typeof fetchCommunityId>[0],
  identifier: string,
  id: string,
  actorApId: string,
) {
  const db = c.get("db"),
    { community } = await fetchCommunityId(c, identifier);
  if (!community) return { error: "Community not found", status: 404 as const };
  // Gate the selected payload in its actual SQL read, not only an earlier JS check.
  const allowed = await db
    .select({ allowed: groupReadScope(db, community.apId, actorApId) })
    .from(communities)
    .where(eq(communities.apId, community.apId))
    .get();
  if (!allowed?.allowed)
    return { error: "Community is not readable", status: 403 as const };
  const message = await db
    .select()
    .from(objects)
    .where(groupMessageScope(db, id, community.apId, actorApId))
    .get();
  if (!message) {
    const current = await db
      .select({ allowed: groupReadScope(db, community.apId, actorApId) })
      .from(communities)
      .where(eq(communities.apId, community.apId))
      .get();
    return current?.allowed
      ? { error: "owned_group_message_not_found", status: 404 as const }
      : { error: "Community is not readable", status: 403 as const };
  }
  if (message.attributedTo !== actorApId)
    return {
      error: "Only the author can edit this message",
      status: 403 as const,
    };
  return { message, communityApId: community.apId };
}

async function groupMessageRevision(
  message: OwnedGroupMessage,
  communityApId: string,
) {
  const value = JSON.stringify([
    communityApId,
    message.apId,
    message.attributedTo,
    message.content,
    message.published,
    message.updated,
    message.attachmentsJson,
    message.toJson,
    message.ccJson,
    message.audienceJson,
    message.conversation,
    message.visibility,
    message.isLocal,
  ]);
  return (
    "group-message-v1:" +
    bytesToHex(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      ),
    )
  );
}

function guardGroupMessage(
  db: Database,
  message: OwnedGroupMessage,
  communityApId: string,
  actorApId: string,
) {
  const selected = db
    .select({ id: objects.apId })
    .from(objects)
    .where(
      and(
        groupMessageScope(db, message.apId, communityApId, actorApId),
        eq(objects.attributedTo, actorApId),
        sql`${objects.content} IS ${message.content}`,
        sql`${objects.published} IS ${message.published}`,
        sql`${objects.updated} IS ${message.updated}`,
        eq(objects.attachmentsJson, message.attachmentsJson),
        eq(objects.toJson, message.toJson),
        eq(objects.ccJson, message.ccJson),
        eq(objects.audienceJson, message.audienceJson),
        sql`${objects.conversation} IS ${message.conversation}`,
        eq(objects.visibility, message.visibility),
        eq(objects.isLocal, message.isLocal),
      ),
    );
  return createGuardedDatabase(db, () =>
    admissionGuard(
      db,
      sql`EXISTS ${selected}`,
      () => new GroupMessageChangedError(),
    ),
  );
}

// Author-only exact readback, including messages outside the latest page.
messagesRouter.get("/:identifier/messages/:messageId", async (c) => {
  c.header("cache-control", "no-store");
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const found = await findOwnedGroupMessage(
    c,
    c.req.param("identifier"),
    c.req.param("messageId"),
    actor.ap_id,
  );
  if ("error" in found)
    return c.json(
      {
        error: found.error,
        ...(found.error === "owned_group_message_not_found"
          ? { code: found.error }
          : {}),
      },
      found.status,
    );
  const { message, communityApId } = found,
    revision = await groupMessageRevision(message, communityApId);
  c.header("etag", JSON.stringify(revision));
  return c.json({
    revision,
    community_ap_id: communityApId,
    message: {
      id: message.apId,
      content: message.content,
      created_at: message.published,
      attachments: safeJsonParse<ChatAttachment[]>(message.attachmentsJson, []),
      sender: {
        ap_id: actor.ap_id,
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url,
      },
    },
  });
});

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
    // A partial purge may retain remote chat objects. Defederation must hide
    // them before cursor/limit so they cannot consume or shorten the page.
    operatorActorNotBlockedSql(sql`${objects.attributedTo}`),
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
      attachmentsJson: objects.attachmentsJson,
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
        username: formatUsername(
          msg.attributedTo,
          senderInfo?.preferredUsername,
        ),
        preferred_username: senderInfo?.preferredUsername || null,
        name: senderInfo?.name || null,
        icon_url: senderInfo?.iconUrl || null,
      },
      content: msg.content,
      attachments: safeJsonParse<ChatAttachment[]>(msg.attachmentsJson, []),
      created_at: msg.published,
    };
  });

  // Per-member read positions (LOCAL-ONLY read receipts): rows exist only for
  // local members that marked the chat read — read state is never federated,
  // so remote members simply never appear here. Restricted to CURRENT members
  // so a kicked member's stale row doesn't leak into the read count, and capped
  // (most-recently-read first) so a huge community can't return an unbounded
  // receipt list on every page fetch.
  const readStates = await db
    .select({
      actorApId: dmCommunityReadStatus.actorApId,
      lastReadAt: dmCommunityReadStatus.lastReadAt,
    })
    .from(dmCommunityReadStatus)
    .innerJoin(
      communityMembers,
      and(
        eq(communityMembers.communityApId, dmCommunityReadStatus.communityApId),
        eq(communityMembers.actorApId, dmCommunityReadStatus.actorApId),
      ),
    )
    .where(
      and(
        eq(dmCommunityReadStatus.communityApId, community.apId),
        sql`NOT EXISTS (
      SELECT 1 FROM talk_read_modes mode WHERE mode.actor_ap_id = ${dmCommunityReadStatus.actorApId}
        AND mode.kind = 'community' AND mode.target_ap_id = ${community.apId}
        AND mode.thread_id = ${community.apId} AND mode.epoch = ${communityMembers.joinedAt})`,
      ),
    )
    .orderBy(desc(dmCommunityReadStatus.lastReadAt))
    .limit(MAX_COMMUNITY_READ_STATES);

  return c.json({
    messages: result,
    has_more: hasMore,
    read_observed: { version: 1, max_ids: 50 },
    read_states: readStates.map((r) => ({
      actor_ap_id: r.actorApId,
      last_read_at: r.lastReadAt,
    })),
  });
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
    const body = await c.req.json<{
      content?: string;
      attachments?: unknown;
    }>();

    const attachmentsResult = validateChatAttachments(body.attachments);
    if (!attachmentsResult.ok) {
      return c.json({ error: attachmentsResult.error }, 400);
    }
    const attachments = attachmentsResult.attachments;

    // Guard non-string content before .trim() (else TypeError → 500). An
    // attachment-only message (image send) carries no text.
    const rawContent = body.content;
    if (
      typeof rawContent !== "string" &&
      !(
        attachments.length > 0 &&
        (rawContent === undefined || rawContent === null)
      )
    ) {
      return c.json({ error: "Message content is required" }, 400);
    }
    const content = typeof rawContent === "string" ? rawContent.trim() : "";
    if (!content && attachments.length === 0) {
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

    // Community talk deliberately has no social-inbox row, so its durable push
    // jobs must commit with the message itself. Resolve only members that own a
    // Yurume pusher at event time; delivery re-checks membership before egress.
    // Set-based fanout stays one statement regardless of community size. It
    // shares the message transaction, so neither orphan messages nor partial
    // notification populations can survive a later failure.
    const jobValues: Record<
      keyof typeof notificationPushJobs.$inferSelect,
      unknown
    > = {
      id: sql`${notificationPushers.actorApId} || char(10) || ${activityApIdVal}`,
      actorApId: notificationPushers.actorApId,
      activityApId: sql`${activityApIdVal}`,
      product: sql`'yurume'`,
      status: sql`'pending'`,
      processingToken: sql`NULL`,
      attempts: sql`0`,
      pendingPusherIdsJson: sql`NULL`,
      nextAttemptAt: sql`${now}`,
      lastError: sql`NULL`,
      createdAt: sql`${now}`,
      updatedAt: sql`${now}`,
      deliveredAt: sql`NULL`,
    };
    const pushColumns = Object.keys(getTableColumns(notificationPushJobs)).map(
      (key) => jobValues[key as keyof typeof jobValues] as SQL,
    );
    const pushJobs = db
      .insert(notificationPushJobs)
      .select(
        sql`
      SELECT DISTINCT ${sql.join(pushColumns, sql`, `)}
      FROM ${notificationPushers}
      INNER JOIN ${communityMembers}
        ON ${communityMembers.actorApId} = ${notificationPushers.actorApId}
      WHERE ${communityMembers.communityApId} = ${community.apId}
        AND ${notificationPushers.product} = 'yurume'
        AND ${notificationPushers.actorApId} <> ${actor.ap_id}
        AND NOT EXISTS (SELECT 1 FROM account_deletion_targets
          WHERE actor_ap_id = ${notificationPushers.actorApId})
    `,
      )
      .onConflictDoNothing();

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
        attachmentsJson: JSON.stringify(attachments),
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
      pushJobs,
    ]);

    const messagePayload = {
      id: objectApId,
      sender: {
        ap_id: actor.ap_id,
        username: formatUsername(actor.ap_id, actor.preferred_username),
        preferred_username: actor.preferred_username,
        name: actor.name,
        icon_url: actor.icon_url,
      },
      content,
      attachments,
      created_at: now,
    };

    // Realtime fanout to LOCAL members (best-effort, after the response).
    // Community talk has no inbox row, so the shared notification sweep never
    // sees it — this direct emit is the only realtime path. Membership rows
    // exist only for local members (remote membership is a follows edge), and
    // the fanout is capped so a huge community cannot stall the writer.
    if (isRealtimeAvailable(c.env)) {
      const communityApIdForEmit = community.apId;
      await runRealtimeAfterResponse(c, async () => {
        const members = await db
          .select({ actorApId: communityMembers.actorApId })
          .from(communityMembers)
          .where(eq(communityMembers.communityApId, communityApIdForEmit))
          .limit(200);
        await emitRealtimeBestEffort(
          c.env,
          members.map(({ actorApId }) => ({
            actorApId,
            type: "talk.message",
            data: {
              kind: "community",
              community_ap_id: communityApIdForEmit,
              message: messagePayload,
            },
          })),
        );
        await Promise.all(
          members
            .filter(({ actorApId }) => actorApId !== actor.ap_id)
            .map(({ actorApId }) => emitUnreadSnapshot(c.env, actorApId)),
        );
      });
    }

    return c.json({ message: messagePayload }, 201);
  },
);

// PATCH /api/communities/:identifier/messages/:messageId - Edit a message
messagesRouter.patch("/:identifier/messages/:messageId", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const identifier = c.req.param("identifier")!;
  const messageId = c.req.param("messageId")!;
  const db = c.get("db");

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

  const found = await findOwnedGroupMessage(
    c,
    identifier,
    messageId,
    actor.ap_id,
  );
  if ("error" in found) return c.json({ error: found.error }, found.status);
  const { message, communityApId } = found,
    revision = await groupMessageRevision(message, communityApId);
  const header = c.req.header("if-match");
  if (header !== undefined) {
    if (!/^"group-message-v1:[a-f0-9]{64}"$/.test(header))
      return c.json({ error: "Invalid If-Match" }, 400);
    if (header !== JSON.stringify(revision))
      return c.json({ error: "message_changed" }, 409);
  }
  const now = new Date().toISOString();
  try {
    await guardGroupMessage(db, message, communityApId, actor.ap_id)
      .update(objects)
      .set({ content, updated: now })
      .where(eq(objects.apId, messageId));
  } catch (error) {
    if (!(error instanceof GroupMessageChangedError)) throw error;
    return c.json({ error: "message_changed" }, 409);
  }
  return c.json({
    success: true,
    community_ap_id: communityApId,
    message: { id: messageId, content, updated_at: now },
    revision: await groupMessageRevision(
      { ...message, content, updated: now },
      communityApId,
    ),
  });
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
  await purgeMediaBlobs(db, c.env.MEDIA, mediaKeys);

  return c.json({ success: true });
});

export default messagesRouter;
