import type { Database } from "../../../../db/index.ts";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import {
  activities,
  actors,
  follows,
  likes,
  objects,
} from "../../../../db/index.ts";
import {
  activityApId,
  generateId,
  isLocal,
} from "../../../federation-helpers.ts";
import { enqueueDeliveryToActor } from "../../../lib/delivery/queue.ts";
import { logger } from "../../../lib/logger.ts";
import {
  type Activity,
  type ActivityContext,
  getActivityObject,
  getActivityObjectId,
} from "../inbox-types.ts";
import {
  deleteFollowByCompoundKey,
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
) {
  const db = c.get("db");

  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Determine if we need to approve
  const status = recipient.isPrivate ? "pending" : "accepted";
  const now = new Date().toISOString();

  // Use insert + onConflictDoNothing to atomically create follow record (prevents race condition)
  const insertResult = await db
    .insert(follows)
    .values({
      followerApId: actor,
      followingApId: recipient.apId,
      status,
      activityApId: activityId,
      acceptedAt: status === "accepted" ? now : null,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  // If insert returned nothing, the follow already existed
  const isNewFollow = !!insertResult;
  if (!isNewFollow) return;

  // Update counts if accepted
  if (status === "accepted") {
    await db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} + 1` })
      .where(eq(actors.apId, recipient.apId));
  }

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
      object: activityId,
    };

    // Store accept activity before enqueue.
    await db.insert(activities).values({
      apId: acceptId,
      type: "Accept",
      actorApId: recipient.apId,
      objectApId: activityId,
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

export async function handleAccept(c: ActivityContext, activity: Activity) {
  const db = c.get("db");
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  const follow = await findFollowByActivityId(db, followId);
  if (!follow || follow.status === "accepted") return;

  const now = new Date().toISOString();

  try {
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
  } catch (e) {
    log.error("Error in handleAccept", {
      event: "ap.accept.handler_error",
      error: e,
    });
  }
}

// ---------------------------------------------------------------------------
// Reject handler
// ---------------------------------------------------------------------------

export async function handleReject(c: ActivityContext, activity: Activity) {
  const db = c.get("db");
  const followId = getActivityObjectId(activity);
  if (!followId) return;

  const follow = await findFollowByActivityId(db, followId);
  if (!follow) return;

  await deleteFollowByCompoundKey(
    db,
    follow.followerApId,
    follow.followingApId,
  );
}

// ---------------------------------------------------------------------------
// Undo handler
// ---------------------------------------------------------------------------

export async function handleUndo(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
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

  if (objectType === "Follow") {
    await undoFollow(db, objectId, actor, recipient);
  } else if (objectType === "Like") {
    await undoLike(db, objectId, activityObject, actor, recipient);
  } else if (objectType === "Announce") {
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
  recipient: ActorRow,
): Promise<boolean> {
  const originalActivity = await db
    .select({
      type: activities.type,
      objectApId: activities.objectApId,
      actorApId: activities.actorApId,
    })
    .from(activities)
    .where(eq(activities.apId, objectId))
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
    const follow = await findFollowByActivityId(db, objectId);
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
    await undoInteraction(db, kind, countField, undefined, objectId, actor);
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

async function undoLike(
  db: Database,
  objectId: string | null,
  activityObject: ReturnType<typeof getActivityObject>,
  actor: string,
  recipient: ActorRow,
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

  // Last resort: delete any like from this actor for the recipient's objects
  const recipientObjects = await db
    .select({ apId: objects.apId })
    .from(objects)
    .where(eq(objects.attributedTo, recipient.apId));
  if (recipientObjects.length > 0) {
    const deleted = await db
      .delete(likes)
      .where(
        and(
          eq(likes.actorApId, actor),
          inArray(
            likes.objectApId,
            recipientObjects.map((o) => o.apId),
          ),
        ),
      )
      .returning({ objectApId: likes.objectApId });
    if (deleted.length > 0) {
      await db
        .update(objects)
        .set({ likeCount: sql`${objects.likeCount} - 1` })
        .where(
          inArray(objects.apId, [...new Set(deleted.map((r) => r.objectApId))]),
        );
    }
  }
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
