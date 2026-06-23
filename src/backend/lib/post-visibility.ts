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
 * Whether `viewerApId` may read `obj`, honoring BOTH the community membership
 * gate and the per-post visibility:
 *   - public / unlisted  → readable (subject to the community gate);
 *   - followers          → author, an accepted follower, OR an explicitly
 *                          addressed (to/cc) recipient such as a mention;
 *   - direct             → author or an addressed recipient (to/cc).
 * An anonymous viewer (`null`) can never satisfy followers/direct. Fails closed.
 */
export async function canViewerReadObjectFull(
  db: Database,
  obj: ReadGateObject,
  viewerApId: string | null | undefined,
): Promise<boolean> {
  // A Story's stored visibility ("public") does NOT encode its reach: a personal
  // story is followers-only and a community story is members-only, and BOTH are
  // revoked at endTime. The generic visibility checks below would otherwise treat
  // it as world-readable (public, empty audience, no community), so gate it here.
  if (obj.type === "Story") {
    // The author always reads their own story (even after it expires).
    if (viewerApId && obj.attributedTo === viewerApId) return true;
    // Expired → revoked from everyone else (matches the dedicated story feed +
    // /ap/objects + media gates, which the generic single-object path skipped).
    if (obj.endTime && obj.endTime <= new Date().toISOString()) return false;
    // Community story → members-only (canViewerReadObject gates on communityApId).
    if (obj.communityApId) {
      return canViewerReadObject(
        db,
        { audienceJson: obj.audienceJson, communityApId: obj.communityApId },
        viewerApId,
      );
    }
    // Personal story → accepted-follower reach (despite the public default).
    if (!viewerApId) return false;
    const follower = await db
      .select({ followerApId: follows.followerApId })
      .from(follows)
      .where(
        and(
          eq(follows.followerApId, viewerApId),
          eq(follows.followingApId, obj.attributedTo),
          eq(follows.status, "accepted"),
        ),
      )
      .get();
    return Boolean(follower);
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

  if (obj.visibility === "direct") {
    if (!viewerApId) return false;
    if (obj.attributedTo === viewerApId) return true;
    return isExplicitRecipient(obj, viewerApId);
  }

  if (obj.visibility === "followers") {
    if (!viewerApId) return false;
    if (obj.attributedTo === viewerApId) return true;
    if (isExplicitRecipient(obj, viewerApId)) return true;
    const accepted = await db
      .select({ followerApId: follows.followerApId })
      .from(follows)
      .where(
        and(
          eq(follows.followerApId, viewerApId),
          eq(follows.followingApId, obj.attributedTo),
          eq(follows.status, "accepted"),
        ),
      )
      .get();
    return Boolean(accepted);
  }

  return true; // public / unlisted
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
