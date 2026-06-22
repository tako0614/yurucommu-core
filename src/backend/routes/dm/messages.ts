// Direct Messages - AP Native
// DMs are Note objects with visibility='direct' and to=[recipient]
// Threading via conversation field

import { Hono } from "hono";
import { and, desc, eq, inArray, like, lt } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  activities,
  actorCache,
  actors,
  blocks,
  inbox as inboxTable,
  objectRecipients,
  objects,
} from "../../../db/index.ts";
import { deleteObjectCascade } from "../posts/delete-cascade.ts";
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
  getConversationId,
  MAX_DM_CONTENT_LENGTH,
  MAX_DM_PAGE_LIMIT,
} from "./query-helpers.ts";
import { enqueueDeliveryToActor } from "../../lib/delivery/queue.ts";
import { logger } from "../../lib/logger.ts";

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
  | "apId"
  | "attributedTo"
  | "content"
  | "attachmentsJson"
  | "published"
  | "toJson"
>;

type DmMessageResponse = {
  id: string;
  sender: SenderInfo;
  content: string | null;
  attachments?: Attachment[];
  created_at: string | null;
};

/** Validate trimmed DM content; returns the trimmed string or an error response. */
function validateContent(
  raw: string | undefined,
): string | { error: string; status: 400 } {
  const content = raw?.trim();
  if (!content) return { error: "Message content is required", status: 400 };
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
    username: formatUsername(actor.ap_id),
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
  // Build where clause: filter by conversation + visibility + type
  // Authorization is re-validated in code below (defense-in-depth)
  const baseCondition = and(
    eq(objects.visibility, "direct"),
    eq(objects.type, "Note"),
    eq(objects.conversation, conversationId),
  );

  const whereClause = before
    ? and(baseCondition!, lt(objects.published, before))
    : baseCondition;

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
      toJson: objects.toJson,
    })
    .from(objects)
    .where(whereClause!)
    .orderBy(desc(objects.published))
    .limit(limit + 1);

  // Defence-in-depth: re-validate authorization at the code level. (In practice
  // every row in the actor's own conversation passes, so the +1 reliably signals
  // an older page.)
  const authorized = messages.filter((msg) => {
    if (msg.attributedTo === actorApId) return true;
    const toRecipients = safeJsonParse<string[]>(msg.toJson, []);
    return toRecipients.includes(actorApId);
  });

  const hasMore = authorized.length > limit;
  return { rows: hasMore ? authorized.slice(0, limit) : authorized, hasMore };
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
        username: formatUsername(msg.attributedTo),
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
  const limit = parseLimit(c.req.query("limit"), 50, MAX_DM_PAGE_LIMIT);
  const before = c.req.query("before");
  const conversationId = getConversationId(
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
  return c.json({
    messages,
    conversation_id: conversationId,
    has_more: hasMore,
  });
});

// Send message to a specific user (creates Note with direct visibility)
dm.post("/user/:encodedApId/messages", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const otherApId = decodeURIComponent(c.req.param("encodedApId"));
  const body = await c.req.json<{ content: string }>();
  const baseUrl = c.env.APP_URL;

  const contentOrError = validateContent(body.content);
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
  const conversationId = getConversationId(baseUrl, actor.ap_id, otherApId);
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

  return c.json(
    {
      message: {
        id: apId,
        sender: buildSenderFromActor(actor),
        content,
        created_at: now,
      },
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

  // Sequential operations (D1 doesn't support interactive transactions).
  // Also remove the delivery Create activity + the recipient's inbox row created
  // at send time (messages.ts send path). These tables are addressed by AP id
  // with no FK to `objects`, so deleting only the object orphans them — and
  // because the notifications query LEFT JOINs the now-missing object (a
  // deleted DM's object is gone → NULL visibility → not excluded as "direct"),
  // the orphan Create inbox row would resurface as a blank "mention"
  // notification with a dead /post link. Drop them first.
  const relatedActivities = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(eq(activities.objectApId, message.apId));
  const activityIds = relatedActivities.map((a) => a.apId);
  if (activityIds.length > 0) {
    await db
      .delete(inboxTable)
      .where(inArray(inboxTable.activityApId, activityIds));
    await db.delete(activities).where(inArray(activities.apId, activityIds));
  }
  // Reap the message's child rows AND any attached R2 blob + media_uploads row
  // via the shared cascade (covers objectRecipients + media + likes/announces/
  // bookmarks/story*), then drop the object. Local DMs are text-only today so
  // there is no blob to leak yet, but routing through the cascade now keeps DM
  // deletion correct the moment DM media upload is wired in (and a leaked DM
  // blob would be PRIVATE) — matching the post and story delete paths.
  await deleteObjectCascade(db, message.apId, c.env.MEDIA);
  await db.delete(objects).where(eq(objects.apId, message.apId));

  return c.json({ success: true });
});

export default dm;
