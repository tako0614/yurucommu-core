import { and, type AnyColumn, eq, notInArray, type SQL } from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import { blocks, mutes, objects } from "../../db/index.ts";

/**
 * Predicate excluding posts authored by anyone the viewer has blocked or muted.
 *
 * Expressed as `objects.attributed_to NOT IN (SELECT blocked) AND ... NOT IN
 * (SELECT muted)` — i.e. `NOT IN (blocked ∪ muted)` — using db.select
 * SUBQUERIES rather than materialising the id lists into an `inArray`. Each
 * subquery binds a single bound parameter (the viewer) regardless of how many
 * accounts the viewer has blocked/muted, so it never approaches Cloudflare D1's
 * 100-bound-parameter-per-query ceiling. (The previous `notInArray(attributedTo,
 * [...blocked, ...muted])` materialised up to ~2000 ids — fine on the libsql the
 * tests run on, but a "too many SQL variables" 500 on production D1 for a heavy
 * moderator.)
 *
 * Returns `undefined` for an empty viewer (anonymous) so callers can skip it.
 * Applying it unconditionally for a logged-in viewer is correct even with zero
 * blocks/mutes: `NOT IN (empty set)` is true for every row.
 *
 * `column` defaults to the post author (`objects.attributedTo`) for feeds, but
 * can be any actor-id column — e.g. `activities.actorApId` so the notifications
 * list/count can suppress activity from blocked/muted accounts the same way.
 */
export function excludeBlockedMutedAuthors(
  db: Database,
  viewerApId: string,
  column: AnyColumn = objects.attributedTo,
): SQL | undefined {
  if (!viewerApId) return undefined;
  return and(
    notInArray(
      column,
      db
        .select({ id: blocks.blockedApId })
        .from(blocks)
        .where(eq(blocks.blockerApId, viewerApId)),
    ),
    notInArray(
      column,
      db
        .select({ id: mutes.mutedApId })
        .from(mutes)
        .where(eq(mutes.muterApId, viewerApId)),
    ),
  );
}
