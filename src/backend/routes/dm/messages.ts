// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from "hono";
import { and, desc, eq, inArray, like, or } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  activities,
  actorCache,
  actors,
  blocks,
  dmReadStatus,
  inbox as inboxTable,
  messageStampRefs,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
} from "../posts/delete-cascade.ts";
import type { Env, Variables } from "../../types.ts";
import {
  activityApId,
  formatUsername,
  generateId,
  isLocal,
  objectApId,
  parseLimit,
  safeJsonParse,
} from "../../federation-helpers.ts";
import {
  MAX_DM_CONTENT_LENGTH,
  MAX_DM_PAGE_LIMIT,
  resolveConversationId,
} from "./query-helpers.ts";
import { recipientObjectIds } from "./conversations-helpers.ts";
import { enqueueDeliveryToActor } from "../../lib/delivery/queue.ts";
import {
  emitRealtimeBestEffort,
  runRealtimeAfterResponse,
} from "../../runtime/realtime-hub.ts";
import { feedCursorWhere } from "../../lib/feed-cursor.ts";
import { toApAttachments } from "../../lib/activitypub-helpers.ts";
import { OBJECT_CONTEXT } from "../../lib/ap-context.ts";
import { validateChatAttachments } from "../../lib/attachments.ts";
import { logger } from "../../lib/logger.ts";
import { isActorBlockedStrict } from "../../lib/blocklist.ts";
import { deleteActivitiesCascade } from "../../lib/activity-delete-cascade.ts";
import {
  messageStampSnapshotFromProjection,
  recordStampRecent,
  resolveSendableStamp,
} from "../../lib/stamps.ts";

const log = logger.child({ component: "dm.messages" });

// `.batch` lives only on the concrete D1/libsql subclasses, not the Database
// union; reach it through a narrow structural cast (matching the other routes).
type Batchable = { batch: (stmts: unknown[]) => Promise<unknown> };

const dm = new Hono<{ Bindings: Env; Variables: Variables }>();

type Attachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

// --- Shared helpers (file-local) ---

type ActorInfo = {
  apId: string;
  preferredUsername: string | null;
  name: string | null;
  iconUrl: string | null;
};

type SenderInfo = {
  ap_id: string;
  username: string;
  preferred_username: string | null;
  name: string | null;
  icon_url: string | null;
};

// Only the columns the authorization filter + formatter touch (the fetch query
// projects exactly these — see fetchAuthorizedMessages; avoids pulling raw_json
// on the 4s-polled endpoint).
type DmMessageRow = Pick<
  typeof objects.$inferSelect,
  "apId" | "attributedTo" | "content" | "attachmentsJson" | "published"
> & {
  stampUri: string | null;
  packUri: string | null;
  revisionDigest: string | null;
  remoteAssetUrl: string | null;
  localAssetR2Key: string | null;
  stampMediaType: string | null;
  stampWidth: number | null;
  stampHeight: number | null;
  assetSha256: string | null;
  stampAltText: string | null;
};

type DmMessageResponse = {
  id: string;
  sender: SenderInfo;
  content: string | null;
  attachments?: Attachment[];
  stamp?: ReturnType<typeof messageStampSnapshotFromProjection>;
  created_at: string | null;
};

/**
 * Validate trimmed DM content; returns the trimmed string or an error response.
 * With `allowEmpty` (an attachment-only message) an empty/absent content is
 * accepted and normalized to "".
 */
function validateContent(
  raw: unknown,
  allowEmpty = false,
): string | { error: string; status: 400 } {
  // The json<{content:string}>() cast is compile-time only; a client can send a
  // non-string. Guard before .trim() else TypeError → 500 (the global handler
  // deliberately does not mask TypeError as 400). Mirrors the profile/post/invite
  // validators.
  if (typeof raw !== "string") {
    if (allowEmpty && (raw === undefined || raw === null)) return "";
    return { error: "Message content is required", status: 400 };
  }
  const content = raw.trim();
  if (!content) {
    if (allowEmpty) return "";
    return { error: "Message content is required", status: 400 };
  }
  if (content.length > MAX_DM_CONTENT_LENGTH) {
    return {
      error: `Message too long (max ${MAX_DM_CONTENT_LENGTH} chars)`,
      status: 400,
    };
  }
  return content;
}

