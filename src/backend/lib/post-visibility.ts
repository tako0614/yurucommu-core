// Single-object read-gate combining ALL visibility dimensions: the private-
// community membership gate (delegated to canViewerReadObject) AND the
// per-post public / unlisted / followers / direct visibility check. This is the
// canonical "can this viewer read this object" predicate; the inline gates in
// posts/routes.ts (post-detail + filterVisibleReplies), posts/interactions.ts
// (bookmarks), and notifications.ts implement the same logic and may migrate to
// this helper over time.

import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import { blocks, follows } from "../../db/index.ts";
import { canViewerReadObject } from "./community-visibility.ts";
import { safeJsonParse } from "../federation-helpers.ts";

export type ReadGateObject = {
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
    return isExplicitRecipient(obj, viewerApId);
  }

  if (obj.visibility === "followers") {
    if (!viewerApId) return false;
    if (obj.attributedTo === viewerApId) return true;
    if (isExplicitRecipient(obj, viewerApId)) return true;
    return isAcceptedFollower(obj.attributedTo);
  }

  return true; // public / unlisted
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
): Promise<boolean> {
  const now = new Date().toISOString();

  // Story author + expiry shortcuts need no community/follow query.
  if (obj.type === "Story") {
    if (viewerApId && obj.attributedTo === viewerApId) return true;
    if (obj.endTime && obj.endTime <= now) return false;
  }

  // Private-community membership gate first (non-community objects short to true).
  if (
    !(await canViewerReadObject(
      db,
      { audienceJson: obj.audienceJson, communityApId: obj.communityApId },
      viewerApId,
    ))
  ) {
    return false;
  }

  // Resolve the single accepted-follow edge only when a follower-gated branch
  // actually needs it (personal story, or a followers-only post with no explicit
  // to/cc recipient), then defer to the shared per-post predicate.
  const needsFollow =
    !!viewerApId &&
    obj.attributedTo !== viewerApId &&
    ((obj.type === "Story" && !obj.communityApId) ||
      (obj.type !== "Story" &&
        obj.visibility === "followers" &&
        !isExplicitRecipient(obj, viewerApId)));
  const following = needsFollow
    ? await hasAcceptedFollow(db, viewerApId, obj.attributedTo)
    : false;

  return passesPostVisibilitySync(obj, viewerApId, () => following, now);
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
  const row = await db
    .select({ blockerApId: blocks.blockerApId })
    .from(blocks)
    .where(
      and(
        eq(blocks.blockerApId, targetApId),
        eq(blocks.blockedApId, actorApId),
      ),
    )
    .get();
  return Boolean(row);
}
