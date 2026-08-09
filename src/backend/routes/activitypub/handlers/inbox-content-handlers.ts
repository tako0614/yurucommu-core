import type { Database } from "../../../../db/index.ts";
import {
  and,
  count,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  activities,
  actorCache,
  actors,
  announces,
  blocks,
  bookmarks,
  communities,
  follows,
  inbox as inboxTable,
  likes,
  mutes,
  objectRecipients,
  objects,
  storyShares,
  storyViews,
  storyVotes,
} from "../../../../db/index.ts";
import { insertMany, runBatch } from "../../../../db/d1-write.ts";
import {
  addressesPublic,
  collectBoundedInboundAddresses,
} from "../inbound-addressing.ts";
import { upsertActivityAndNotify } from "./inbox-shared-helpers.ts";
import { normalizeInboundTimestamp } from "./inbound-timestamp.ts";
import { resolveInboundCommunityScope } from "./inbound-community-scope.ts";
import {
  MAX_INBOUND_OBJECT_ID_LENGTH,
  validateInboundObjectIdentity,
} from "./inbound-object-identity.ts";
import {
  buildInboundStoryCreateProjection,
  buildInboundStoryUpdateProjection,
  declaresStoryAddressing,
  hasStoryProjectionUpdate,
  normalizeInboundStoryCreateEndTime,
  normalizeInboundStoryUpdateEndTime,
  storyAddressedCollections,
} from "./inbound-story-projection.ts";
import {
  deleteObjectCascade,
  purgeMediaBlobs,
} from "../../posts/delete-cascade.ts";
import {
  boundInboundContent,
  boundInboundNoteAttachmentsJson,
  boundInboundSummary,
  boundInboundTagsJson,
} from "../../posts/transformers.ts";
import {
  activityApId,
  generateId,
  isLocal,
  isSafeRemoteUrl,
} from "../../../federation-helpers.ts";
import { getConversationId } from "../../dm/query-helpers.ts";
import {
  fetchAndUpsertActorCache,
  getInstanceFetchSignerByDb,
} from "../../../lib/activitypub-actor-cache.ts";
import { fetchWithTimeout } from "../../../lib/federation-fetch.ts";
import { signRequest } from "../../../lib/ap-signing.ts";
import {
  destinationDeclaresAlias,
  enqueuePersistedMoveRefollows,
  moveRefollowPrefix,
  rewriteMovedFollowGraph,
} from "../../../lib/account-migration.ts";
import { chunkForInClause } from "../../../lib/chunk.ts";
import {
  actorSuppressesInteractionFrom,
  canViewerReadObjectFull,
} from "../../../lib/post-visibility.ts";
import { logger } from "../../../lib/logger.ts";
import {
  type Activity,
  type ActivityContext,
  type ActivityObject,
  getActivityObject,
  getActivityObjectId,
  typeIncludes,
} from "../inbox-types.ts";

const log = logger.child({ component: "activitypub.inbox.content" });

type ActorRow = typeof actors.$inferSelect;

// normalizeInboundTimestamp now lives in ./inbound-timestamp.ts (shared with the
// federated group-chat path) — imported at the top of this file.

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

/** Single-user instance policy: any local owner block/mute suppresses content writes. */
async function ownerSuppressesInboundActor(
  db: Database,
  actorApId: string,
): Promise<boolean> {
  const [block, mute] = await Promise.all([
    db
      .select({ actorApId: blocks.blockerApId })
      .from(blocks)
      .where(eq(blocks.blockedApId, actorApId))
      .get(),
    db
      .select({ actorApId: mutes.muterApId })
      .from(mutes)
      .where(eq(mutes.mutedApId, actorApId))
      .get(),
  ]);
  return Boolean(block || mute);
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

// A note addressed to a followers collection (the author's `<actor>/followers`)
// and NOT to Public is a followers-only post. We match any `/followers`
// collection by suffix (mirrors isDirectNote), which covers the author's
// collection without needing to resolve it.
export function addressesFollowers(addresses: string[]): boolean {
  return addresses.some((a) => a.endsWith("/followers"));
}

type NoteAddressing = {
  readonly to: string[];
  readonly cc: string[];
  readonly bto: string[];
  readonly bcc: string[];
};

type AddressingSource = Pick<Activity, "to" | "cc" | "bto" | "bcc">;

function declaresAddressing(source: AddressingSource): boolean {
  return (
    source.to !== undefined ||
    source.cc !== undefined ||
    source.bto !== undefined ||
    source.bcc !== undefined
  );
}

function noteAddressing(source: AddressingSource): NoteAddressing {
  return {
    to: addressList(source.to),
    cc: addressList(source.cc),
    bto: addressList(source.bto),
    bcc: addressList(source.bcc),
  };
}

/**
 * Resolve the Note reach carried by a Create. The embedded object is the
 * durable object projection when it declares any addressing field (including
 * an explicit empty array); peers that put all addressing on the Create
 * envelope remain compatible through the fallback.
 */
function createNoteAddressing(
  activity: Activity,
  object: ActivityObject,
): NoteAddressing {
  return noteAddressing(declaresAddressing(object) ? object : activity);
}

function allNoteAddresses(addressing: NoteAddressing): string[] {
  return [
    ...addressing.to,
    ...addressing.cc,
    ...addressing.bto,
    ...addressing.bcc,
  ];
}

/**
 * Bounded actor/specific-object recipients, excluding collection reach. These
 * become indexed object_recipients authority. `bto`/`bcc` values never enter
 * the public to_json/cc_json projections.
 */
function specificRecipientAddresses(addressing: NoteAddressing): string[] {
  return [...new Set(allNoteAddresses(addressing))].filter(
    (address) => !addressesPublic([address]) && !address.endsWith("/followers"),
  );
}

function hiddenRecipientAddresses(addressing: NoteAddressing): string[] {
  return [...new Set([...addressing.bto, ...addressing.bcc])].filter(
    (address) => !addressesPublic([address]) && !address.endsWith("/followers"),
  );
}

/**
 * Derive an object's reply counter from the indexed child edge set.
 *
 * Federation delivery is unordered: a child can commit while its parent is
 * still unknown, making the child's immediate parent UPDATE a legitimate
 * zero-row no-op. Every later parent insert or duplicate delivery must run this
 * statement after the insert attempt so both arrival orders — and old stale
 * rows — converge without depending on a child retry.
 */
function recomputeObjectReplyCount(db: Database, objectId: string) {
  return db
    .update(objects)
    .set({
      replyCount: sql`(SELECT COUNT(*) FROM ${objects} WHERE ${objects.inReplyTo} = ${objectId})`,
    })
    .where(eq(objects.apId, objectId));
}

/**
 * Recipient-INDEPENDENT visibility classification for an inbound generic Note,
 * mirroring the local outbound addressing contract. CRITICAL invariant: a
 * non-public Note is NEVER classified as "unlisted" (world-readable). Direct
 * addressed Notes are normally diverted before the generic Create insert, but
 * the classifier itself remains total so every caller fails closed:
 *   - "public"    — the Public collection is in `to`;
 *   - "unlisted"  — Public is only in `cc` (Mastodon-style unlisted);
 *   - "followers" — a followers collection is addressed and Public is absent.
 *   - "direct"    — only actor IRIs, or no usable addressing at all. The empty
 *                   case is intentionally unreadable rather than world-readable.
 * Previously this was derived solely from `to.includes(Public)`, so a remote
 * followers-only post (Public absent) was silently downgraded to "unlisted" and
 * became world-readable. */
function classifyInboundNoteVisibility(
  addressing: NoteAddressing,
): "public" | "unlisted" | "followers" | "direct" {
  const { to, cc, bto, bcc } = addressing;
  if (addressesPublic(to)) return "public";
  if (addressesPublic(cc)) return "unlisted";
  // Hidden fields are still audience authority. They are considered for reach
  // classification but are never copied into visible addressing projections.
  if (addressesPublic([...bto, ...bcc])) return "public";
  if (addressesFollowers([...to, ...cc, ...bto, ...bcc])) return "followers";
  return "direct";
}

/**
 * A Note addressed ONLY to specific actors — no Public, no followers collection
 * — i.e. a direct/DM-shaped Note. When such a Note reaches a shared-inbox fan-out
 * recipient it is NOT addressed to, it must NOT be stored as a world-readable
 * generic Note; the addressed local actor's own delivery handles it via
 * insertDirectNote. Recipient-independent (keyed on the activity's own
 * addressing), unlike isDirectNote.
 */
function isDirectShapedNote(addressing: NoteAddressing): boolean {
  const all = allNoteAddresses(addressing);
  if (all.length === 0) return false;
  if (addressesPublic(all)) return false;
  if (addressesFollowers(all)) return false;
  return true;
}

function boundAddressJson(value: unknown): string {
  return JSON.stringify(addressList(value));
}

/**
 * Normalize one already-validated AS2 addressing field (`to` / `cc` /
 * `audience`). The field may be absent, a bare string, or an array mixing
 * strings and embedded objects. Validation happens once for the complete
 * envelope/object projection before any caller derives reach from these lists.
 */
function addressList(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((a): a is string => typeof a === "string"))];
}

