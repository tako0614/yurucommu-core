import type { Context } from 'hono';
import type { Env, Variables } from '../../types';
import type { PrismaClient } from '../../../generated/prisma';
import { communityApId } from '../../utils';

export type MembershipContext = Context<{ Bindings: Env; Variables: Variables }>;

export function resolveCommunityApId(baseUrl: string, identifier: string): string {
  return identifier.startsWith('http') ? identifier : communityApId(baseUrl, identifier);
}

export async function fetchCommunityDetails(c: MembershipContext, identifier: string) {
  const prisma = c.get('prisma') as PrismaClient;
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier },
      ],
    },
  });
  return { apId, community };
}

export async function fetchCommunityId(c: MembershipContext, identifier: string) {
  const prisma = c.get('prisma') as PrismaClient;
  const apId = resolveCommunityApId(c.env.APP_URL, identifier);
  const community = await prisma.community.findFirst({
    where: {
      OR: [
        { apId },
        { preferredUsername: identifier },
      ],
    },
    select: { apId: true },
  });
  return { apId, community };
}
