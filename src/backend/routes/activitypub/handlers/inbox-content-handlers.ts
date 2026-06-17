import type { Database } from "../../../../db/index.ts";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  activities,
  actors,
  follows,
  inbox as inboxTable,
  likes,
  objectRecipients,
  objects,
  storyViews,
  storyVotes,
} from "../../../../db/index.ts";
import { upsertActivityAndNotify } from "./inbox-shared-helpers.ts";
import {
  activityApId,
  fetchWithTimeout,
  generateId,
  getDomain,
  isLocal,
  isSafeRemoteUrl,
  objectApId,
} from "../../../federation-helpers.ts";
import { getConversationId } from "../../dm/query-helpers.ts";
import { fetchAndUpsertActorCache } from "../../../lib/activitypub-actor-cache.ts";
import { logger } from "../../../lib/logger.ts";
import {
  type Activity,
  type ActivityContext,
  type ActivityObject,
  getActivityObject,
  getActivityObjectId,
  type StoryOverlay,
} from "../inbox-types.ts";

const log = logger.child({ component: "activitypub.inbox.content" });

type ActorRow = typeof actors.$inferSelect;

// Federation blocklist enforcement lives centrally in
// `verifyAndParseInbox` (routes/activitypub/inbox.ts): every inbound
// activity is gated once there before any handler runs, so the per-handler
// gate that previously lived here is intentionally absent.

// ---------------------------------------------------------------------------
// Inline helpers
// ---------------------------------------------------------------------------

function isStoryType(type: string | string[] | undefined): boolean {
  if (!type) return false;
  return Array.isArray(type) ? type.includes("Story") : type === "Story";
}

// The ActivityStreams public-collection magic value, including the legacy
// short forms some implementations still emit.
const PUBLIC_COLLECTION = new Set([
  "https://www.w3.org/ns/activitystreams#Public",
  "as:Public",
  "Public",
]);

function addressesPublic(addresses: string[]): boolean {
  return addresses.some((a) => PUBLIC_COLLECTION.has(a));
}

/**
 * Reject an inbound object whose `object.id` is asserted under a host the
 * delivering actor does not control (object-ID squatting / cross-origin
 * injection). A remote actor may only Create objects under its own origin, and
 * never under the local domain. Returns true when the object id must be
 * rejected. Mirrors the ownership checks already enforced for Delete/Update.
 */
function isObjectIdOriginMismatch(
  objectId: string | undefined,
  actor: string,
  baseUrl: string,
): boolean {
  if (!objectId) return false;
  // A remote actor must never assert a local-domain object id.
  if (isLocal(objectId, baseUrl)) return true;
  try {
    return getDomain(objectId) !== getDomain(actor);
  } catch {
    // Unparseable object id: treat as a mismatch (reject) rather than insert.
    return true;
  }
}

/**
 * Detect an inbound direct (DM) Note: it is addressed (in `to`/`cc`) to one or
 * more recipients but NOT to the Public collection and NOT to a followers
 * collection. The local addressed recipient is the inbox owner (`recipient`),
 * who is necessarily a known local actor row. Mirrors the outbound DM contract
 * in dm/messages.ts (visibility="direct", to=[recipient]).
 */
function isDirectNote(
  object: { to?: string[]; cc?: string[] },
  recipient: ActorRow,
): boolean {
  const to = object.to ?? [];
  const cc = object.cc ?? [];
  const all = [...to, ...cc];
  if (all.length === 0) return false;
  // Direct notes are never addressed to the Public collection...
  if (addressesPublic(all)) return false;
  // ...nor to a followers collection (follower-only posts are not DMs).
  if (all.some((a) => a.endsWith("/followers"))) return false;
  if (recipient.followersUrl && all.includes(recipient.followersUrl)) {
    return false;
  }
  // The inbox owner must be explicitly addressed in `to` (the recipient set
  // that defines a DM); a mere `cc` mention is not treated as a DM.
  return to.includes(recipient.apId);
}

/**
 * Route an inbound direct (DM) Note into the recipient's DM inbox /
 * message-request flow, mirroring the local outbound path in
 * dm/messages.ts: a direct-visibility Note row, an objectRecipients row, a
 * stored inbound Create activity, and an inbox row so it surfaces.
 *
 * Scope: a single local recipient (the inbox owner). The outbound DM model is
 * strictly 1:1 (to=[otherApId]) and `objects.conversation` is a single column,
 * so multi-recipient / group direct Notes are intentionally out of scope and
 * fall back to the generic Note insert.
 */
