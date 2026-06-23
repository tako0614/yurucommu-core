import { Hono } from "hono";
import { and, desc, eq, gt, inArray, sql } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";
import {
  activities,
  actorCache,
  actors,
  follows,
  inbox,
} from "../../db/index.ts";
import {
  activityApId,
  formatUsername,
  generateId,
  isLocal,
  isSafeRemoteUrl,
  parseLimit,
  parseOffset,
} from "../federation-helpers.ts";
import { enqueueDeliveryToActor } from "../lib/delivery/queue.ts";
import {
  buildApActivity,
  createAndDeliverActivity,
  deliverResponseIfRemote,
  findPendingFollow,
  handleLocalFollow,
  handleRemoteFollow,
  isResponse,
  parseNonEmptyString,
  parseStringArray,
  requireActorAndBody,
} from "./follow-helpers.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "follow" });

// `.batch` lives only on the concrete D1/libsql subclasses, not the Database
// union; reach it through a narrow structural cast (matching the other routes).
type Batchable = { batch: (stmts: unknown[]) => Promise<unknown> };

// Capped at 90 (not 100): the accepted ids are re-queried via
// `inArray(follows.followerApId, requesterApIds)` and Cloudflare D1 allows at
// most 100 bound parameters per query (libsql, used by the tests, allows ~32k).
const MAX_BATCH_ACCEPT_SIZE = 90;

const follow = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// POST / -- Follow an actor (local or remote)
// ---------------------------------------------------------------------------

follow.post("/", async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const targetApId = parseNonEmptyString(body.target_ap_id);
  if (!targetApId) {
    return c.json({ error: "target_ap_id required", code: "BAD_REQUEST" }, 400);
  }
  if (targetApId === actor.ap_id) {
    return c.json({ error: "Cannot follow yourself" }, 400);
  }

  const existing = await db
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, actor.ap_id),
        eq(follows.followingApId, targetApId),
      ),
    )
    .get();
  if (existing) {
    // A leftover 'rejected' edge (from before reject switched to deleting the
    // row) must not permanently block a re-follow — clear it and fall through to
    // a fresh request. A live pending/accepted edge still blocks.
    if (existing.status === "rejected") {
      await db
        .delete(follows)
        .where(
          and(
            eq(follows.followerApId, actor.ap_id),
            eq(follows.followingApId, targetApId),
          ),
        );
    } else {
      return c.json({ error: "Already following or pending" }, 400);
    }
  }

  if (isLocal(targetApId, baseUrl)) {
    return handleLocalFollow(c, db, baseUrl, actor, targetApId);
  }
  return handleRemoteFollow(c, db, baseUrl, actor, targetApId);
});

// ---------------------------------------------------------------------------
// DELETE / -- Unfollow
// ---------------------------------------------------------------------------

