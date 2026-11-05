import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../../../db/index.ts";
import {
  communities,
  communityBans,
  communityMembers,
  follows,
} from "../../../../db/index.ts";
import { activityPubActorIdentityMatchesSql } from "../../../lib/activitypub-actor-identity-sql.ts";
import { communityRequiresMembership } from "../../../lib/community-visibility.ts";
import { isMemberBanned } from "../../communities/membership-shared.ts";
import { findFollowByFollowerIdentity } from "./inbox-shared-helpers.ts";

export type InboundCommunityTarget = {
  apId: string;
  visibility: string | null;
  postPolicy: string | null;
};

export type InboundCommunityScope =
  | { allowed: true; communityApId: string | null }
  | { allowed: false; communityApId: null };

/** An ephemeral witness of the actual rows used by the shared posting check. */
export type InboundCommunityAdmission = InboundCommunityTarget & {
  actorApId: string;
  acceptedFollowerApId: string | null;
  memberActorApId: string | null;
  memberRole: string | null;
  membershipRequired: boolean;
  roleRequired: boolean;
};

/**
 * Recheck the admitted community rows inside the projection's atomic batch.
 * One JSON parameter keeps a bounded fold of different rooms below D1's
 * variable ceiling; actor aliases use the same SQL normalizer as the ban check.
 * The witness never grants authority without its current database rows.
 */
export function inboundCommunityAdmissionsSql(
  admissions: readonly InboundCommunityAdmission[],
  actorApId: string,
): SQL {
  if (admissions.length === 0) return sql`1`;
  const bannedActors = activityPubActorIdentityMatchesSql(
    sql`SELECT ${communityBans.bannedApId} FROM ${communityBans}
      WHERE ${communityBans.communityApId} IN (SELECT room FROM posting_admissions)`,
    actorApId,
  );
  return sql`(WITH posting_admissions AS MATERIALIZED (
    SELECT json_extract(value, '$.apId') AS room,
      json_extract(value, '$.visibility') AS visibility,
      json_extract(value, '$.postPolicy') AS policy,
      json_extract(value, '$.actorApId') AS actor,
      json_extract(value, '$.memberActorApId') AS member_actor,
      json_extract(value, '$.acceptedFollowerApId') AS follower,
      json_extract(value, '$.memberRole') AS role,
      json_extract(value, '$.membershipRequired') AS needs_member,
      json_extract(value, '$.roleRequired') AS needs_role
    FROM json_each(${JSON.stringify(admissions)})
  ), posting_banned_actors AS MATERIALIZED (${bannedActors})
  SELECT NOT EXISTS (SELECT 1 FROM posting_admissions AS admitted
    WHERE NOT EXISTS (SELECT 1 FROM ${communities}
      WHERE ${communities.apId} = admitted.room AND ${communities.deletedAt} IS NULL
        AND ${communities.visibility} IS admitted.visibility
        AND ${communities.postPolicy} IS admitted.policy)
    OR EXISTS (SELECT 1 FROM ${communityBans}
      WHERE ${communityBans.communityApId} = admitted.room
        AND ${communityBans.bannedApId} IN (SELECT * FROM posting_banned_actors))
    OR (admitted.needs_member AND NOT (
      EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followingApId} = admitted.room
        AND ${follows.followerApId} = admitted.follower AND ${follows.status} = 'accepted')
      OR EXISTS (SELECT 1 FROM ${communityMembers} WHERE ${communityMembers.communityApId} = admitted.room
        AND ${communityMembers.actorApId} = admitted.member_actor AND ${communityMembers.role} IS admitted.role)))
    OR (admitted.needs_role AND NOT EXISTS (SELECT 1 FROM ${communityMembers}
      WHERE ${communityMembers.communityApId} = admitted.room
        AND ${communityMembers.actorApId} = admitted.member_actor AND ${communityMembers.role} IS admitted.role))))`;
}

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
  onAllowed?: (admission: InboundCommunityAdmission) => void,
): Promise<boolean> {
  const [banned, memberFollow, memberRow] = await Promise.all([
    isMemberBanned(db, community.apId, actorApId),
    findFollowByFollowerIdentity(db, actorApId, community.apId),
    db.query.communityMembers.findFirst({
      where: and(
        eq(communityMembers.communityApId, community.apId),
        eq(communityMembers.actorApId, actorApId),
      ),
      columns: { role: true },
    }),
  ]);
  if (banned) return false;

  const isMember = memberFollow?.status === "accepted" || Boolean(memberRow);
  const role = memberRow?.role;
  const isManager = role === "owner" || role === "moderator";
  const policy = community.postPolicy || "members";

  if (communityRequiresMembership(community.visibility) && !isMember) {
    return false;
  }
  if (policy !== "anyone" && !isMember) return false;
  if (policy === "mods" && !isManager) return false;
  if (policy === "owners" && role !== "owner") return false;
  onAllowed?.({
    apId: community.apId,
    visibility: community.visibility,
    postPolicy: community.postPolicy,
    actorApId,
    acceptedFollowerApId:
      memberFollow?.status === "accepted" ? memberFollow.followerApId : null,
    memberActorApId: memberRow ? actorApId : null,
    memberRole: role ?? null,
    membershipRequired:
      communityRequiresMembership(community.visibility) || policy !== "anyone",
    roleRequired: policy === "mods" || policy === "owners",
  });
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
  onAllowed?: (admission: InboundCommunityAdmission) => void,
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
  if (
    !(await canActorPostToInboundCommunity(db, actorApId, community, onAllowed))
  ) {
    return { allowed: false, communityApId: null };
  }
  return { allowed: true, communityApId: community.apId };
}