/**
 * Resolve a `user@domain` handle for a DM recipient. Prefers the stored
 * preferredUsername paired with the recipient's host, falling back to
 * deriving the handle from the actor id (`formatUsername`).
 */
function resolveRecipientHandle(
  preferredUsername: string | null,
  apId: string,
): string {
  if (preferredUsername) {
    try {
      return `${preferredUsername}@${new URL(apId).host}`;
    } catch {
      // fall through to apId-derived handle
    }
  }
  return formatUsername(apId);
}

/** Build a sender info object from a current-session actor. */
function buildSenderFromActor(actor: {
  ap_id: string;
  preferred_username: string | null;
  name: string | null;
  icon_url: string | null;
}): SenderInfo {
  return {
    ap_id: actor.ap_id,
    username: formatUsername(actor.ap_id, actor.preferred_username),
    preferred_username: actor.preferred_username,
    name: actor.name,
    icon_url: actor.icon_url,
  };
}

/**
 * Fetch direct messages the actor is authorized to see, filtered by
 * conversation. Returns one page (newest-first, capped at `limit`) plus
 * `hasMore` — whether an OLDER page exists — so the thread can offer a "load
 * older" affordance. `before` is the `published` of the oldest message already
 * shown (older messages are fetched with `published < before`).
 */
async function fetchAuthorizedMessages(
  db: Database,
  actorApId: string,
  conversationId: string,
  limit: number,
  before: string | undefined,
): Promise<{ rows: DmMessageRow[]; hasMore: boolean }> {
  // Authorization is part of the SQL set, not a post-query to_json filter.
  // Hidden bto/bcc recipients intentionally do not appear in to_json; their
  // indexed object_recipients link is the read authority used everywhere else
  // in the DM subsystem. Keeping the predicate inside the query also makes the
  // limit+1 pagination signal exact after authorization.
  const baseCondition = and(
    eq(objects.visibility, "direct"),
    eq(objects.type, "Note"),
    eq(objects.conversation, conversationId),
    or(
      eq(objects.attributedTo, actorApId),
      inArray(objects.apId, recipientObjectIds(db, actorApId)),
    ),
  );

  // Composite (published, apId) cursor so two messages sharing a published
  // millisecond aren't skipped on a load-older that straddles that ms (see
  // lib/feed-cursor.ts). The client builds the cursor from the oldest shown
  // message; a published-only value from an older client is still accepted.
  const cursor = feedCursorWhere(objects.published, objects.apId, before);
  const whereClause = cursor ? and(baseCondition!, cursor) : baseCondition;

  // Fetch one extra row to detect whether an older page exists. Project only the
  // 6 columns the formatter/authorization touch — a bare select() pulled every
  // column incl. the large raw_json blob on a 4s-polled endpoint (mirrors the
  // POST_FEED_COLUMNS projection already used by the timeline).
  const messages = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      content: objects.content,
      attachmentsJson: objects.attachmentsJson,
      published: objects.published,
      stampUri: messageStampRefs.stampUri,
      packUri: messageStampRefs.packUri,
      revisionDigest: messageStampRefs.revisionDigest,
      remoteAssetUrl: messageStampRefs.remoteAssetUrl,
      localAssetR2Key: messageStampRefs.localAssetR2Key,
      stampMediaType: messageStampRefs.mediaType,
      stampWidth: messageStampRefs.width,
      stampHeight: messageStampRefs.height,
      assetSha256: messageStampRefs.assetSha256,
      stampAltText: messageStampRefs.altText,
    })
    .from(objects)
    .leftJoin(messageStampRefs, eq(messageStampRefs.messageId, objects.apId))
    .where(whereClause!)
    .orderBy(desc(objects.published), desc(objects.apId))
    .limit(limit + 1);

  const hasMore = messages.length > limit;
  return { rows: hasMore ? messages.slice(0, limit) : messages, hasMore };
}

/** Build a map from ap_id -> actor info, checking local actors then cached actors. */
async function resolveAuthorInfoMap(
  db: Database,
  authorApIds: string[],
): Promise<Map<string, ActorInfo>> {
  const localActors = await db
    .select({
      apId: actors.apId,
      preferredUsername: actors.preferredUsername,
      name: actors.name,
      iconUrl: actors.iconUrl,
    })
    .from(actors)
    .where(inArray(actors.apId, authorApIds));

  const localMap = new Map<string, ActorInfo>(
    localActors.map((a) => [a.apId, a]),
  );

  const remoteApIds = authorApIds.filter((id) => !localMap.has(id));
  if (remoteApIds.length > 0) {
    const cached = await db
      .select({
        apId: actorCache.apId,
        preferredUsername: actorCache.preferredUsername,
        name: actorCache.name,
        iconUrl: actorCache.iconUrl,
      })
      .from(actorCache)
      .where(inArray(actorCache.apId, remoteApIds));

    for (const a of cached) {
      localMap.set(a.apId, a);
    }
  }

  return localMap;
}

