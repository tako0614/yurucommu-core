import { and, eq, gt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  actors,
  announces,
  follows,
  likes,
  objects,
  reports,
} from "../../../../db/index.ts";
import type { Database } from "../../../../db/index.ts";
import {
  activityApId,
  generateId,
  getDomain,
} from "../../../federation-helpers.ts";
import {
  type Activity,
  type ActivityContext,
  getActivityObjectId,
} from "../inbox-types.ts";
import { notifyLocalObjectOwner } from "./inbox-shared-helpers.ts";
import { isLocal } from "../../../lib/ap-ids.ts";
import {
  actorIsBlockedBy,
  canViewerReadObjectFull,
} from "../../../lib/post-visibility.ts";
import { logger } from "../../../lib/logger.ts";

type ActorRow = typeof actors.$inferSelect;

const log = logger.child({ component: "activitypub.inbox.interaction" });

// ---------------------------------------------------------------------------
// Atomic multi-statement commit (mirrors posts/interactions.ts `runBatch`)
//
// D1 has no interactive transactions, but both the D1 and libsql drivers
// expose `db.batch([...])`, which commits a list of prepared statements
// atomically. The shared `Database` union aliases the abstract
// `BaseSQLiteDatabase` base (which does not surface `batch`), so we narrow to
// the concrete batch surface here rather than weakening the shared type.
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

// ---------------------------------------------------------------------------
// Interaction table / count-field mapping
// ---------------------------------------------------------------------------

type InteractionKind = "like" | "announce";

const INTERACTION_CONFIG = {
  like: {
    table: likes,
    countField: "likeCount" as const,
    activityType: "Like",
  },
  announce: {
    table: announces,
    countField: "announceCount" as const,
    activityType: "Announce",
  },
} as const;

// ---------------------------------------------------------------------------
// Generic interaction handler (shared by Like & Announce)
// ---------------------------------------------------------------------------

