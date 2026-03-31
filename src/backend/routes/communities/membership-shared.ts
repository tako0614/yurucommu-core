import type { Context } from 'hono';
import { eq, and, or, inArray } from 'drizzle-orm';
import type { Database } from '../../../db/index.ts';
import { actors, actorCache, communities, communityMembers } from '../../../db/index.ts';
import type { Env, Variables } from '../../types.ts';
import { communityApId } from '../../federation-helpers.ts';

export const managerRoles = new Set(['owner', 'moderator']);

export function resolveCommunityApId(baseUrl: string, identifier: string): string {
  return identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
}

/** Shared WHERE clause for looking up a community by identifier or apId. */
export function communityWhere(apId: string, identifier: string) {
  return or(eq(communities.apId, apId), eq(communities.preferredUsername, identifier));
}

export async function fetchCommunityDetails(c: Context<{ Bindings: Env; Variables: Variables }>, identifier: string) {
  const db = c.get('db');
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await db.select().from(communities)
    .where(communityWhere(apId, identifier))
    .get();
  return { apId, community };
}

export async function fetchCommunityId(c: Context<{ Bindings: Env; Variables: Variables }>, identifier: string) {
  const db = c.get('db');
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await db.select({ apId: communities.apId }).from(communities)
    .where(communityWhere(apId, identifier))
    .get();
  return { apId, community };
}

/** Compound key condition for CommunityMember / CommunityJoinRequest lookups. */
export function memberWhere(communityApIdVal: string, actorApId: string) {
  return and(eq(communityMembers.communityApId, communityApIdVal), eq(communityMembers.actorApId, actorApId));
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
  const member = await db.select().from(communityMembers)
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
  if (apIds.length === 0) return new Map<string, { preferredUsername: string | null; name: string | null; iconUrl?: string | null }>();

  type ActorInfo = { preferredUsername: string | null; name: string | null; iconUrl?: string | null };

  const selectLocalBase = { apId: actors.apId, preferredUsername: actors.preferredUsername, name: actors.name, iconUrl: actors.iconUrl } as const;
  const selectCachedBase = { apId: actorCache.apId, preferredUsername: actorCache.preferredUsername, name: actorCache.name, iconUrl: actorCache.iconUrl } as const;

  const [localActors, cachedActors] = await Promise.all([
    db.select(selectLocalBase).from(actors).where(inArray(actors.apId, apIds)),
    db.select(selectCachedBase).from(actorCache).where(inArray(actorCache.apId, apIds)),
  ]);

  // Cached first so local overrides
  const map = new Map<string, ActorInfo>();
  for (const a of cachedActors) {
    const info: ActorInfo = { preferredUsername: a.preferredUsername, name: a.name };
    if (includeIcon) info.iconUrl = a.iconUrl;
    map.set(a.apId, info);
  }
  for (const a of localActors) {
    const info: ActorInfo = { preferredUsername: a.preferredUsername, name: a.name };
    if (includeIcon) info.iconUrl = a.iconUrl;
    map.set(a.apId, info);
  }
  return map;
}
