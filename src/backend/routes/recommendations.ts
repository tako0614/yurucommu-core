import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';
import { withCache, CacheTTL, CacheTags } from '../middleware/cache';
import type { PrismaClient } from '../../generated/prisma';

const recommendations = new Hono<{ Bindings: Env; Variables: Variables }>();

type ActorInfo = { apId: string; preferredUsername: string | null; name: string | null; iconUrl: string | null };

/** Build a merged actor lookup map (local actors take priority over cached). */
async function buildActorMap(
  prisma: PrismaClient,
  apIds: string[],
): Promise<Map<string, ActorInfo>> {
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: apIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: apIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  const map = new Map<string, ActorInfo>();
  for (const a of cachedActors) map.set(a.apId, a);
  for (const a of localActors) map.set(a.apId, a);
  return map;
}

/**
 * GET /api/recommendations/users
 *
 * Returns recommended users based on friends-of-friends algorithm.
 * Finds users followed by people the current user follows,
 * ranked by number of mutual connections.
 */
recommendations.get(
  '/users',
  withCache({ ttl: CacheTTL.ACTOR_PROFILE, varyByActor: true, cacheTag: CacheTags.ACTOR }),
  async (c) => {
    const actor = c.get('actor');
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const prisma = c.get('prisma');
    const myApId = actor.ap_id;

    const candidates = await prisma.$queryRaw<
      Array<{ ap_id: string; mutual_count: number }>
    >`
      SELECT f2.following_ap_id AS ap_id, COUNT(DISTINCT f2.follower_ap_id) AS mutual_count
      FROM follows f1
      JOIN follows f2 ON f1.following_ap_id = f2.follower_ap_id AND f2.status = 'accepted'
      WHERE f1.follower_ap_id = ${myApId}
        AND f1.status = 'accepted'
        AND f2.following_ap_id != ${myApId}
        AND f2.following_ap_id NOT IN (
          SELECT following_ap_id FROM follows
          WHERE follower_ap_id = ${myApId} AND status IN ('accepted', 'pending')
        )
        AND f2.following_ap_id NOT IN (
          SELECT blocked_ap_id FROM blocks WHERE blocker_ap_id = ${myApId}
        )
        AND f2.following_ap_id NOT IN (
          SELECT muted_ap_id FROM mutes WHERE muter_ap_id = ${myApId}
        )
      GROUP BY f2.following_ap_id
      ORDER BY mutual_count DESC
      LIMIT 5
    `;

    if (candidates.length === 0) return c.json({ users: [] });

    const actorMap = await buildActorMap(prisma, candidates.map(r => r.ap_id));

    const users = candidates.map((row) => {
      const info = actorMap.get(row.ap_id);
      return {
        ap_id: row.ap_id,
        preferred_username: info?.preferredUsername ?? null,
        name: info?.name ?? null,
        icon_url: info?.iconUrl ?? null,
        username: formatUsername(row.ap_id),
        mutual_count: Number(row.mutual_count),
      };
    });

    return c.json({ users });
  },
);

export default recommendations;
