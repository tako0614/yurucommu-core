// Single-object read-gate combining ALL visibility dimensions: the private-
// community membership gate (delegated to canViewerReadObject) AND the
// per-post public / unlisted / followers / direct visibility check. This is the
// canonical "can this viewer read this object" predicate; the inline gates in
// posts/routes.ts (post-detail + filterVisibleReplies), posts/interactions.ts
// (bookmarks), and notifications.ts implement the same logic and may migrate to
// this helper over time.

import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import { follows, objectRecipients, objects } from "../../db/index.ts";
import {
  canViewerReadObject,
  communityReadAdmissionSql,
  type CommunityReadAdmission,
} from "./community-visibility.ts";
import { safeJsonParse } from "../federation-helpers.ts";
import {
  personalActorIsBlockedBy,
  personalActorIsSuppressedBy,
} from "./personal-actor-moderation.ts";
import {
  isActorBlockedStrict,
  operatorActorNotBlockedSql,
} from "./blocklist.ts";

export type ReadGateObject = {
  apId?: string;
  visibility: string;
  attributedTo: string;
  toJson: string;
  ccJson: string;
  audienceJson: string;
  communityApId: string | null;
  // A Story is stored visibility="public" / audienceJson="[]" but its REAL reach
  // is followers (personal) or members (community), and it is revoked at endTime.
  // When these are supplied the gate applies the Story reach rule; omit them for
  // non-story callers (the branch is then never taken).
  type?: string;
  endTime?: string | null;
};

/** Ephemeral dependencies of one successful canonical read decision. */
export type PostReadAdmission = {
  object: Required<Omit<ReadGateObject, "type">> & { type: string | null };
  viewer: string | null;
  community: CommunityReadAdmission | null;
  followRequired: boolean;
  projectedRecipientRequired: boolean;
  expires: boolean;
};

// A bound D1 string may contain at most 2,000,000 bytes. Do not silently
// truncate a historical projection that cannot fit its admission receipt.
export const MAX_POST_READ_ADMISSION_BYTES = 2_000_000;

/** The actual object and every positive/negative read dependency still hold. */
export function postReadAdmissionSql(admission: PostReadAdmission): SQL {
  const serialized = JSON.stringify(admission);
  if (
    new TextEncoder().encode(serialized).byteLength >
    MAX_POST_READ_ADMISSION_BYTES
  ) {
    throw new RangeError(
      "Parent read admission exceeds the D1 bound-string limit",
    );
  }
  const receipt = sql`read_receipt.value`;
  const viewer = sql`json_extract(${receipt}, '$.viewer')`;
  const fields = [
    "apId",
    "type",
    "attributedTo",
    "visibility",
    "toJson",
    "ccJson",
    "audienceJson",
    "communityApId",
    "endTime",
  ] as const;
  const snapshot = fields.map(
    (field) =>
      sql`${objects[field]} IS json_extract(${receipt}, ${sql.raw("'$.object." + field + "'")})`,
  );
  return sql`(WITH read_receipt(value) AS MATERIALIZED (SELECT ${serialized})
    SELECT EXISTS (SELECT 1 FROM ${objects}, read_receipt
      WHERE ${sql.join(snapshot, sql` AND `)}
        AND ${operatorActorNotBlockedSql(sql`${objects.attributedTo}`)}
        AND (json_type(${receipt}, '$.community') = 'null' OR (
          ${communityReadAdmissionSql(sql`json_extract(${receipt}, '$.community')`, viewer)}))
        AND (NOT json_extract(${receipt}, '$.followRequired') OR EXISTS (
          SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${viewer}
            AND ${follows.followingApId} = ${objects.attributedTo} AND ${follows.status} = 'accepted'))
        AND (NOT json_extract(${receipt}, '$.projectedRecipientRequired') OR EXISTS (
          SELECT 1 FROM ${objectRecipients} WHERE ${objectRecipients.objectApId} = ${objects.apId}
            AND ${objectRecipients.recipientApId} = ${viewer} AND ${objectRecipients.type} = 'to'))
        AND (NOT json_extract(${receipt}, '$.expires') OR ${objects.endTime} > strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))))`;
}

/**
 * A viewer the author EXPLICITLY addressed (in `to` or `cc`) — e.g. an
 * @mention — may read the post even without an accepted-follow edge: the author
 * chose to send it to them, and it was delivered to that actor's inbox.
 * Mentions land in `cc` (mergeCc in posts/routes.ts); direct recipients in `to`.
 */
