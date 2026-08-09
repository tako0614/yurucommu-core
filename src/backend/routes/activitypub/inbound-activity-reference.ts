import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { activities } from "../../../db/index.ts";
import { isSameActivityPubActor } from "../../lib/activitypub-actor-identity.ts";
import {
  isBoundedHttpActivityId,
  isTrustedRemoteActivityId,
} from "../../lib/remote-activity-id.ts";
import { internalInboundActivityId } from "./inbound-activity-identity.ts";

const LEGACY_REFERENCE_CANDIDATE_LIMIT = 64;

/**
 * Resolve an Activity reference controlled by a verified remote actor to the
 * canonical local ledger IRI.
 *
 * The direct path covers the local `inbound-<hash>` IRI we may have exposed as
 * a fallback. The raw-envelope path covers a normal peer wire ID, but only
 * within the signing actor and only when that actor owns the ID's exact origin.
 * Actor scoping is essential because Activity IDs are origin-owned: sibling
 * actors on one server may otherwise collide and make a legitimate Undo bind
 * to whichever row SQLite happens to return first.
 */
export async function resolveInboundActivityReference(
  db: Database,
  reference: string,
  actorApId: string,
  localBaseUrl: string,
): Promise<string | null> {
  if (!isBoundedHttpActivityId(reference)) return null;

  const direct = await db
    .select({ apId: activities.apId, actorApId: activities.actorApId })
    .from(activities)
    .where(eq(activities.apId, reference))
    .get();
  if (direct && isSameActivityPubActor(direct.actorApId, actorApId)) {
    return direct.apId;
  }

  if (!isTrustedRemoteActivityId(reference, actorApId, localBaseUrl)) {
    return null;
  }

  // Current inbound rows use this deterministic actor+source key. Resolve it
  // first so a sibling actor reusing the same public wire id can neither poison
  // the lookup nor force a scan of retained envelopes.
  const expectedInternalId = await internalInboundActivityId(
    localBaseUrl,
    actorApId,
    reference,
  );
  const retainedCurrent = await db
    .select({ apId: activities.apId, actorApId: activities.actorApId })
    .from(activities)
    .where(
      and(
        eq(activities.apId, expectedInternalId),
        eq(activities.direction, "inbound"),
      ),
    )
    .get();
  if (
    retainedCurrent &&
    isSameActivityPubActor(retainedCurrent.actorApId, actorApId)
  ) {
    return retainedCurrent.apId;
  }

  // Preserve legacy rows whose primary key predates the deterministic key.
  // Keep the common exact-spelling lookup indexed by actor first.
  const retainedExact = await db
    .select({ apId: activities.apId })
    .from(activities)
    .where(
      and(
        eq(activities.direction, "inbound"),
        eq(activities.actorApId, actorApId),
        // A corrupted/legacy raw_json row must not make the whole lookup throw.
        sql`CASE WHEN json_valid(${activities.rawJson}) THEN json_extract(${activities.rawJson}, '$.id') ELSE NULL END = ${reference}`,
      ),
    )
    .get();
  if (retainedExact) return retainedExact.apId;

  // Older rows may retain the same key owner under an accepted cosmetic actor
  // spelling. This compatibility path is deliberately bounded; current rows
  // always hit the deterministic lookup above. Compare in JS so host case is
  // insensitive without accidentally making the case-sensitive path so.
  const retainedLegacyCandidates = await db
    .select({ apId: activities.apId, actorApId: activities.actorApId })
    .from(activities)
    .where(
      and(
        eq(activities.direction, "inbound"),
        sql`CASE WHEN json_valid(${activities.rawJson}) THEN json_extract(${activities.rawJson}, '$.id') ELSE NULL END = ${reference}`,
      ),
    )
    .limit(LEGACY_REFERENCE_CANDIDATE_LIMIT)
    .all();
  return (
    retainedLegacyCandidates.find((candidate) =>
      isSameActivityPubActor(candidate.actorApId, actorApId),
    )?.apId ?? null
  );
}