follow.delete("/", async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const targetApId = parseNonEmptyString(body.target_ap_id);
  if (!targetApId) {
    return c.json({ error: "target_ap_id required", code: "BAD_REQUEST" }, 400);
  }

  const existingFollow = await db
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, actor.ap_id),
        eq(follows.followingApId, targetApId),
      ),
    )
    .get();
  if (!existingFollow) return c.json({ error: "Not following" }, 400);

  const wasAccepted = existingFollow.status === "accepted";
  const targetIsLocal = isLocal(targetApId, baseUrl);

  const deleteEdge = db
    .delete(follows)
    .where(
      and(
        eq(follows.followerApId, actor.ap_id),
        eq(follows.followingApId, targetApId),
      ),
    );

  if (wasAccepted) {
    // Co-commit the decrements + delete in ONE batch so a crash between them
    // can't leave the edge gone with un-decremented counts (permanent over-
    // count). Decrements run BEFORE the delete, guarded by EXISTS(accepted edge)
    // + count>0 (underflow) — mirrors the federated undoFollowEdge.
    const acceptedEdgeExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${actor.ap_id} AND ${follows.followingApId} = ${targetApId} AND ${follows.status} = 'accepted')`;
    const stmts: unknown[] = [
      db
        .update(actors)
        .set({ followingCount: sql`${actors.followingCount} - 1` })
        .where(
          and(
            eq(actors.apId, actor.ap_id),
            gt(actors.followingCount, 0),
            acceptedEdgeExists,
          ),
        ),
    ];
    if (targetIsLocal) {
      stmts.push(
        db
          .update(actors)
          .set({ followerCount: sql`${actors.followerCount} - 1` })
          .where(
            and(
              eq(actors.apId, targetApId),
              gt(actors.followerCount, 0),
              acceptedEdgeExists,
            ),
          ),
      );
    }
    stmts.push(deleteEdge);
    await (db as unknown as Batchable).batch(stmts);
  } else {
    await deleteEdge;
  }

  if (!targetIsLocal) {
    const undoObject = {
      type: "Follow",
      actor: actor.ap_id,
      object: targetApId,
    };
    await createAndDeliverActivity(
      c.env,
      db,
      baseUrl,
      "Undo",
      actor.ap_id,
      undoObject,
      targetApId,
      targetApId,
    );
  }

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /accept -- Accept a single follow request
// ---------------------------------------------------------------------------

follow.post("/accept", async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const requesterApId = parseNonEmptyString(body.requester_ap_id);
  if (!requesterApId) {
    return c.json(
      { error: "requester_ap_id required", code: "BAD_REQUEST" },
      400,
    );
  }

  let pendingFollow: Awaited<ReturnType<typeof findPendingFollow>>;
  try {
    // Read the pending edge first (we need its activityApId for the Accept
    // delivery below), then co-commit the flip + both increments in ONE batch.
    // Previously the flip committed and the +1s were SEPARATE autocommits: a
    // crash between them left the edge accepted with un-bumped counts, and the
    // retry's conditional flip matched 0 rows so the increment was permanently
    // SKIPPED (under-count). The increments are guarded by EXISTS(... pending) —
    // evaluated before the in-batch flip — and the flip keeps its `status=
    // 'pending'` predicate, so a concurrent duplicate accept can neither double-
    // count nor under-count. Mirrors the federated handleAccept.
    const pending = await findPendingFollow(db, requesterApId, actor.ap_id);
    if (!pending) {
      pendingFollow = undefined;
    } else {
      const pendingExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${requesterApId} AND ${follows.followingApId} = ${actor.ap_id} AND ${follows.status} = 'pending')`;
      const stmts: unknown[] = [
        db
          .update(actors)
          .set({ followerCount: sql`${actors.followerCount} + 1` })
          .where(and(eq(actors.apId, actor.ap_id), pendingExists)),
      ];
      if (isLocal(requesterApId, baseUrl)) {
        stmts.push(
          db
            .update(actors)
            .set({ followingCount: sql`${actors.followingCount} + 1` })
            .where(and(eq(actors.apId, requesterApId), pendingExists)),
        );
      }
      stmts.push(
        db
          .update(follows)
          .set({ status: "accepted", acceptedAt: new Date().toISOString() })
          .where(
            and(
              eq(follows.followerApId, requesterApId),
              eq(follows.followingApId, actor.ap_id),
              eq(follows.status, "pending"),
            ),
          ),
      );
      await (db as unknown as Batchable).batch(stmts);
      pendingFollow = pending;
    }
  } catch (e) {
    log.error("Error in accept", {
      event: "follow.accept.error",
      error: e,
    });
    return c.json({ error: "Internal error" }, 500);
  }

  if (!pendingFollow) {
    return c.json({ error: "No pending follow request" }, 404);
  }

  await deliverResponseIfRemote(
    c.env,
    db,
    baseUrl,
    "Accept",
    actor.ap_id,
    requesterApId,
    pendingFollow.activityApId,
  );

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /accept/batch -- Batch accept follow requests
// ---------------------------------------------------------------------------

follow.post("/accept/batch", async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const requesterApIds = parseStringArray(body.requester_ap_ids);
  if (!requesterApIds || requesterApIds.length === 0) {
    return c.json(
      {
        error: "requester_ap_ids array required",
        code: "BAD_REQUEST",
      },
      400,
    );
  }
  if (requesterApIds.length > MAX_BATCH_ACCEPT_SIZE) {
    return c.json(
      {
        error: `Batch size exceeds maximum of ${MAX_BATCH_ACCEPT_SIZE}`,
      },
      400,
    );
  }

  const pendingFollows = await db
    .select()
    .from(follows)
    .where(
      and(
        inArray(follows.followerApId, requesterApIds),
        eq(follows.followingApId, actor.ap_id),
        eq(follows.status, "pending"),
      ),
    );
  const pendingFollowMap = new Map(
    pendingFollows.map((f) => [f.followerApId, f]),
  );

  const results: { ap_id: string; success: boolean; error?: string }[] = [];
  const activitiesToCreate: Array<{
    apId: string;
    type: string;
    actorApId: string;
    objectApId: string | undefined;
    rawJson: string;
    direction: string;
  }> = [];
  const remoteEnqueues: Array<{ activityId: string; recipientApId: string }> =
    [];

  for (const requesterApId of requesterApIds) {
    const pendingFollow = pendingFollowMap.get(requesterApId);
    if (!pendingFollow) {
      results.push({
        ap_id: requesterApId,
        success: false,
        error: "No pending follow request",
      });
      continue;
    }

    try {
      // Co-commit the flip + increments per request in ONE batch (mirrors the
      // single accept). Previously each flip committed in the loop and the
      // counts were bumped ONCE after the loop, so a crash mid-loop lost the
      // accumulated increments for already-flipped rows. Increments guarded by
      // EXISTS(pending) before the flip; the flip keeps its pending predicate.
      const requesterIsLocal = isLocal(requesterApId, baseUrl);
      const pendingExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${requesterApId} AND ${follows.followingApId} = ${actor.ap_id} AND ${follows.status} = 'pending')`;
      const stmts: unknown[] = [
        db
          .update(actors)
          .set({ followerCount: sql`${actors.followerCount} + 1` })
          .where(and(eq(actors.apId, actor.ap_id), pendingExists)),
      ];
      if (requesterIsLocal) {
        stmts.push(
          db
            .update(actors)
            .set({ followingCount: sql`${actors.followingCount} + 1` })
            .where(and(eq(actors.apId, requesterApId), pendingExists)),
        );
      }
      stmts.push(
        db
          .update(follows)
          .set({ status: "accepted", acceptedAt: new Date().toISOString() })
          .where(
            and(
              eq(follows.followerApId, requesterApId),
              eq(follows.followingApId, actor.ap_id),
              eq(follows.status, "pending"),
            ),
          ),
      );
      await (db as unknown as Batchable).batch(stmts);

      if (requesterIsLocal) {
        // local follower's followingCount already bumped in the batch above
      } else if (isSafeRemoteUrl(requesterApId)) {
        const id = activityApId(baseUrl, generateId());
        const activity = buildApActivity(
          "Accept",
          actor.ap_id,
          pendingFollow.activityApId,
          id,
        );

        activitiesToCreate.push({
          apId: id,
          type: "Accept",
          actorApId: actor.ap_id,
          objectApId: pendingFollow.activityApId || undefined,
          rawJson: JSON.stringify(activity),
          direction: "outbound",
        });
        remoteEnqueues.push({ activityId: id, recipientApId: requesterApId });
      } else {
        log.warn("Blocked unsafe remote actor", {
          event: "follow.accept.unsafe_remote_actor",
          actor: requesterApId,
        });
      }

      results.push({ ap_id: requesterApId, success: true });
    } catch {
      results.push({
        ap_id: requesterApId,
        success: false,
        error: "Internal error",
      });
    }
  }

  // (Counts are bumped per-request inside the loop's batch — no aggregate
  // post-loop increment, which could be lost on a mid-loop crash.)

  if (activitiesToCreate.length > 0) {
    await db.insert(activities).values(activitiesToCreate);
  }

  if (remoteEnqueues.length > 0) {
    await Promise.allSettled(
      remoteEnqueues.map((e) =>
        enqueueDeliveryToActor(c.env, e.activityId, e.recipientApId),
      ),
    );
  }

  return c.json({
    results,
    accepted_count: results.filter((r) => r.success).length,
  });
});

