// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from "hono";
import { mediaReferenceError } from "../../lib/errors.ts";
import { and, desc, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  hasObservedReads,
  partnerObservedReadIds,
} from "../../lib/talk-read-receipts.ts";
import {
  activities,
  actorCache,
  actors,
  blocks,
  dmReadStatus,
  inbox as inboxTable,
  objectRecipients,
  objects,
  runBatch,
  type D1Statement,
} from "../../../db/index.ts";
import { createGuardedDatabase } from "../../../db/guarded-writes.ts";
import { admissionGuard } from "../../lib/account-deletion-admission.ts";
import { bytesToHex } from "../../lib/hex.ts";
import {
  prepareDeliveryResolutionJobs,
  enqueueDeliveryResolutionJobs,
} from "../../lib/delivery/resolution-outbox.ts";
import {
  prepareObjectsDeleteCascade,
  purgeMediaBlobs,
} from "../posts/delete-cascade.ts";
import type { Env, Variables } from "../../types.ts";
import {
  activityApId,
  formatUsername,
  generateId,
  isLocal,
  isSafeRemoteUrl,
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
import { validateChatAttachments } from "../../lib/attachments.ts";
import { logger } from "../../lib/logger.ts";
import { isActorBlockedStrict } from "../../lib/blocklist.ts";
import { activityDeleteCascadeStatements } from "../../lib/activity-delete-cascade.ts";

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
>;

type DmMessageResponse = {
  id: string;
  sender: SenderInfo;
  content: string | null;
  attachments?: Attachment[];
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
  otherApId: string,
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
      and(
        eq(objects.attributedTo, actorApId),
        inArray(objects.apId, recipientObjectIds(db, otherApId)),
      ),
      and(
        eq(objects.attributedTo, otherApId),
        inArray(objects.apId, recipientObjectIds(db, actorApId)),
      ),
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
    })
    .from(objects)
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
      created_at: msg.published,
    };
  });
}

/** Fetch messages for a conversation, resolve authors, and format for API response. */
async function fetchAndFormatMessages(
  db: Database,
  actorApId: string,
  otherApId: string,
  conversationId: string,
  limit: number,
  before: string | undefined,
): Promise<{ messages: DmMessageResponse[]; hasMore: boolean }> {
  const { rows, hasMore } = await fetchAuthorizedMessages(
    db,
    actorApId,
    otherApId,
    conversationId,
    limit,
    before,
  );
  const authorApIds = [...new Set(rows.map((m) => m.attributedTo))];
  const authorMap = await resolveAuthorInfoMap(db, authorApIds);
  return { messages: formatMessages(rows, authorMap), hasMore };
}

function ownedDmScope(messageId: string) {
  return and(
    eq(objects.apId, messageId),
    eq(objects.visibility, "direct"),
    eq(objects.type, "Note"),
    isNull(objects.communityApId),
    sql`NOT EXISTS (SELECT 1 FROM object_recipients audience
      WHERE audience.object_ap_id=${objects.apId} AND audience.type='audience')`,
  );
}

class OwnedMessageChangedError extends Error {}

/** Look up a direct-message Note that the actor owns (for edit/delete). */
async function findOwnedDmMessage(
  db: Database,
  messageId: string,
  actorApId: string,
): Promise<
  | typeof objects.$inferSelect
  | {
      error: string;
      status: 403 | 404;
    }
> {
  const message = await db
    .select()
    .from(objects)
    .where(ownedDmScope(messageId))
    .get();

  if (!message) return { error: "Message not found", status: 404 };
  if (message.attributedTo !== actorApId) {
    return { error: "Forbidden", status: 403 };
  }
  return message;
}

type OwnedDmMessage = typeof objects.$inferSelect;

/** A content/authority snapshot, not a secret or a durable schema revision. */
async function ownedDmRevision(message: OwnedDmMessage) {
  const value = JSON.stringify([
    message.apId,
    message.attributedTo,
    message.content,
    message.published,
    message.updated,
    message.attachmentsJson,
    message.toJson,
    message.ccJson,
    message.conversation,
    message.communityApId,
  ]);
  return (
    "dm-v1:" +
    bytesToHex(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
      ),
    )
  );
}