async function handleInteraction(
  kind: InteractionKind,
  c: ActivityContext,
  activity: Activity,
  actor: string,
  baseUrl: string,
): Promise<void> {
  const db = c.get("db");
  const objectId = getActivityObjectId(activity);
  if (!objectId) return;

  // Block + read gate for a LOCAL target. Every LOCAL interaction path (like /
  // repost / reply / story like-vote-share) refuses an actor the owner has
  // blocked or who cannot read the object; the inbound federated Like/Announce
  // path did neither, so a personally-blocked remote could still bump the
  // owner's like/boost counter AND deliver a "X liked your post" notification
  // (defeating the block as a harassment remedy), and a remote that cannot read a
  // restricted post could still interact with it. Mirror the local guards.
  const target = await db
    .select({
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
    .where(eq(objects.apId, objectId))
    .get();
  if (target && isLocal(target.attributedTo, baseUrl)) {
    if (await actorIsBlockedBy(db, target.attributedTo, actor)) return;
    if (!(await canViewerReadObjectFull(db, target, actor))) return;
  }

  const { table, countField, activityType } = INTERACTION_CONFIG[kind];
  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Was the edge already present BEFORE this dispatch? This decides whether the
  // dispatch represents a genuinely new interaction (gate for the one-shot
  // owner notification below) — it does NOT gate the counter, which is derived
  // atomically from the edge table state at commit (see below).
  const existingEdge = await db
    .select({ actorApId: table.actorApId })
    .from(table)
    .where(and(eq(table.actorApId, actor), eq(table.objectApId, objectId)))
    .get();

  // #7 (atomicity + idempotency): the edge insert and the counter maintenance
  // MUST commit together. Previously the edge was inserted (onConflictDoNothing)
  // and the counter was bumped in a SEPARATE statement; under the claim/processed
  // re-dispatch model an interruption between the two left the edge present but
  // the counter un-bumped, and a retry's no-op insert SKIPPED the bump → a
  // permanent under-count. Group both into one atomic `db.batch`, and derive the
  // counter from `COUNT(*)` of the edge table rather than a blind `+ 1`: the
  // recompute is exact and idempotent, so a retry after a mid-write crash
  // converges to the correct value and a genuine duplicate can never double-count.
  await runBatch(db, [
    db
      .insert(table)
      .values({
        actorApId: actor,
        objectApId: objectId,
        activityApId: activityId,
      })
      .onConflictDoNothing(),
    db
      .update(objects)
      .set({
        [countField]: sql`(SELECT COUNT(*) FROM ${table} WHERE ${table.objectApId} = ${objectId})`,
      })
      .where(eq(objects.apId, objectId)),
  ]);

  // Only notify the local owner for a genuinely new interaction. A duplicate
  // (re)delivery — including a wave-8 re-dispatch of an already-applied edge —
  // must not spam a second notification.
  if (existingEdge) return;

  await notifyLocalObjectOwner(
    db,
    objectId,
    activityId,
    activityType,
    actor,
    activity,
    baseUrl,
  );
}

// ---------------------------------------------------------------------------
// Like handler
// ---------------------------------------------------------------------------

export async function handleLike(
  c: ActivityContext,
  activity: Activity,
  _recipient: ActorRow,
  actor: string,
  baseUrl: string,
) {
  await handleInteraction("like", c, activity, actor, baseUrl);
}

// ---------------------------------------------------------------------------
// Announce handler (repost/boost)
// ---------------------------------------------------------------------------

export async function handleAnnounce(
  c: ActivityContext,
  activity: Activity,
  _recipient: ActorRow,
  actor: string,
  baseUrl: string,
) {
  await handleInteraction("announce", c, activity, actor, baseUrl);
}

// ---------------------------------------------------------------------------
// Add handler (collection add; used by some servers for membership)
// ---------------------------------------------------------------------------

export async function handleAdd(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string,
) {
  const followingApId = resolveCollectionTarget(activity, recipient, actor);
  if (!followingApId) return;

  const db = c.get("db");
  const now = new Date().toISOString();

  // SECURITY (consent — federated follow-graph forgery): an `Add <local user>
  // to <remote>/followers` is the remote CONFIRMING the local user's OWN Follow
  // (it is an alias of Accept), NOT a license to make the local user follow the
  // sender. It must therefore only TRANSITION a PRE-EXISTING pending edge to
  // accepted (mirroring handleAccept) — never CREATE an edge. The previous
  // version inserted a fresh `accepted` edge + bumped both counters whenever the
  // edge was absent, so a remote could sign an unsolicited `Add` naming any
  // local user as `object` and forge an accepted follow `<victim> -> <sender>`,
  // inflating the victim's followingCount and routing the sender's posts into
  // the victim's home feed — all without the victim ever following anyone.
  //
  // #COUNTER-SYM: like handleAccept, the two +1s run BEFORE the flip, each
  // guarded by a correlated `EXISTS(... status='pending')` subquery, and the
  // flip's own `status='pending'` predicate makes a duplicate/already-accepted
  // (or absent) edge a total no-op — so counters can neither double-bump,
  // under-count on retry, nor bump for an edge that was never pending.
  const pendingEdgeExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${recipient.apId} AND ${follows.followingApId} = ${followingApId} AND ${follows.status} = 'pending')`;
  await runBatch(db, [
    db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} + 1` })
      .where(and(eq(actors.apId, recipient.apId), pendingEdgeExists)),
    db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} + 1` })
      .where(and(eq(actors.apId, followingApId), pendingEdgeExists)),
    db
      .update(follows)
      .set({ status: "accepted", acceptedAt: now })
      .where(
        and(
          eq(follows.followerApId, recipient.apId),
          eq(follows.followingApId, followingApId),
          eq(follows.status, "pending"),
        ),
      ),
  ]);
}

// ---------------------------------------------------------------------------
// Remove handler (collection remove; used for expulsion/ban)
// ---------------------------------------------------------------------------

export async function handleRemove(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string,
) {
  const followingApId = resolveCollectionTarget(activity, recipient, actor);
  if (!followingApId) return;

  const db = c.get("db");

  // #COUNTER-SYM (crash-retry convergence): the edge delete and both -1s MUST
  // commit together. Previously the delete committed first and the decrements
  // were SEPARATE statements; a crash between them left the edge gone but the
  // counts un-decremented, and the peer's retry matched 0 rows so the decrements
  // were SKIPPED → a permanent OVER-count. Co-commit them in one atomic batch.
  //
  // The two decrements run BEFORE the delete and are each guarded by a
  // correlated `EXISTS(... status='accepted')` subquery (so a pending /
  // never-counted edge, a duplicate Remove, or an unknown edge does not drift
  // the counts) plus a `count > 0` underflow guard (mirrors the local API delete
  // paths in posts/interactions.ts which batch + guard both sides).
  const acceptedEdgeExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${recipient.apId} AND ${follows.followingApId} = ${followingApId} AND ${follows.status} = 'accepted')`;
  await runBatch(db, [
    db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} - 1` })
      .where(
        and(
          eq(actors.apId, recipient.apId),
          gt(actors.followingCount, 0),
          acceptedEdgeExists,
        ),
      ),
    db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} - 1` })
      .where(
        and(
          eq(actors.apId, followingApId),
          gt(actors.followerCount, 0),
          acceptedEdgeExists,
        ),
      ),
    db
      .delete(follows)
      .where(
        and(
          eq(follows.followerApId, recipient.apId),
          eq(follows.followingApId, followingApId),
        ),
      ),
  ]);
}

// ---------------------------------------------------------------------------
// Block handler (remote actor blocks the recipient)
// ---------------------------------------------------------------------------

