import { type AnyColumn, sql, type SQL } from "drizzle-orm";
import { blocks, mutes, objects } from "../../db/index.ts";
import { activityPubActorIdentitySetSql } from "./activitypub-actor-identity-sql.ts";

/**
 * Predicate excluding posts authored by anyone the viewer has blocked or muted.
 *
 * Expressed as one uncorrelated `NOT IN` subquery over the union of raw +
 * canonical block/mute identities. It binds only the viewer twice regardless
 * of relation count, so it stays under Cloudflare D1's 100-parameter ceiling.
 * The set CTE runs once per query rather than parsing actor URLs per feed row.
 *
 * Returns `undefined` for an empty viewer (anonymous) so callers can skip it.
 * Applying it unconditionally for a logged-in viewer is correct even with zero
 * blocks/mutes: `NOT IN (empty set)` is true.
 *
 * `column` defaults to the post author (`objects.attributedTo`) for feeds, but
 * can be any actor-id column — e.g. `activities.actorApId` so the notifications
 * list/count can suppress activity from blocked/muted accounts the same way.
 */
export function excludeBlockedMutedAuthors(
  viewerApId: string,
  column: AnyColumn = objects.attributedTo,
): SQL | undefined {
  if (!viewerApId) return undefined;
  const excludedIds = activityPubActorIdentitySetSql(
    sql`
      SELECT ${blocks.blockedApId}
      FROM ${blocks}
      WHERE ${blocks.blockerApId} = ${viewerApId}
      UNION ALL
      SELECT ${mutes.mutedApId}
      FROM ${mutes}
      WHERE ${mutes.muterApId} = ${viewerApId}
    `,
  );
  return sql`${column} NOT IN (${excludedIds})`;
}
