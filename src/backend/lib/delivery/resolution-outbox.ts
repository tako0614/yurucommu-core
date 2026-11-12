import { and, asc, eq, inArray, lte, or, sql, type SQL } from "drizzle-orm";

import {
  affectedRowCount,
  deliveryResolutions,
  insertMany,
  rawBatchStatement,
  runBatch,
  type D1Statement,
  type Database,
} from "../../../db/index.ts";
import type { Env } from "../../types.ts";
import type { IQueueProducer } from "../../runtime/queue.ts";
import type { DeliveryQueueMessageV1 } from "./types.ts";
import { sha256Hex } from "./transformers.ts";

const OUTBOX_SCAN_LIMIT = 50;
const STALE_RESOLUTION_MS = 2 * 60 * 1000;
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Keep the follow-up DELETE (ids + statuses + cutoff) under D1's 100-bind cap.
const TERMINAL_PURGE_LIMIT = 50;
export const MAX_RESOLVE_ATTEMPTS = 8;

const TERMINAL_STATUSES = ["resolved", "failed", "discarded"] as const;

export type DeliveryResolutionIntent = {
  readonly activityId: string;
  readonly recipientActorApId: string;
};

export type DeliveryResolutionClaim =
  | { readonly state: "missing" }
  | { readonly state: "terminal" }
  | { readonly state: "deferred"; readonly delaySeconds: number }
  | { readonly state: "busy"; readonly delaySeconds: number }
  | {
      readonly state: "claimed";
      readonly id: string;
      readonly processingToken: string;
      readonly attempts: number;
    };

export async function computeDeliveryResolutionId(
  activityId: string,
  recipientActorApId: string,
): Promise<string> {
  return sha256Hex(`resolve_actor|${activityId}|${recipientActorApId}`);
}

export function buildResolveActorMessage(
  activityId: string,
  recipientActorApId: string,
  attempts = 0,
): DeliveryQueueMessageV1 {
  return {
    version: 1,
    type: "resolve_actor",
    activityId,
    recipientActorApId,
    ...(attempts > 0 ? { attempts } : {}),
    scheduledAt: new Date().toISOString(),
  };
}

async function materializeIntents(
  intents: readonly DeliveryResolutionIntent[],
) {
  const unique = new Map<string, DeliveryResolutionIntent>();
  for (const intent of intents) {
    unique.set(`${intent.activityId}\0${intent.recipientActorApId}`, intent);
  }
  return await Promise.all(
    [...unique.values()].map(async (intent) => ({
      id: await computeDeliveryResolutionId(
        intent.activityId,
        intent.recipientActorApId,
      ),
      ...intent,
    })),
  );
}

export type PreparedDeliveryResolutionJobs = {
  readonly rows: ReadonlyArray<
    DeliveryResolutionIntent & { readonly id: string }
  >;
  readonly statements: readonly D1Statement[];
};

/** Build durable first-hop intent inserts without executing them. */
export async function prepareDeliveryResolutionJobs(
  db: Database,
  intents: readonly DeliveryResolutionIntent[],
  // Trusted engine-only SQL over the CTE `intent`. Fence every insert/reopen,
  // not only a later cursor update in the containing atomic batch.
  options?: { readonly guard: SQL; readonly reopenTerminal: true },
): Promise<PreparedDeliveryResolutionJobs> {
  const rows = await materializeIntents(intents);
  if (rows.length === 0) return { rows, statements: [] };
  const now = new Date().toISOString();
  if (options) {
    const statements: D1Statement[] = [];
    // 15 * 3 values plus fixed claim/binding/time parameters stay below D1's
    // 100-bind limit; VALUES avoids the five-term compound SELECT ceiling.
    for (let offset = 0; offset < rows.length; offset += 15) {
      const values = rows
        .slice(offset, offset + 15)
        .map(
          (row) =>
            sql`(${row.id}, ${row.activityId}, ${row.recipientActorApId})`,
        );
      statements.push(
        rawBatchStatement(
          db,
          sql`
        WITH intent(id, activity_ap_id, recipient_actor_ap_id) AS
          (VALUES ${sql.join(values, sql`, `)})
        INSERT INTO delivery_resolutions
          (id, activity_ap_id, recipient_actor_ap_id, status, attempts,
           next_attempt_at, created_at, updated_at)
        SELECT id, activity_ap_id, recipient_actor_ap_id, 'pending', 0,
          ${now}, ${now}, ${now} FROM intent WHERE ${options.guard}
        ON CONFLICT(id) DO UPDATE SET status = 'pending', attempts = 0,
          next_attempt_at = excluded.next_attempt_at,
          processing_token = NULL, last_error = NULL, resolved_at = NULL,
          updated_at = excluded.updated_at
        WHERE delivery_resolutions.status IN ('resolved', 'failed', 'discarded')
      `,
        ),
      );
    }
    return { rows, statements };
  }
  const statements = insertMany(
    db,
    deliveryResolutions,
    rows.map((row) => ({
      id: row.id,
      activityApId: row.activityId,
      recipientActorApId: row.recipientActorApId,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })),
    { conflict: "ignore" },
  );
  return { rows, statements };
}

