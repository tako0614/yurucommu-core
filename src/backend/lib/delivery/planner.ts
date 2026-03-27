import type { Database } from '../../../db';
import { inArray } from 'drizzle-orm';
import { actorCache } from '../../../db';
import { emitMetric } from './metrics';
import { DELIVERY_ENDPOINT_CACHE_TTL_MS, safeParseIsoTimeMs } from './transformers';
import { isSafeRemoteUrl } from '../../federation-helpers';

export type PlannedEndpointGroup = {
  endpoint: string;
  recipientCount: number;
};

export type PlanEndpointsResult = {
  groups: PlannedEndpointGroup[];
  unknownRecipients: string[];
  totalRecipients: number;
  sharedInboxRecipients: number;
};

type ActorCacheRow = {
  apId: string;
  inbox: string;
  sharedInbox: string | null;
  lastFetchedAt: string;
};

function isActorCacheFresh(row: ActorCacheRow, nowMs: number): boolean {
  const lastFetched = safeParseIsoTimeMs(row.lastFetchedAt);
  if (lastFetched === null) return false;
  return nowMs - lastFetched < DELIVERY_ENDPOINT_CACHE_TTL_MS;
}

function chooseEndpoint(row: ActorCacheRow): { endpoint: string; usedSharedInbox: boolean } | null {
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
  }
): Promise<PlanEndpointsResult> {
  const nowMs = Date.now();
  const totalRecipients = recipientActorApIds.length;
  if (totalRecipients === 0) {
    return { groups: [], unknownRecipients: [], totalRecipients: 0, sharedInboxRecipients: 0 };
  }

  // Batch-load actor_cache for recipient set.
  const rows = await db.select({
    apId: actorCache.apId,
    inbox: actorCache.inbox,
    sharedInbox: actorCache.sharedInbox,
    lastFetchedAt: actorCache.lastFetchedAt,
  })
    .from(actorCache)
    .where(inArray(actorCache.apId, recipientActorApIds));

  const byApId = new Map(rows.map((r) => [r.apId, r as ActorCacheRow]));
  const unknownRecipients: string[] = [];
  const endpointCounts = new Map<string, number>();
  let sharedInboxRecipients = 0;

  for (const apId of recipientActorApIds) {
    const row = byApId.get(apId);
    // Treat missing, stale, or unresolvable actors as unknown for resolve_actor jobs.
    const chosen = row && isActorCacheFresh(row, nowMs) ? chooseEndpoint(row) : null;
    if (!chosen) {
      unknownRecipients.push(apId);
      continue;
    }

    if (chosen.usedSharedInbox) sharedInboxRecipients++;
    endpointCounts.set(chosen.endpoint, (endpointCounts.get(chosen.endpoint) ?? 0) + 1);
  }

  const groups: PlannedEndpointGroup[] = Array.from(endpointCounts.entries()).map(([endpoint, recipientCount]) => ({
    endpoint,
    recipientCount,
  }));

  // Observability: sharedInbox aggregation ratio.
  const ratio = totalRecipients > 0 ? sharedInboxRecipients / totalRecipients : 0;
  emitMetric('delivery_shared_inbox_aggregation_ratio', ratio, {
    total_recipients: totalRecipients,
    shared_inbox_recipients: sharedInboxRecipients,
    endpoints: groups.length,
    unknown_recipients: unknownRecipients.length,
    ...(options?.metricTags ?? {}),
  });

  return { groups, unknownRecipients, totalRecipients, sharedInboxRecipients };
}
