import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";
import { formatUsername } from "../federation-helpers.ts";
import { operatorActorNotBlockedSql } from "../lib/blocklist.ts";
import { logger } from "../lib/logger.ts";
import { batchLoadActorInfo } from "./communities/membership-shared.ts";

const recommendations = new Hono<{ Bindings: Env; Variables: Variables }>();
const log = logger.child({ component: "recommendations" });

/**
 * GET /api/recommendations/users
 *
 * Returns recommended users based on friends-of-friends algorithm.
 * Finds users followed by people the current user follows,
 * ranked by number of mutual connections.
 */
recommendations.get("/users", async (c) => {
  const actor = c.get("actor");
  if (!actor) return c.json({ error: "Unauthorized" }, 401);

  const db = c.get("db");
  const myApId = actor.ap_id;

  try {
    // Hide deleted and private/locked local accounts, matching search and
    // other actor-discovery surfaces. Remote actor_cache candidates retain
    // their existing scope. Keep explanations outside this raw SELECT so
    // request admission can reject multiple SQL statements without parsing
    // comment punctuation as SQL syntax.
    const candidates = await db.all<{ ap_id: string; mutual_count: number }>(
      sql`
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
          AND f2.following_ap_id NOT IN (
            SELECT ap_id FROM actors WHERE deleted_at IS NOT NULL OR is_private = 1
          )
          AND ${operatorActorNotBlockedSql(sql.raw("f2.following_ap_id"))}
        GROUP BY f2.following_ap_id
        ORDER BY mutual_count DESC
        LIMIT 5
      `,
    );

    if (candidates.length === 0) return c.json({ users: [] });

    const actorMap = await batchLoadActorInfo(
      db,
      candidates.map((r) => r.ap_id),
    );

    const users = candidates.map((row) => {
      const info = actorMap.get(row.ap_id);
      return {
        ap_id: row.ap_id,
        preferred_username: info?.preferredUsername ?? null,
        name: info?.name ?? null,
        icon_url: info?.iconUrl ?? null,
        username: formatUsername(row.ap_id, info?.preferredUsername),
        mutual_count: Number(row.mutual_count),
      };
    });

    return c.json({ users });
  } catch (error) {
    log.warn("Recommendations failed; returning empty suggestions", {
      event: "recommendations.failed",
      actorApId: myApId,
      error,
    });
    return c.json({ users: [] });
  }
});

export default recommendations;
