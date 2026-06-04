import { and, eq, or, sql } from "drizzle-orm";
import {
  actors,
  announces,
  follows,
  likes,
  objects,
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
  await db
    .insert(follows)
    .values({
      followerApId: recipient.apId,
      followingApId,
      status: "accepted",
      activityApId: activity.id || null,
      acceptedAt: now,
    })
    .onConflictDoUpdate({
      target: [follows.followerApId, follows.followingApId],
      set: {
        status: "accepted",
        acceptedAt: now,
        activityApId: activity.id || undefined,
      },
    });
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
  await db
    .delete(follows)
    .where(
      and(
        eq(follows.followerApId, recipient.apId),
        eq(follows.followingApId, followingApId),
      ),
    );
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
  await db
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
    );
}

// ---------------------------------------------------------------------------
// Flag handler (report)
// ---------------------------------------------------------------------------

export async function handleFlag(
  _c: ActivityContext,
  activity: Activity,
  actor: string,
) {
  const objectId = getActivityObjectId(activity);
  const targetId = getActivityTargetId(activity);
  // No moderation subsystem yet: record is already stored in activities; log for operators.
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