/** Persist intent before attempting any Queue RPC. */
export async function persistDeliveryResolutionJobs(
  db: Database,
  intents: readonly DeliveryResolutionIntent[],
): Promise<ReadonlyArray<DeliveryResolutionIntent & { readonly id: string }>> {
  const prepared = await prepareDeliveryResolutionJobs(db, intents);
  if (prepared.statements.length > 0) {
    await runBatch(
      db,
      prepared.statements as [
        (typeof prepared.statements)[number],
        ...(typeof prepared.statements)[number][],
      ],
    );
  }
  return prepared.rows;
}

async function sendRows(
  db: Database,
  queue: IQueueProducer<DeliveryQueueMessageV1>,
  rows: readonly {
    readonly id: string;
    readonly activityApId: string;
    readonly recipientActorApId: string;
    readonly attempts: number;
  }[],
  now: string,
): Promise<number> {
  if (rows.length === 0) return 0;
  await queue.sendBatch(
    rows.map((row) => ({
      body: buildResolveActorMessage(
        row.activityApId,
        row.recipientActorApId,
        row.attempts,
      ),
    })),
  );
  await db
    .update(deliveryResolutions)
    .set({ status: "queued", processingToken: null, updatedAt: now })
    .where(
      and(
        inArray(
          deliveryResolutions.id,
          rows.map((row) => row.id),
        ),
        inArray(deliveryResolutions.status, ["pending", "retry_wait"]),
      ),
    );
  return rows.length;
}

/** Publish already-committed intent without inserting or reopening authority. */
export async function publishDeliveryResolutionJobs(
  db: Database,
  queue: IQueueProducer<DeliveryQueueMessageV1> | undefined,
  ids: readonly string[],
): Promise<number> {
  if (!queue) return 0;
  const now = new Date().toISOString();
  let sent = 0;
  for (let offset = 0; offset < ids.length; offset += OUTBOX_SCAN_LIMIT) {
    const rows = await db
      .select({
        id: deliveryResolutions.id,
        activityApId: deliveryResolutions.activityApId,
        recipientActorApId: deliveryResolutions.recipientActorApId,
        attempts: deliveryResolutions.attempts,
      })
      .from(deliveryResolutions)
      .where(
        and(
          inArray(
            deliveryResolutions.id,
            ids.slice(offset, offset + OUTBOX_SCAN_LIMIT),
          ),
          inArray(deliveryResolutions.status, ["pending", "retry_wait"]),
          lte(deliveryResolutions.nextAttemptAt, now),
        ),
      );
    sent += await sendRows(db, queue, rows, now);
  }
  return sent;
}