async function insertDirectNote(
  db: Database,
  activity: Activity,
  object: ActivityObject,
  objectId: string,
  actor: string,
  recipient: ActorRow,
  baseUrl: string,
): Promise<void> {
  // Derive the conversation. Honour a sender-supplied `object.conversation`
  // only when it matches the value yurucommu itself would compute for this
  // (sender, localRecipient) pair — otherwise a remote actor could force a
  // message into an arbitrary thread (spoof a reply context). Fall back to the
  // computed id for foreign-origin DMs that carry no/invalid conversation.
  const computedConversation = getConversationId(
    baseUrl,
    actor,
    recipient.apId,
  );
  const conversationId =
    object.conversation === computedConversation
      ? object.conversation
      : computedConversation;

  const attachments = object.attachment
    ? JSON.stringify(object.attachment)
    : "[]";
  const publishedAt = object.published || new Date().toISOString();
  const toJson = JSON.stringify([recipient.apId]);

  const inserted = await db
    .insert(objects)
    .values({
      apId: objectId,
      type: "Note",
      attributedTo: actor,
      content: object.content || "",
      summary: object.summary || null,
      attachmentsJson: attachments,
      inReplyTo: object.inReplyTo || null,
      visibility: "direct",
      toJson,
      conversation: conversationId,
      communityApId: null,
      published: publishedAt,
      isLocal: 0,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (!inserted) return; // duplicate

  await db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} + 1` })
    .where(eq(actors.apId, actor));

  await db
    .insert(objectRecipients)
    .values({ objectApId: objectId, recipientApId: recipient.apId, type: "to" })
    .onConflictDoNothing();

  // Store the inbound Create and surface it in the recipient's inbox so the DM
  // appears in the conversation / message-requests view.
  const activityId = activity.id || activityApId(baseUrl, generateId());
  await upsertActivityAndNotify(
    db,
    activityId,
    "Create",
    actor,
    objectId,
    activity,
    recipient.apId,
  );
}

// ---------------------------------------------------------------------------
// Create handler
// ---------------------------------------------------------------------------

export async function handleCreate(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string,
  baseUrl: string,
) {
  const db = c.get("db");
  const object = getActivityObject(activity);
  if (!object) return;

  // Handle Story type
  if (isStoryType(object.type)) {
    await handleCreateStory(c, activity, actor, baseUrl);
    return;
  }

  // Handle Note type
  if (object.type !== "Note") return;

  // Same-origin guard: a remote actor may only Create objects under its own
  // origin, never under another host or the local domain. This closes the
  // object-ID squatting / cross-origin injection vector and mirrors the
  // ownership checks already enforced for Delete/Update.
  if (isObjectIdOriginMismatch(object.id, actor, baseUrl)) {
    log.warn("Create rejected: object id origin does not match actor", {
      event: "ap.create.object_origin_mismatch",
      actor,
      objectId: object.id,
    });
    return;
  }

  // Direct (DM) Note routing: a Note addressed to the local inbox owner that
  // is neither public nor follower-only belongs in the recipient's DM inbox /
  // message-request flow rather than the generic public Note insert.
  if (object.id && isDirectNote(object, recipient)) {
    const existing = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, object.id))
      .get();
    if (existing) return;
    await insertDirectNote(
      db,
      activity,
      object,
      object.id,
      actor,
      recipient,
      baseUrl,
    );
    return;
  }

  const objectId = object.id || objectApId(baseUrl, generateId());

  // Check if object already exists
  const existing = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (existing) return;

  const attachments = object.attachment
    ? JSON.stringify(object.attachment)
    : "[]";
  const publishedAt = object.published || new Date().toISOString();
  const parentObj = object.inReplyTo
    ? await db
        .select({ attributedTo: objects.attributedTo })
        .from(objects)
        .where(eq(objects.apId, object.inReplyTo))
        .get()
    : null;
  const shouldNotifyParent = !!(
    parentObj && isLocal(parentObj.attributedTo, baseUrl)
  );
  const replyActivityId = shouldNotifyParent
    ? activity.id || activityApId(baseUrl, generateId())
    : null;

  // Try to insert object; if duplicate, skip
  const insertResult = await db
    .insert(objects)
    .values({
      apId: objectId,
      type: "Note",
      attributedTo: actor,
      content: object.content || "",
      summary: object.summary || null,
      attachmentsJson: attachments,
      inReplyTo: object.inReplyTo || null,
      visibility: object.to?.includes(
        "https://www.w3.org/ns/activitystreams#Public",
      )
        ? "public"
        : "unlisted",
      communityApId: null,
      published: publishedAt,
      isLocal: 0,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (!insertResult) return; // duplicate

  await db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} + 1` })
    .where(eq(actors.apId, actor));

  if (object.inReplyTo) {
    await db
      .update(objects)
      .set({ replyCount: sql`${objects.replyCount} + 1` })
      .where(eq(objects.apId, object.inReplyTo));
  }

  if (shouldNotifyParent && parentObj && replyActivityId) {
    await upsertActivityAndNotify(
      db,
      replyActivityId,
      "Create",
      actor,
      objectId,
      activity,
      parentObj.attributedTo,
    );
  }
}