export async function handleBlock(
  c: ActivityContext,
  activity: Activity,
  recipient: ActorRow,
  actor: string,
) {
  const db = c.get("db");
  const blockedId = getActivityObjectId(activity);
  if (!blockedId) return;

  // Only act when the recipient is being blocked.
  if (blockedId !== recipient.apId) return;

  // Best-effort: sever follow relations in both directions. #COUNTER-SYM
  // (crash-retry convergence): handle each direction as its own atomic
  // edge-delete + counter reconcile so a crash between the delete and the
  // decrements cannot leave a counter permanently over-counted (the peer's
  // retry would otherwise match 0 rows and skip the decrement).
  await severFollowEdge(db, recipient.apId, actor); // recipient follows actor
  await severFollowEdge(db, actor, recipient.apId); // actor follows recipient
}

/**
 * Atomically delete a (followerApId -> followingApId) follow edge and reconcile
 * both denormalized counters in a single batch.
 *
 * #COUNTER-SYM: the decrements run BEFORE the delete, each guarded by a
 * correlated `EXISTS(... status='accepted')` subquery (pending edges were never
 * counted) plus a `count > 0` underflow guard, so a pending edge, a duplicate
 * Block, a never-existing edge, or a crash-then-retry is a clean no-op rather
 * than permanently over-counting.
 */
export async function severFollowEdge(
  db: Database,
  followerApId: string,
  followingApId: string,
): Promise<void> {
  const acceptedEdgeExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${followerApId} AND ${follows.followingApId} = ${followingApId} AND ${follows.status} = 'accepted')`;
  await runBatch(db, [
    db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} - 1` })
      .where(
        and(
          eq(actors.apId, followerApId),
          gt(actors.followingCount, 0),
          acceptedEdgeExists,
        ),
      ),
    db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} - 1` })
      .where(
        and(
          eq(actors.apId, followingApId),
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

// ---------------------------------------------------------------------------
// Flag handler (report)
// ---------------------------------------------------------------------------

export async function handleFlag(
  c: ActivityContext,
  activity: Activity,
  actor: string,
) {
  const objectId = getActivityObjectId(activity);
  const targetId = getActivityTargetId(activity);
  // Flag activities carry a free-text reason in `content` (not part of the
  // narrowed Activity type, so read it defensively).
  const rawContent = (activity as { content?: unknown }).content;
  // Cap the inbound reason length at ingest. The Flag `content` is fully
  // attacker-controlled free text, so without a bound the reports table grows
  // unbounded under report spam. 2000 chars is ample for a moderation reason.
  const content =
    typeof rawContent === "string" ? rawContent.slice(0, 2000) : null;

  // The report target is the flagged object (preferred) or the activity target.
  const reportTarget = objectId ?? targetId ?? null;

  let instance: string | null = null;
  try {
    instance = getDomain(actor);
  } catch {
    instance = null;
  }

  // Persist the report so operators can triage it via the moderation API.
  // Best-effort: never let a storage error 5xx the inbox (which would make
  // the sender retry on a backoff). Log the failure for the operator.
  try {
    const db = c.get("db");
    await db.insert(reports).values({
      id: generateId(),
      reporterApId: actor,
      targetApId: reportTarget,
      content,
      instance,
    });
  } catch (err) {
    log.warn("Failed to persist Flag report", {
      event: "ap.flag.persist_failed",
      actor,
      object: objectId,
      target: targetId,
      error: err,
    });
  }

  log.warn("Flag received", {
    event: "ap.flag.received",
    actor,
    object: objectId,
    target: targetId,
    activityId: activity.id || null,
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

function normalizeCollectionTarget(targetId: string): string {
  if (targetId.endsWith("/followers")) {
    return targetId.slice(0, -"/followers".length);
  }
  return targetId;
}

/**
 * Resolve the collection target for Add/Remove activities.
 * Returns the normalized followingApId, or null if the activity should be ignored
 * (missing object, object does not target recipient, or missing target).
 */
function resolveCollectionTarget(
  activity: Activity,
  recipient: ActorRow,
  actor: string,
): string | null {
  const objectId = getActivityObjectId(activity);
  if (!objectId || objectId !== recipient.apId) return null;

  const targetId = getActivityTargetId(activity);
  const followingApId = normalizeCollectionTarget(targetId || actor) || null;
  if (!followingApId) return null;

  // SECURITY (federated follow-graph forgery): `activity.target` is
  // attacker-controlled and only the signing actor is authenticated, NOT the
  // target. Without this check a signed Add/Remove could forge or delete a local
  // user's follow edge to an ARBITRARY third party (followingApId on any host).
  // Constrain the resolved target to the signing actor's own origin, so an
  // Add/Remove can only affect a relationship involving the sending actor.
  try {
    if (getDomain(followingApId) !== getDomain(actor)) return null;
  } catch {
    return null;
  }
  return followingApId;
}
