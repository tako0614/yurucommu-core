import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  actors,
  announces,
  communities,
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
import { fetchAndPersistAnnouncedNote } from "./inbox-content-handlers.ts";
import { isLocal } from "../../../lib/ap-ids.ts";
import { notDeleted } from "../../../../db/index.ts";
import {
  actorSuppressesInteractionFrom,
  canViewerReadObjectFull,
} from "../../../lib/post-visibility.ts";
import { logger } from "../../../lib/logger.ts";
import { MAX_ACTIVITY_OBJECT_IDS } from "../../../lib/activitypub-validators.ts";
import { severFollowPair } from "../../../lib/follow-edge-mutations.ts";

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

  // Apply the canonical read gate to EVERY object retained by this instance,
  // including a remote-authored object delivered to a local recipient. Limiting
  // this check to locally-authored targets let an unrelated signer Like/Announce
  // a cached remote DM or followers-only Note, mutating its edge/counter state
  // despite having no read access. Personal blocks/mutes remain local-owner
  // state, so that extra write-suppression guard only applies when the retained
  // object's author is local.
  const target = await db
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
    .where(and(eq(objects.apId, objectId), notDeleted(objects)))
    .get();
  // Never retain a relationship to an object this instance does not currently
  // retain as live. With no D1 FK (remote identities/relationships are
  // intentionally app-managed), the old path inserted one permanent edge for
  // every attacker-chosen object id even though the counter update matched no
  // row. A signer could therefore grow likes/announces without bound, and a
  // soft-deleted object could accumulate fresh interactions. An unknown
  // Announce from a followed actor still gets its one bounded, validated fetch
  // in handleAnnounce BEFORE reaching this guard; only a successfully persisted
  // public/unlisted Note proceeds.
  if (!target) return;

  if (
    isLocal(target.attributedTo, baseUrl) &&
    (await actorSuppressesInteractionFrom(db, target.attributedTo, actor))
  ) {
    return;
  }
  if (!(await canViewerReadObjectFull(db, target, actor))) return;

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

/**
 * A Like is INSTANCE-scoped: the affected object (and the local owner to
 * notify) is resolved from `activity.object`, never from a delivery recipient.
 * The recipient argument was already ignored; removing it is what stops the
 * shared inbox from being able to run this once per local follower.
 */
export async function handleLike(
  c: ActivityContext,
  activity: Activity,
  actor: string,
  baseUrl: string,
) {
  await handleInteraction("like", c, activity, actor, baseUrl);
}

// ---------------------------------------------------------------------------
// Announce handler (repost/boost)
// ---------------------------------------------------------------------------

/**
 * Does at least one (non-tombstoned) LOCAL actor have an accepted follow of
 * `actorApId`? The fetch-and-store path below is gated on this so an arbitrary
 * remote cannot use our inbox as an open relay: only a boost from someone a
 * local user chose to follow may trigger an outbound object fetch.
 */
async function actorHasLocalFollowers(
  db: Database,
  actorApId: string,
): Promise<boolean> {
  const row = await db
    .select({ followerApId: follows.followerApId })
    .from(follows)
    .innerJoin(
      actors,
      and(eq(actors.apId, follows.followerApId), notDeleted(actors)),
    )
    .where(
      and(eq(follows.followingApId, actorApId), eq(follows.status, "accepted")),
    )
    .limit(1)
    .get();
  return Boolean(row);
}

