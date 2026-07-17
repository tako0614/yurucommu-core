/**
 * Shared Yurume unread totals.
 *
 * SINGLE owner of the DM + community-chat unread COUNT(*) SQL. It is consumed
 * by BOTH:
 *   - GET /api/dm/unread/count (the Messages nav badge), and
 *   - the notification push payload's `counts.unread`
 * so the app badge a push sets can never drift from the badge the client
 * computes when it opens. A parity test pins this helper to the endpoint.
 *
 * - DM unread: direct Notes addressed TO the actor (via the object_recipients
 *   `to` index), not authored by the actor, published after the actor's
 *   per-conversation read time (epoch if never read), excluding archived
 *   conversations.
 * - Community unread: group-CHAT Notes (audience-linked, communityApId IS NULL
 *   — NOT feed posts) in communities the actor belongs to, not the actor's
 *   own, after the later of the per-community read time and the join time.
 */

import { and, count, eq, sql } from "drizzle-orm";
import {
  activities,
  inbox as inboxTable,
  objects,
  type Database,
} from "../../db/index.ts";
import { notificationEligibilityWhere } from "./notification-eligibility.ts";

export interface YurumeUnreadCounts {
  readonly dm: number;
  readonly community: number;
  readonly total: number;
}

export async function yurumeUnreadCounts(
  db: Database,
  actorApId: string,
): Promise<YurumeUnreadCounts> {
  const dmRow = await db.get<{ c: number }>(sql`
    SELECT COUNT(*) AS c
    FROM objects o
    JOIN object_recipients orp
      ON orp.object_ap_id = o.ap_id
      AND orp.recipient_ap_id = ${actorApId}
      AND orp.type = 'to'
    LEFT JOIN dm_read_status r
      ON r.conversation_id = o.conversation
      AND r.actor_ap_id = ${actorApId}
    WHERE o.visibility = 'direct'
      AND o.type = 'Note'
      AND o.conversation IS NOT NULL
      AND o.attributed_to != ${actorApId}
      AND o.published > COALESCE(r.last_read_at, '1970-01-01T00:00:00Z')
      AND o.conversation NOT IN (
        SELECT conversation_id FROM dm_archived_conversations
        WHERE actor_ap_id = ${actorApId}
      )
  `);

  const communityRow = await db.get<{ c: number }>(sql`
    SELECT COUNT(*) AS c
    FROM community_members cm
    JOIN object_recipients orp
      ON orp.recipient_ap_id = cm.community_ap_id
      AND orp.type = 'audience'
    JOIN objects o
      ON o.ap_id = orp.object_ap_id
      AND o.type = 'Note'
      AND o.community_ap_id IS NULL
      AND o.attributed_to != ${actorApId}
    LEFT JOIN dm_community_read_status r
      ON r.community_ap_id = cm.community_ap_id
      AND r.actor_ap_id = ${actorApId}
    WHERE cm.actor_ap_id = ${actorApId}
      AND o.published > COALESCE(
        r.last_read_at,
        cm.joined_at,
        '1970-01-01T00:00:00Z'
      )
  `);

  const dm = Number(dmRow?.c ?? 0);
  const community = Number(communityRow?.c ?? 0);
  return { dm, community, total: dm + community };
}

/**
 * Unread social-notification count. SAME shared eligibility builder as the
 * notifications list, the badge endpoint, and push delivery (not-self,
 * user-facing types, archive exclusion, direct-DM exclusion, block/mute
 * suppression) so a realtime-pushed badge can never drift from the badge the
 * client fetches.
 */
export async function notificationUnreadCount(
  db: Database,
  actorApId: string,
): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(inboxTable)
    .innerJoin(activities, eq(inboxTable.activityApId, activities.apId))
    .leftJoin(objects, eq(activities.objectApId, objects.apId))
    .where(
      and(
        eq(inboxTable.actorApId, actorApId),
        eq(inboxTable.read, 0),
        ...notificationEligibilityWhere(db, actorApId, { direct: "exclude" }),
      ),
    )
    .get();
  return Number(result?.count ?? 0);
}

export interface UnreadSnapshot {
  readonly dm: number;
  readonly community: number;
  readonly talkTotal: number;
  readonly notifications: number;
}

/**
 * One authoritative unread snapshot (talk + notifications) for the realtime
 * `unread` event. Server-computed on every emit so clients never derive or
 * increment counters themselves.
 */
export async function computeUnreadSnapshot(
  db: Database,
  actorApId: string,
): Promise<UnreadSnapshot> {
  const [talk, notifications] = await Promise.all([
    yurumeUnreadCounts(db, actorApId),
    notificationUnreadCount(db, actorApId),
  ]);
  return {
    dm: talk.dm,
    community: talk.community,
    talkTotal: talk.total,
    notifications,
  };
}