/** Map raw DB message rows to the API response shape (chronological order). */
function formatMessages(
  messages: DmMessageRow[],
  authorMap: Map<string, ActorInfo>,
): DmMessageResponse[] {
  return messages.reverse().map((msg) => {
    const info = authorMap.get(msg.attributedTo);
    const stamp = messageStampSnapshotFromProjection({
      stampUri: msg.stampUri,
      packUri: msg.packUri,
      revisionDigest: msg.revisionDigest,
      remoteAssetUrl: msg.remoteAssetUrl,
      localAssetR2Key: msg.localAssetR2Key,
      mediaType: msg.stampMediaType,
      width: msg.stampWidth,
      height: msg.stampHeight,
      assetSha256: msg.assetSha256,
      altText: msg.stampAltText,
    });
    return {
      id: msg.apId,
      sender: {
        ap_id: msg.attributedTo,
        username: formatUsername(msg.attributedTo, info?.preferredUsername),
        preferred_username: info?.preferredUsername || null,
        name: info?.name || null,
        icon_url: info?.iconUrl || null,
      },
      content: msg.content,
      attachments: safeJsonParse<Attachment[]>(msg.attachmentsJson, []),
      ...(stamp ? { stamp } : {}),
      created_at: msg.published,
    };
  });
}

/** Fetch messages for a conversation, resolve authors, and format for API response. */
async function fetchAndFormatMessages(
  db: Database,
  actorApId: string,
  conversationId: string,
  limit: number,
  before: string | undefined,
): Promise<{ messages: DmMessageResponse[]; hasMore: boolean }> {
  const { rows, hasMore } = await fetchAuthorizedMessages(
    db,
    actorApId,
    conversationId,
    limit,
    before,
  );
  const authorApIds = [...new Set(rows.map((m) => m.attributedTo))];
  const authorMap = await resolveAuthorInfoMap(db, authorApIds);
  return { messages: formatMessages(rows, authorMap), hasMore };
}

/** Look up a direct-message Note that the actor owns (for edit/delete). */
async function findOwnedDmMessage(
  db: Database,
  messageId: string,
  actorApId: string,
): Promise<
  | { apId: string; attributedTo: string; conversation: string | null }
  | {
      error: string;
      status: 403 | 404;
    }
> {
  const message = await db
    .select({
      apId: objects.apId,
      attributedTo: objects.attributedTo,
      conversation: objects.conversation,
    })
    .from(objects)
    .where(
      and(
        eq(objects.apId, messageId),
        eq(objects.visibility, "direct"),
        eq(objects.type, "Note"),
      ),
    )
    .get();

  if (!message) return { error: "Message not found", status: 404 };
  if (message.attributedTo !== actorApId) {
    return { error: "Forbidden", status: 403 };
  }
  return message;
}

/** Create the DM Note object row. */
// Build (but do not execute) the insert for a DM Note. Returned as a statement
// so the caller can co-commit it with the recipient/activity/inbox rows in one
// atomic batch (D1 has no interactive transactions).
function dmNoteInsert(
  db: Database,
  data: {
    apId: string;
    actorApId: string;
    content: string;
    attachments: Attachment[];
    toJson: string;
    conversationId: string;
    published: string;
  },
) {
  return db.insert(objects).values({
    apId: data.apId,
    type: "Note",
    attributedTo: data.actorApId,
    content: data.content,
    attachmentsJson: JSON.stringify(data.attachments),
    visibility: "direct",
    toJson: data.toJson,
    ccJson: JSON.stringify([]),
    conversation: data.conversationId,
    published: data.published,
    isLocal: 1,
  });
}

// --- Route handlers ---

