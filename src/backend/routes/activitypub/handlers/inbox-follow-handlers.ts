import type { Database } from "../../../../db/index.ts";
import { and, eq, gt, or, sql } from "drizzle-orm";
import { activities, actors, follows } from "../../../../db/index.ts";
import {
  activityApId,
  generateId,
  isLocal,
} from "../../../federation-helpers.ts";
import { enqueueDeliveryToActor } from "../../../lib/delivery/queue.ts";
import { actorIsBlockedBy } from "../../../lib/post-visibility.ts";
import { logger } from "../../../lib/logger.ts";
import {
  type Activity,
  type ActivityContext,
  getActivityObject,
  getActivityObjectId,
  typeIncludes,
} from "../inbox-types.ts";
import {
  findFollowByActivityId,
  runBatch,
  undoInteraction,
  upsertActivityAndNotify,
} from "./inbox-shared-helpers.ts";

type ActorRow = typeof actors.$inferSelect;

const log = logger.child({ component: "activitypub.inbox.follow" });

// ---------------------------------------------------------------------------
// Follow handler
// ---------------------------------------------------------------------------

export async function handleFollow(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string,
  baseUrl: string,
  sourceActivityId: string = activity.id || "",
) {
  const db = c.get("db");

  // A Follow from an actor the recipient has personally BLOCKED must be dropped —
  // mirror the local follow guard (handleLocalFollow's actorIsBlockedBy 404).
  // Without this, a blocked remote could re-follow (auto-accepting on a public
  // recipient → followerCount++ + a follow notification + an Accept, so the
  // blocked actor resumes receiving fan-out), or surface in the owner's
  // follow-request list. `actor` is the HTTP-signature-verified signer. The inbox
  // already ACKs, so dropping here causes no retry storm and does not leak the
  // block to the sender.
  if (await actorIsBlockedBy(db, recipient.apId, actor)) {
    return;
  }

  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Determine if we need to approve
  const status = recipient.isPrivate ? "pending" : "accepted";
  const now = new Date().toISOString();

  // Was the edge already present BEFORE this dispatch? This gates the one-shot
  // owner notification / Accept reply below so a duplicate (re)delivery does not
  // spam them — it does NOT gate the counter, which is reconciled atomically in
  // the batch below against the edge table's pre-insert state.
  const existingEdge = await db
    .select({ followerApId: follows.followerApId })
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, actor),
        eq(follows.followingApId, recipient.apId),
      ),
    )
    .get();

  // #COUNTER-SYM (crash-retry convergence): the followers-edge insert and the
  // recipient.followerCount +1 MUST commit together. Previously the edge was
  // inserted (onConflictDoNothing) and, for an auto-accept recipient, the count
  // was bumped in a SEPARATE statement gated on `isNewFollow`; under the
  // claim/processed re-dispatch model a crash between the insert and the +1, then
  // a peer retry (whose no-op insert sets isNewFollow=false → early return),
  // permanently SKIPPED the increment → a follower UNDER-count. Co-commit the
  // insert and the increment in one atomic batch (mirrors handleAccept / handleAdd).
  //
  // The increment runs BEFORE the insert, guarded by a correlated
  // `NOT EXISTS(edge)` subquery, so it fires only when THIS batch is the one that
  // creates the edge (the absent edge is observed in pre-insert state) AND only
  // for an 'accepted' (non-private) recipient. A duplicate Follow, or a retry
  // after the edge already existed, sees the edge present → the guard is false and
  // the insert is a no-op, so the count can neither double-bump nor under-count.
  // For a private recipient the edge inserts as 'pending' with no count change.
  if (status === "accepted") {
    const edgeAbsent = sql`NOT EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${actor} AND ${follows.followingApId} = ${recipient.apId})`;
    await runBatch(db, [
      db
        .update(actors)
        .set({ followerCount: sql`${actors.followerCount} + 1` })
        .where(and(eq(actors.apId, recipient.apId), edgeAbsent)),
      db
        .insert(follows)
        .values({
          followerApId: actor,
          followingApId: recipient.apId,
          status,
          activityApId: activityId,
          acceptedAt: now,
        })
        .onConflictDoNothing(),
    ]);
  } else {
    // Private recipient: follow stays pending, no count change.
    await db
      .insert(follows)
      .values({
        followerApId: actor,
        followingApId: recipient.apId,
        status,
        activityApId: activityId,
        acceptedAt: null,
      })
      .onConflictDoNothing();
  }

  // If the edge already existed, this is a duplicate (re)delivery: the counter is
  // already correct (the batch's no-op insert kept the NOT-EXISTS guard false),
  // so do not re-notify the owner or re-send an Accept.
  if (existingEdge) return;

  // Store activity and add to inbox (AP Native notification)
  await upsertActivityAndNotify(
    db,
    activityId,
    "Follow",
    actor,
    recipient.apId,
    activity,
    recipient.apId,
  );

  // Send Accept response
  // If the recipient requires approval, do NOT auto-accept.
  if (status === "accepted" && !isLocal(actor, baseUrl)) {
    const acceptId = activityApId(baseUrl, generateId());
    const acceptActivity = {
      "@context": "https://www.w3.org/ns/activitystreams",
      id: acceptId,
      type: "Accept",
      actor: recipient.apId,
      // Echo the peer's bounded protocol id, not our origin-bound internal
      // ledger id. Remote servers match Accept.object to their Follow id.
      object: sourceActivityId || activityId,
    };

    // Store accept activity before enqueue.
    await db.insert(activities).values({
      apId: acceptId,
      type: "Accept",
      actorApId: recipient.apId,
      objectApId: sourceActivityId || activityId,
      rawJson: JSON.stringify(acceptActivity),
      direction: "outbound",
    });

    // Outbound delivery must be async (no remote POST in request path).
    await enqueueDeliveryToActor(c.env, acceptId, actor);
  }
}