/** Persist a bounded recipient set, then publish only currently-due rows. */
export async function enqueueDeliveryResolutionJobs(
  db: Database,
  queue: IQueueProducer<DeliveryQueueMessageV1> | undefined,
  intents: readonly DeliveryResolutionIntent[],
  options: { readonly reopenTerminal?: boolean } = {},
): Promise<number> {
  const materialized = await persistDeliveryResolutionJobs(db, intents);
  if (!queue || materialized.length === 0) return 0;
  const now = new Date().toISOString();
  let sent = 0;
  for (
    let offset = 0;
    offset < materialized.length;
    offset += OUTBOX_SCAN_LIMIT
  ) {
    const ids = materialized
      .slice(offset, offset + OUTBOX_SCAN_LIMIT)
      .map((row) => row.id);
    if (options.reopenTerminal) {
      // A 404/410 endpoint invalidation is a new resolution generation for the
      // same (Activity, actor) pair. The deterministic row may already be
      // terminal from the original successful resolution, so reactivate it
      // before publishing the replacement wakeup.
      await db
        .update(deliveryResolutions)
        .set({
          status: "pending",
          processingToken: null,
          attempts: 0,
          nextAttemptAt: now,
          lastError: null,
          updatedAt: now,
          resolvedAt: null,
        })
        .where(
          and(
            inArray(deliveryResolutions.id, ids),
            inArray(deliveryResolutions.status, [...TERMINAL_STATUSES]),
          ),
        );
    }
    const due = await db
      .select({
        id: deliveryResolutions.id,
        activityApId: deliveryResolutions.activityApId,
        recipientActorApId: deliveryResolutions.recipientActorApId,
        attempts: deliveryResolutions.attempts,
      })
      .from(deliveryResolutions)
      .where(
        and(
          inArray(deliveryResolutions.id, ids),
          inArray(deliveryResolutions.status, ["pending", "retry_wait"]),
          lte(deliveryResolutions.nextAttemptAt, now),
        ),
      );
    sent += await sendRows(db, queue, due, now);
  }
  return sent;
}

/** Recover due or stale first-hop rows. Safe after requests, queue batches, and cron. */
export async function enqueuePendingDeliveryResolutionJobs(
  env: Env,
  nowDate = new Date(),
): Promise<number> {
  const db = env.DB_INSTANCE;
  const now = nowDate.toISOString();
  await purgeTerminalDeliveryResolutionJobs(db, nowDate);
  if (!env.DELIVERY_QUEUE || !env.DELIVERY_DLQ) return 0;

  const staleBefore = new Date(
    nowDate.getTime() - STALE_RESOLUTION_MS,
  ).toISOString();
  await db
    .update(deliveryResolutions)
    .set({ status: "pending", processingToken: null, updatedAt: now })
    .where(
      and(
        inArray(deliveryResolutions.status, ["queued", "processing"]),
        lte(deliveryResolutions.updatedAt, staleBefore),
      ),
    );

  const rows = await db
    .select({
      id: deliveryResolutions.id,
      activityApId: deliveryResolutions.activityApId,
      recipientActorApId: deliveryResolutions.recipientActorApId,
      attempts: deliveryResolutions.attempts,
    })
    .from(deliveryResolutions)
    .where(
      and(
        inArray(deliveryResolutions.status, ["pending", "retry_wait"]),
        lte(deliveryResolutions.nextAttemptAt, now),
      ),
    )
    .orderBy(asc(deliveryResolutions.createdAt))
    .limit(OUTBOX_SCAN_LIMIT);
  return await sendRows(db, env.DELIVERY_QUEUE, rows, now);
}

export async function claimDeliveryResolutionJob(
  db: Database,
  activityId: string,
  recipientActorApId: string,
  nowDate = new Date(),
): Promise<DeliveryResolutionClaim> {
  const id = await computeDeliveryResolutionId(activityId, recipientActorApId);
  const row = await db
    .select({
      status: deliveryResolutions.status,
      attempts: deliveryResolutions.attempts,
      nextAttemptAt: deliveryResolutions.nextAttemptAt,
      updatedAt: deliveryResolutions.updatedAt,
    })
    .from(deliveryResolutions)
    .where(eq(deliveryResolutions.id, id))
    .get();
  if (!row) return { state: "missing" };
  if ((TERMINAL_STATUSES as readonly string[]).includes(row.status)) {
    return { state: "terminal" };
  }

  const nowMs = nowDate.getTime();
  const nextMs = Date.parse(row.nextAttemptAt);
  if (
    row.status === "retry_wait" &&
    Number.isFinite(nextMs) &&
    nextMs > nowMs
  ) {
    return {
      state: "deferred",
      delaySeconds: Math.max(1, Math.ceil((nextMs - nowMs) / 1000)),
    };
  }

  const now = nowDate.toISOString();
  const staleBefore = new Date(nowMs - STALE_RESOLUTION_MS).toISOString();
  const processingToken = crypto.randomUUID();
  const claim = await db
    .update(deliveryResolutions)
    .set({ status: "processing", processingToken, updatedAt: now })
    .where(
      and(
        eq(deliveryResolutions.id, id),
        or(
          inArray(deliveryResolutions.status, ["pending", "queued"]),
          and(
            eq(deliveryResolutions.status, "retry_wait"),
            lte(deliveryResolutions.nextAttemptAt, now),
          ),
          and(
            eq(deliveryResolutions.status, "processing"),
            lte(deliveryResolutions.updatedAt, staleBefore),
          ),
        ),
      ),
    );
  if (affectedRowCount(claim) === 0) {
    return { state: "busy", delaySeconds: 60 };
  }
  return { state: "claimed", id, processingToken, attempts: row.attempts };
}

