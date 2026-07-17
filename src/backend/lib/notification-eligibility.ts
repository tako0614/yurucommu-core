/**
 * Shared social-notification eligibility predicates.
 *
 * SINGLE owner of the WHERE fragments that decide whether an inbox row is a
 * user-facing notification. Consumed by ALL of:
 *   - GET /api/notifications (list),
 *   - GET /api/notifications/unread/count (badge),
 *   - the push outbox processor (delivery-time re-check + push unread badge)
 * so a change to eligibility (a new activity type, a new suppression rule)
 * cannot silently drift between the list, the badge, and push delivery — the
 * dispersion that past audits repeatedly flagged for visibility logic.
 */

import {
  and,
  eq,
  exists,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  type SQL,
} from "drizzle-orm";

import {
  activities,
  dmArchivedConversations,
  inbox,
  notificationArchived,
  objects,
  type Database,
} from "../../db/index.ts";
import { excludeBlockedMutedAuthors } from "./feed-exclude.ts";

/**
 * The activity types that surface as notifications. Any addition must hold for
 * the list, the unread badge, AND push delivery — they all read this constant.
 */
export const NOTIFICATION_ACTIVITY_TYPES = [
  "Follow",
  "Like",
  "Announce",
  "Create",
] as const;

export interface NotificationEligibilityOptions {
  /**
   * How direct-visibility (DM) Creates are treated:
   * - "exclude" (list/badge): a DM surfaces in the DM view, never as a
   *   notification row, so drop it entirely.
   * - "unless-dm-archived" (push): a direct Create IS push-eligible (routed to
   *   Yurume), unless the recipient archived the conversation — archiving is a
   *   delivery preference, not merely a presentation filter.
   */
  readonly direct: "exclude" | "unless-dm-archived";
  /**
   * Archive partition. "exclude" (default: badge/push and the default list
   * view) hides archived rows; "only" (the list's archived view) shows ONLY
   * archived rows.
   */
  readonly archived?: "exclude" | "only";
  /**
   * Restrict to a subset of NOTIFICATION_ACTIVITY_TYPES (the list's type
   * filter). Defaults to the full set; callers must not widen it.
   */
  readonly activityTypes?: readonly string[];
}

/**
 * Eligibility conditions for a query shaped as
 * `inbox JOIN activities LEFT JOIN objects` scoped to `actorApId`'s inbox.
 * Returns the shared conditions only; callers add their own paging/read/type
 * filters on top.
 */
export function notificationEligibilityWhere(
  db: Database,
  actorApId: string,
  options: NotificationEligibilityOptions,
): SQL[] {
  // Never notify an actor about their own activity.
  const notSelf = ne(activities.actorApId, actorApId);

  // Only user-facing activity types.
  const userFacingType = inArray(activities.type, [
    ...(options.activityTypes ?? NOTIFICATION_ACTIVITY_TYPES),
  ]);

  // Archive partition. Archived notifications are hidden from the default
  // list, excluded from the badge, and must not push; the list's archived view
  // inverts the predicate.
  const archivedSubquery = db
    .select({ activityApId: notificationArchived.activityApId })
    .from(notificationArchived)
    .where(
      and(
        eq(notificationArchived.actorApId, inbox.actorApId),
        eq(notificationArchived.activityApId, inbox.activityApId),
      ),
    );
  const notArchived =
    options.archived === "only"
      ? exists(archivedSubquery)
      : notExists(archivedSubquery);

  // Direct (DM) handling. The object join is LEFT (Follow's object is an
  // actor, not an objects row), so NULL visibility must be kept.
  let directCondition: SQL;
  if (options.direct === "exclude") {
    directCondition = or(
      isNull(objects.visibility),
      ne(objects.visibility, "direct"),
    )!;
  } else {
    const archivedDmSubquery = db
      .select({ conversationId: dmArchivedConversations.conversationId })
      .from(dmArchivedConversations)
      .where(
        and(
          eq(dmArchivedConversations.actorApId, actorApId),
          eq(dmArchivedConversations.conversationId, objects.conversation),
        ),
      );
    directCondition = or(
      isNull(objects.visibility),
      ne(objects.visibility, "direct"),
      notExists(archivedDmSubquery),
    )!;
  }

  const conditions: SQL[] = [
    notSelf,
    userFacingType,
    notArchived,
    directCondition,
  ];

  // Suppress notifications whose actor the recipient has blocked or muted.
  // This is the read-time choke point: mutes are read-only everywhere, and not
  // every notify WRITE path block-checks, so gating here covers like/repost/
  // follow/reply/mention (local AND federated) for both blocks and mutes.
  const blockMute = excludeBlockedMutedAuthors(
    db,
    actorApId,
    activities.actorApId,
  );
  if (blockMute) conditions.push(blockMute);

  return conditions;
}