// ---------------------------------------------------------------------------
// Accept handler
// ---------------------------------------------------------------------------

export async function handleAccept(
  c: ActivityContext,
  activity: Activity,
  actor: string | null,
) {
  const db = c.get("db");
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  const follow = await findFollowByActivityId(db, followId);
  if (!follow || follow.status === "accepted") return;

  // Only the followed party may Accept the follow. The signing actor is bound to
  // its domain upstream, so without this a different-domain actor that learned
  // the follow activity id could flip someone else's pending follow to accepted.
  if (!actor || follow.followingApId !== actor) return;

  const now = new Date().toISOString();

  // #COUNTER-SYM (crash-retry convergence): the pending->accepted flip and
  // both +1s MUST commit together. Previously the flip committed first and the
  // increments were SEPARATE statements; a crash between them left the edge
  // 'accepted' while the counts were un-bumped, and the peer's retry saw an
  // already-accepted edge (the early-return above) so the increments were
  // SKIPPED → a permanent UNDER-count. Co-commit the flip and the increments
  // in one atomic batch so the whole transition is all-or-nothing.
  //
  // The two increments run BEFORE the flip and are each guarded by a
  // correlated `EXISTS(... status='pending')` subquery, so they fire only when
  // THIS batch is the one performing the transition (the still-pending edge is
  // observed in pre-flip state). A concurrent duplicate Accept, or a retry
  // after the flip already committed, sees a non-pending edge → both guards
  // are false and the flip's `status='pending'` predicate is a no-op, so the
  // counts can neither double-bump nor (on retry) under-count.
  // Storage failures must escape to the fenced inbox dispatch so it can release
  // the claim and return a retryable response instead of committing the ledger.
  const pendingEdgeExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${follow.followerApId} AND ${follows.followingApId} = ${follow.followingApId} AND ${follows.status} = 'pending')`;
  await runBatch(db, [
    db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} + 1` })
      .where(and(eq(actors.apId, follow.followerApId), pendingEdgeExists)),
    db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} + 1` })
      .where(and(eq(actors.apId, follow.followingApId), pendingEdgeExists)),
    db
      .update(follows)
      .set({ status: "accepted", acceptedAt: now })
      .where(
        and(
          eq(follows.followerApId, follow.followerApId),
          eq(follows.followingApId, follow.followingApId),
          eq(follows.status, "pending"),
        ),
      ),
  ]);
}

// ---------------------------------------------------------------------------
// Reject handler
// ---------------------------------------------------------------------------

export async function handleReject(
  c: ActivityContext,
  activity: Activity,
  actor: string | null,
) {
  const db = c.get("db");
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  const follow = await findFollowByActivityId(db, followId);
  if (!follow) return;

  // Only the followed party may Reject the follow (see handleAccept).
  if (!actor || follow.followingApId !== actor) return;

  // A remote followee can Reject an ALREADY-ACCEPTED follow to terminate it
  // (Mastodon does this on lock + remove-follower). handleAccept incremented the
  // local follower's followingCount when the edge became accepted, so a Reject of
  // an accepted edge MUST decrement it — otherwise the follower's following_count
  // stays permanently +1 over its true value (the edge IS correctly deleted, only
  // the denormalized count drifts). Co-commit the accepted-gated decrement with
  // the delete, mirroring undoFollowEdge: a pending (never-counted) reject and a
  // duplicate are no-ops via the EXISTS(... status='accepted') + gt(>0) guards.
  // (followingApId — the rejecting followee — is the remote signer with no local
  // actors row, so only the local follower's followingCount is reconciled.)
  const acceptedEdgeExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${follow.followerApId} AND ${follows.followingApId} = ${follow.followingApId} AND ${follows.status} = 'accepted')`;
  await runBatch(db, [
    db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} - 1` })
      .where(
        and(
          eq(actors.apId, follow.followerApId),
          gt(actors.followingCount, 0),
          acceptedEdgeExists,
        ),
      ),
    db
      .delete(follows)
      .where(
        and(
          eq(follows.followerApId, follow.followerApId),
          eq(follows.followingApId, follow.followingApId),
        ),
      ),
  ]);
}

// ---------------------------------------------------------------------------
// Undo handler
// ---------------------------------------------------------------------------

/**
 * `recipient` is null when the Undo arrived at the shared inbox as an
 * INSTANCE-scoped activity — i.e. Undo(Like|Announce), which is actor-keyed
 * and idempotent and names no local actor. Undo(Follow|Block) is object-actor
 * scoped and always dispatched with its resolved target, so a null recipient
 * on a follow branch means the target could not be resolved; that is logged
 * and refused rather than guessed at. The previous code guessed: it fell back
 * to deleting the signer's likes across EVERY object the "recipient" had
 * authored and rewriting every one of that actor's `objects` rows.
 */
export async function handleUndo(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow | null,
  actor: string,
  _baseUrl: string,
) {
  const db = c.get("db");
  const activityObject = getActivityObject(activity);
  const objectType = activityObject?.type;
  const objectId = getActivityObjectId(activity);

  // If object is just a string (activity ID), try to find the original activity
  if (!objectType && objectId) {
    const resolved = await resolveUndoByActivityId(
      db,
      objectId,
      actor,
      recipient,
    );
    if (resolved) return;
  }

  if (typeIncludes(objectType, "Follow")) {
    if (!recipient) {
      log.warn("Undo(Follow) without a resolved local target", {
        event: "ap.undo.follow.no_recipient",
        actor,
        activityId: activity.id,
      });
      return;
    }
    await undoFollow(db, objectId, actor, recipient);
  } else if (typeIncludes(objectType, "Like")) {
    await undoLike(db, objectId, activityObject, actor);
  } else if (typeIncludes(objectType, "Announce")) {
    await undoAnnounce(db, objectId, activityObject, actor);
  }
}

// ---------------------------------------------------------------------------
// Undo sub-handlers (internal)
// ---------------------------------------------------------------------------

/**
 * When the Undo object is a bare ID string, look up the original activity
 * and undo it based on its stored type.
 * Returns true if handled (caller should return), false otherwise.
 */
async function resolveUndoByActivityId(
  db: Database,
  objectId: string,
  actor: string,
  recipient: ActorRow | null,
): Promise<boolean> {
  const originalActivity = await db
    .select({
      apId: activities.apId,
      type: activities.type,
      objectApId: activities.objectApId,
      actorApId: activities.actorApId,
    })
    .from(activities)
    .where(
      or(
        eq(activities.apId, objectId),
        and(
          eq(activities.direction, "inbound"),
          sql`json_extract(${activities.rawJson}, '$.id') = ${objectId}`,
        ),
      ),
    )
    .get();
  if (!originalActivity) return false;

  if (originalActivity.actorApId && originalActivity.actorApId !== actor) {
    log.warn("Undo actor mismatch", {
      event: "ap.undo.actor_mismatch",
      actor,
      originalActor: originalActivity.actorApId,
      activityId: objectId,
    });
    return true;
  }

  if (originalActivity.type === "Follow") {
    // The followerCount decrement is keyed on the followed actor, so an
    // instance-dispatched Undo (no resolved local target) must not run it.
    if (!recipient) {
      log.warn("Undo(Follow) by activity id without a resolved local target", {
        event: "ap.undo.follow.no_recipient",
        actor,
        activityId: objectId,
      });
      return true;
    }
    const follow = await findFollowByActivityId(db, originalActivity.apId);
    if (follow) {
      await undoFollowEdge(
        db,
        follow.followerApId,
        follow.followingApId,
        recipient.apId,
      );
    }
    return true;
  }

  if (
    (originalActivity.type === "Like" ||
      originalActivity.type === "Announce") &&
    originalActivity.objectApId
  ) {
    const kind =
      originalActivity.type === "Like"
        ? ("like" as const)
        : ("announce" as const);
    const countField =
      kind === "like" ? ("likeCount" as const) : ("announceCount" as const);
    // #COUNTER-SYM: delegate to `undoInteraction`'s activityId path, which now
    // co-commits the edge delete and a COUNT(*) recompute in one atomic batch.
    // A crash-then-retry converges (the recompute is idempotent against the true
    // edge set) instead of permanently over-counting on the retry's no-op
    // delete. The actor-mismatch guard above still constrains who may undo.
    await undoInteraction(
      db,
      kind,
      countField,
      undefined,
      originalActivity.apId,
      actor,
    );
    return true;
  }

  return true;
}

/**
 * Atomically remove a follow edge and reconcile `followerCount`.
 *
 * #COUNTER-SYM (crash-retry convergence): the edge delete and the -1 MUST
 * commit together. Previously the delete committed first and the decrement was
 * a SEPARATE statement; a crash between them left the edge gone but the count
 * un-decremented, and the peer's retry matched 0 rows so the decrement was
 * SKIPPED → a permanent OVER-count. Co-commit both in one batch. The decrement
 * runs BEFORE the delete and is guarded by a correlated
 * `EXISTS(... status='accepted')` subquery (so a pending/never-counted edge,
 * a duplicate Undo, or an unknown edge does not drift the count) plus a
 * `followerCount > 0` underflow guard (mirrors the local API delete paths in
 * posts/interactions.ts which batch + guard both sides).
 */
async function undoFollowEdge(
  db: Database,
  followerApId: string,
  followingApId: string,
  recipientApId: string,
): Promise<void> {
  const acceptedEdgeExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${followerApId} AND ${follows.followingApId} = ${followingApId} AND ${follows.status} = 'accepted')`;
  await runBatch(db, [
    db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} - 1` })
      .where(
        and(
          eq(actors.apId, recipientApId),
          gt(actors.followerCount, 0),
          acceptedEdgeExists,
        ),
      ),
    db
      .delete(follows)
      .where(
        and(
          eq(follows.followerApId, followerApId),
          eq(follows.followingApId, followingApId),
        ),
      ),
  ]);
}

async function undoFollow(
  db: Database,
  objectId: string | null,
  actor: string,
  recipient: ActorRow,
): Promise<void> {
  const follow = objectId ? await findFollowByActivityId(db, objectId) : null;

  // Bind the undo to the VERIFIED signer: an Undo(Follow) may only remove the
  // SIGNER's own follow edge. The activity id is public (it appears in the
  // originator's outbox), so a resolved edge whose follower != `actor` is a
  // cross-actor forgery — an attacker severing a victim's follow + decrementing
  // their followerCount. The bare-string Undo path already enforces this via
  // resolveUndoByActivityId; the typed-object path must too.
  if (follow && follow.followerApId !== actor) {
    log.warn("Undo(Follow) actor mismatch", {
      event: "ap.undo.follow.actor_mismatch",
      actor,
      followOwner: follow.followerApId,
      activityId: objectId,
    });
    return;
  }

  // #COUNTER-SYM: co-commit the edge delete and the followerCount -1 atomically
  // (see `undoFollowEdge`). `handleFollow` increments followerCount only for an
  // 'accepted' follow, so the decrement is gated on the edge being accepted; a
  // duplicate Undo, an Undo of a never-accepted (pending) follow, or an Undo of
  // an unknown follow is a clean no-op and a crash-then-retry converges instead
  // of permanently over-counting.
  const followerApId = follow ? follow.followerApId : actor;
  const followingApId = follow ? follow.followingApId : recipient.apId;
  await undoFollowEdge(db, followerApId, followingApId, recipient.apId);
}

/**
 * Undo(Like).
 *
 * If the like edge cannot be identified — from the inner object's `object`, or
 * from the referenced Like activity id — there is NOTHING to undo and we say
 * so. There used to be a "last resort" here that deleted every like the signer
 * held on ANY object authored by the delivery recipient and then recomputed
 * `likeCount` for EVERY one of that actor's `objects` rows. It was reachable
 * from a malformed `{type:'Undo', object:{type:'Like', id:...}}` with no inner
 * `object` (and from the actor-mismatch branch), and under the shared inbox it
 * ran once per local follower, so a single non-conformant peer could both wipe
 * a user's likes across an author's whole timeline and amplify a full-table
 * UPDATE by the follower count. Nothing about the activity authorised that
 * scope: the only thing it identified was the signer.
 */
async function undoLike(
  db: Database,
  objectId: string | null,
  activityObject: ReturnType<typeof getActivityObject>,
  actor: string,
): Promise<void> {
  const handled = await undoInteraction(
    db,
    "like",
    "likeCount",
    activityObject?.object,
    objectId,
    actor,
  );
  if (handled) return;

  log.warn("Undo(Like) names no resolvable like edge; ignoring", {
    event: "ap.undo.like.unresolved",
    actor,
    activityId: objectId,
    object: activityObject?.object,
  });
}
async function undoAnnounce(
  db: Database,
  objectId: string | null,
  activityObject: ReturnType<typeof getActivityObject>,
  actor: string,
): Promise<void> {
  await undoInteraction(
    db,
    "announce",
    "announceCount",
    activityObject?.object,
    objectId,
    actor,
  );
}
