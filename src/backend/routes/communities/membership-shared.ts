import type { Context } from 'hono';
import type { Env, Variables } from '../../types';
import type { PrismaClient } from '../../../generated/prisma';
import { communityApId } from '../../utils';
import { managerRoles } from './utils';

export type MembershipContext = Context<{ Bindings: Env; Variables: Variables }>;

export function resolveCommunityApId(baseUrl: string, identifier: string): string {
  return identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
}

/** Shared WHERE clause for looking up a community by identifier or apId. */
function communityWhere(apId: string, identifier: string) {
  return { OR: [{ apId }, { preferredUsername: identifier }] };
}

export async function fetchCommunityDetails(c: MembershipContext, identifier: string) {
  const prisma = c.get('prisma') as PrismaClient;
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await prisma.community.findFirst({
    where: communityWhere(apId, identifier),
  });
  return { apId, community };
}

export async function fetchCommunityId(c: MembershipContext, identifier: string) {
  const prisma = c.get('prisma') as PrismaClient;
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await prisma.community.findFirst({
    where: communityWhere(apId, identifier),
    select: { apId: true },
  });
  return { apId, community };
}

/** Compound key for CommunityMember / CommunityJoinRequest lookups. */
export function memberKey(communityApId: string, actorApId: string) {
  return { communityApId_actorApId: { communityApId, actorApId } };
}

/**
 * Require the actor to be a manager (owner or moderator) of the community.
 * Returns the membership record on success, or null if unauthorized.
 */
export async function requireManager(
  prisma: PrismaClient,
  communityApId: string,
  actorApId: string,
) {
  const member = await prisma.communityMember.findUnique({
    where: memberKey(communityApId, actorApId),
  });
  if (!member || !managerRoles.has(member.role)) return null;
  return member;
}

/**
 * Batch load actor display info from both local actors and cached actors.
 * Returns a single Map keyed by apId with the merged results (local takes priority).
 */
export async function batchLoadActorInfo(
  prisma: PrismaClient,
  apIds: string[],
  includeIcon = true,
) {
  if (apIds.length === 0) return new Map<string, { preferredUsername: string | null; name: string | null; iconUrl?: string | null }>();

  const select = includeIcon
    ? { apId: true, preferredUsername: true, name: true, iconUrl: true } as const
    : { apId: true, preferredUsername: true, name: true } as const;

  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({ where: { apId: { in: apIds } }, select }),
    prisma.actorCache.findMany({ where: { apId: { in: apIds } }, select }),
  ]);

  // Cached first so local overrides
  const map = new Map<string, { preferredUsername: string | null; name: string | null; iconUrl?: string | null }>();
  for (const a of cachedActors) map.set(a.apId, a);
  for (const a of localActors) map.set(a.apId, a);
  return map;
}