/**
 * The embedded object's audience is the persisted object projection. Peers
 * that put audience only on the activity envelope remain compatible, while an
 * explicit object-level [] wins and can clear the scope on Update.
 */
function normalizedObjectAudience(
  activity: Activity,
  object: ActivityObject,
): string[] {
  const source =
    object.audience !== undefined ? object.audience : activity.audience;
  return [...new Set(addressList(source))];
}

/**
 * Extract the `href` of every `Mention` tag on an inbound object. AS2 `tag` may
 * be an array, a single object, or absent; each Mention carries the mentioned
 * actor's id in `href`. Used to fan-in mention notifications for federated posts
 * (mirrors the local processMentions path).
 */
// Cap on the number of distinct local mentions a single inbound activity can
// fan a notification out to. `object.tag` is bounded only by the 512 KiB inbox
// payload cap (~9-10k Mention entries), and each one used to cost a serial
// `actors` SELECT — an attacker could blow the Workers subrequest budget with
// one signed POST. Real posts mention a handful of people, so this ceiling is
// generous while bounding the worst case.
const MAX_INBOUND_MENTIONS = 50;

function extractMentionHrefs(tag: unknown): string[] {
  const arr = Array.isArray(tag) ? tag : tag ? [tag] : [];
  const hrefs: string[] = [];
  for (const t of arr) {
    if (
      t &&
      typeof t === "object" &&
      typeIncludes((t as { type?: string | string[] }).type, "Mention")
    ) {
      const href = (t as { href?: unknown }).href;
      if (typeof href === "string" && href) hrefs.push(href);
    }
  }
  return hrefs;
}

/**
 * Detect an inbound direct (DM) Note: it is addressed (in
 * `to`/`cc`/`bto`/`bcc`) to one or more recipients but NOT to the Public
 * collection and NOT to a followers collection. The local addressed recipient
 * is the inbox owner (`recipient`), who is necessarily a known local actor row.
 * Mirrors the outbound DM contract in dm/messages.ts (visibility="direct",
 * to=[recipient]).
 */
function isDirectNote(
  addressing: NoteAddressing,
  recipient: ActorRow,
): boolean {
  const all = allNoteAddresses(addressing);
  if (all.length === 0) return false;
  // Direct notes are never addressed to the Public collection...
  if (addressesPublic(all)) return false;
  // ...nor to a followers collection (follower-only posts are not DMs).
  if (all.some((a) => a.endsWith("/followers"))) return false;
  if (recipient.followersUrl && all.includes(recipient.followersUrl)) {
    return false;
  }
  // Every AS2 audience field names recipients. `bto`/`bcc` are private, not
  // non-authoritative; dropping them here makes a correctly routed hidden DM
  // persist without recipient authority and therefore disappear from the UX.
  return all.includes(recipient.apId);
}

/**
 * Route an inbound direct (DM) Note into the recipient's DM inbox /
 * message-request flow, mirroring the local outbound path in
 * dm/messages.ts: a direct-visibility Note row, an objectRecipients row, a
 * stored inbound Create activity, and an inbox row so it surfaces.
 *
 * Each invocation records delivery for one local inbox owner. The outbound DM
 * UX remains strictly 1:1 (to=[otherApId]), so only single-recipient direct
 * Notes receive an `objects.conversation` id; multi-recipient delivery keeps
 * recipient authority without pretending that it belongs to a 1:1 thread.
 */
