import { and, eq, or, sql } from "drizzle-orm";
import {
  actors,
  announces,
  follows,
  likes,
  objects,
  reports,
} from "../../../../db/index.ts";
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
import { logger } from "../../../lib/logger.ts";

type ActorRow = typeof actors.$inferSelect;

const log = logger.child({ component: "activitypub.inbox.interaction" });

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

  const { table, countField, activityType } = INTERACTION_CONFIG[kind];
  const activityId = activity.id || activityApId(baseUrl, generateId());

  // Try to insert; if duplicate, skip
  const insertResult = await db
    .insert(table)
    .values({
      actorApId: actor,
      objectApId: objectId,
      activityApId: activityId,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (!insertResult) return; // duplicate

  await db
    .update(objects)
    .set({ [countField]: sql`${objects[countField]} + 1` })
    .where(eq(objects.apId, objectId));

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

  // Atomically create the accepted follow edge. `returning().get()` only
  // yields a row when a brand-new row was inserted; an existing edge hits the
  // conflict clause and returns nothing. This gates the count maintenance so a
  // duplicate Add cannot inflate the follower/following counters. Mirrors the
  // new-row gating in `handleFollow`/`handleAccept`.
  const inserted = await db
    .insert(follows)
    .values({
      followerApId: recipient.apId,
      followingApId,
      status: "accepted",
      activityApId: activity.id || null,
      acceptedAt: now,
    })
    .onConflictDoNothing()
    .returning()
    .get();

  if (!inserted) return; // edge already existed; counts unchanged

  // A new accepted edge: recipient now follows `followingApId`. Mirror the
  // count bookkeeping `handleAccept` performs on an accepted follow.
  await db
    .update(actors)
    .set({ followingCount: sql`${actors.followingCount} + 1` })
    .where(eq(actors.apId, recipient.apId));
  await db
    .update(actors)
    .set({ followerCount: sql`${actors.followerCount} + 1` })
    .where(eq(actors.apId, followingApId));
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
  const deleted = await db
    .delete(follows)
    .where(
      and(
        eq(follows.followerApId, recipient.apId),
        eq(follows.followingApId, followingApId),
      ),
    )
    .returning({ status: follows.status });

  // Only decrement when an accepted edge was actually removed. A duplicate
  // Remove or a Remove of a never-accepted (pending) edge must not drift the
  // counters negative. Mirrors `undoFollow`'s rows-affected gating.
  if (deleted.some((row) => row.status === "accepted")) {
    await db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} - 1` })
      .where(eq(actors.apId, recipient.apId));
    await db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} - 1` })
      .where(eq(actors.apId, followingApId));
  }
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

  // Best-effort: sever follow relations in both directions.
  const deleted = await db
    .delete(follows)
    .where(
      or(
        and(
          eq(follows.followerApId, recipient.apId),
          eq(follows.followingApId, actor),
        ),
        and(
          eq(follows.followerApId, actor),
          eq(follows.followingApId, recipient.apId),
        ),
      ),
    )
    .returning({
      followerApId: follows.followerApId,
      followingApId: follows.followingApId,
      status: follows.status,
    });

  // Decrement counters per removed accepted edge: the follower loses a
  // following, the followed loses a follower. Pending edges were never counted
  // (mirrors `handleFollow`'s accepted-only increment), so skip them to avoid
  // negative drift.
  for (const row of deleted) {
    if (row.status !== "accepted") continue;
    await db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} - 1` })
      .where(eq(actors.apId, row.followerApId));
    await db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} - 1` })
      .where(eq(actors.apId, row.followingApId));
  }
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
