import type { Context } from "hono";
import { and, eq, gt, inArray, or, sql } from "drizzle-orm";
import type { Database } from "../../../db/index.ts";
import {
  actorCache,
  actors,
  communities,
  communityMembers,
} from "../../../db/index.ts";
import type { Env, Variables } from "../../types.ts";
import { communityApId } from "../../federation-helpers.ts";

export const managerRoles = new Set(["owner", "moderator"]);

// `Database` is a union whose `.batch` lives only on the concrete D1/libsql
// subclasses; reach it through a narrow structural cast (matching membership-join).
type Batchable = { batch: (stmts: unknown[]) => Promise<unknown> };

/**
 * Atomically remove a member and decrement memberCount in ONE batch. The
 * decrement runs BEFORE the delete and is guarded by `EXISTS(member)` (so a
 * duplicate concurrent removal — whose member row is already gone — cannot
 * double-decrement) and `memberCount > 0` (underflow). Mirrors the federated
 * undoFollowEdge pattern; replaces the previous non-atomic delete-then-`-1` that
 * could tear on crash, underflow negative, or double-decrement under a race.
 */
export async function removeMemberAtomic(
  db: Database,
  communityApIdVal: string,
  actorApIdVal: string,
): Promise<void> {
  const memberExists = sql`EXISTS (SELECT 1 FROM ${communityMembers} WHERE ${communityMembers.communityApId} = ${communityApIdVal} AND ${communityMembers.actorApId} = ${actorApIdVal})`;
  await (db as unknown as Batchable).batch([
    db
      .update(communities)
      .set({ memberCount: sql`${communities.memberCount} - 1` })
      .where(
        and(
          eq(communities.apId, communityApIdVal),
          gt(communities.memberCount, 0),
          memberExists,
        ),
      ),
    db
      .delete(communityMembers)
      .where(memberWhere(communityApIdVal, actorApIdVal)),
  ]);
}

/**
 * Atomically add a member and increment memberCount in ONE batch. The increment
 * is guarded by `NOT EXISTS(member)` so a duplicate concurrent add (or a retry)
 * cannot double-count; the insert is onConflictDoNothing. Mirrors the open-join
 * batch and the federated handleFollow pattern.
 */
export async function addMemberAtomic(
  db: Database,
  communityApIdVal: string,
  actorApIdVal: string,
  role: string,
  joinedAt: string,
): Promise<void> {
  const memberAbsent = sql`NOT EXISTS (SELECT 1 FROM ${communityMembers} WHERE ${communityMembers.communityApId} = ${communityApIdVal} AND ${communityMembers.actorApId} = ${actorApIdVal})`;
  await (db as unknown as Batchable).batch([
    db
      .update(communities)
      .set({ memberCount: sql`${communities.memberCount} + 1` })
      .where(and(eq(communities.apId, communityApIdVal), memberAbsent)),
    db
      .insert(communityMembers)
      .values({
        communityApId: communityApIdVal,
        actorApId: actorApIdVal,
        role,
        joinedAt,
      })
      .onConflictDoNothing(),
  ]);
}

export function resolveCommunityApId(
  baseUrl: string,
  identifier: string,
): string {
  return identifier.startsWith("http")
    ? identifier
    : communityApId(baseUrl, identifier);
}

/** Shared WHERE clause for looking up a community by identifier or apId. */
export function communityWhere(apId: string, identifier: string) {
  return or(
    eq(communities.apId, apId),
    eq(communities.preferredUsername, identifier),
  );
}

export async function fetchCommunityDetails(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  identifier: string,
) {
  const db = c.get("db");
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await db
    .select()
    .from(communities)
    .where(communityWhere(apId, identifier))
    .get();
  return { apId, community };
}

export async function fetchCommunityId(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  identifier: string,
) {
  const db = c.get("db");
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await db
    .select({ apId: communities.apId })
    .from(communities)
    .where(communityWhere(apId, identifier))
    .get();
  return { apId, community };
}

/** Compound key condition for CommunityMember / CommunityJoinRequest lookups. */
export function memberWhere(communityApIdVal: string, actorApId: string) {
  return and(
    eq(communityMembers.communityApId, communityApIdVal),
    eq(communityMembers.actorApId, actorApId),
  );
}

/**
 * Require the actor to be a manager (owner or moderator) of the community.
 * Returns the membership record on success, or null if unauthorized.
 */
export async function requireManager(
  db: Database,
  communityApIdVal: string,
  actorApId: string,
) {
  const member = await db
    .select()
    .from(communityMembers)
    .where(memberWhere(communityApIdVal, actorApId))
    .get();
  if (!member || !managerRoles.has(member.role)) return null;
  return member;
}

/**
 * Batch load actor display info from both local actors and cached actors.
 * Returns a single Map keyed by apId with the merged results (local takes priority).
 */
export async function batchLoadActorInfo(
  db: Database,
  apIds: string[],
  includeIcon = true,
) {
  if (apIds.length === 0) {
    return new Map<
      string,
      {
        preferredUsername: string | null;
        name: string | null;
        iconUrl?: string | null;
      }
    >();
  }

  type ActorInfo = {
    preferredUsername: string | null;
    name: string | null;
    iconUrl?: string | null;
  };

  const selectLocalBase = {
    apId: actors.apId,
    preferredUsername: actors.preferredUsername,
    name: actors.name,
    iconUrl: actors.iconUrl,
  } as const;
  const selectCachedBase = {
    apId: actorCache.apId,
    preferredUsername: actorCache.preferredUsername,
    name: actorCache.name,
    iconUrl: actorCache.iconUrl,
  } as const;

  const [localActors, cachedActors] = await Promise.all([
    db.select(selectLocalBase).from(actors).where(inArray(actors.apId, apIds)),
    db
      .select(selectCachedBase)
      .from(actorCache)
      .where(inArray(actorCache.apId, apIds)),
  ]);

  // Cached first so local overrides
  const map = new Map<string, ActorInfo>();
  for (const a of cachedActors) {
    const info: ActorInfo = {
      preferredUsername: a.preferredUsername,
      name: a.name,
    };
    if (includeIcon) info.iconUrl = a.iconUrl;
    map.set(a.apId, info);
  }
  for (const a of localActors) {
    const info: ActorInfo = {
      preferredUsername: a.preferredUsername,
      name: a.name,
    };
    if (includeIcon) info.iconUrl = a.iconUrl;
    map.set(a.apId, info);
  }
  return map;
}