// ---------------------------------------------------------------------------
// POST /reject -- Reject a follow request
// ---------------------------------------------------------------------------

follow.post("/reject", async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const requesterApId = parseNonEmptyString(body.requester_ap_id);
  if (!requesterApId) {
    return c.json(
      { error: "requester_ap_id required", code: "BAD_REQUEST" },
      400,
    );
  }

  const pendingFollow = await findPendingFollow(db, requesterApId, actor.ap_id);
  if (!pendingFollow) {
    return c.json({ error: "No pending follow request" }, 404);
  }

  // DELETE the edge rather than parking it at status='rejected'. A 'rejected'
  // row is a permanent dead state: the create path blocks on ANY existing edge
  // ("Already following or pending") and the inbound handleFollow early-returns
  // on a present edge, so the requester could NEVER re-follow. Deleting matches
  // the INBOUND reject path (handleReject -> deleteFollowByCompoundKey) and the
  // community join-request re-pend behaviour, letting a fresh Follow start clean.
  // A pending edge was never counted, so no counter reconcile is needed.
  await db
    .delete(follows)
    .where(
      and(
        eq(follows.followerApId, requesterApId),
        eq(follows.followingApId, actor.ap_id),
      ),
    );

  if (pendingFollow.activityApId) {
    await db
      .update(inbox)
      .set({ read: 1 })
      .where(
        and(
          eq(inbox.actorApId, actor.ap_id),
          eq(inbox.activityApId, pendingFollow.activityApId),
        ),
      );
  }

  await deliverResponseIfRemote(
    c.env,
    db,
    baseUrl,
    "Reject",
    actor.ap_id,
    requesterApId,
    pendingFollow.activityApId,
  );

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /requests -- Pending follow requests
// ---------------------------------------------------------------------------

follow.get("/requests", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  // Capped at 90: this page's followerApIds are re-queried via `inArray` below,
  // and Cloudflare D1 allows at most 100 bound parameters per query. The
  // unclamped fallback (parseLimit returns it verbatim when no param is given)
  // must also be <=90, hence 90/90. Offset paginates the rest.
  const limit = parseLimit(c.req.query("limit"), 90, 90);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);

  const followRows = await db
    .select()
    .from(follows)
    .where(
      and(
        eq(follows.followingApId, actor.ap_id),
        eq(follows.status, "pending"),
      ),
    )
    // followerApId is the PK discriminator (followingApId is fixed = me); add it
    // as a tiebreaker so same-millisecond pending requests page deterministically.
    .orderBy(desc(follows.createdAt), desc(follows.followerApId))
    .limit(limit)
    .offset(offset);

  const followerApIds = followRows.map((f) => f.followerApId);
  const [localActors, cachedActors] = await Promise.all([
    followerApIds.length > 0
      ? db
          .select({
            apId: actors.apId,
            preferredUsername: actors.preferredUsername,
            name: actors.name,
            iconUrl: actors.iconUrl,
          })
          .from(actors)
          .where(inArray(actors.apId, followerApIds))
      : Promise.resolve([]),
    followerApIds.length > 0
      ? db
          .select({
            apId: actorCache.apId,
            preferredUsername: actorCache.preferredUsername,
            name: actorCache.name,
            iconUrl: actorCache.iconUrl,
          })
          .from(actorCache)
          .where(inArray(actorCache.apId, followerApIds))
      : Promise.resolve([]),
  ]);

  const actorInfoMap = new Map<
    string,
    {
      preferredUsername: string | null;
      name: string | null;
      iconUrl: string | null;
    }
  >();
  for (const a of cachedActors) actorInfoMap.set(a.apId, a);
  for (const a of localActors) actorInfoMap.set(a.apId, a);

  const result = followRows.map((f) => {
    const actorInfo = actorInfoMap.get(f.followerApId);
    return {
      ap_id: f.followerApId,
      username: formatUsername(f.followerApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      created_at: f.createdAt,
    };
  });

  return c.json({ requests: result });
});

export default follow;