/** Instance-scoped, exactly like {@link handleLike}. */
export async function handleAnnounce(
  c: ActivityContext,
  activity: Activity,
  actor: string,
  baseUrl: string,
) {
  // Fetch-and-store an UNKNOWN boosted remote object before recording the
  // announce, so a followed remote's boost of a post this instance never saw
  // still surfaces in feeds (previously the Announce only left a dangling
  // announce edge + a counter no-op). Strictly gated: the target must be
  // remote and unknown, and the booster must have at least one local follower
  // (no open-relay amplification). On any fetch/validation failure,
  // handleInteraction drops the Announce because there is no live retained
  // target; it must not create a dangling edge for an attacker-chosen id.
  const db = c.get("db");
  const objectId = getActivityObjectId(activity);
  if (objectId && !isLocal(objectId, baseUrl)) {
    const known = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(eq(objects.apId, objectId))
      .get();
    if (!known && (await actorHasLocalFollowers(db, actor))) {
      const persisted = await fetchAndPersistAnnouncedNote(
        db,
        objectId,
        baseUrl,
      );
      if (!persisted) {
        log.debug("Announce target fetch skipped or failed", {
          event: "ap.announce.object_fetch_failed",
          actor,
          objectId,
        });
      }
    }
  }
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

  // Commit both directions together. The inbox dispatch retries failures, but
  // there must be no interval where only one direction has been severed.
  await severFollowPair(db, recipient.apId, actor);
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
  // Flag activities carry a free-text reason at envelope-level `content`.
  const rawContent = activity.content;
  // Cap the inbound reason length at ingest. The Flag `content` is fully
  // attacker-controlled free text, so without a bound the reports table grows
  // unbounded under report spam. 2000 chars is ample for a moderation reason.
  const content =
    typeof rawContent === "string" ? rawContent.slice(0, 2000) : null;

  // Standard AS2 / Mastodon Flag uses an object ARRAY (usually the reported
  // post followed by its actor). The parser projects those references into a
  // bounded list; retain the scalar fallback for older callers/fixtures and the
  // target fallback for peers that use it instead of object.
  const reportedIds = [
    ...(activity.objectIds ?? []),
    ...(objectId ? [objectId] : []),
    ...(targetId ? [targetId] : []),
  ]
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, MAX_ACTIVITY_OBJECT_IDS);

  let instance: string | null = null;
  try {
    instance = getDomain(actor);
  } catch {
    instance = null;
  }

  // Persist only a target this instance can actually moderate:
  //   - an object authored by a local actor;
  //   - an object scoped to a live local community; or
  //   - a local actor/community itself.
  //
  // Before this authority check, every signed Flag — including one containing
  // no usable object at all — appended a permanent report row for an arbitrary
  // attacker-chosen id. Besides filling the queue with unactionable noise, that
  // made the append-only table a storage-amplification surface. Each IN list is
  // capped by MAX_ACTIVITY_OBJECT_IDS, below D1's 100-bind ceiling.
  //
  // A storage failure MUST escape to the inbox route. The shared dispatch
  // contract releases its fenced claim and returns retryable 503, leaving the
  // activity ledger uncommitted so the peer can complete the report later.
  // Swallowing this error would ACK 202 and mark the activity processed even
  // though no moderation row exists, permanently losing a valid abuse report.
  try {
    const db = c.get("db");
    if (reportedIds.length === 0) {
      log.info("Dropped inbound Flag with no reportable target", {
        event: "ap.flag.no_target",
        actor,
      });
      return;
    }

    const objectTargets = await db
      .select({ apId: objects.apId })
      .from(objects)
      .where(
        and(
          inArray(objects.apId, reportedIds),
          or(
            sql`EXISTS (SELECT 1 FROM ${actors} WHERE ${actors.apId} = ${objects.attributedTo})`,
            sql`EXISTS (
              SELECT 1 FROM ${communities}
              WHERE ${communities.apId} = ${objects.communityApId}
                AND ${communities.deletedAt} IS NULL
            )`,
          ),
        ),
      );
    const actorTargets = await db
      .select({ apId: actors.apId })
      .from(actors)
      .where(inArray(actors.apId, reportedIds));
    const communityTargets = await db
      .select({ apId: communities.apId })
      .from(communities)
      .where(
        and(inArray(communities.apId, reportedIds), notDeleted(communities)),
      );

    // Prefer a specific actionable object over its actor when both are present
    // in a standard `[post, actor]` Flag array.
    const actionableObjects = new Set(objectTargets.map((row) => row.apId));
    const actionableEntities = new Set([
      ...actorTargets.map((row) => row.apId),
      ...communityTargets.map((row) => row.apId),
    ]);
    const reportTarget =
      reportedIds.find((id) => actionableObjects.has(id)) ??
      reportedIds.find((id) => actionableEntities.has(id));
    if (!reportTarget) {
      log.info("Dropped inbound Flag outside local moderation authority", {
        event: "ap.flag.unowned_target",
        actor,
      });
      return;
    }

    await db
      .insert(reports)
      .values({
        // verifyAndParseInbox stamps an origin-bound internal activity id.
        // Reusing it makes a dispatch retry idempotent instead of appending a
        // second random report after a commit/lease failure.
        id: activity.id || generateId(),
        reporterApId: actor,
        targetApId: reportTarget,
        content,
        instance,
      })
      .onConflictDoNothing();
  } catch (err) {
    log.warn("Failed to persist Flag report", {
      event: "ap.flag.persist_failed",
      actor,
      object: objectId,
      target: targetId,
      error: err,
    });
    throw err;
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

  // SECURITY (same-host actor authority): `activity.target` is
  // attacker-controlled and only the exact signing actor is authenticated.
  // Same-origin is insufficient: one account on a multi-user remote host must
  // not Accept or Remove a local user's follow edge to a sibling account. Once
  // an optional `/followers` collection suffix is normalized, the target actor
  // id must therefore equal the verified signer exactly.
  if (followingApId !== actor) return null;
  return followingApId;
}