export function isExplicitRecipient(
  obj: { toJson: string; ccJson: string },
  viewerApId: string,
): boolean {
  return (
    safeJsonParse<string[]>(obj.toJson, []).includes(viewerApId) ||
    safeJsonParse<string[]>(obj.ccJson, []).includes(viewerApId)
  );
}

/**
 * Resolve whether `viewerApId` has an accepted follow edge to `authorApId`.
 */
async function hasAcceptedFollow(
  db: Database,
  viewerApId: string,
  authorApId: string,
): Promise<boolean> {
  const row = await db
    .select({ followerApId: follows.followerApId })
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, viewerApId),
        eq(follows.followingApId, authorApId),
        eq(follows.status, "accepted"),
      ),
    )
    .get();
  return Boolean(row);
}

/** Resolve a private bto/bcc recipient without exposing that identity in JSON. */
async function hasProjectedRecipient(
  db: Database,
  objectApId: string,
  viewerApId: string,
): Promise<boolean> {
  const row = await db
    .select({ objectApId: objectRecipients.objectApId })
    .from(objectRecipients)
    .where(
      and(
        eq(objectRecipients.objectApId, objectApId),
        eq(objectRecipients.recipientApId, viewerApId),
        eq(objectRecipients.type, "to"),
      ),
    )
    .get();
  return Boolean(row);
}

/**
 * Per-post visibility decision EXCLUDING the private-community membership gate.
 * This is the single source of truth for the public / unlisted / followers /
 * direct rules plus the Story reach + expiry rule, and is shared by the async
 * single-object helper (`canViewerReadObjectFull`) and by batched page gates
 * (bookmarks, etc.) so the to/cc explicit-recipient and Story branches cannot
 * drift per surface. The community membership gate is applied SEPARATELY by the
 * caller (inline async in the single-object helper, batched in page gates), and
 * a follower lookup is injected via `isAcceptedFollower` so both a per-object DB
 * query and a precomputed batched Set satisfy the same rules without an N+1.
 *
 * Returns true/false; for a COMMUNITY story it returns true after the author /
 * expiry shortcuts so the caller's community gate decides membership.
 */
export function passesPostVisibilitySync(
  obj: ReadGateObject,
  viewerApId: string | null | undefined,
  isAcceptedFollower: (authorApId: string) => boolean,
  isProjectedRecipient: (objectApId: string) => boolean = () => false,
  now: string = new Date().toISOString(),
): boolean {
  // A Story's stored visibility ("public") does NOT encode its reach: a personal
  // story is followers-only and a community story is members-only, and BOTH are
  // revoked at endTime.
  if (obj.type === "Story") {
    if (viewerApId && obj.attributedTo === viewerApId) return true; // own story
    if (obj.endTime && obj.endTime <= now) return false; // expired → revoked
    if (obj.communityApId) return true; // members gate applied by caller
    if (!viewerApId) return false;
    return isAcceptedFollower(obj.attributedTo); // personal → followers reach
  }

  if (obj.visibility === "direct") {
    if (!viewerApId) return false;
    if (obj.attributedTo === viewerApId) return true;
    return (
      isExplicitRecipient(obj, viewerApId) ||
      (!!obj.apId && isProjectedRecipient(obj.apId))
    );
  }

  if (obj.visibility === "followers") {
    if (!viewerApId) return false;
    if (obj.attributedTo === viewerApId) return true;
    if (isExplicitRecipient(obj, viewerApId)) return true;
    if (obj.apId && isProjectedRecipient(obj.apId)) return true;
    return isAcceptedFollower(obj.attributedTo);
  }

  return obj.visibility === "public" || obj.visibility === "unlisted";
}

/**
 * Whether `viewerApId` may read `obj`, honoring BOTH the community membership
 * gate and the per-post visibility:
 *   - public / unlisted  → readable (subject to the community gate);
 *   - followers          → author, an accepted follower, OR an explicitly
 *                          addressed (to/cc) recipient such as a mention;
 *   - direct             → author or an addressed recipient (to/cc);
 *   - Story              → author always; else revoked past endTime; community
 *                          story → members-only; personal story → followers.
 * An anonymous viewer (`null`) can never satisfy followers/direct. Fails closed.
 */