function guardedOwnedDm(db: Database, message: OwnedDmMessage) {
  const same = and(
    ownedDmScope(message.apId),
    eq(objects.attributedTo, message.attributedTo),
    sql`${objects.content} IS ${message.content}`,
    sql`${objects.published} IS ${message.published}`,
    sql`${objects.updated} IS ${message.updated}`,
    eq(objects.attachmentsJson, message.attachmentsJson),
    eq(objects.toJson, message.toJson),
    eq(objects.ccJson, message.ccJson),
    sql`${objects.conversation} IS ${message.conversation}`,
  );
  const present = db.select({ id: objects.apId }).from(objects).where(same);
  return createGuardedDatabase(db, () =>
    admissionGuard(
      db,
      sql`EXISTS ${present}`,
      () => new OwnedMessageChangedError(),
    ),
  );
}

function revisionError(header: string | undefined, revision: string) {
  if (header === undefined) return undefined; // Preserve older callers' contract.
  if (!/^"dm-v1:[a-f0-9]{64}"$/.test(header))
    return { error: "Invalid If-Match", status: 400 as const };
  if (header !== JSON.stringify(revision))
    return { error: "message_changed", status: 409 as const };
}

async function prepareDmMutationDelivery(
  db: Database,
  env: Env,
  message: OwnedDmMessage,
  kind: "Update" | "Delete",
  content?: string,
  updated?: string,
) {
  const addresses = (value: string) => {
    const parsed = safeJsonParse<unknown>(value, []);
    return Array.isArray(parsed)
      ? [
          ...new Set(
            parsed.filter(
              (id): id is string =>
                typeof id === "string" &&
                id !== "https://www.w3.org/ns/activitystreams#Public" &&
                !id.endsWith("/followers"),
            ),
          ),
        ]
      : [];
  };
  const to = addresses(message.toJson),
    cc = addresses(message.ccJson);
  const recipients: string[] = [];
  for (const id of new Set([...to, ...cc])) {
    if (
      !isLocal(id, env.APP_URL) &&
      isSafeRemoteUrl(id) &&
      !(await isActorBlockedStrict(db, id))
    )
      recipients.push(id);
  }
  const id = activityApId(env.APP_URL, generateId());
  const wire = {
    "@context": "https://www.w3.org/ns/activitystreams",
    id,
    type: kind,
    actor: message.attributedTo,
    to,
    cc,
    object:
      kind === "Delete"
        ? { id: message.apId, type: "Tombstone" }
        : {
            id: message.apId,
            type: "Note",
            attributedTo: message.attributedTo,
            to,
            cc,
            content,
            published: message.published,
            updated,
            conversation: message.conversation,
            attachment: toApAttachments(
              safeJsonParse<unknown[]>(message.attachmentsJson, []),
              env.APP_URL,
            ),
          },
  };
  const intents = recipients.map((recipientActorApId) => ({
    activityId: id,
    recipientActorApId,
  }));
  const jobs = await prepareDeliveryResolutionJobs(db, intents);
  return {
    statements: [
      db.insert(activities).values({
        apId: id,
        type: kind,
        actorApId: message.attributedTo,
        objectApId: message.apId,
        rawJson: JSON.stringify(wire),
        direction: "outbound",
      }) as D1Statement,
      ...jobs.statements,
    ] as [D1Statement, ...D1Statement[]],
    async publish() {
      try {
        // First-hop intent already committed. A missing Queue or lost wakeup
        // leaves it recoverable by the established resolution outbox drain.
        await enqueueDeliveryResolutionJobs(
          db,
          env.DELIVERY_QUEUE && env.DELIVERY_DLQ
            ? env.DELIVERY_QUEUE
            : undefined,
          intents,
        );
      } catch (error) {
        log.error("DM mutation delivery wakeup failed", {
          event: "dm.mutation.delivery_wakeup_failed",
          activityId: id,
          error,
        });
      }
    },
  };
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
    otherApId,
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

  const partnerScope = {
    viewer: otherApId,
    kind: "user" as const,
    target: actor.ap_id,
    thread: conversationId,
    epoch: "",
  };
  const partnerExact = await hasObservedReads(db, partnerScope);

  return c.json({
    messages,
    conversation_id: conversationId,
    has_more: hasMore,
    partner_last_read_at: partnerExact
      ? null
      : (partnerRead?.lastReadAt ?? null),
    partner_read_message_ids: await partnerObservedReadIds(
      db,
      partnerScope,
      messages.map((message) => message.id),
    ),
    read_observed: { version: 1, max_ids: 50 },
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
  }>();
  const baseUrl = c.env.APP_URL;

  const attachmentsResult = validateChatAttachments(body.attachments);
  if (!attachmentsResult.ok) {
    return c.json({ error: attachmentsResult.error }, 400);
  }
  const attachments = attachmentsResult.attachments as Attachment[];

  // An attachment-only message (LINE-style image send) carries no text.
  const contentOrError = validateContent(body.content, attachments.length > 0);
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
        "@context": "https://www.w3.org/ns/activitystreams",
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
  const batchOps = isRecipientLocal
    ? [
        noteStmt,
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
    const mediaError = mediaReferenceError(e);
    if (mediaError) throw mediaError;
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

// Exact author-only readback also covers an older message outside the latest page.
dm.get("/messages/:messageId", async (c) => {
  c.header("cache-control", "no-store");
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);
  const message = await findOwnedDmMessage(
    c.get("db"),
    c.req.param("messageId"),
    actor.ap_id,
  );
  if ("error" in message)
    return message.status === 404
      ? c.json({ error: "owned_dm_not_found", code: "owned_dm_not_found" }, 404)
      : c.json({ error: message.error }, message.status);
  const revision = await ownedDmRevision(message);
  c.header("etag", JSON.stringify(revision));
  return c.json({
    revision,
    message: {
      id: message.apId,
      sender: buildSenderFromActor(actor),
      content: message.content,
      created_at: message.published,
      attachments: safeJsonParse<Attachment[]>(message.attachmentsJson, []),
    },
  });
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
  const conditional = revisionError(
    c.req.header("if-match"),
    await ownedDmRevision(message),
  );
  if (conditional)
    return c.json({ error: conditional.error }, conditional.status);

  const now = new Date().toISOString();
  const delivery = await prepareDmMutationDelivery(
    db,
    c.env,
    message,
    "Update",
    content,
    now,
  );
  try {
    await runBatch(guardedOwnedDm(db, message), [
      db
        .update(objects)
        .set({ content, updated: now })
        .where(eq(objects.apId, message.apId)),
      ...delivery.statements,
    ]);
  } catch (error) {
    if (!(error instanceof OwnedMessageChangedError)) throw error;
    return c.json({ error: "message_changed" }, 409);
  }
  await delivery.publish();

  return c.json({
    success: true,
    message: { id: message.apId, content, updated_at: now },
    revision: await ownedDmRevision({ ...message, content, updated: now }),
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
  const conditional = revisionError(
    c.req.header("if-match"),
    await ownedDmRevision(message),
  );
  if (conditional)
    return c.json({ error: conditional.error }, conditional.status);

  const plan = await prepareObjectsDeleteCascade(
    db,
    [message.apId],
    c.env.MEDIA,
  );
  if (
    plan.objects.length !== 1 ||
    plan.objects[0]!.attachmentsJson !== message.attachmentsJson
  ) {
    return c.json({ error: "message_changed" }, 409);
  }
  const delivery = await prepareDmMutationDelivery(
    db,
    c.env,
    message,
    "Delete",
  );
  try {
    await runBatch(guardedOwnedDm(db, message), [
      ...activityDeleteCascadeStatements(
        db,
        eq(activities.objectApId, message.apId),
      ),
      ...plan.mediaStatements,
      ...plan.batches.flat(),
      db.delete(objects).where(eq(objects.apId, message.apId)),
      ...delivery.statements,
    ]);
  } catch (error) {
    if (!(error instanceof OwnedMessageChangedError)) throw error;
    return c.json({ error: "message_changed" }, 409);
  }
  // Irreversible R2 purge LAST — after the objects row is gone, so a failed
  // object delete can't leave a live (private) DM pointing at a deleted blob.
  await purgeMediaBlobs(db, c.env.MEDIA, plan.mediaKeys);
  await delivery.publish();

  return c.json({ success: true });
});

export default dm;
