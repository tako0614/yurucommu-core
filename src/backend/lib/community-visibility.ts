/**
 * Shared community read-gate helper.
 *
 * Community-scoped Notes are stored with `visibility = "public"` (so the normal
 * public/followers/direct visibility checks treat them as openly readable) but
 * carry a non-empty `audienceJson = [communityApId]`. That non-empty audience is
 * what keeps them out of the public / home / following feeds (which filter on
 * `audienceJson = "[]"`).
 *
 * For a PRIVATE community this is not enough: a single-object fetch (GET a post,
 * a reply, or an `/ap/objects/:id`) bypasses the audience filter entirely, so a
 * "public"-visibility community post would leak to any caller. This module
 * centralizes the membership gate those single-object paths must apply on top of
 * the normal visibility check.
 *
 * Membership model: `community_members` has no status column — the presence of a
 * row IS the acceptance (this mirrors `resolveCommunityRead` in routes/timeline.ts).
 * A private community is readable only by an actor with a `community_members` row.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/index.ts";
import { communities, communityMembers } from "../../db/index.ts";
import { objects } from "../../db/index.ts";
import { safeJsonParse } from "../federation-helpers.ts";
import { chunkForInClause } from "./chunk.ts";

/**
 * Drizzle predicate that matches only objects with NO extra audience (i.e. not
 * community-scoped and not otherwise addressed). Anonymous LIST queries should
 * AND this in so community / addressed posts never appear in a public feed.
 *
 * This is exactly `eq(objects.audienceJson, "[]")`; exported as a named constant
 * so every list query references the same canonical condition.
 */
export const NO_AUDIENCE_PREDICATE = eq(objects.audienceJson, "[]");

/** Minimal object shape needed to evaluate the community read-gate. */
export type CommunityGateObject = {
  audienceJson?: string | null;
  communityApId?: string | null;
};

/**
 * True when the object is addressed to a community (or otherwise carries a
 * non-empty audience). Community-scoped Notes set `audienceJson = [communityApId]`.
 */
export function isAddressedToCommunity(obj: CommunityGateObject): boolean {
  const audience = safeJsonParse<unknown[]>(obj.audienceJson ?? "[]", []);
  return Array.isArray(audience) && audience.length > 0;
}

/**
 * Extract the community AP IDs an object is addressed to. Prefers the explicit
 * `communityApId` column when present, otherwise reads them out of `audienceJson`.
 */
function communityApIdsFor(obj: CommunityGateObject): string[] {
  const ids = new Set<string>();
  if (obj.communityApId) ids.add(obj.communityApId);
  const audience = safeJsonParse<unknown[]>(obj.audienceJson ?? "[]", []);
  if (Array.isArray(audience)) {
    for (const entry of audience) {
      if (typeof entry === "string" && entry.length > 0) ids.add(entry);
    }
  }
  return [...ids];
}

/**
 * Single-object community read-gate.
 *
 * If `obj` is addressed to a community whose `visibility` is "private", this
 * returns `true` only when `viewerApId` is an accepted member (a row in
 * `community_members`) of that community; otherwise it returns `true` and leaves
 * the normal public/followers/direct visibility check to the caller.
 *
 * An anonymous viewer (`viewerApId` null/undefined) against a private community
 * always returns `false`. This NEVER widens access: a non-community or
 * public-community object short-circuits to `true` and is still subject to the
 * caller's existing visibility gate.
 */
export async function canViewerReadObject(
  db: Database,
  obj: CommunityGateObject,
  viewerApId: string | null | undefined,
): Promise<boolean> {
  const communityIds = communityApIdsFor(obj);
  if (communityIds.length === 0) return true;

  // Only PRIVATE communities gate single-object reads. Resolve which (if any)
  // of the addressed communities are private in one batched query.
  const privateRows = await db
    .select({ apId: communities.apId })
    .from(communities)
    .where(
      and(
        inArray(communities.apId, communityIds),
        eq(communities.visibility, "private"),
      ),
    );

  if (privateRows.length === 0) return true;

  // Addressed to at least one private community: an anonymous viewer can never
  // satisfy membership, so fail closed.
  if (!viewerApId) return false;

  const privateApIds = privateRows.map((r) => r.apId);
  const membership = await db
    .select({ communityApId: communityMembers.communityApId })
    .from(communityMembers)
    .where(
      and(
        inArray(communityMembers.communityApId, privateApIds),
        eq(communityMembers.actorApId, viewerApId),
      ),
    )
    .limit(1)
    .get();

  return Boolean(membership);
}

/**
 * Batched equivalent of {@link canViewerReadObject} for a whole page of objects.
 *
 * Returns the set of `apId`s that PASS the community read-gate, in TWO queries
 * total (private-community lookup + viewer-membership lookup) instead of the
 * 1-2 queries PER object the per-row form costs. The per-object semantics are
 * identical: an object passes unless it is addressed to a private community the
 * viewer is not a member of (an anonymous viewer never satisfies a private
 * community). Objects with no community audience always pass.
 *
 * Both IN(...) lookups are chunked to stay under D1's 100-bound-parameter cap,
 * since a page can address up to ~90 distinct communities.
 */
export async function communityReadableApIds<
  T extends CommunityGateObject & { apId: string },
>(
  db: Database,
  objs: T[],
  viewerApId: string | null | undefined,
): Promise<Set<string>> {
  const readable = new Set<string>();
  const perObjectCommunityIds = new Map<string, string[]>();
  const unionIds = new Set<string>();
  for (const o of objs) {
    const ids = communityApIdsFor(o);
    perObjectCommunityIds.set(o.apId, ids);
    for (const id of ids) unionIds.add(id);
  }

  // No object is community-addressed → every object passes the gate.
  if (unionIds.size === 0) {
    for (const o of objs) readable.add(o.apId);
    return readable;
  }

  // Which addressed communities are private? (only private communities gate)
  const privateSet = new Set<string>();
  for (const chunk of chunkForInClause([...unionIds])) {
    const rows = await db
      .select({ apId: communities.apId })
      .from(communities)
      .where(
        and(
          inArray(communities.apId, chunk),
          eq(communities.visibility, "private"),
        ),
      );
    for (const r of rows) privateSet.add(r.apId);
  }

  // Which of those private communities is the viewer a member of?
  const viewerMemberSet = new Set<string>();
  if (viewerApId && privateSet.size > 0) {
    for (const chunk of chunkForInClause([...privateSet])) {
      const rows = await db
        .select({ communityApId: communityMembers.communityApId })
        .from(communityMembers)
        .where(
          and(
            inArray(communityMembers.communityApId, chunk),
            eq(communityMembers.actorApId, viewerApId),
          ),
        );
      for (const r of rows) viewerMemberSet.add(r.communityApId);
    }
  }

  for (const o of objs) {
    const privateForObj = (perObjectCommunityIds.get(o.apId) ?? []).filter(
      (id) => privateSet.has(id),
    );
    if (privateForObj.length === 0) {
      readable.add(o.apId); // not addressed to any private community
    } else if (privateForObj.some((id) => viewerMemberSet.has(id))) {
      readable.add(o.apId); // member of at least one of its private communities
    }
    // else: addressed to a private community the viewer is not in → excluded.
  }
  return readable;
}