// ---------------------------------------------------------------------------
// Create(Story) handler
// ---------------------------------------------------------------------------

export async function handleCreateStory(
  c: ActivityContext,
  activity: Activity,
  actor: string,
  baseUrl: string,
) {
  const db = c.get("db");
  const object = getActivityObject(activity);
  if (!object) return;

  // Same-origin guard: reject a story whose object id is squatted under another
  // host or the local domain (see handleCreate for rationale).
  if (isObjectIdOriginMismatch(object.id, actor, baseUrl)) {
    log.warn("Create(Story) rejected: object id origin does not match actor", {
      event: "ap.story.object_origin_mismatch",
      actor,
      objectId: object.id,
    });
    return;
  }

  const objectId = object.id || objectApId(baseUrl, generateId());

  // Check if story already exists
  const existing = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (existing) return;

  // attachment validation (required)
  if (!object.attachment) {
    log.error("Remote story has no attachment", {
      event: "ap.story.missing_attachment",
      objectId,
    });
    return;
  }

  // Normalize attachment (handle array or single object)
  const attachmentArray = Array.isArray(object.attachment)
    ? object.attachment
    : [object.attachment];
  const attachment = attachmentArray[0] as {
    url?: string;
    mediaType?: string;
    width?: number;
    height?: number;
  };

  if (!attachment || !attachment.url) {
    log.error("Remote story attachment has no URL", {
      event: "ap.story.attachment_missing_url",
      objectId,
    });
    return;
  }

  // overlays validation (optional, validate if present)
  let overlays: StoryOverlay[] | undefined;
  if (Array.isArray(object.overlays)) {
    const filtered = (object.overlays as StoryOverlay[]).filter(
      (o: StoryOverlay) =>
        o &&
        o.position &&
        typeof o.position.x === "number" &&
        typeof o.position.y === "number",
    );
    if (filtered.length > 0) overlays = filtered;
  }

  // Build attachments_json
  const attachmentData = {
    attachment: {
      r2_key: "", // Remote stories don't have local R2 key
      content_type: attachment.mediaType || "image/jpeg",
      url: attachment.url,
      width: attachment.width || 1080,
      height: attachment.height || 1920,
    },
    displayDuration:
      (object as { displayDuration?: string }).displayDuration || "PT5S",
    // The remote caption arrives as the AS2 Note `content`; persist it so the
    // local renderer shows the same caption as the originating instance.
    caption:
      typeof object.content === "string" && object.content.trim().length > 0
        ? object.content
        : undefined,
    overlays,
  };

  const now = new Date().toISOString();
  const endTime =
    object.endTime || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  await db.insert(objects).values({
    apId: objectId,
    type: "Story",
    attributedTo: actor,
    content: "",
    attachmentsJson: JSON.stringify(attachmentData),
    endTime,
    published: object.published || now,
    isLocal: 0,
  });
}

// ---------------------------------------------------------------------------
// Delete handler
// ---------------------------------------------------------------------------

