import type { Database } from "../../../../db/index.ts";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  activities,
  actorCache,
  actors,
  follows,
  inbox as inboxTable,
  objectRecipients,
  objects,
} from "../../../../db/index.ts";
import { upsertActivityAndNotify } from "./inbox-shared-helpers.ts";
import { normalizeInboundTimestamp } from "./inbound-timestamp.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
} from "../../posts/delete-cascade.ts";
import {
  boundAttachmentsJson,
  boundInboundContent,
  boundInboundSummary,
  MAX_ATTACHMENTS_JSON_LENGTH,
  MAX_POST_CONTENT_LENGTH,
  MAX_POST_SUMMARY_LENGTH,
  truncate,
} from "../../posts/transformers.ts";
import {
  activityApId,
  generateId,
  getDomain,
  isLocal,
  isSafeRemoteUrl,
  objectApId,
} from "../../../federation-helpers.ts";
import { getConversationId } from "../../dm/query-helpers.ts";
import {
  fetchAndUpsertActorCache,
  getInstanceFetchSignerByDb,
} from "../../../lib/activitypub-actor-cache.ts";
import { enqueueDeliveryToActor } from "../../../lib/delivery/queue.ts";
import { destinationDeclaresAlias } from "../../../lib/account-migration.ts";
import { logger } from "../../../lib/logger.ts";
import {
  type Activity,
  type ActivityContext,
  type ActivityObject,
  getActivityObject,
  getActivityObjectId,
  type StoryOverlay,
  typeIncludes,
} from "../inbox-types.ts";

const log = logger.child({ component: "activitypub.inbox.content" });

type ActorRow = typeof actors.$inferSelect;

// normalizeInboundTimestamp now lives in ./inbound-timestamp.ts (shared with the
// federated group-chat path) — imported at the top of this file.

// ---------------------------------------------------------------------------
// Atomic multi-statement commit (mirrors posts/interactions.ts `runBatch` and
// the inbox-interaction / inbox-shared helper). D1 has no interactive
// transactions, but both the D1 and libsql drivers expose `db.batch([...])`,
// which commits a list of prepared statements atomically. The shared
// `Database` union aliases the abstract `BaseSQLiteDatabase` base (which does
// not surface `batch`), so we narrow to the concrete batch surface here.
// ---------------------------------------------------------------------------

type BatchStatement = BatchItem<"sqlite">;
interface BatchableDb {
  batch(
    statements: readonly [BatchStatement, ...BatchStatement[]],
  ): Promise<unknown>;
}

async function runBatch(
  db: Database,
  statements: readonly [BatchStatement, ...BatchStatement[]],
): Promise<void> {
  await (db as unknown as BatchableDb).batch(statements);
}

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

// The actor object types whose inbound Update represents a remote
// profile / avatar / public-key change that should refresh the actor cache.
const ACTOR_OBJECT_TYPES = new Set([
  "Person",
  "Service",
  "Group",
  "Organization",
  "Application",
]);

// Minimum interval between outbound actor re-fetches triggered by an inbound
// Update(actor). Within this window we rely on the existing cache row (and the
// normal actor-cache TTL) instead of re-fetching, so a flood of Update
// activities cannot amplify into a flood of outbound fetches.
const ACTOR_UPDATE_REFETCH_COOLDOWN_MS = 60_000;