export async function canViewerReadObjectFull(
  db: Database,
  obj: ReadGateObject,
  viewerApId: string | null | undefined,
  onAllowed?: (admission: PostReadAdmission) => void,
): Promise<boolean> {
  const now = new Date().toISOString();
  const allow = (
    community: CommunityReadAdmission | null,
    followRequired = false,
    projectedRecipientRequired = false,
  ) => {
    if (obj.apId)
      onAllowed?.({
        object: {
          apId: obj.apId,
          type: obj.type ?? null,
          attributedTo: obj.attributedTo,
          visibility: obj.visibility,
          toJson: obj.toJson,
          ccJson: obj.ccJson,
          audienceJson: obj.audienceJson,
          communityApId: obj.communityApId,
          endTime: obj.endTime ?? null,
        },
        viewer: viewerApId ?? null,
        community,
        followRequired,
        projectedRecipientRequired,
        expires:
          obj.type === "Story" &&
          viewerApId !== obj.attributedTo &&
          Boolean(obj.endTime),
      });
    return true;
  };

  // Instance moderation is a read boundary, not only an ingest/delivery
  // boundary. A failed or partial purge intentionally leaves retained objects
  // for retry/reversible unblock; while their author is operator-blocked those
  // rows must be inert through every single-object reader and interaction that
  // consumes this canonical gate.
  if (await isActorBlockedStrict(db, obj.attributedTo)) return false;

  // Story author + expiry shortcuts need no community/follow query.
  if (obj.type === "Story") {
    if (viewerApId && obj.attributedTo === viewerApId) return allow(null);
    if (obj.endTime && obj.endTime <= now) return false;
  }

  // Private-community membership gate first (non-community objects short to true).
  let communityAdmission: CommunityReadAdmission | null = null;
  if (
    !(await canViewerReadObject(
      db,
      { audienceJson: obj.audienceJson, communityApId: obj.communityApId },
      viewerApId,
      (admission) => {
        communityAdmission = admission;
      },
    ))
  ) {
    return false;
  }

  // Resolve the single accepted-follow edge only when a follower-gated branch
  // actually needs it (personal story, or a followers-only post with no explicit
  // to/cc recipient), then defer to the shared per-post predicate.
  const needsProjection =
    !!viewerApId &&
    !!obj.apId &&
    obj.attributedTo !== viewerApId &&
    obj.type !== "Story" &&
    (obj.visibility === "direct" || obj.visibility === "followers") &&
    !isExplicitRecipient(obj, viewerApId);
  const projectedRecipient = needsProjection
    ? await hasProjectedRecipient(db, obj.apId!, viewerApId!)
    : false;

  const needsFollow =
    !!viewerApId &&
    obj.attributedTo !== viewerApId &&
    ((obj.type === "Story" && !obj.communityApId) ||
      (obj.type !== "Story" &&
        obj.visibility === "followers" &&
        !isExplicitRecipient(obj, viewerApId) &&
        !projectedRecipient));
  const following = needsFollow
    ? await hasAcceptedFollow(db, viewerApId, obj.attributedTo)
    : false;

  const allowed = passesPostVisibilitySync(
    obj,
    viewerApId,
    () => following,
    () => projectedRecipient,
    now,
  );
  return allowed
    ? allow(communityAdmission, following, projectedRecipient)
    : false;
}

/**
 * True if `targetApId` (a post author / follow target) has blocked `actorApId`.
 * Callers reject the interaction (like / repost / follow) with a 404 so a blocked
 * actor cannot bump the target's counts, establish a follow edge, or insert into
 * the target's inbox — and the 404 (not 403) avoids leaking the block. Mirrors
 * the inline guard already used by the story-like and DM-send paths.
 */
export async function actorIsBlockedBy(
  db: Database,
  targetApId: string,
  actorApId: string,
): Promise<boolean> {
  return personalActorIsBlockedBy(db, targetApId, actorApId);
}

/**
 * True if `targetApId` has blocked OR muted `actorApId` and therefore does not
 * want an inbound write from that actor reflected on a locally-owned object.
 * Keep this separate from `actorIsBlockedBy`: block remains the existence-
 * hiding authorization rule used by reads and direct local API responses,
 * while mute is an owner-selected write-suppression rule for federated
 * interactions and other targeted inbound writes such as Like, Announce,
 * Follow, Reply, DM, and Mention.
 */
export async function actorSuppressesInteractionFrom(
  db: Database,
  targetApId: string,
  actorApId: string,
): Promise<boolean> {
  return personalActorIsSuppressedBy(db, targetApId, actorApId);
}
