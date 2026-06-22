import type { Database } from "../../../db/index.ts";
import { inArray } from "drizzle-orm";
import { actorCache } from "../../../db/index.ts";
import { emitMetric } from "./metrics.ts";
import {
  DELIVERY_ENDPOINT_CACHE_TTL_MS,
  safeParseIsoTimeMs,
} from "./transformers.ts";
import { isSafeRemoteUrl } from "../../federation-helpers.ts";
import { filterBlockedActorApIds } from "../blocklist.ts";

export type PlannedEndpointGroup = {
  endpoint: string;
  recipientCount: number;
};

export type PlanEndpointsResult = {
  groups: PlannedEndpointGroup[];
  unknownRecipients: string[];
  totalRecipients: number;
  sharedInboxRecipients: number;
  /**
   * Recipients dropped because the operator has blocked their actor AP-ID or
   * hostname. These receive no outbound delivery and no resolve_actor enqueue
   * (mirrors the inbound blocklist enforcement in the inbox handler).
   */
  blockedRecipients: string[];
};

type ActorCacheRow = {
  apId: string;
  inbox: string;
  sharedInbox: string | null;
  lastFetchedAt: string;
};

// Max ids per IN(...) lookup, kept well under SQLite's bound-parameter ceiling
// so a large recipient set is loaded in chunks rather than throwing.
const PLANNER_IN_CHUNK = 500;

function isActorCacheFresh(row: ActorCacheRow, nowMs: number): boolean {
  const lastFetched = safeParseIsoTimeMs(row.lastFetchedAt);
  if (lastFetched === null) return false;
  return nowMs - lastFetched < DELIVERY_ENDPOINT_CACHE_TTL_MS;
}

function chooseEndpoint(
  row: ActorCacheRow,
): { endpoint: string; usedSharedInbox: boolean } | null {
  const shared = row.sharedInbox;
  if (shared && isSafeRemoteUrl(shared)) {
    return { endpoint: shared, usedSharedInbox: true };
  }
  if (row.inbox && isSafeRemoteUrl(row.inbox)) {
    return { endpoint: row.inbox, usedSharedInbox: false };
  }
  return null;
}

export async function planEndpointsFromActorCache(
  db: Database,
  recipientActorApIds: string[],
  options?: {
    metricTags?: Record<string, string | number | boolean | null | undefined>;
  },
): Promise<PlanEndpointsResult> {
  const nowMs = Date.now();
  const totalRecipients = recipientActorApIds.length;
  if (totalRecipients === 0) {
    return {
      groups: [],
      unknownRecipients: [],
      totalRecipients: 0,
      sharedInboxRecipients: 0,
      blockedRecipients: [],
    };
  }

  // Enforce the operator blocklist on the OUTBOUND side too: drop any
  // recipient whose actor AP-ID or hostname is defederated BEFORE grouping
  // endpoints, so a blocked domain/actor never receives our posts or DMs.
  // Uses the same isActorBlocked check (which also covers the hostname
  // transitively) that the inbox handler uses inbound.
  const allowedRecipients: string[] = [];
  const blockedRecipients: string[] = [];
  // Batched blocklist filter (2 queries) instead of a serial isActorBlocked
  // per recipient (2 queries each → up to ~400 round-trips per fan-out page).
  const blockedSet = await filterBlockedActorApIds(db, recipientActorApIds);
  for (const apId of recipientActorApIds) {
    if (blockedSet.has(apId)) {
      blockedRecipients.push(apId);
    } else {
      allowedRecipients.push(apId);
    }
  }

  // After blocklist filtering, nothing left to plan.
  if (allowedRecipients.length === 0) {
    emitMetric("delivery_shared_inbox_aggregation_ratio", 0, {
      total_recipients: totalRecipients,
      shared_inbox_recipients: 0,
      endpoints: 0,
      unknown_recipients: 0,
      blocked_recipients: blockedRecipients.length,
      ...(options?.metricTags ?? {}),
    });
    return {
      groups: [],
      unknownRecipients: [],
      totalRecipients,
      sharedInboxRecipients: 0,
      blockedRecipients,
    };
  }

  // Batch-load actor_cache for the recipient set, chunked so a large fan-out
  // (a big community's whole remote audience) can't exceed SQLite's bound-
  // parameter ceiling and throw — an un-acked throw here would poison the fanout
  // queue message into an infinite retry loop.
  const rows: ActorCacheRow[] = [];
  for (let i = 0; i < allowedRecipients.length; i += PLANNER_IN_CHUNK) {
    const chunkRows = await db
      .select({
        apId: actorCache.apId,
        inbox: actorCache.inbox,
        sharedInbox: actorCache.sharedInbox,
        lastFetchedAt: actorCache.lastFetchedAt,
      })
      .from(actorCache)
      .where(
        inArray(
          actorCache.apId,
          allowedRecipients.slice(i, i + PLANNER_IN_CHUNK),
        ),
      );
    rows.push(...(chunkRows as ActorCacheRow[]));
  }

  const byApId = new Map(rows.map((r) => [r.apId, r as ActorCacheRow]));
  const unknownRecipients: string[] = [];
  const endpointCounts = new Map<string, number>();
  let sharedInboxRecipients = 0;

  for (const apId of allowedRecipients) {
    const row = byApId.get(apId);
    // Treat missing, stale, or unresolvable actors as unknown for resolve_actor jobs.
    const chosen =
      row && isActorCacheFresh(row, nowMs) ? chooseEndpoint(row) : null;
    if (!chosen) {
      unknownRecipients.push(apId);
      continue;
    }

    if (chosen.usedSharedInbox) sharedInboxRecipients++;
    endpointCounts.set(
      chosen.endpoint,
      (endpointCounts.get(chosen.endpoint) ?? 0) + 1,
    );
  }

  const groups: PlannedEndpointGroup[] = Array.from(
    endpointCounts.entries(),
  ).map(([endpoint, recipientCount]) => ({
    endpoint,
    recipientCount,
  }));

  // Observability: sharedInbox aggregation ratio.
  const ratio =
    totalRecipients > 0 ? sharedInboxRecipients / totalRecipients : 0;
  emitMetric("delivery_shared_inbox_aggregation_ratio", ratio, {
    total_recipients: totalRecipients,
    shared_inbox_recipients: sharedInboxRecipients,
    endpoints: groups.length,
    unknown_recipients: unknownRecipients.length,
    blocked_recipients: blockedRecipients.length,
    ...(options?.metricTags ?? {}),
  });

  return {
    groups,
    unknownRecipients,
    totalRecipients,
    sharedInboxRecipients,
    blockedRecipients,
  };
}
