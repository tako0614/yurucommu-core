import { and, eq, inArray, isNull } from "drizzle-orm";

import type { Database } from "../../../../db/index.ts";
import {
  communities,
  communityMembers,
  follows,
} from "../../../../db/index.ts";
import { communityRequiresMembership } from "../../../lib/community-visibility.ts";
import { isMemberBanned } from "../../communities/membership-shared.ts";

export type InboundCommunityTarget = {
  apId: string;
  visibility: string | null;
  postPolicy: string | null;
};

export type InboundCommunityScope =
  | { allowed: true; communityApId: string | null }
  | { allowed: false; communityApId: null };

/**
 * Apply the same posting authority to every inbound community projection.
 *
 * Remote membership is an accepted Follow of the community Group; local
 * membership carries a role in community_members. A durable ban wins before
 * either representation. Keeping this decision in one helper prevents the
 * Group inbox and user-inbox Note/Story paths from drifting into different
 * definitions of who may inject content into a community feed.
 */
export async function canActorPostToInboundCommunity(
  db: Database,
  actorApId: string,
  community: InboundCommunityTarget,
): Promise<boolean> {
  const [banned, memberFollow, memberRow] = await Promise.all([
    isMemberBanned(db, community.apId, actorApId),
    db.query.follows.findFirst({
      where: and(
        eq(follows.followerApId, actorApId),
        eq(follows.followingApId, community.apId),
        eq(follows.status, "accepted"),
      ),
      columns: { status: true },
    }),
    db.query.communityMembers.findFirst({
      where: and(
        eq(communityMembers.communityApId, community.apId),
        eq(communityMembers.actorApId, actorApId),
      ),
      columns: { role: true },
    }),
  ]);
  if (banned) return false;

  const isMember = Boolean(memberFollow) || Boolean(memberRow);
  const role = memberRow?.role;
  const isManager = role === "owner" || role === "moderator";
  const policy = community.postPolicy || "members";

  if (communityRequiresMembership(community.visibility) && !isMember) {
    return false;
  }
  if (policy !== "anyone" && !isMember) return false;
  if (policy === "mods" && !isManager) return false;
  if (policy === "owners" && role !== "owner") return false;
  return true;
}

/**
 * Resolve a bounded AS2 audience against local live communities and authorize
 * the signer for the one matching scope.
 *
 * Unknown/external audiences are preserved by the caller but do not acquire a
 * local community_ap_id. More than one local match is ambiguous and rejected.
 * The ap_id and followers_url lookups are intentionally separate: with the
 * 64-address ingress cap, combining both IN lists would compile to 128 bound
 * parameters and fail on production D1's 100-variable ceiling.
 */
export async function resolveInboundCommunityScope(
  db: Database,
  actorApId: string,
  audience: readonly string[],
): Promise<InboundCommunityScope> {
  const addresses = [...new Set(audience)].filter(Boolean).slice(0, 64);
  if (addresses.length === 0) {
    return { allowed: true, communityApId: null };
  }

  const columns = {
    apId: communities.apId,
    visibility: communities.visibility,
    postPolicy: communities.postPolicy,
  };
  const [byApId, byFollowersUrl] = await Promise.all([
    db
      .select(columns)
      .from(communities)
      .where(
        and(
          inArray(communities.apId, addresses),
          isNull(communities.deletedAt),
        ),
      ),
    db
      .select(columns)
      .from(communities)
      .where(
        and(
          inArray(communities.followersUrl, addresses),
          isNull(communities.deletedAt),
        ),
      ),
  ]);
  const matches = new Map<string, InboundCommunityTarget>();
  for (const community of [...byApId, ...byFollowersUrl]) {
    matches.set(community.apId, community);
  }
  if (matches.size === 0) {
    return { allowed: true, communityApId: null };
  }
  if (matches.size !== 1) {
    return { allowed: false, communityApId: null };
  }

  const community = [...matches.values()][0]!;
  if (!(await canActorPostToInboundCommunity(db, actorApId, community))) {
    return { allowed: false, communityApId: null };
  }
  return { allowed: true, communityApId: community.apId };
}