async function insertDirectNote(
  db: Database,
  activity: Activity,
  object: ActivityObject,
  objectId: string,
  actor: string,
  recipient: ActorRow,
  baseUrl: string,
  addressing: NoteAddressing,
): Promise<void> {
  // Derive the conversation. Honour a sender-supplied `object.conversation`
  // only when it matches the value yurucommu itself would compute for this
  // (sender, localRecipient) pair — otherwise a remote actor could force a
  // message into an arbitrary thread (spoof a reply context). Fall back to the
  // computed id for foreign-origin DMs that carry no/invalid conversation.
  const directRecipients = specificRecipientAddresses(addressing);
  const computedConversation =
    directRecipients.length === 1
      ? getConversationId(baseUrl, actor, directRecipients[0])
      : null;
  const conversationId =
    computedConversation && object.conversation === computedConversation
      ? object.conversation
      : computedConversation;

  const publishedAt = normalizeInboundTimestamp(
    object.published,
    new Date().toISOString(),
  );

  const replyCountStatements = [
    ...(object.inReplyTo
      ? [recomputeObjectReplyCount(db, object.inReplyTo)]
      : []),
    // A direct Note can itself be a late-arriving parent. Recompute even when
    // the insert conflicts so a peer retry repairs a stale legacy counter.
    recomputeObjectReplyCount(db, objectId),
  ];

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
        attachmentsJson: boundInboundNoteAttachmentsJson(object.attachment),
        tagsJson: boundInboundTagsJson(object.tag),
        inReplyTo: object.inReplyTo || null,
        visibility: "direct",
        // Only visible audience fields are serialized. Hidden `bto` / `bcc`
        // recipients live exclusively in object_recipients and must never be
        // disclosed through object JSON or the post API.
        toJson: boundAddressJson(addressing.to),
        ccJson: boundAddressJson(addressing.cc),
        conversation: conversationId,
        communityApId: null,
        published: publishedAt,
        isLocal: 0,
      })
      .onConflictDoNothing(),
    // The recipient link MUST co-commit with the object. Inbound-DM recipient
    // membership is resolved EXCLUSIVELY through object_recipients (contacts /
    // requests / unread-count), so an object that committed WITHOUT its
    // object_recipients row is a DM permanently invisible to the recipient.
    // Previously this insert ran as a SEPARATE await after the batch: a crash /
    // isolate-eviction in that window left exactly that orphan, and the caller's
    // `if (existing) return` made the re-dispatch skip the repair. In-batch with
    // onConflictDoNothing it is atomic (never orphaned) AND idempotent (a retry
    // is a safe no-op). The local-send / community / takos-tools paths already
    // co-commit this row for the same reason.
    db
      .insert(objectRecipients)
      .values({
        objectApId: objectId,
        recipientApId: recipient.apId,
        type: "to",
      })
      .onConflictDoNothing(),
    ...replyCountStatements,
  ]);

  // Store the inbound Create and surface it in the recipient's inbox so the DM
  // appears in the conversation / message-requests view. Both inserts are
  // idempotent, so every local recipient in a shared-inbox fan-out gets its own
  // inbox row and a retry repairs a missing side effect safely.
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

  const identity = validateInboundObjectIdentity(object.id, actor, baseUrl);
  if (!identity.ok) {
    log.warn("Create rejected: invalid remote object identity", {
      event: "ap.create.object_identity_invalid",
      actor,
      objectId: object.id,
      reason: identity.reason,
    });
    return;
  }

  const addressingContract = collectBoundedInboundAddresses([activity, object]);
  if (!addressingContract.ok) {
    log.warn("Create(Note) rejected: invalid addressing projection", {
      event: "ap.create.note_addressing_invalid",
      actor,
      objectId: identity.objectId,
      reason: addressingContract.reason,
    });
    return;
  }

  // Direct (DM) Note routing: a Note addressed to the local inbox owner that
  // is neither public nor follower-only belongs in the recipient's DM inbox /
  // message-request flow rather than the generic public Note insert.
  const addressing = createNoteAddressing(activity, object);

  const parentObj = object.inReplyTo
    ? await db
        .select({
          apId: objects.apId,
          attributedTo: objects.attributedTo,
          visibility: objects.visibility,
          toJson: objects.toJson,
          ccJson: objects.ccJson,
          audienceJson: objects.audienceJson,
          communityApId: objects.communityApId,
          type: objects.type,
          endTime: objects.endTime,
        })
        .from(objects)
        .where(eq(objects.apId, object.inReplyTo))
        .get()
    : null;

  // Inbound replies must pass the canonical read gate for EVERY parent retained
  // by this instance, including direct Notes and remote-authored objects
  // delivered to a local recipient. Keeping this check before the direct/generic
  // routing split prevents either storage path from becoming a restricted-thread
  // injection bypass. Personal block/mute state remains local-owner state, so
  // that extra guard applies only when the parent author is local.
  if (object.inReplyTo && parentObj) {
    if (!(await canViewerReadObjectFull(db, parentObj, actor))) return;
    if (
      isLocal(parentObj.attributedTo, baseUrl) &&
      (await actorSuppressesInteractionFrom(db, parentObj.attributedTo, actor))
    ) {
      return;
    }
  }

  // Root/public/followers/community Notes are still writes into this local
  // recipient's feed. Apply the same block/mute policy as DM, reply, mention,
  // Follow, Like, Announce, and Story before any durable projection is created.
  // The shared inbox invokes this handler once per resolved local recipient, so
  // the decision remains recipient-specific on that path.
  if (await actorSuppressesInteractionFrom(db, recipient.apId, actor)) {
    log.info("Dropped inbound Note from a blocked or muted actor", {
      event: "ap.create.note_suppressed",
      actor,
      recipient: recipient.apId,
    });
    return;
  }

  if (object.id && isDirectNote(addressing, recipient)) {
    await insertDirectNote(
      db,
      activity,
      object,
      object.id,
      actor,
      recipient,
      baseUrl,
      addressing,
    );
    return;
  }

  // A direct/DM-shaped Note (addressed only to specific actors, neither Public
  // nor followers) that is NOT addressed to THIS fan-out recipient: the shared
  // inbox calls handleCreate once per local follower of the sender, so a DM
  // addressed to actor A is also dispatched for an unrelated follower B. We must
  // NOT store it as a world-readable generic Note for B — the addressed actor's
  // own delivery handles it via insertDirectNote above. Skip it here.
  if (isDirectShapedNote(addressing)) {
    log.warn("Skipping direct Note not addressed to this recipient", {
      event: "ap.create.direct_note_not_addressed",
      actor,
      recipient: recipient.apId,
      objectId: object.id,
    });
    return;
  }

  const objectId = identity.objectId;

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

  const audience = normalizedObjectAudience(activity, object);
  const communityScope = await resolveInboundCommunityScope(
    db,
    actor,
    audience,
  );
  if (!communityScope.allowed) return;

  const publishedAt = normalizeInboundTimestamp(
    object.published,
    new Date().toISOString(),
  );

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
      attachmentsJson: boundInboundNoteAttachmentsJson(object.attachment),
      tagsJson: boundInboundTagsJson(object.tag),
      inReplyTo: object.inReplyTo || null,
      // Recipient-independent classification: a non-public Note is never stored
      // as world-readable "unlisted". A followers-only post → "followers" (gated
      // by the accepted-follow edge), preserving the remote author's audience.
      visibility: classifyInboundNoteVisibility(addressing),
      // Persist the addressing so the explicit-recipient (mention) gate in
      // canViewerReadObjectFull / the post-detail route can evaluate.
      toJson: boundAddressJson(addressing.to),
      ccJson: boundAddressJson(addressing.cc),
      audienceJson: JSON.stringify(audience),
      communityApId: communityScope.communityApId,
      published: publishedAt,
      isLocal: 0,
    })
    .onConflictDoNothing();

  const bumpPostCount = db
    .update(actors)
    .set({ postCount: sql`${actors.postCount} + 1` })
    .where(and(eq(actors.apId, actor), objectAbsent));

  // Persist hidden bto/bcc recipients as indexed authority projections on the
  // generic path. Visible to/cc recipients already remain authoritative in the
  // JSON projection; duplicating them here is unnecessary and would turn an
  // ordinary remote @mention into a recipient-table dependency. The canonical
  // read gate combines both representations without revealing hidden reach.
  const recipientProjectionStatements = insertMany(
    db,
    objectRecipients,
    hiddenRecipientAddresses(addressing).map((recipientApId) => ({
      objectApId: objectId,
      recipientApId,
      type: "to",
    })),
    { conflict: "ignore" },
  );

  if (object.inReplyTo) {
    const parentId = object.inReplyTo;
    await runBatch(db, [
      bumpPostCount,
      insertObject,
      ...recipientProjectionStatements,
      recomputeObjectReplyCount(db, parentId),
      recomputeObjectReplyCount(db, objectId),
    ]);
  } else {
    await runBatch(db, [
      bumpPostCount,
      insertObject,
      ...recipientProjectionStatements,
      recomputeObjectReplyCount(db, objectId),
    ]);
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

  // Notify every LOCAL actor @-mentioned in the post — the federated counterpart
  // of the local processMentions fan-in. Without this a cross-instance @-mention
  // produced no notification at all (mention is a first-class notification type
  // that only ever fired for local-origin posts). Runs once (the duplicate
  // delivery short-circuits at `existingBeforeInsert` above). Skips the post
  // author and the parent author (already notified by the reply branch) and
  // honors the mentioned actor's block/mute of the sender, mirroring the reply
  // gate.
  const mentionedLocalApIds = new Set<string>();
  for (const href of extractMentionHrefs(object.tag)) {
    if (!isLocal(href, baseUrl)) continue;
    if (href === actor) continue;
    if (parentObj && href === parentObj.attributedTo) continue;
    mentionedLocalApIds.add(href);
    // Bound attacker-controlled fan-out: stop collecting once the cap is hit so
    // a tag array full of distinct fake local hrefs cannot drive unbounded work.
    if (mentionedLocalApIds.size >= MAX_INBOUND_MENTIONS) break;
  }
  if (mentionedLocalApIds.size === 0) return;

  // Batch-resolve which of the mentioned hrefs are real local actors in one
  // chunked query (D1 caps bound params at 100), instead of a serial SELECT per
  // href. An attacker can pack thousands of distinct fake local hrefs into the
  // tag array; resolving them one-by-one was an N+1 / subrequest-budget
  // amplification. The chunked inArray collapses it to ceil(N/90) queries, and
  // only the resolved (existing) actors are then notified.
  const existingLocalApIds = (
    await Promise.all(
      chunkForInClause([...mentionedLocalApIds]).map((chunk) =>
        db
          .select({ apId: actors.apId })
          .from(actors)
          .where(inArray(actors.apId, chunk)),
      ),
    )
  ).flat();

  for (const { apId: mentionedApId } of existingLocalApIds) {
    if (await actorSuppressesInteractionFrom(db, mentionedApId, actor))
      continue;
    await upsertActivityAndNotify(
      db,
      activityApId(baseUrl, generateId()),
      "Create",
      actor,
      objectId,
      activity,
      mentionedApId,
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

  const identity = validateInboundObjectIdentity(object.id, actor, baseUrl);
  if (!identity.ok) {
    log.warn("Create(Story) rejected: invalid remote object identity", {
      event: "ap.story.object_identity_invalid",
      actor,
      objectId: object.id,
      reason: identity.reason,
    });
    return;
  }

  const objectId = identity.objectId;

  // Per-user block: drop a Story from an actor the local owner has blocked,
  // mirroring the inbound DM blockedBySigner drop + the inbound Like/Announce/
  // Follow/reply block gates. The other inbound owner-visible paths all enforce
  // the per-user `blocks` table; Create(Story) was the gap, so a blocked actor's
  // stories were still stored (consuming the per-author cap + retrievable via
  // GET /api/posts/:id). Single-user instance: any blocks row blocking this actor
  // is the owner's block.
  if (await ownerSuppressesInboundActor(db, actor)) return;

  // Check if story already exists
  const existing = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (existing) {
    // Duplicate Story delivery is a bounded repair opportunity for a parent
    // inserted by an older version before one or more child replies arrived.
    await recomputeObjectReplyCount(db, objectId);
    return;
  }

  // Per-author flood cap. A hostile remote could Create() an unbounded number of
  // Stories to bloat our feed/storage (each carries an attachment blob + caption).
  // The local create path is naturally bounded by the owner; inbound has no such
  // bound, so cap the concurrent LIVE (non-expired) remote stories per author.
  // Expired stories are reaped, so this limits the live set, not lifetime volume.
  const MAX_INBOUND_STORIES_PER_ACTOR = 50;
  const nowIso = new Date().toISOString();
  const liveStories = await db
    .select({ n: count() })
    .from(objects)
    .where(
      and(
        eq(objects.attributedTo, actor),
        eq(objects.type, "Story"),
        eq(objects.isLocal, 0),
        gt(objects.endTime, nowIso),
      ),
    )
    .get();
  if ((liveStories?.n ?? 0) >= MAX_INBOUND_STORIES_PER_ACTOR) {
    log.warn("Create(Story) rejected: author live-story cap reached", {
      event: "ap.story.author_cap",
      actor,
    });
    return;
  }

  // Story metadata has a product-specific storage shape; never feed it through
  // the generic Note attachment projection. Normalize every remote field at
  // this boundary so malformed URLs/overlays cannot become durable UI data.
  const storyProjection = buildInboundStoryCreateProjection(object);
  if (!storyProjection) {
    log.warn("Create(Story) rejected: invalid story projection", {
      event: "ap.story.invalid_projection",
      actor,
      objectId,
    });
    return;
  }

  // Clamp+normalize `published` first and anchor the expiry to that durable
  // value. Already-expired objects are discarded, closing the live-cap bypass
  // where a sender could churn unlimited rows with a past endTime.
  const now = new Date().toISOString();
  const publishedAt = normalizeInboundTimestamp(object.published, now);
  const endTime = normalizeInboundStoryCreateEndTime(
    publishedAt,
    object.endTime,
    now,
  );
  if (!endTime) {
    log.debug("Create(Story) dropped: already expired", {
      event: "ap.story.expired_at_ingress",
      actor,
      objectId,
    });
    return;
  }

  // The early existence check above is best-effort (TOCTOU): two isolates
  // racing the same cold story can both pass it. `onConflictDoNothing` keeps
  // that race insert-safe, and gating follow-on side effects on the returned
  // row mirrors the duplicate guard in handleCreate.
  // Carry the community scope across the federation boundary. A story that
  // arrived through community fanout is addressed to the community's followers
  // collection, not the author's; storing it with no scope made the local read
  // gate treat it as a personal story and serve it to every local follower of
  // the author, member or not. Resolve the addressed collection against the
  // communities this instance actually knows and only then mark the scope —
  // an unresolvable audience is left unscoped rather than trusted, and the
  // membership gate is still evaluated locally against `community_members`.
  const storyAddressing = storyAddressedCollections(activity, object);
  if (storyAddressing.overflow) {
    log.warn("Create(Story) rejected: too many addressing entries", {
      event: "ap.story.addressing_overflow",
      actor,
      objectId,
    });
    return;
  }
  const communityScope = await resolveInboundCommunityScope(
    db,
    actor,
    storyAddressing.addresses,
  );
  if (!communityScope.allowed) return;
  const storyAudience = communityScope.communityApId
    ? [communityScope.communityApId]
    : normalizedObjectAudience(activity, object);

  const inserted = await db
    .insert(objects)
    .values({
      apId: objectId,
      type: "Story",
      attributedTo: actor,
      content: "",
      attachmentsJson: storyProjection.json,
      ...(communityScope.communityApId
        ? {
            communityApId: communityScope.communityApId,
            audienceJson: JSON.stringify(storyAudience),
          }
        : storyAudience.length > 0
          ? { audienceJson: JSON.stringify(storyAudience) }
          : {}),
      endTime,
      // Handles the child-before-parent order without a second transaction.
      // The child Create path repairs the opposite concurrent order.
      replyCount: sql`(SELECT COUNT(*) FROM ${objects} WHERE ${objects.inReplyTo} = ${objectId})`,
      published: publishedAt,
      isLocal: 0,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (!inserted) return; // duplicate
}

// ---------------------------------------------------------------------------
// Announce target resolution (fetch-and-store a boosted remote Note)
// ---------------------------------------------------------------------------

// Upper bound on the fetch of a boosted remote object. Mirrors the actor-cache
// fetch timeout; the body size is already capped by fetchWithTimeout's wrapper.
const ANNOUNCED_OBJECT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Resolve an inbound Announce whose target this instance has never seen: fetch
 * the boosted object from its origin, validate it, and persist it as a remote
 * Note so the announce edge recorded by handleAnnounce surfaces in feeds
 * ("reposted by X") instead of dangling on an unknown ap_id.
 *
 * Reuses the SSRF-guarded federation fetch discipline end to end:
 * `fetchWithTimeout` (resolver-pinned DNS validation, no redirects, capped +
 * time-bounded body) with the GET signed as the instance actor so a
 * secure-mode remote serves the document (mirrors fetchAndUpsertActorCache).
 *
 * Validation mirrors the inbound Create(Note) gates:
 *   - the document's `id` must equal the fetched URL (no id squatting);
 *   - `attributedTo` must be same-origin with the object id (a remote author
 *     may only own objects under its own host — mirrors
 *     isObjectIdOriginMismatch, and a local-origin object is never fetched);
 *   - type must include "Note"; direct/DM-shaped addressing is refused;
 *   - only world-readable classifications (public / unlisted) are persisted —
 *     a boost must never widen a followers-only/direct object's audience, and
 *     this instance cannot verify a remote author's follower audience.
 *
 * Depth cap: the object's `inReplyTo` is stored verbatim and a retained parent
 * is authority-checked locally, but an unknown parent is NEVER fetched. A
 * single Announce therefore triggers at most one object fetch (plus a
 * best-effort author-profile cache fill), not a thread walk.
 *
 * Best-effort by contract: every failure returns false and the Announce is
 * dropped exactly as it was before this path existed.
 */
export async function fetchAndPersistAnnouncedNote(
  db: Database,
  objectId: string,
  baseUrl: string,
): Promise<boolean> {
  // Never fetch a local id (a local object that does not exist is just gone)
  // and never fetch an unsafe URL (non-http(s), credentials, blocked host…).
  if (
    objectId.length > MAX_INBOUND_OBJECT_ID_LENGTH ||
    isLocal(objectId, baseUrl) ||
    !isSafeRemoteUrl(objectId)
  ) {
    return false;
  }

  let note: ActivityObject & { attributedTo?: unknown };
  try {
    const headers: Record<string, string> = {
      Accept: "application/activity+json, application/ld+json",
    };
    const signer = await getInstanceFetchSignerByDb(db);
    if (signer) {
      Object.assign(
        headers,
        await signRequest(signer.privateKeyPem, signer.keyId, "GET", objectId),
      );
    }
    const res = await fetchWithTimeout(objectId, {
      headers,
      timeout: ANNOUNCED_OBJECT_FETCH_TIMEOUT_MS,
    });
    if (!res.ok) return false;
    const raw: unknown = await res.json();
    if (!raw || typeof raw !== "object") return false;
    note = raw as ActivityObject & { attributedTo?: unknown };
  } catch {
    // Unresolvable / oversized / timed-out fetch: drop silently (the caller
    // logs at debug level), matching the pre-existing unknown-object behavior.
    return false;
  }

  if (note.id !== objectId) return false;
  if (!typeIncludes(note.type, "Note")) return false;

  const attributedTo =
    typeof note.attributedTo === "string" ? note.attributedTo : null;
  if (!attributedTo || !isSafeRemoteUrl(attributedTo)) return false;
  if (!validateInboundObjectIdentity(objectId, attributedTo, baseUrl).ok) {
    return false;
  }

  const addressingContract = collectBoundedInboundAddresses([note]);
  if (!addressingContract.ok) return false;

  // Addressing gates: a DM-shaped object must never be stored world-readable,
  // and a non-public classification is refused outright (see doc comment).
  const addressing = noteAddressing(note);
  if (isDirectShapedNote(addressing)) return false;
  const visibility = classifyInboundNoteVisibility(addressing);
  if (visibility !== "public" && visibility !== "unlisted") return false;

  const audience = addressList(note.audience);
  const communityScope = await resolveInboundCommunityScope(
    db,
    attributedTo,
    audience,
  );
  if (!communityScope.allowed) return false;

  // A fetched boost target can itself be a reply. If its parent is already
  // retained, apply the exact same read/suppression authority as ordinary
  // inbound Create before storing the child. Without this check an Announce of
  // an otherwise-public Note could inject a reply beneath a local direct or
  // followers-only parent that its author cannot read. An unknown parent stays
  // unresolved (the one-fetch depth cap below); later parent arrival repairs
  // its derived counter through recomputeObjectReplyCount.
  const parentObj = note.inReplyTo
    ? await db
        .select({
          apId: objects.apId,
          attributedTo: objects.attributedTo,
          visibility: objects.visibility,
          toJson: objects.toJson,
          ccJson: objects.ccJson,
          audienceJson: objects.audienceJson,
          communityApId: objects.communityApId,
          type: objects.type,
          endTime: objects.endTime,
        })
        .from(objects)
        .where(eq(objects.apId, note.inReplyTo))
        .get()
    : null;
  if (note.inReplyTo && parentObj) {
    if (!(await canViewerReadObjectFull(db, parentObj, attributedTo))) {
      return false;
    }
    if (
      isLocal(parentObj.attributedTo, baseUrl) &&
      (await actorSuppressesInteractionFrom(
        db,
        parentObj.attributedTo,
        attributedTo,
      ))
    ) {
      return false;
    }
  }

  // Best-effort author profile fill so the surfaced boost renders with the
  // author's name/icon. Cache-when-absent; a failure never blocks the persist.
  const cachedAuthor = await db
    .select({ apId: actorCache.apId })
    .from(actorCache)
    .where(eq(actorCache.apId, attributedTo))
    .get();
  if (!cachedAuthor) {
    try {
      await fetchAndUpsertActorCache(db, attributedTo, {
        timeout: ANNOUNCED_OBJECT_FETCH_TIMEOUT_MS,
        mode: "insert",
        signer: (await getInstanceFetchSignerByDb(db)) ?? undefined,
      });
    } catch {
      /* best-effort */
    }
  }

  const insertObject = db
    .insert(objects)
    .values({
      apId: objectId,
      type: "Note",
      attributedTo,
      content: boundInboundContent(note.content),
      summary: boundInboundSummary(note.summary),
      attachmentsJson: boundInboundNoteAttachmentsJson(note.attachment),
      tagsJson: boundInboundTagsJson(note.tag),
      // Stored verbatim and never remotely resolved (depth cap): a boosted
      // reply keeps its honest thread link even when the parent stays unknown.
      inReplyTo: note.inReplyTo || null,
      visibility,
      toJson: boundAddressJson(note.to),
      ccJson: boundAddressJson(note.cc),
      audienceJson: JSON.stringify(audience),
      communityApId: communityScope.communityApId,
      published: normalizeInboundTimestamp(
        note.published,
        new Date().toISOString(),
      ),
      isLocal: 0,
    })
    .onConflictDoNothing();

  if (note.inReplyTo) {
    await runBatch(db, [
      insertObject,
      recomputeObjectReplyCount(db, note.inReplyTo),
      // Unknown Announce targets race normal Create delivery; the no-op insert
      // plus recompute keeps both arrival paths idempotent and repairable.
      recomputeObjectReplyCount(db, objectId),
    ]);
  } else {
    await runBatch(db, [insertObject, recomputeObjectReplyCount(db, objectId)]);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Delete handler
// ---------------------------------------------------------------------------

/**
 * Tombstone a remote actor locally in response to a verified inbound
 * Delete(Actor). Mirrors the local /me/delete teardown for the federation-facing
 * state we hold about a remote: reconcile LOCAL counterparts' follower/following
 * counts, drop the follow edges in both directions, purge the actor cache, and
 * cascade-delete the remote's cached content. All deletes are subquery-scoped
 * (no spliced ids → D1-param-safe) and remote objects carry no R2 blobs (their
 * media are remote URLs, not local uploads), so no media purge is needed.
 */
async function handleRemoteActorDelete(
  c: ActivityContext,
  actorId: string,
): Promise<void> {
  const db = c.get("db");

  // A Delete(actor) is one authority transition: the remote identity, its
  // relationship authority, cached content, and every denormalized counter
  // must disappear together. Keeping these as independent commits made retry
  // unsafe: a failure after one counterpart counter decrement but before the
  // follow delete let the retry observe the same edge and decrement again.
  // D1 batch is the only atomic multi-statement primitive available here.
  const remoteObjectIds = () =>
    db
      .select({ id: objects.apId })
      .from(objects)
      .where(eq(objects.attributedTo, actorId));

  // Counterpart count reconcile BEFORE dropping edges (mirrors actors.ts):
  // everyone the deleted remote followed loses a follower; everyone who followed
  // it loses a following. The subquery naturally scopes to LOCAL actors (remote
  // actors have no `actors` row); gt(...,0) guards underflow.
  await runBatch(db, [
    db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} - 1` })
      .where(
        and(
          inArray(
            actors.apId,
            db
              .select({ id: follows.followingApId })
              .from(follows)
              .where(eq(follows.followerApId, actorId)),
          ),
          gt(actors.followerCount, 0),
        ),
      ),
    db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} - 1` })
      .where(
        and(
          inArray(
            actors.apId,
            db
              .select({ id: follows.followerApId })
              .from(follows)
              .where(eq(follows.followingApId, actorId)),
          ),
          gt(actors.followingCount, 0),
        ),
      ),
    db
      .delete(follows)
      .where(
        or(
          eq(follows.followerApId, actorId),
          eq(follows.followingApId, actorId),
        ),
      ),

    // Recompute the replyCount of any LOCAL parent the remote's cached objects
    // replied to, counting only replies that will remain after this batch.
    db
      .update(objects)
      .set({
        replyCount: sql`(SELECT COUNT(*) FROM objects AS child WHERE child.in_reply_to = ${objects.apId} AND child.attributed_to <> ${actorId})`,
      })
      .where(
        inArray(
          objects.apId,
          db
            .select({ id: objects.inReplyTo })
            .from(objects)
            .where(
              and(
                eq(objects.attributedTo, actorId),
                isNotNull(objects.inReplyTo),
              ),
            ),
        ),
      ),

    // Reconcile counters on OTHER objects the remote interacted with before
    // dropping those edges. The subqueries stay bounded and D1-param-safe.
    db
      .update(objects)
      .set({ likeCount: sql`${objects.likeCount} - 1` })
      .where(
        and(
          inArray(
            objects.apId,
            db
              .select({ id: likes.objectApId })
              .from(likes)
              .where(eq(likes.actorApId, actorId)),
          ),
          gt(objects.likeCount, 0),
        ),
      ),
    db
      .update(objects)
      .set({ announceCount: sql`${objects.announceCount} - 1` })
      .where(
        and(
          inArray(
            objects.apId,
            db
              .select({ id: announces.objectApId })
              .from(announces)
              .where(eq(announces.actorApId, actorId)),
          ),
          gt(objects.announceCount, 0),
        ),
      ),
    db
      .update(objects)
      .set({ shareCount: sql`${objects.shareCount} - 1` })
      .where(
        and(
          inArray(
            objects.apId,
            db
              .select({ id: storyShares.storyApId })
              .from(storyShares)
              .where(eq(storyShares.actorApId, actorId)),
          ),
          gt(objects.shareCount, 0),
        ),
      ),

    // Delete interaction edges the remote authored on other objects.
    db.delete(likes).where(eq(likes.actorApId, actorId)),
    db.delete(announces).where(eq(announces.actorApId, actorId)),
    db.delete(bookmarks).where(eq(bookmarks.actorApId, actorId)),
    db.delete(storyShares).where(eq(storyShares.actorApId, actorId)),
    db.delete(storyVotes).where(eq(storyVotes.actorApId, actorId)),
    db.delete(storyViews).where(eq(storyViews.actorApId, actorId)),

    // Cascade child rows keyed by the remote's authored objects (no FK cascade
    // is assumed), then remove the objects and cached identity itself. A fresh
    // subquery per statement avoids shared-AST reuse.
    db.delete(likes).where(inArray(likes.objectApId, remoteObjectIds())),
    db
      .delete(announces)
      .where(inArray(announces.objectApId, remoteObjectIds())),
    db
      .delete(bookmarks)
      .where(inArray(bookmarks.objectApId, remoteObjectIds())),
    db
      .delete(objectRecipients)
      .where(inArray(objectRecipients.objectApId, remoteObjectIds())),
    db
      .delete(storyVotes)
      .where(inArray(storyVotes.storyApId, remoteObjectIds())),
    db
      .delete(storyViews)
      .where(inArray(storyViews.storyApId, remoteObjectIds())),
    db
      .delete(storyShares)
      .where(inArray(storyShares.storyApId, remoteObjectIds())),
    db.delete(objects).where(eq(objects.attributedTo, actorId)),
    db.delete(actorCache).where(eq(actorCache.apId, actorId)),
  ]);

  log.info("Processed inbound Delete(actor)", {
    event: "ap.delete.actor",
    actor: actorId,
  });
}

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
  if (!delObj) {
    // Delete(Actor): a remote announcing its OWN account deletion addresses the
    // actor as the object (object === actor). Remote actors are never stored in
    // `objects` (they live in actorCache), so the per-object path above finds no
    // row. verifyAndParseInbox has already bound the signer to activity.actor
    // (same origin), so an object that equals the verified actor is owned by the
    // signer. Tombstone the remote locally so a stale profile + dangling follow
    // edge + cached content do not survive indefinitely.
    if (objectId === actorId) {
      await handleRemoteActorDelete(c, actorId);
    }
    return;
  }

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
    .select({
      attributedTo: objects.attributedTo,
      inReplyTo: objects.inReplyTo,
      type: objects.type,
      attachmentsJson: objects.attachmentsJson,
      published: objects.published,
      endTime: objects.endTime,
      communityApId: objects.communityApId,
    })
    .from(objects)
    .where(eq(objects.apId, objectId))
    .get();
  if (!existing || existing.attributedTo !== actor) return;

  // Story is deliberately handled before Note: Yurucommu emits
  // type=["Story","Note"] for interoperability, but its durable projection is
  // not a Note attachment array. The old generic branch rewrote
  // attachments_json/content into the wrong shape and corrupted the Story UI.
  if (existing.type === "Story" || isStoryType(object.type)) {
    if (existing.type !== "Story" || !isStoryType(object.type)) {
      log.warn("Update rejected: object type does not match stored Story", {
        event: "ap.update.story_type_mismatch",
        actor,
        objectId,
      });
      return;
    }
    if (await ownerSuppressesInboundActor(db, actor)) return;

    const now = new Date().toISOString();
    const endTime = normalizeInboundStoryUpdateEndTime(
      existing.published,
      existing.endTime,
      object.endTime,
      now,
    );
    if (!endTime) {
      log.debug("Update(Story) dropped: invalid or expired lifetime", {
        event: "ap.update.story_expired",
        actor,
        objectId,
      });
      return;
    }

    // A Story's scope is fixed at creation. Re-authorize the retained community
    // on every Update (membership/ban policy may have changed) and fold any new
    // addressing into the same resolution. A second local community is then
    // ambiguous and rejected; a valid Update never widens or moves scope.
    const hasAddressingUpdate = declaresStoryAddressing(activity, object);
    if (hasAddressingUpdate || existing.communityApId !== null) {
      const storyAddressing = storyAddressedCollections(activity, object);
      if (storyAddressing.overflow) {
        log.warn("Update(Story) rejected: too many addressing entries", {
          event: "ap.update.story_addressing_overflow",
          actor,
          objectId,
        });
        return;
      }
      const scopeAddresses = existing.communityApId
        ? [...new Set([...storyAddressing.addresses, existing.communityApId])]
        : storyAddressing.addresses;
      const communityScope = await resolveInboundCommunityScope(
        db,
        actor,
        scopeAddresses,
      );
      if (
        !communityScope.allowed ||
        communityScope.communityApId !== existing.communityApId
      ) {
        log.warn("Update(Story) rejected: scope is unauthorized or changed", {
          event: "ap.update.story_scope_mismatch",
          actor,
          objectId,
          existingCommunityApId: existing.communityApId,
        });
        return;
      }
    }

    const projection = buildInboundStoryUpdateProjection(
      object,
      existing.attachmentsJson,
    );
    if (!projection) {
      log.warn("Update(Story) rejected: invalid story projection", {
        event: "ap.update.story_invalid_projection",
        actor,
        objectId,
      });
      return;
    }

    const projectionChanged = hasStoryProjectionUpdate(object);
    const updateStory = db
      .update(objects)
      .set({
        attachmentsJson: projectionChanged ? projection.json : undefined,
        endTime,
        updated: now,
      })
      .where(eq(objects.apId, objectId));
    if (object.overlays !== undefined) {
      // Poll votes are indexed only by option position. Replacing/clearing the
      // overlay list must clear old votes in the same D1 batch, otherwise an old
      // option 0 is silently counted for a different new option 0.
      await runBatch(db, [
        updateStory,
        db.delete(storyVotes).where(eq(storyVotes.storyApId, objectId)),
      ]);
    } else {
      await updateStory;
    }
    return;
  }

  // Update object content
  if (existing.type === "Note" && typeIncludes(object.type, "Note")) {
    // Update is instance-dispatched and therefore has no single recipient row.
    // Yurucommu's default deployment has one local owner, so the same owner-wide
    // block/mute policy used by Story Update must stop a newly suppressed remote
    // actor from replacing already-retained Note content or reach.
    if (await ownerSuppressesInboundActor(db, actor)) return;

    const addressingContract = collectBoundedInboundAddresses([object]);
    if (!addressingContract.ok) {
      log.warn("Update(Note) rejected: invalid addressing projection", {
        event: "ap.update.note_addressing_invalid",
        actor,
        objectId,
        reason: addressingContract.reason,
      });
      return;
    }

    // Content and reach are one authority decision. A remote author can narrow
    // an existing public Note to followers/direct in the same Update; applying
    // only its new body would leave that private content readable through the
    // stale public single-object gate. Treat the presence of either addressing
    // field as a complete reach update (an omitted counterpart is empty), while
    // preserving both old fields for peers that send a legacy content-only
    // partial Update.
    const hasAddressingUpdate = declaresAddressing(object);
    const updatedAddressing = hasAddressingUpdate
      ? noteAddressing(object)
      : undefined;
    const hasAudienceUpdate = object.audience !== undefined;
    const updatedAudience = hasAudienceUpdate
      ? normalizedObjectAudience(activity, object)
      : undefined;
    const communityScope = hasAudienceUpdate
      ? await resolveInboundCommunityScope(db, actor, updatedAudience ?? [])
      : existing.communityApId
        ? await resolveInboundCommunityScope(db, actor, [
            existing.communityApId,
          ])
        : { allowed: true as const, communityApId: null };
    if (
      !communityScope.allowed ||
      (!hasAudienceUpdate &&
        communityScope.communityApId !== existing.communityApId)
    ) {
      log.warn("Update(Note) rejected: actor cannot project into community", {
        event: "ap.update.note_community_unauthorized",
        actor,
        objectId,
      });
      return;
    }

    const hasThreadUpdate = object.inReplyTo !== undefined;
    const updatedParentId = hasThreadUpdate ? object.inReplyTo : undefined;
    if (updatedParentId === objectId) {
      log.warn("Update(Note) rejected: object cannot reply to itself", {
        event: "ap.update.note_self_reply",
        actor,
        objectId,
      });
      return;
    }
    if (updatedParentId) {
      const parent = await db
        .select({
          apId: objects.apId,
          attributedTo: objects.attributedTo,
          visibility: objects.visibility,
          toJson: objects.toJson,
          ccJson: objects.ccJson,
          audienceJson: objects.audienceJson,
          communityApId: objects.communityApId,
          type: objects.type,
          endTime: objects.endTime,
          deletedAt: objects.deletedAt,
        })
        .from(objects)
        .where(eq(objects.apId, updatedParentId))
        .get();
      if (
        parent &&
        (parent.deletedAt !== null ||
          !(await canViewerReadObjectFull(db, parent, actor)) ||
          (isLocal(parent.attributedTo, c.env.APP_URL) &&
            (await actorSuppressesInteractionFrom(
              db,
              parent.attributedTo,
              actor,
            ))))
      ) {
        log.warn("Update(Note) rejected: reply parent is not readable", {
          event: "ap.update.note_parent_unreadable",
          actor,
          objectId,
          parentId: updatedParentId,
        });
        return;
      }
    }

    const updatedVisibility = updatedAddressing
      ? isDirectShapedNote(updatedAddressing)
        ? "direct"
        : classifyInboundNoteVisibility(updatedAddressing)
      : undefined;
    const projectedRecipients = updatedAddressing
      ? specificRecipientAddresses(updatedAddressing)
      : [];
    // DM conversation ids are pair authority. Never carry an old recipient's
    // thread id across a re-address; only a single specific recipient has a
    // 1:1 conversation in Yurucommu's model. Public/followers/multi-recipient/
    // empty reach clears the old DM conversation.
    const updatedConversation = hasAddressingUpdate
      ? updatedVisibility === "direct" && projectedRecipients.length === 1
        ? getConversationId(c.env.APP_URL, actor, projectedRecipients[0])
        : null
      : undefined;
    const updateObject = db
      .update(objects)
      .set({
        content:
          object.content !== undefined
            ? boundInboundContent(object.content)
            : undefined,
        summary:
          object.summary !== undefined
            ? boundInboundSummary(object.summary)
            : undefined,
        attachmentsJson:
          object.attachment !== undefined
            ? boundInboundNoteAttachmentsJson(object.attachment)
            : undefined,
        tagsJson:
          object.tag !== undefined
            ? boundInboundTagsJson(object.tag)
            : undefined,
        visibility: updatedVisibility,
        // bto/bcc are deliberately absent: their recipients are private and
        // represented only by the indexed recipient projection below.
        toJson: updatedAddressing
          ? boundAddressJson(updatedAddressing.to)
          : undefined,
        ccJson: updatedAddressing
          ? boundAddressJson(updatedAddressing.cc)
          : undefined,
        audienceJson: hasAudienceUpdate
          ? JSON.stringify(updatedAudience)
          : undefined,
        communityApId: hasAudienceUpdate
          ? communityScope.communityApId
          : undefined,
        inReplyTo: hasThreadUpdate ? (updatedParentId ?? null) : undefined,
        conversation: updatedConversation,
        updated: new Date().toISOString(),
      })
      .where(eq(objects.apId, objectId));

    // `object_recipients(type=to)` is the indexed DM-read authority used by
    // contacts, requests, unread counts, and conversation discovery. Updating
    // only toJson would revoke canonical object GET while the old recipient
    // still received the NEW private body in their contact preview. Replace the
    // projection in the same D1 batch as the object row so neither old nor new
    // reach can be observed half-applied. insertMany keeps every statement
    // below D1's parameter ceiling for the bounded 64-address input.
    const recipientProjectionStatements = hasAddressingUpdate
      ? [
          db
            .delete(objectRecipients)
            .where(
              and(
                eq(objectRecipients.objectApId, objectId),
                eq(objectRecipients.type, "to"),
              ),
            ),
          ...insertMany(
            db,
            objectRecipients,
            projectedRecipients.map((recipientApId) => ({
              objectApId: objectId,
              recipientApId,
              type: "to",
            })),
            { conflict: "ignore" },
          ),
        ]
      : [];

    // A reply edge and both denormalized parent counters are one mutation.
    // Recompute (rather than increment/decrement) after the child UPDATE so a
    // duplicate/retry converges without double-counting. The old and new parent
    // set has at most two entries, keeping the whole projection far below D1's
    // 50-statement batch ceiling even at the 64-recipient addressing bound.
    const parentIdsToRecompute = hasThreadUpdate
      ? [
          ...new Set(
            [existing.inReplyTo, updatedParentId ?? null].filter(
              (id): id is string => typeof id === "string" && id.length > 0,
            ),
          ),
        ]
      : [];
    const parentCounterStatements = parentIdsToRecompute.map((parentId) =>
      db
        .update(objects)
        .set({
          replyCount: sql`(SELECT COUNT(*) FROM ${objects} WHERE ${objects.inReplyTo} = ${parentId})`,
        })
        .where(eq(objects.apId, parentId)),
    );

    const projectionStatements = [
      ...recipientProjectionStatements,
      ...parentCounterStatements,
    ];
    if (projectionStatements.length === 0) {
      await updateObject;
    } else {
      await runBatch(db, [updateObject, ...projectionStatements]);
    }
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

  const baseUrl = c.env.APP_URL;
  const refollowPrefix = await moveRefollowPrefix({
    baseUrl,
    inboundActivityId: activity.id,
    oldActorApId,
    newActorApId,
  });

  // The graph + outbound Follow activities commit atomically below, while the
  // external Queue send necessarily happens afterwards. If that send threw,
  // the inbox row remains processed=0 and a peer retry reaches this handler.
  // Resume from the durable activity namespace BEFORE re-fetching the alias:
  // the old edges are already gone, and a temporary destination fetch outage
  // must not turn a retryable Queue failure into a silently completed no-op.
  if (
    (await enqueuePersistedMoveRefollows({
      db,
      env: c.env,
      newActorApId,
      refollowPrefix,
    })) > 0
  ) {
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

  await rewriteMovedFollowGraph({
    db,
    oldActorApId,
    newActorApId,
    refollowPrefix,
  });

  // Queue delivery is the only non-transactional step. Do not swallow a real
  // producer failure: the inbox claim remains uncommitted and a retry resumes
  // the durable activities through the prefix check at the top of this handler.
  await enqueuePersistedMoveRefollows({
    db,
    env: c.env,
    newActorApId,
    refollowPrefix,
  });
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