function isActorTypeUpdate(type: string | string[] | undefined): boolean {
  if (!type) return false;
  return Array.isArray(type)
    ? type.some((t) => ACTOR_OBJECT_TYPES.has(t))
    : ACTOR_OBJECT_TYPES.has(type);
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

// A note addressed to a followers collection (the author's `<actor>/followers`)
// and NOT to Public is a followers-only post. We match any `/followers`
// collection by suffix (mirrors isDirectNote), which covers the author's
// collection without needing to resolve it.
function addressesFollowers(addresses: string[]): boolean {
  return addresses.some((a) => a.endsWith("/followers"));
}

/**
 * Recipient-INDEPENDENT visibility classification for an inbound generic Note,
 * mirroring the local outbound addressing contract. CRITICAL invariant: a
 * non-public Note is NEVER classified as "unlisted" (world-readable). Direct
 * (addressed-to-specific-actors-only) Notes are diverted BEFORE this is reached
 * (insertDirectNote / the direct-shaped skip), so the residual here is:
 *   - "public"    — the Public collection is in `to`;
 *   - "unlisted"  — Public is only in `cc` (Mastodon-style unlisted), or the
 *                   note carries no usable addressing at all;
 *   - "followers" — a followers collection is addressed and Public is absent.
 * Previously this was derived solely from `to.includes(Public)`, so a remote
 * followers-only post (Public absent) was silently downgraded to "unlisted" and
 * became world-readable. */
function classifyInboundNoteVisibility(object: {
  to?: string[];
  cc?: string[];
}): "public" | "unlisted" | "followers" {
  const to = object.to ?? [];
  const cc = object.cc ?? [];
  if (addressesPublic(to)) return "public";
  if (addressesPublic(cc)) return "unlisted";
  if (addressesFollowers([...to, ...cc])) return "followers";
  return "unlisted";
}

/**
 * A Note addressed ONLY to specific actors — no Public, no followers collection
 * — i.e. a direct/DM-shaped Note. When such a Note reaches a shared-inbox fan-out
 * recipient it is NOT addressed to, it must NOT be stored as a world-readable
 * generic Note; the addressed local actor's own delivery handles it via
 * insertDirectNote. Recipient-independent (keyed on the activity's own
 * addressing), unlike isDirectNote.
 */
function isDirectShapedNote(object: { to?: string[]; cc?: string[] }): boolean {
  const all = [...(object.to ?? []), ...(object.cc ?? [])];
  if (all.length === 0) return false;
  if (addressesPublic(all)) return false;
  if (addressesFollowers(all)) return false;
  return true;
}

// Cap persisted addressing arrays so a remote cannot bloat a row with a huge
// to/cc list; 64 entries is far beyond any real audience and keeps the explicit-
// recipient (mention) gate working.
const MAX_ADDRESS_ENTRIES = 64;
function boundAddressJson(addresses: string[] | undefined): string {
  if (!Array.isArray(addresses) || addresses.length === 0) return "[]";
  return JSON.stringify(
    addresses
      .filter((a) => typeof a === "string")
      .slice(0, MAX_ADDRESS_ENTRIES),
  );
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
  const publishedAt = normalizeInboundTimestamp(
    object.published,
    new Date().toISOString(),
  );
  const toJson = JSON.stringify([recipient.apId]);

  // Was the object already present BEFORE this dispatch? This decides whether
  // this delivery is the one that creates the row (and therefore the one that
  // owns the postCount +1 and the inbox surfacing). It is read once here and
  // used only to gate the post-commit side effects; the counter itself is made
  // crash-/retry-safe by the in-batch NOT-EXISTS guard below.
  const existingObject = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();

  // #3 (atomicity + idempotency): the object insert and the author postCount
  // bump MUST commit together. Previously the row was inserted
  // (onConflictDoNothing) and postCount bumped in a SEPARATE await; under the
  // claim/processed re-dispatch model a crash between them left the row present
  // but the count un-bumped, and a peer retry's no-op insert SKIPPED the bump →
  // a permanent under-count. Co-commit both in one atomic batch. The postCount
  // +1 runs BEFORE the insert and is guarded by a correlated NOT-EXISTS(object)
  // subquery, so it fires only when THIS batch creates the row (mirrors the
  // edge-absent guard in handleAdd); a duplicate / retry sees the row present →
  // the guard is false and the insert is a no-op, so the count can neither
  // double-bump nor under-count.
  const objectAbsent = sql`NOT EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${objectId})`;
  await runBatch(db, [
    db
      .update(actors)
      .set({ postCount: sql`${actors.postCount} + 1` })
      .where(and(eq(actors.apId, actor), objectAbsent)),
    db
      .insert(objects)
      .values({
        apId: objectId,
        type: "Note",
        attributedTo: actor,
        content: boundInboundContent(object.content),
        summary: boundInboundSummary(object.summary),
        attachmentsJson: boundAttachmentsJson(attachments),
        inReplyTo: object.inReplyTo || null,
        visibility: "direct",
        toJson,
        conversation: conversationId,
        communityApId: null,
        published: publishedAt,
        isLocal: 0,
      })
      .onConflictDoNothing(),
  ]);

  if (existingObject) return; // duplicate: no inbox surfacing, no double count

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

  // Handle Note type (a remote may send `type` as a string or an array)
  if (!typeIncludes(object.type, "Note")) return;

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

  // A direct/DM-shaped Note (addressed only to specific actors, neither Public
  // nor followers) that is NOT addressed to THIS fan-out recipient: the shared
  // inbox calls handleCreate once per local follower of the sender, so a DM
  // addressed to actor A is also dispatched for an unrelated follower B. We must
  // NOT store it as a world-readable generic Note for B — the addressed actor's
  // own delivery handles it via insertDirectNote above. Skip it here.
  if (isDirectShapedNote(object)) {
    log.warn("Skipping direct Note not addressed to this recipient", {
      event: "ap.create.direct_note_not_addressed",
      actor,
      recipient: recipient.apId,
      objectId: object.id,
    });
    return;
  }

  const objectId = object.id || objectApId(baseUrl, generateId());

  // Was the object already present BEFORE this dispatch? This is read ONCE and
  // used only to gate the one-shot side effects (parent notification) below; it
  // intentionally does NOT early-return, because the idempotent count batch must
  // still run on a retry so a parent replyCount left stale by an interrupted
  // prior attempt CONVERGES (mirrors handleInteraction, which always runs the
  // recompute batch and uses the pre-read only to gate the notification).
  const existingBeforeInsert = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();

  const attachments = object.attachment
    ? JSON.stringify(object.attachment)
    : "[]";
  const publishedAt = normalizeInboundTimestamp(
    object.published,
    new Date().toISOString(),
  );
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

  // #3 (atomicity + idempotency): the object insert, the author postCount bump,
  // and (for a reply) the parent replyCount bump MUST commit together.
  // Previously the row was inserted (onConflictDoNothing) and the counts bumped
  // in SEPARATE awaits; under the claim/processed re-dispatch model a crash
  // between them left the row present but the counts un-bumped, and a peer
  // retry's no-op insert SKIPPED the bumps → permanent postCount/replyCount
  // drift. Co-commit them in one atomic batch:
  //   - postCount +1 runs BEFORE the insert, guarded by a correlated
  //     NOT-EXISTS(object) subquery so it fires only when THIS batch creates
  //     the row (mirrors handleAdd's edge-absent guard); a duplicate / retry
  //     observes the row present → guard false → no double-bump, no under-count.
  //   - replyCount is RECOMPUTED from COUNT(*) of the reply edge set AFTER the
  //     insert (mirrors the object-counter recompute in handleInteraction /
  //     undoInteraction): exact and idempotent, so a retry after a mid-write
  //     crash CONVERGES to the true reply count and a duplicate cannot inflate.
  const objectAbsent = sql`NOT EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${objectId})`;
  const insertObject = db
    .insert(objects)
    .values({
      apId: objectId,
      type: "Note",
      attributedTo: actor,
      content: boundInboundContent(object.content),
      summary: boundInboundSummary(object.summary),
      attachmentsJson: boundAttachmentsJson(attachments),
      inReplyTo: object.inReplyTo || null,
      // Recipient-independent classification: a non-public Note is never stored
      // as world-readable "unlisted". A followers-only post → "followers" (gated
      // by the accepted-follow edge), preserving the remote author's audience.
      visibility: classifyInboundNoteVisibility(object),
      // Persist the addressing so the explicit-recipient (mention) gate in
      // canViewerReadObjectFull / the post-detail route can evaluate.
      toJson: boundAddressJson(object.to),
      ccJson: boundAddressJson(object.cc),
      communityApId: null,
      published: publishedAt,
      isLocal: 0,
    })
    .onConflictDoNothing();

  const bumpPostCount = db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} + 1` })
    .where(and(eq(actors.apId, actor), objectAbsent));

  if (object.inReplyTo) {
    const parentId = object.inReplyTo;
    await runBatch(db, [
      bumpPostCount,
      insertObject,
      db
        .update(objects)
        .set({
          replyCount: sql`(SELECT COUNT(*) FROM ${objects} WHERE ${objects.inReplyTo} = ${parentId})`,
        })
        .where(eq(objects.apId, parentId)),
    ]);
  } else {
    await runBatch(db, [bumpPostCount, insertObject]);
  }

  if (existingBeforeInsert) return; // duplicate: no double notification

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

  // overlays validation (optional, validate if present). Cap the COUNT — the
  // local create path bounds overlays via validateOverlays (MAX_OVERLAYS=20),
  // and a hostile remote must not pad an unbounded array into attachments_json.
  const MAX_INBOUND_OVERLAYS = 20;
  let overlays: StoryOverlay[] | undefined;
  if (Array.isArray(object.overlays)) {
    const filtered = (object.overlays as StoryOverlay[])
      .filter(
        (o: StoryOverlay) =>
          o &&
          o.position &&
          typeof o.position.x === "number" &&
          typeof o.position.y === "number",
      )
      .slice(0, MAX_INBOUND_OVERLAYS);
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
    // The remote caption arrives as the AS2 Note `content`; persist it (bounded
    // to the same local content cap as every other inbound Note path) so the
    // local renderer shows the same caption as the originating instance.
    caption:
      typeof object.content === "string" && object.content.trim().length > 0
        ? boundInboundContent(object.content)
        : undefined,
    overlays,
  };

  const now = new Date().toISOString();
  // Clamp the attacker-controlled `endTime`: a story must expire. A non-ISO or
  // far-future value stored verbatim would never satisfy the expiry filter
  // (`lt(endTime, now)`, a lexical compare), so a malicious remote could create
  // never-expiring stories that accumulate forever. Bound it to published + ~25h
  // (the ~24h story lifetime + slack) and normalize to ISO so the compare holds.
  const STORY_MAX_LIFETIME_MS = 25 * 60 * 60 * 1000;
  // Clamp+normalize the inbound `published` FIRST and anchor the endTime bound to
  // THAT, not the raw value: a far-future `published` ("9999-…") would otherwise
  // push maxEndMs far into the future too and defeat this very expiry clamp.
  const publishedAt = normalizeInboundTimestamp(object.published, now);
  const publishedMs = Date.parse(publishedAt);
  const maxEndMs =
    (Number.isNaN(publishedMs) ? Date.now() : publishedMs) +
    STORY_MAX_LIFETIME_MS;
  const requestedEndMs = object.endTime ? Date.parse(object.endTime) : NaN;
  const endTime = new Date(
    Number.isNaN(requestedEndMs)
      ? maxEndMs
      : Math.min(requestedEndMs, maxEndMs),
  ).toISOString();

  // The early existence check above is best-effort (TOCTOU): two isolates
  // racing the same cold story can both pass it. `onConflictDoNothing` keeps
  // that race insert-safe, and gating follow-on side effects on the returned
  // row mirrors the duplicate guard in handleCreate.
  // Bound the serialized story data. Caption is capped and overlays are
  // count-limited above, but per-overlay padding could still inflate it; if the
  // blob exceeds the attachments cap, drop the (decorative) overlays so the core
  // attachment + caption still persist within bounds.
  let storyDataJson = JSON.stringify(attachmentData);
  if (storyDataJson.length > MAX_ATTACHMENTS_JSON_LENGTH) {
    storyDataJson = JSON.stringify({ ...attachmentData, overlays: undefined });
  }

  const inserted = await db
    .insert(objects)
    .values({
      apId: objectId,
      type: "Story",
      attributedTo: actor,
      content: "",
      attachmentsJson: storyDataJson,
      endTime,
      published: publishedAt,
      isLocal: 0,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (!inserted) return; // duplicate
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

  // Delete every child row keyed by this object before the object row itself.
  // FK ON DELETE CASCADE is not reliably enforced on every runtime/connection
  // (D1 ignores PRAGMA foreign_keys), so cascade explicitly to avoid orphans.
  // Covers likes/announces/bookmarks/object_recipients/story_* in one place,
  // shared with the local DELETE /posts/:id path.
  const mediaKeys = await deleteObjectCascade(db, objectId, c.env.MEDIA);

  // #3 (atomicity + idempotency): the object-row delete and the counter
  // decrements MUST commit together. Previously the row was deleted and the
  // counts decremented in SEPARATE awaits; under the claim/processed
  // re-dispatch model a crash between them left the row gone but the counts
  // un-decremented, and a peer retry early-returns on the absent row so the
  // decrements were SKIPPED → permanent postCount/replyCount drift. Co-commit
  // them in one atomic batch (the media cascade above is intentionally NOT
  // moved into the batch — it must run first while attachments_json is still
  // readable). Statement ordering inside the batch:
  //   - postCount -1 runs BEFORE the delete, guarded by a correlated
  //     EXISTS(object) subquery (so a duplicate Delete / retry on an
  //     already-gone row is a no-op) plus a gt(postCount,0) underflow guard
  //     (mirrors handleRemove).
  //   - replyCount is RECOMPUTED from COUNT(*) of the remaining reply edge set
  //     AFTER the delete (mirrors undoInteraction's object-counter recompute):
  //     exact and idempotent, so a retry CONVERGES to the true reply count.
  const objectExists = sql`EXISTS (SELECT 1 FROM ${objects} WHERE ${objects.apId} = ${objectId})`;
  const author = delObj.attributedTo;
  const deleteObject = db.delete(objects).where(eq(objects.apId, objectId));
  const decPostCount = db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} - 1` })
    .where(and(eq(actors.apId, author), gt(actors.postCount, 0), objectExists));

  if (delObj.inReplyTo) {
    const parentId = delObj.inReplyTo;
    await runBatch(db, [
      decPostCount,
      deleteObject,
      db
        .update(objects)
        .set({
          replyCount: sql`(SELECT COUNT(*) FROM ${objects} WHERE ${objects.inReplyTo} = ${parentId})`,
        })
        .where(eq(objects.apId, parentId)),
    ]);
  } else {
    await runBatch(db, [decPostCount, deleteObject]);
  }

  // Irreversible R2 purge LAST — after the objects row is gone. On the queue-
  // backed inbox path a failure here is also self-healing: a Delete retry
  // re-runs, finds no media_uploads rows, and proceeds.
  await purgeMediaBlobs(c.env.MEDIA, mediaKeys);
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

  // Update(Person/Service/Group) — an inbound actor-document update (remote
  // profile / avatar / public-key rotation). Apply it immediately by
  // re-fetching and upserting the actor through the same canonical actor-cache
  // path used by cacheRemoteActor, instead of waiting for the 24h actor-cache
  // TTL to expire. A signed actor may only update its own document, so the
  // updated object must be the actor itself (`object.id === activity.actor`,
  // mirroring the actor==object self-update contract). The remote document is
  // re-fetched from origin (never trusted from the wire) so a spoofed Update
  // body cannot poison the cache.
  if (isActorTypeUpdate(object.type) || objectId === actor) {
    if (objectId !== actor) {
      log.warn("Update(actor) rejected: object id does not match actor", {
        event: "ap.update.actor_self_mismatch",
        actor,
        objectId,
      });
      return;
    }
    // Amplification guard: an inbound Update(actor) would otherwise trigger an
    // unconditional outbound re-fetch of the actor document on EVERY activity,
    // so a remote could flood us into hammering its origin (or a third party).
    // Skip the re-fetch when the cached row was fetched within a short cooldown
    // window; the normal actor-cache TTL refresh still picks up later changes.
    const cached = await db
      .select({ lastFetchedAt: actorCache.lastFetchedAt })
      .from(actorCache)
      .where(eq(actorCache.apId, objectId))
      .get();
    if (cached?.lastFetchedAt) {
      const age = Date.now() - new Date(cached.lastFetchedAt).getTime();
      if (
        Number.isFinite(age) &&
        age >= 0 &&
        age < ACTOR_UPDATE_REFETCH_COOLDOWN_MS
      ) {
        log.debug("Update(actor) re-fetch skipped: within cooldown", {
          event: "ap.update.actor_refetch_cooldown",
          actor: objectId,
          ageMs: age,
        });
        return;
      }
    }
    await refreshActorCache(db, objectId);
    return;
  }

  const existing = await db
    .select({ attributedTo: objects.attributedTo })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (!existing || existing.attributedTo !== actor) return;

  // Update object content
  if (typeIncludes(object.type, "Note")) {
    const attachments = object.attachment
      ? JSON.stringify(object.attachment)
      : undefined;
    await db
      .update(objects)
      .set({
        content:
          typeof object.content === "string" && object.content
            ? truncate(object.content, MAX_POST_CONTENT_LENGTH)
            : undefined,
        summary:
          typeof object.summary === "string" && object.summary
            ? truncate(object.summary, MAX_POST_SUMMARY_LENGTH)
            : undefined,
        attachmentsJson: attachments
          ? boundAttachmentsJson(attachments)
          : undefined,
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
  if (
    !(await destinationDeclaresAlias(
      newActorApId,
      oldActorApId,
      (await getInstanceFetchSignerByDb(db)) ?? undefined,
    ))
  ) {
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
              // Subquery, not `inArray(followerTargets)`: the old actor's follow
              // graph can exceed D1's 100-bound-parameter ceiling. Same set as
              // followerTargets (the old actor's followees).
              inArray(
                follows.followingApId,
                db
                  .select({ id: follows.followingApId })
                  .from(follows)
                  .where(eq(follows.followerApId, oldActorApId)),
              ),
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
              // Subquery, not `inArray(followingSources)`: the old actor's
              // follower graph can exceed D1's 100-bound-parameter ceiling. Same
              // set as followingSources (the old actor's followers).
              inArray(
                follows.followerApId,
                db
                  .select({ id: follows.followerApId })
                  .from(follows)
                  .where(eq(follows.followingApId, oldActorApId)),
              ),
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

  // Drop self-edges in addition to the existing-pair dedup: if the old and new
  // actor were already connected (old followed/was-followed-by new, or vice
  // versa), rewriting the endpoint to the new actor would produce a row where
  // followerApId === followingApId (a self-follow). Filter those out so the
  // migration never materializes a self-follow.
  const followerRewrites = followerRows
    .filter(
      (row) =>
        !existingFollowerTargetSet.has(row.followingApId) &&
        row.followingApId !== newActorApId,
    )
    .map((row) => ({
      followerApId: newActorApId,
      followingApId: row.followingApId,
      status: row.status,
      activityApId: row.activityApId,
      createdAt: row.createdAt,
      acceptedAt: row.acceptedAt,
    }));
  // For followers that are LOCAL to this instance, a bare edge rewrite is not
  // enough: the destination server has no record of the follow, so it would
  // never deliver the migrated account's posts (the local user's following list
  // would point at the new actor but silently receive nothing). Re-issue a
  // fresh, *pending* Follow to the new actor and enqueue outbound delivery —
  // the standard Mastodon "follow the move target on the user's behalf"
  // behavior; the destination's Accept flips it to accepted. Remote followers
  // are left as a plain edge rewrite: re-establishing their follow is their own
  // server's responsibility.
  const baseUrl = c.env.APP_URL;
  const localReFollows: { followerApId: string; followId: string }[] = [];
  const followingRewrites = followingRows
    .filter(
      (row) =>
        !existingFollowingSourceSet.has(row.followerApId) &&
        row.followerApId !== newActorApId,
    )
    .map((row) => {
      if (isLocal(row.followerApId, baseUrl)) {
        const followId = activityApId(baseUrl, generateId());
        localReFollows.push({ followerApId: row.followerApId, followId });
        return {
          followerApId: row.followerApId,
          followingApId: newActorApId,
          status: "pending",
          activityApId: followId,
          createdAt: row.createdAt,
          acceptedAt: null,
        };
      }
      return {
        followerApId: row.followerApId,
        followingApId: newActorApId,
        status: row.status,
        activityApId: row.activityApId,
        createdAt: row.createdAt,
        acceptedAt: row.acceptedAt,
      };
    });

  // LOCAL followers whose ACCEPTED edge to the old actor we are about to delete.
  // Each such edge was counted in that follower's followingCount; the re-issued
  // Follow to the new actor is created PENDING (uncounted) and only re-adds the
  // +1 when the destination Accepts (handleAccept). So the old +1 must be removed
  // now, otherwise the eventual Accept stacks a second +1 on the never-removed
  // old count → a permanent over-count of 1 per migrated follow. Decrementing at
  // delete time is correct in every Accept-timing case: during the pending window
  // the follower counts 0 of this relationship (right — it is pending), after the
  // Accept it is back to 1, and if the Accept never arrives it stays decremented
  // (right — the edge is perpetually pending). Remote followers' counts are not
  // ours to manage; only local followingCount is authoritative here.
  const localAcceptedFollowerApIds = Array.from(
    new Set(
      followingRows
        .filter(
          (row) =>
            row.status === "accepted" && isLocal(row.followerApId, baseUrl),
        )
        .map((row) => row.followerApId),
    ),
  );

  // Co-commit the four edge mutations + the per-follower followingCount
  // decrements in ONE atomic batch. D1 has no interactive transactions, and the
  // OLD sequential form was non-convergent: a crash between "delete old edges"
  // and "decrement" left the old edges gone, so a re-dispatch (the row is still
  // processed=0) re-read EMPTY follower/following rows, skipped the decrement,
  // and left every migrated local follower's followingCount permanently +1 over.
  // Batching makes delete+decrement all-or-nothing: a crash before commit changes
  // nothing (retry re-runs cleanly from the still-present old edges); a crash
  // after commit re-reads no old edges (the batch is then a no-op) → the
  // decrement is applied exactly once.
  const moveOps = [];
  if (followerRewrites.length > 0) {
    moveOps.push(db.insert(follows).values(followerRewrites));
  }
  if (followerRows.length > 0) {
    moveOps.push(
      db.delete(follows).where(eq(follows.followerApId, oldActorApId)),
    );
  }
  if (followingRewrites.length > 0) {
    moveOps.push(db.insert(follows).values(followingRewrites));
  }
  if (followingRows.length > 0) {
    moveOps.push(
      db.delete(follows).where(eq(follows.followingApId, oldActorApId)),
    );
  }
  for (const followerApId of localAcceptedFollowerApIds) {
    moveOps.push(
      db
        .update(actors)
        .set({ followingCount: sql`${actors.followingCount} - 1` })
        .where(
          and(eq(actors.apId, followerApId), gt(actors.followingCount, 0)),
        ),
    );
  }
  if (moveOps.length > 0) {
    await runBatch(db, moveOps as unknown as Parameters<typeof runBatch>[1]);
  }

  // Record + deliver the outbound Follow activities for migrated local
  // followers so the destination server registers them as followers and starts
  // delivering. Best-effort per follower: a delivery enqueue failure must not
  // abort the rest of the migration (the follow row is already pending and will
  // simply lack delivery until retried).
  for (const { followerApId, followId } of localReFollows) {
    const followActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: followId,
      type: "Follow",
      actor: followerApId,
      object: newActorApId,
    };
    try {
      await db.insert(activities).values({
        apId: followId,
        type: "Follow",
        actorApId: followerApId,
        objectApId: newActorApId,
        rawJson: JSON.stringify(followActivity),
        direction: "outbound",
      });
      await enqueueDeliveryToActor(c.env, followId, newActorApId);
    } catch (e) {
      log.warn("Failed to issue migration re-follow to move target", {
        event: "ap.move.refollow_failed",
        follower: followerApId,
        newActor: newActorApId,
        error: e,
      });
    }
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
async function refreshActorCache(
  db: Database,
  actorApIdValue: string,
): Promise<void> {
  const result = await fetchAndUpsertActorCache(db, actorApIdValue, {
    timeout: 15000,
    mode: "upsert",
    // Sign as the instance actor so a secure-mode remote serves its doc.
    signer: (await getInstanceFetchSignerByDb(db)) ?? undefined,
  });
  if (!result.ok && result.reason === "fetch_failed") {
    // Shared by Move (refresh the migration target) and Update(actor)
    // (apply a remote profile / key rotation immediately). Best-effort: a
    // failed refresh simply leaves the existing cache row in place until the
    // normal TTL refresh, so it is logged rather than thrown.
    log.warn("Failed to refresh remote actor cache", {
      event: "ap.actor.cache_refresh_failed",
      actor: actorApIdValue,
    });
  }
}
