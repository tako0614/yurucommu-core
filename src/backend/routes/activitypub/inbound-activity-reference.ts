import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../../../db/index.ts";
import { activities } from "../../../db/index.ts";
import {
  isBoundedHttpActivityId,
  isTrustedRemoteActivityId,
} from "../../lib/remote-activity-id.ts";

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
    .select({ apId: activities.apId })
    .from(activities)
    .where(
      and(eq(activities.apId, reference), eq(activities.actorApId, actorApId)),
    )
    .get();
  if (direct) return direct.apId;

  if (!isTrustedRemoteActivityId(reference, actorApId, localBaseUrl)) {
    return null;
  }
  const retained = await db
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
  return retained?.apId ?? null;
}
