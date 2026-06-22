import { and, eq, notInArray, type SQL } from "drizzle-orm";
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
 */
export function excludeBlockedMutedAuthors(
  db: Database,
  viewerApId: string,
): SQL | undefined {
  if (!viewerApId) return undefined;
  return and(
    notInArray(
      objects.attributedTo,
      db
        .select({ id: blocks.blockedApId })
        .from(blocks)
        .where(eq(blocks.blockerApId, viewerApId)),
    ),
    notInArray(
      objects.attributedTo,
      db
        .select({ id: mutes.mutedApId })
        .from(mutes)
        .where(eq(mutes.muterApId, viewerApId)),
    ),
  );
}