dm.get("/user/:encodedApId/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  if (await isActorBlockedStrict(db, otherApId)) {
    return c.json({ error: "User not found" }, 404);
  }
  const limit = parseLimit(c.req.query("limit"), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query("before");
  // Resolve to the STORED conversation id of an existing thread rather than
  // always recomputing the current-scheme id, so messages/read-status stay
  // matched for threads created before the current id scheme.
  const conversationId = await resolveConversationId(
    db,
    c.env.APP_URL,
    actor.ap_id,
    otherApId,
  );

  const { messages, hasMore } = await fetchAndFormatMessages(
    db,
    actor.ap_id,
    conversationId,
    limit,
    before,
  );

  // The partner's read position (LOCAL-ONLY read receipt): the row only exists
  // when the other participant is a local account that opened the thread —
  // read state is never federated, so a remote partner stays null ("unknown")
  // rather than "unread".
  const partnerRead = await db
    .select({ lastReadAt: dmReadStatus.lastReadAt })
    .from(dmReadStatus)
    .where(
      and(
        eq(dmReadStatus.actorApId, otherApId),
        eq(dmReadStatus.conversationId, conversationId),
      ),
    )
    .get();

  return c.json({
    messages,
    conversation_id: conversationId,
    has_more: hasMore,
    partner_last_read_at: partnerRead?.lastReadAt ?? null,
  });
});

