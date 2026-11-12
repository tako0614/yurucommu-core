import { and, asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import {
  affectedRowCount,
  actorCache,
  deliveryQueue,
  deliveryEndpointRecipients,
  runBatch,
  type Database,
  type D1Statement,
} from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import { isSafeRemoteUrl } from "../../federation-helpers.ts";
import { filterBlockedActorApIdsStrict } from "../blocklist.ts";
import {
  prepareDeliveryResolutionJobs,
  publishDeliveryResolutionJobs,
} from "./resolution-outbox.ts";
import { safeParseIsoTimeMs } from "./transformers.ts";
import type { DeliveryRecoverEndpointMessageV1 } from "./types.ts";

const PAGE_SIZE = 200;
const WINDOW_SIZE = 2000;
const STALE_MS = 2 * 60 * 1000;
type EndpointOwner = {
  readonly jobId: string;
  readonly activityId: string;
  readonly endpoint: string;
  readonly processingToken: string;
};

/** Only the exact selected HTTP claim may create a recovery generation. */
export async function beginEndpointRecovery(
  db: Database,
  owner: EndpointOwner,
): Promise<string | null> {
  const ownership = and(
    eq(deliveryQueue.id, owner.jobId),
    eq(deliveryQueue.activityApId, owner.activityId),
    eq(deliveryQueue.inboxUrl, owner.endpoint),
    eq(deliveryQueue.status, "processing"),
    eq(deliveryQueue.processingToken, owner.processingToken),
  );
  const now = new Date().toISOString();
  const retain = db
    .update(deliveryQueue)
    .set({
      endpointRecoveryGeneration: owner.processingToken,
      endpointRecoveryPending: 1,
      endpointRecoveryCursor: null,
      endpointRecoveryProcessingToken: null,
      endpointRecoveryProcessingStartedAt: null,
      endpointRecoveryNextAttemptAt: now,
      endpointRecoveryAttempts: 0,
      endpointRecoveryError: null,
    })
    .where(
      and(
        ownership,
        eq(deliveryQueue.endpointRecoveryPending, 0),
        sql`${deliveryQueue.endpointRecoveryGeneration} IS NOT ${owner.processingToken}`,
      ),
    );
  // Invalidate cached endpoints in the same commit as the repair marker,
  // before any resolution wakeup can race it. A page/Queue outage must not
  // leave resumed work using the known-bad but apparently fresh endpoint.
  const ownsHttpClaim = sql`EXISTS (SELECT 1 FROM delivery_queue WHERE ${ownership})`;
  await runBatch(db, [
    retain as unknown as D1Statement,
    db
      .update(actorCache)
      .set({ sharedInbox: null, lastFetchedAt: "1970-01-01T00:00:00.000Z" })
      .where(
        and(eq(actorCache.sharedInbox, owner.endpoint), ownsHttpClaim),
      ) as unknown as D1Statement,
    db
      .update(actorCache)
      .set({ lastFetchedAt: "1970-01-01T00:00:00.000Z" })
      .where(
        and(eq(actorCache.inbox, owner.endpoint), ownsHttpClaim),
      ) as unknown as D1Statement,
  ]);
  // A later HTTP attempt must join pending work instead of resetting its cursor.
  const row = await db
    .select({ generation: deliveryQueue.endpointRecoveryGeneration })
    .from(deliveryQueue)
    .where(and(ownership, eq(deliveryQueue.endpointRecoveryPending, 1)))
    .get();
  return row?.generation ?? null;
}

export function buildEndpointRecoveryMessage(
  jobId: string,
  generation: string,
): DeliveryRecoverEndpointMessageV1 {
  return {
    version: 1,
    type: "recover_endpoint",
    jobId,
    generation,
    scheduledAt: new Date().toISOString(),
  };
}

/** Queue signals are hints. Pending authority is consumed only by a DB page. */
export async function enqueuePendingEndpointRecoveries(
  env: Env,
  nowDate = new Date(),
): Promise<number> {
  if (!env.DELIVERY_QUEUE) return 0;
  const rows = await env.DB_INSTANCE.select({
    id: deliveryQueue.id,
    generation: deliveryQueue.endpointRecoveryGeneration,
    next: deliveryQueue.endpointRecoveryNextAttemptAt,
    token: deliveryQueue.endpointRecoveryProcessingToken,
    started: deliveryQueue.endpointRecoveryProcessingStartedAt,
  })
    .from(deliveryQueue)
    .where(
      and(
        eq(deliveryQueue.endpointRecoveryPending, 1),
        sql`julianday(${deliveryQueue.endpointRecoveryNextAttemptAt}) <= julianday(${nowDate.toISOString()})`,
        sql`(${deliveryQueue.endpointRecoveryProcessingToken} IS NULL OR
      julianday(${deliveryQueue.endpointRecoveryProcessingStartedAt}) <= julianday(${new Date(nowDate.getTime() - STALE_MS).toISOString()}))`,
      ),
    )
    .orderBy(
      asc(deliveryQueue.endpointRecoveryNextAttemptAt),
      asc(deliveryQueue.id),
    )
    .limit(50);
  const due = rows.filter(
    (row) =>
      row.generation &&
      safeParseIsoTimeMs(row.next) !== null &&
      (!row.token ||
        (safeParseIsoTimeMs(row.started) !== null &&
          nowDate.getTime() - safeParseIsoTimeMs(row.started)! >= STALE_MS)),
  );
  if (due.length)
    await env.DELIVERY_QUEUE.sendBatch(
      due.map((row) => ({
        body: buildEndpointRecoveryMessage(row.id, row.generation!),
      })),
    );
  return due.length;
}

/** A bounded window; each page commits first-hop rows and its cursor together. */
export async function continueEndpointRecovery(
  db: Database,
  env: Env,
  msg: DeliveryRecoverEndpointMessageV1,
): Promise<number> {
  const job = await db
    .select()
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, msg.jobId))
    .get();
  if (
    !job ||
    job.endpointRecoveryPending !== 1 ||
    job.endpointRecoveryGeneration !== msg.generation
  )
    return 0;
  const now = Date.now();
  const due = safeParseIsoTimeMs(job.endpointRecoveryNextAttemptAt);
  if (due === null || due > now) return 0;
  if (job.endpointRecoveryProcessingToken) {
    const started = safeParseIsoTimeMs(job.endpointRecoveryProcessingStartedAt);
    if (started === null || now - started < STALE_MS) return 0;
  }
  const token = crypto.randomUUID();
  const fence = (cursor: string | null): SQL =>
    and(
      eq(deliveryQueue.id, job.id),
      eq(deliveryQueue.endpointRecoveryGeneration, msg.generation),
      eq(deliveryQueue.endpointRecoveryPending, 1),
      eq(deliveryQueue.endpointRecoveryProcessingToken, token),
      sql`${deliveryQueue.endpointRecoveryCursor} IS ${cursor}`,
      eq(deliveryQueue.activityApId, job.activityApId),
      eq(deliveryQueue.inboxUrl, job.inboxUrl),
    )!;
  const claimed = await db
    .update(deliveryQueue)
    .set({
      endpointRecoveryProcessingToken: token,
      endpointRecoveryProcessingStartedAt: new Date(now).toISOString(),
    })
    .where(
      and(
        eq(deliveryQueue.id, job.id),
        eq(deliveryQueue.endpointRecoveryGeneration, msg.generation),
        eq(deliveryQueue.endpointRecoveryPending, 1),
        sql`${deliveryQueue.endpointRecoveryCursor} IS ${job.endpointRecoveryCursor}`,
        job.endpointRecoveryProcessingToken === null
          ? isNull(deliveryQueue.endpointRecoveryProcessingToken)
          : eq(
              deliveryQueue.endpointRecoveryProcessingToken,
              job.endpointRecoveryProcessingToken,
            ),
      ),
    );
  if (!affectedRowCount(claimed)) return 0;
  let cursor = job.endpointRecoveryCursor;
  let scanned = 0,
    persisted = 0;
  try {
    while (scanned < WINDOW_SIZE) {
      const page = await db
        .selectDistinct({ apId: deliveryEndpointRecipients.recipientActorApId })
        .from(deliveryEndpointRecipients)
        .innerJoin(
          deliveryQueue,
          eq(deliveryQueue.id, deliveryEndpointRecipients.deliveryJobId),
        )
        .where(
          and(
            eq(deliveryQueue.activityApId, job.activityApId),
            eq(deliveryQueue.inboxUrl, job.inboxUrl),
            cursor === null
              ? undefined
              : sql`${deliveryEndpointRecipients.recipientActorApId} > ${cursor}`,
          ),
        )
        .orderBy(deliveryEndpointRecipients.recipientActorApId)
        .limit(PAGE_SIZE);
      const candidates = page.map((row) => row.apId).filter(isSafeRemoteUrl);
      // Unavailable policy is retryable: do not consume the page/cursor.
      const blocked = await filterBlockedActorApIdsStrict(db, candidates);
      const allowed = candidates.filter((id) => !blocked.has(id));
      const guard = sql`EXISTS (SELECT 1 FROM delivery_queue WHERE ${fence(cursor)})
        AND EXISTS (SELECT 1 FROM activities WHERE ap_id = intent.activity_ap_id)
        AND NOT EXISTS (SELECT 1 FROM remote_actor_tombstones WHERE actor_ap_id = intent.recipient_actor_ap_id)
        AND EXISTS (SELECT 1 FROM delivery_endpoint_recipients r
          JOIN delivery_queue j ON j.id = r.delivery_job_id
          WHERE j.activity_ap_id = intent.activity_ap_id AND j.inbox_url = ${job.inboxUrl}
            AND r.recipient_actor_ap_id = intent.recipient_actor_ap_id)`;
      const prepared = await prepareDeliveryResolutionJobs(
        db,
        allowed.map((recipientActorApId) => ({
          activityId: job.activityApId,
          recipientActorApId,
        })),
        { guard, reopenTerminal: true },
      );
      const next = page.at(-1)?.apId ?? cursor;
      const complete = page.length < PAGE_SIZE;
      const advance = db
        .update(deliveryQueue)
        .set({
          endpointRecoveryCursor: next,
          endpointRecoveryPending: complete ? 0 : 1,
          endpointRecoveryError: null,
        })
        .where(fence(cursor))
        .returning({ id: deliveryQueue.id });
      // Keep every statement conditional. Losing ownership is not a partial
      // success: neither old intents nor a new cursor may escape this batch.
      await runBatch(db, [
        ...prepared.statements,
        advance as unknown as D1Statement,
      ] as unknown as [D1Statement, ...D1Statement[]]);
      const owned = await db
        .select({ id: deliveryQueue.id })
        .from(deliveryQueue)
        .where(
          and(
            eq(deliveryQueue.id, job.id),
            eq(deliveryQueue.endpointRecoveryGeneration, msg.generation),
            eq(deliveryQueue.endpointRecoveryProcessingToken, token),
            sql`${deliveryQueue.endpointRecoveryCursor} IS ${next}`,
          ),
        )
        .get();
      if (!owned) return persisted;
      cursor = next;
      scanned += page.length;
      persisted += allowed.length;
      // This never inserts/reopens rows. Failure leaves the committed outbox
      // and continuation available to their independent sweeps.
      await publishDeliveryResolutionJobs(
        db,
        env.DELIVERY_QUEUE,
        prepared.rows.map((row) => row.id),
      );
      if (complete) break;
    }
    await db
      .update(deliveryQueue)
      .set({
        endpointRecoveryProcessingToken: null,
        endpointRecoveryProcessingStartedAt: null,
        endpointRecoveryNextAttemptAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(deliveryQueue.id, job.id),
          eq(deliveryQueue.endpointRecoveryGeneration, msg.generation),
          eq(deliveryQueue.endpointRecoveryProcessingToken, token),
        ),
      );
  } catch (error) {
    await db
      .update(deliveryQueue)
      .set({
        endpointRecoveryProcessingToken: null,
        endpointRecoveryProcessingStartedAt: null,
        endpointRecoveryNextAttemptAt: new Date(
          Date.now() + 60_000,
        ).toISOString(),
        endpointRecoveryAttempts: sql`${deliveryQueue.endpointRecoveryAttempts} + 1`,
        endpointRecoveryError: "endpoint_recovery_dependency_unavailable",
      })
      .where(
        and(
          eq(deliveryQueue.id, job.id),
          eq(deliveryQueue.endpointRecoveryGeneration, msg.generation),
          eq(deliveryQueue.endpointRecoveryProcessingToken, token),
        ),
      );
    throw error;
  }
  return persisted;
}