export async function handleDelete(c: ActivityContext, activity: Activity) {
  const db = c.get("db");
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  const actorId = typeof activity.actor === "string" ? activity.actor : null;
  if (!actorId) {
    log.warn("Delete activity missing actor", {
      event: "ap.delete.missing_actor",
      objectId,
    });
    return;
  }

  const delObj = await db
    .select({
      attributedTo: objects.attributedTo,
      type: objects.type,
      replyCount: objects.replyCount,
      inReplyTo: objects.inReplyTo,
    })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (!delObj) return;

  // Verify actor owns the object before deleting
  if (delObj.attributedTo !== actorId) {
    log.warn("Delete rejected: actor does not own object", {
      event: "ap.delete.actor_ownership_mismatch",
      actor: actorId,
      objectId,
      ownedBy: delObj.attributedTo,
    });
    return;
  }

  // Story-specific cleanup
  if (delObj.type === "Story") {
    await db.delete(storyVotes).where(eq(storyVotes.storyApId, objectId));
    await db.delete(storyViews).where(eq(storyViews.storyApId, objectId));
  }

  // Common cleanup for all object types
  await db.delete(likes).where(eq(likes.objectApId, objectId));

  await db.delete(objects).where(eq(objects.apId, objectId));

  await db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} - 1` })
    .where(eq(actors.apId, delObj.attributedTo));

  // If the deleted object was a reply, decrement the parent's replyCount so the
  // running tally does not inflate permanently (mirrors the increment in
  // handleCreate and the local delete path). Guard against underflow.
  if (delObj.inReplyTo) {
    await db
      .update(objects)
      .set({ replyCount: sql`${objects.replyCount} - 1` })
      .where(
        and(
          eq(objects.apId, delObj.inReplyTo),
          sql`${objects.replyCount} > 0`,
        ),
      );
  }
}

// ---------------------------------------------------------------------------
// Update handler
// ---------------------------------------------------------------------------

export async function handleUpdate(
  c: ActivityContext,
  activity: Activity,
  actor: string,
) {
  const db = c.get("db");
  const object = getActivityObject(activity);
  if (!object) return;

  const objectId = object.id;
  if (!objectId) return;

  const existing = await db
    .select({ attributedTo: objects.attributedTo })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (!existing || existing.attributedTo !== actor) return;

  // Update object content
  if (object.type === "Note") {
    const attachments = object.attachment
      ? JSON.stringify(object.attachment)
      : undefined;
    await db
      .update(objects)
      .set({
        content: object.content || undefined,
        summary: object.summary || undefined,
        attachmentsJson: attachments || undefined,
        updated: new Date().toISOString(),
      })
      .where(eq(objects.apId, objectId));
  }
}

// ---------------------------------------------------------------------------
// Move handler (account migration)
// ---------------------------------------------------------------------------

export async function handleMove(
  c: ActivityContext,
  activity: Activity,
  actor: string,
) {
  const db = c.get("db");
  const oldActorApId = getActivityObjectId(activity);
  const newActorApId = getActivityTargetId(activity);
  if (!oldActorApId || !newActorApId) return;

  // Only accept self-move. Signature verification already ensures the request is signed,
  // but we also require Move.object to match Move.actor (defense-in-depth).
  if (oldActorApId !== actor) return;
  if (oldActorApId === newActorApId) return;

  if (!isSafeRemoteUrl(newActorApId)) {
    log.warn("Blocked unsafe Move target", {
      event: "ap.move.unsafe_target",
      newActor: newActorApId,
      oldActor: oldActorApId,
    });
    return;
  }

  // SECURITY (account-migration follow-graph hijack): a signed Move only proves
  // the OLD actor consents to move; it does NOT prove the destination is the same
  // person. Without verifying the destination's `alsoKnownAs` back-reference, a
  // remote actor that accumulated local followers could redirect them all to an
  // arbitrary unconsenting account (follower-stealing). Require the standard
  // Mastodon Move guard: the destination actor document must list the old actor
  // in `alsoKnownAs`. Fails closed.
  if (!(await destinationDeclaresAlias(newActorApId, oldActorApId))) {
    log.warn("Blocked Move without alsoKnownAs back-reference", {
      event: "ap.move.unverified_alias",
      newActor: newActorApId,
      oldActor: oldActorApId,
    });
    return;
  }

  // Refresh/cache the new actor document (best-effort).
  await refreshActorCache(db, newActorApId);

  // Rewrite follow graph references from old -> new in batches.
  const followerRows = await db
    .select({
      followingApId: follows.followingApId,
      status: follows.status,
      activityApId: follows.activityApId,
      createdAt: follows.createdAt,
      acceptedAt: follows.acceptedAt,
    })
    .from(follows)
    .where(eq(follows.followerApId, oldActorApId));

  const followingRows = await db
    .select({
      followerApId: follows.followerApId,
      status: follows.status,
      activityApId: follows.activityApId,
      createdAt: follows.createdAt,
      acceptedAt: follows.acceptedAt,
    })
    .from(follows)
    .where(eq(follows.followingApId, oldActorApId));

  const followerTargets = followerRows.map((row) => row.followingApId);
  const followingSources = followingRows.map((row) => row.followerApId);

  const existingFollowerPairs =
    followerTargets.length > 0
      ? await db
          .select({ followingApId: follows.followingApId })
          .from(follows)
          .where(
            and(
              eq(follows.followerApId, newActorApId),
              inArray(follows.followingApId, followerTargets),
            ),
          )
      : [];
  const existingFollowingPairs =
    followingSources.length > 0
      ? await db
          .select({ followerApId: follows.followerApId })
          .from(follows)
          .where(
            and(
              inArray(follows.followerApId, followingSources),
              eq(follows.followingApId, newActorApId),
            ),
          )
      : [];

  const existingFollowerTargetSet = new Set(
    existingFollowerPairs.map((row) => row.followingApId),
  );
  const existingFollowingSourceSet = new Set(
    existingFollowingPairs.map((row) => row.followerApId),
  );

  const followerRewrites = followerRows
    .filter((row) => !existingFollowerTargetSet.has(row.followingApId))
    .map((row) => ({
      followerApId: newActorApId,
      followingApId: row.followingApId,
      status: row.status,
      activityApId: row.activityApId,
      createdAt: row.createdAt,
      acceptedAt: row.acceptedAt,
    }));
  const followingRewrites = followingRows
    .filter((row) => !existingFollowingSourceSet.has(row.followerApId))
    .map((row) => ({
      followerApId: row.followerApId,
      followingApId: newActorApId,
      status: row.status,
      activityApId: row.activityApId,
      createdAt: row.createdAt,
      acceptedAt: row.acceptedAt,
    }));

  // Sequential operations (no interactive transactions in D1)
  if (followerRewrites.length > 0) {
    await db.insert(follows).values(followerRewrites);
  }
  if (followerRows.length > 0) {
    await db.delete(follows).where(eq(follows.followerApId, oldActorApId));
  }
  if (followingRewrites.length > 0) {
    await db.insert(follows).values(followingRewrites);
  }
  if (followingRows.length > 0) {
    await db.delete(follows).where(eq(follows.followingApId, oldActorApId));
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getActivityTargetId(activity: Activity): string | null {
  const target = activity.target;
  if (!target) return null;
  if (typeof target === "string") return target;
  return target.id || null;
}

/** Fetch a remote actor document and cache it locally. Best-effort (errors are logged, not thrown). */
/**
 * Verify the destination actor of a Move declares the origin actor in its
 * `alsoKnownAs` (the standard Mastodon account-migration consent check). Fetches
 * the destination actor document fresh and fails closed on any error.
 */
async function destinationDeclaresAlias(
  newActorApId: string,
  oldActorApId: string,
): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(newActorApId, {
      headers: { Accept: "application/activity+json, application/ld+json" },
      timeout: 15000,
    });
    if (!res.ok) return false;
    const raw: unknown = await res.json();
    if (!raw || typeof raw !== "object") return false;
    const doc = raw as { id?: unknown; alsoKnownAs?: unknown };
    if (doc.id !== newActorApId) return false;
    const aka = doc.alsoKnownAs;
    const aliases = Array.isArray(aka)
      ? aka
      : typeof aka === "string"
        ? [aka]
        : [];
    return aliases.includes(oldActorApId);
  } catch {
    return false;
  }
}

async function refreshActorCache(
  db: Database,
  actorApIdValue: string,
): Promise<void> {
  const result = await fetchAndUpsertActorCache(db, actorApIdValue, {
    timeout: 15000,
    mode: "upsert",
  });
  if (!result.ok && result.reason === "fetch_failed") {
    log.warn("Failed to refresh Move target actor cache", {
      event: "ap.move.cache_refresh_failed",
      actor: actorApIdValue,
    });
  }
}