// Send message to a specific user (creates Note with direct visibility)
dm.post("/user/:encodedApId/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  // Operator defederation is an authority boundary, not merely a late queue
  // filter. Reject before recipient lookup, body work, conversation resolution,
  // or any Note/Activity write so the API cannot claim a DM was sent when its
  // delivery is guaranteed to be skipped.
  if (await isActorBlockedStrict(db, otherApId)) {
    return c.json({ error: "User not found" }, 404);
  }
  const body = await c.req.json<{
    content?: string;
    attachments?: unknown;
    stamp?: unknown;
  }>();
  const baseUrl = c.env.APP_URL;

  const attachmentsResult = validateChatAttachments(body.attachments);
  if (!attachmentsResult.ok) {
    return c.json({ error: attachmentsResult.error }, 400);
  }
  let attachments = attachmentsResult.attachments as Attachment[];

  const stampResult =
    body.stamp === undefined
      ? null
      : await resolveSendableStamp(db, actor.ap_id, body.stamp, {
          acceptLanguage: c.req.header("Accept-Language"),
        });
  if (stampResult && !stampResult.ok) {
    return c.json({ error: stampResult.error }, stampResult.status);
  }
  if (
    stampResult?.ok &&
    (attachments.length > 0 ||
      (typeof body.content === "string" && body.content.trim().length > 0))
  ) {
    return c.json(
      { error: "A Stamp message cannot include text or other attachments" },
      400,
    );
  }
  if (stampResult?.ok) {
    attachments = [stampResult.stamp.attachment];
  }

  // An attachment-only message (LINE-style image send) carries no text.
  const contentOrError = stampResult?.ok
    ? `[Stamp: ${stampResult.stamp.snapshot.alt}]`
    : validateContent(body.content, attachments.length > 0);
  if (typeof contentOrError !== "string") {
    return c.json({ error: contentOrError.error }, contentOrError.status);
  }
  const content = contentOrError;

  // Verify other user exists (check both local actors and cached remote actors)
  const localActor = await db
    .select({
      apId: actors.apId,
      inbox: actors.inbox,
      preferredUsername: actors.preferredUsername,
    })
    .from(actors)
    .where(eq(actors.apId, otherApId))
    .get();

  const cachedActor = !localActor
    ? await db
        .select({
          apId: actorCache.apId,
          inbox: actorCache.inbox,
          preferredUsername: actorCache.preferredUsername,
        })
        .from(actorCache)
        .where(eq(actorCache.apId, otherApId))
        .get()
    : null;

  const otherActor = localActor || cachedActor;
  if (!otherActor) return c.json({ error: "User not found" }, 404);

  // Reject if the recipient has blocked the sender. Respond with 404 (the same
  // shape as a non-existent recipient) so the sender cannot distinguish a block
  // from a missing user and thereby learn they were blocked.
  const blockedBy = await db
    .select({ blockerApId: blocks.blockerApId })
    .from(blocks)
    .where(
      and(
        eq(blocks.blockerApId, otherApId),
        eq(blocks.blockedApId, actor.ap_id),
      ),
    )
    .get();
  if (blockedBy) return c.json({ error: "User not found" }, 404);

  const apId = objectApId(baseUrl, generateId());
  const now = new Date().toISOString();
  // Reuse an existing thread's stored conversation id so a reply does not split
  // a thread created before the current id scheme into a second id; a brand new
  // conversation falls back to the current-scheme id.
  const conversationId = await resolveConversationId(
    db,
    baseUrl,
    actor.ap_id,
    otherApId,
  );
  const toJson = JSON.stringify([otherApId]);

  const isRecipientLocal = !!localActor;
  const deliveryActivityId = activityApId(baseUrl, generateId());
  // Address the recipient with a Mention tag so remote servers (e.g. Mastodon)
  // surface the DM as a notification. Prefer the stored preferredUsername, then
  // fall back to deriving user@domain from the recipient actor id.
  const recipientName = `@${resolveRecipientHandle(otherActor.preferredUsername, otherApId)}`;
  const mentionTag = [
    { type: "Mention", href: otherApId, name: recipientName },
  ];
  // Media is stored as an app-relative /media path; absolutize (and strip the
  // internal r2_key) for the federated copy so the remote can fetch it.
  const apAttachments = toApAttachments(attachments, baseUrl);
  const remoteCreateActivity = !isRecipientLocal
    ? {
        "@context": OBJECT_CONTEXT,
        id: deliveryActivityId,
        type: "Create",
        actor: actor.ap_id,
        to: [otherApId],
        tag: mentionTag,
        object: {
          id: apId,
          type: "Note",
          attributedTo: actor.ap_id,
          to: [otherApId],
          content,
          ...(apAttachments.length > 0 ? { attachment: apAttachments } : {}),
          published: now,
          conversation: conversationId,
          tag: mentionTag,
        },
      }
    : null;

  // Co-commit the message atomically. D1 has no interactive transactions; a
  // sequence of separate inserts could commit the Note without its
  // object_recipients row, and the recipient's DM reader resolves membership
  // ONLY via object_recipients — so an orphan Note would be permanently
  // invisible to the recipient. batch() is atomic (mirrors the community-chat
  // send), so the Note + recipient + activity (+ inbox notification) land or
  // fail together.
  const noteStmt = dmNoteInsert(db, {
    apId,
    actorApId: actor.ap_id,
    content,
    attachments,
    toJson,
    conversationId,
    published: now,
  });
  const stampSnapshotStmt = stampResult?.ok
    ? db.insert(messageStampRefs).values({
        messageId: apId,
        stampUri: stampResult.stamp.snapshot.id,
        packUri: stampResult.stamp.snapshot.pack_id,
        revisionId: stampResult.stamp.revisionId,
        revisionDigest: stampResult.stamp.snapshot.revision,
        localAssetR2Key: stampResult.stamp.localAssetR2Key,
        mediaType: stampResult.stamp.snapshot.asset.media_type,
        width: stampResult.stamp.snapshot.asset.width,
        height: stampResult.stamp.snapshot.asset.height,
        assetSha256: stampResult.stamp.snapshot.asset.sha256,
        altText: stampResult.stamp.snapshot.alt,
        createdAt: now,
      })
    : null;
  const stampRecentStmt = stampResult?.ok
    ? recordStampRecent(db, actor.ap_id, stampResult.stamp.snapshot.id, now)
    : null;
  const batchOps = isRecipientLocal
    ? [
        noteStmt,
        ...(stampSnapshotStmt ? [stampSnapshotStmt] : []),
        ...(stampRecentStmt ? [stampRecentStmt] : []),
        db
          .insert(objectRecipients)
          .values({ objectApId: apId, recipientApId: otherApId, type: "to" })
          .onConflictDoNothing(),
        db.insert(activities).values({
          apId: deliveryActivityId,
          type: "Create",
          actorApId: actor.ap_id,
          objectApId: apId,
          rawJson: JSON.stringify({
            type: "Create",
            actor: actor.ap_id,
            object: apId,
          }),
          direction: "inbound",
        }),
        db.insert(inboxTable).values({
          actorApId: otherApId,
          activityApId: deliveryActivityId,
        }),
      ]
    : [
        noteStmt,
        ...(stampSnapshotStmt ? [stampSnapshotStmt] : []),
        ...(stampRecentStmt ? [stampRecentStmt] : []),
        db.insert(activities).values({
          apId: deliveryActivityId,
          type: "Create",
          actorApId: actor.ap_id,
          objectApId: apId,
          rawJson: JSON.stringify(remoteCreateActivity),
          direction: "outbound",
        }),
      ];

  try {
    await (db as unknown as Batchable).batch(batchOps);
  } catch (e) {
    log.error("Failed to insert message", {
      event: "dm.message.insert_failed",
      actor: actor.ap_id,
      recipient: otherApId,
      error: e,
    });
    return c.json({ error: "Failed to send message" }, 500);
  }

  if (!isLocal(otherApId, baseUrl)) {
    await enqueueDeliveryToActor(c.env, deliveryActivityId, otherApId);
  }

  const messagePayload = {
    id: apId,
    sender: buildSenderFromActor(actor),
    content,
    attachments,
    ...(stampResult?.ok ? { stamp: stampResult.stamp.snapshot } : {}),
    created_at: now,
  };

  // Realtime fanout (best-effort, after the response): the recipient's open
  // thread gets the message body without polling; the sender's OTHER tabs and
  // devices stay in sync too. `other_ap_id` is per-recipient (each side sees
  // the counterpart). Unread counters flow via the shared post-response sweep
  // (the inbox trigger wrote a push job for the local recipient).
  await runRealtimeAfterResponse(c, () =>
    emitRealtimeBestEffort(c.env, [
      ...(isRecipientLocal
        ? [
            {
              actorApId: otherApId,
              type: "talk.message",
              data: {
                kind: "dm",
                other_ap_id: actor.ap_id,
                conversation_id: conversationId,
                message: messagePayload,
              },
            },
          ]
        : []),
      {
        actorApId: actor.ap_id,
        type: "talk.message",
        data: {
          kind: "dm",
          other_ap_id: otherApId,
          conversation_id: conversationId,
          message: messagePayload,
        },
      },
    ]),
  );

  return c.json(
    {
      message: messagePayload,
      conversation_id: conversationId,
    },
    201,
  );
});