export async function retryDeliveryResolutionJob(
  db: Database,
  claim: Extract<DeliveryResolutionClaim, { state: "claimed" }>,
  error: unknown,
  delaySeconds = 60,
): Promise<{ readonly owned: boolean; readonly terminal: boolean }> {
  const attempts = claim.attempts + 1;
  const terminal = attempts >= MAX_RESOLVE_ATTEMPTS;
  const now = new Date();
  const result = await db
    .update(deliveryResolutions)
    .set({
      status: terminal ? "failed" : "retry_wait",
      processingToken: null,
      attempts,
      nextAttemptAt: new Date(
        now.getTime() + delaySeconds * 1000,
      ).toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
      updatedAt: now.toISOString(),
      resolvedAt: terminal ? now.toISOString() : null,
    })
    .where(
      and(
        eq(deliveryResolutions.id, claim.id),
        eq(deliveryResolutions.processingToken, claim.processingToken),
      ),
    );
  return { owned: affectedRowCount(result) > 0, terminal };
}

/**
 * Release a claim after a local authority dependency fails without charging
 * the remote actor's bounded resolution-attempt budget. The durable row stays
 * retryable, while the processing token prevents an expired worker from
 * overwriting a newer claim.
 */
export async function deferDeliveryResolutionJob(
  db: Database,
  claim: Extract<DeliveryResolutionClaim, { state: "claimed" }>,
  error: unknown,
  delaySeconds = 60,
): Promise<boolean> {
  const now = new Date();
  const result = await db
    .update(deliveryResolutions)
    .set({
      status: "retry_wait",
      processingToken: null,
      nextAttemptAt: new Date(
        now.getTime() + delaySeconds * 1000,
      ).toISOString(),
      lastError: error instanceof Error ? error.message : String(error),
      updatedAt: now.toISOString(),
      resolvedAt: null,
    })
    .where(
      and(
        eq(deliveryResolutions.id, claim.id),
        eq(deliveryResolutions.processingToken, claim.processingToken),
      ),
    );
  return affectedRowCount(result) > 0;
}

export async function completeDeliveryResolutionJob(
  db: Database,
  claim: Extract<DeliveryResolutionClaim, { state: "claimed" }>,
  status: "resolved" | "discarded",
  reason?: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const result = await db
    .update(deliveryResolutions)
    .set({
      status,
      processingToken: null,
      lastError: reason ?? null,
      updatedAt: now,
      resolvedAt: now,
    })
    .where(
      and(
        eq(deliveryResolutions.id, claim.id),
        eq(deliveryResolutions.processingToken, claim.processingToken),
      ),
    );
  return affectedRowCount(result) > 0;
}

export async function purgeTerminalDeliveryResolutionJobs(
  db: Database,
  nowDate = new Date(),
): Promise<number> {
  const cutoff = new Date(
    nowDate.getTime() - TERMINAL_RETENTION_MS,
  ).toISOString();
  const rows = await db
    .select({ id: deliveryResolutions.id })
    .from(deliveryResolutions)
    .where(
      and(
        inArray(deliveryResolutions.status, [...TERMINAL_STATUSES]),
        lte(deliveryResolutions.updatedAt, cutoff),
      ),
    )
    .orderBy(asc(deliveryResolutions.updatedAt))
    .limit(TERMINAL_PURGE_LIMIT);
  if (rows.length === 0) return 0;
  const result = await db.delete(deliveryResolutions).where(
    and(
      inArray(
        deliveryResolutions.id,
        rows.map((row) => row.id),
      ),
      inArray(deliveryResolutions.status, [...TERMINAL_STATUSES]),
      lte(deliveryResolutions.updatedAt, cutoff),
    ),
  );
  return affectedRowCount(result);
}
