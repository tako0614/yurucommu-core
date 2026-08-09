import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { activities } from "../../../db/index.ts";
import { isSameActivityPubActor } from "../../lib/activitypub-actor-identity.ts";
import { activityPubActorIdentityMatchesSql } from "../../lib/activitypub-actor-identity-sql.ts";
import {
  isBoundedHttpActivityId,
  isTrustedRemoteActivityId,
} from "../../lib/remote-activity-id.ts";
import { internalInboundActivityId } from "./inbound-activity-identity.ts";

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
  // spelling. Search the complete candidate set in SQL: a public wire id can
  // collide across arbitrarily many same-origin sibling actors, so a fixed JS
  // prefix made the legitimate signer-dependent row unreachable. The shared
  // identity matcher keeps path case and sibling actor paths distinct while
  // using a constant parameter count.
  const retainedLegacyActors = activityPubActorIdentityMatchesSql(
    sql`
      SELECT ${activities.actorApId}
      FROM ${activities}
      WHERE ${activities.direction} = 'inbound'
        AND CASE WHEN json_valid(${activities.rawJson})
          THEN json_extract(${activities.rawJson}, '$.id')
          ELSE NULL END = ${reference}
    `,
    actorApId,
  );
  const retainedLegacy = await db
    .select({ apId: activities.apId, actorApId: activities.actorApId })
    .from(activities)
    .where(
      and(
        eq(activities.direction, "inbound"),
        sql`CASE WHEN json_valid(${activities.rawJson}) THEN json_extract(${activities.rawJson}, '$.id') ELSE NULL END = ${reference}`,
        sql`${activities.actorApId} IN (${retainedLegacyActors})`,
      ),
    )
    .limit(1)
    .get();
  return retainedLegacy?.apId ?? null;
}