// Edit a DM message
dm.patch("/messages/:messageId", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const body = await c.req.json<{ content: string }>();

  const contentOrError = validateContent(body.content);
  if (typeof contentOrError !== "string") {
    return c.json({ error: contentOrError.error }, contentOrError.status);
  }
  const content = contentOrError;

  const messageOrError = await findOwnedDmMessage(
    db,
    c.req.param("messageId"),
    actor.ap_id,
  );
  if ("error" in messageOrError) {
    return c.json({ error: messageOrError.error }, messageOrError.status);
  }
  const message = messageOrError;

  const now = new Date().toISOString();
  await db
    .update(objects)
    .set({ content, updated: now })
    .where(eq(objects.apId, message.apId));

  return c.json({
    success: true,
    message: { id: message.apId, content, updated_at: now },
  });
});

// Delete a DM message
dm.delete("/messages/:messageId", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");

  const messageOrError = await findOwnedDmMessage(
    db,
    c.req.param("messageId"),
    actor.ap_id,
  );
  if ("error" in messageOrError) {
    return c.json({ error: messageOrError.error }, messageOrError.status);
  }
  const message = messageOrError;

  // Sequential object/media operations (D1 doesn't support interactive
  // transactions). First atomically remove every delivery Create activity and
  // its activity-keyed inbox/push/delivery/archive/claim projections. These
  // tables are addressed by AP id with no object FK, so deleting only the object
  // orphans them — and because the notifications query LEFT JOINs the now-missing
  // object (NULL visibility → not excluded as "direct"), an orphan inbox row
  // resurfaces as a blank "mention" with a dead /post link.
  await deleteActivitiesCascade(db, eq(activities.objectApId, message.apId));
  // Reap the message's child rows AND any attached R2 blob + media_uploads row
  // via the shared cascade (covers objectRecipients + media + likes/announces/
  // bookmarks/story*), then drop the object. Local DMs are text-only today so
  // there is no blob to leak yet, but routing through the cascade now keeps DM
  // deletion correct the moment DM media upload is wired in (and a leaked DM
  // blob would be PRIVATE) — matching the post and story delete paths.
  const mediaKeys = await deleteObjectCascade(db, message.apId, c.env.MEDIA);
  await db.delete(objects).where(eq(objects.apId, message.apId));
  // Irreversible R2 purge LAST — after the objects row is gone, so a failed
  // object delete can't leave a live (private) DM pointing at a deleted blob.
  await purgeMediaBlobs(c.env.MEDIA, mediaKeys);

  return c.json({ success: true });
});

export default dm;
