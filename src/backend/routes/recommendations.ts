import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';
import { withCache, CacheTTL, CacheTags } from '../middleware/cache';

const recommendations = new Hono<{ Bindings: Env; Variables: Variables }>();

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
    if (!actor) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const prisma = c.get('prisma');
    const myApId = actor.ap_id;

    // Friends-of-friends query:
    // Find users followed by people I follow, excluding:
    // - myself
    // - users I already follow (accepted or pending)
    // - users I've blocked
    // - users I've muted
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

    if (candidates.length === 0) {
      return c.json({ users: [] });
    }

    // Batch load actor info from both Actor and ActorCache tables
    const apIds = candidates.map((r) => r.ap_id);
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

    const localMap = new Map(localActors.map((a) => [a.apId, a]));
    const cachedMap = new Map(cachedActors.map((a) => [a.apId, a]));

    const users = candidates.map((row) => {
      const info = localMap.get(row.ap_id) || cachedMap.get(row.ap_id);
      return {
        ap_id: row.ap_id,
        preferred_username: info?.preferredUsername || null,
        name: info?.name || null,
        icon_url: info?.iconUrl || null,
        username: formatUsername(row.ap_id),
        mutual_count: Number(row.mutual_count),
      };
    });

    return c.json({ users });
  }
);

export default recommendations;
