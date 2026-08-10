import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";

import {
  affectedRowCount,
  deliveryFanouts,
  type Database,
  type D1Statement,
} from "../../../db/index.ts";
import type { IQueueProducer } from "../../runtime/queue.ts";
import type { Env } from "../../types.ts";
import type {
  DeliveryFanoutCommunityMessageV1,
  DeliveryFanoutFollowersMessageV1,
  DeliveryQueueMessageV1,
} from "./types.ts";
import { sha256Hex } from "./transformers.ts";

const OUTBOX_SCAN_LIMIT = 50;
const TERMINAL_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const TERMINAL_PURGE_LIMIT = 50;
const TERMINAL_STATUSES = ["completed", "failed", "discarded"] as const;

export type DeliveryFanoutIntent =
  | {
      readonly kind: "followers";
      readonly activityId: string;
      readonly targetApId: string;
    }
  | {
      readonly kind: "community";
      readonly activityId: string;
      readonly targetApId: string;
      readonly announceActivityId?: string;
    };

export type DeliveryFanoutState = "missing" | "active" | "terminal";

export function deliveryFanoutIntentFromMessage(
  message: DeliveryFanoutFollowersMessageV1 | DeliveryFanoutCommunityMessageV1,
): DeliveryFanoutIntent {
  if (message.type === "fanout_followers") {
    return {
      kind: "followers",
      activityId: message.activityId,
      targetApId: message.followeeApId,
    };
  }
  return {
    kind: "community",
    activityId: message.activityId,
    targetApId: message.communityApId,
    ...(message.announceActivityId
      ? { announceActivityId: message.announceActivityId }
      : {}),
  };
}

export async function computeDeliveryFanoutId(
  intent: DeliveryFanoutIntent,
): Promise<string> {
  return await sha256Hex(
    [
      "fanout",
      intent.kind,
      intent.activityId,
      intent.targetApId,
      intent.kind === "community" ? (intent.announceActivityId ?? "") : "",
    ].join("|"),
  );
}

function buildFanoutMessage(row: {
  readonly activityApId: string;
  readonly kind: string;
  readonly targetApId: string;
  readonly announceActivityApId: string | null;
}): DeliveryFanoutFollowersMessageV1 | DeliveryFanoutCommunityMessageV1 {
  const scheduledAt = new Date().toISOString();
  if (row.kind === "followers") {
    return {
      version: 1,
      type: "fanout_followers",
      activityId: row.activityApId,
      followeeApId: row.targetApId,
      scheduledAt,
    };
  }
  if (row.kind === "community") {
    return {
      version: 1,
      type: "fanout_community",
      activityId: row.activityApId,
      communityApId: row.targetApId,
      ...(row.announceActivityApId
        ? { announceActivityId: row.announceActivityApId }
        : {}),
      scheduledAt,
    };
  }
  throw new Error(`Unsupported delivery fanout kind: ${row.kind}`);
}

/**
 * Build the deterministic fanout-ledger insert without executing it. Writers
 * that commit the Activity and its local state can compose this statement into
 * the same D1 batch, closing the crash window before the durable intent exists.
 */
export async function prepareDeliveryFanoutJob(
  db: Database,
  intent: DeliveryFanoutIntent,
): Promise<{ readonly id: string; readonly statement: D1Statement }> {
  const id = await computeDeliveryFanoutId(intent);
  const now = new Date().toISOString();
  const statement = db
    .insert(deliveryFanouts)
    .values({
      id,
      activityApId: intent.activityId,
      kind: intent.kind,
      targetApId: intent.targetApId,
      announceActivityApId:
        intent.kind === "community"
          ? (intent.announceActivityId ?? null)
          : null,
      status: "pending",
      publications: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing() as unknown as D1Statement;
  return { id, statement };
}

/** Persist the semantic fanout intent before attempting any Queue RPC. */
export async function persistDeliveryFanoutJob(
  db: Database,
  intent: DeliveryFanoutIntent,
): Promise<string> {
  const prepared = await prepareDeliveryFanoutJob(db, intent);
  await prepared.statement;
  return prepared.id;
}

async function publishRows(
  db: Database,
  queue: IQueueProducer<DeliveryQueueMessageV1>,
  rows: readonly {
    readonly id: string;
    readonly activityApId: string;
    readonly kind: string;
    readonly targetApId: string;
    readonly announceActivityApId: string | null;
  }[],
): Promise<number> {
  if (rows.length === 0) return 0;
  await queue.sendBatch(rows.map((row) => ({ body: buildFanoutMessage(row) })));
  await markRowsPublished(
    db,
    rows.map((row) => row.id),
  );
  return rows.length;
}

async function markRowsPublished(
  db: Database,
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  await db
    .update(deliveryFanouts)
    .set({
      status: "published",
      publications: sql`${deliveryFanouts.publications} + 1`,
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        inArray(deliveryFanouts.id, [...ids]),
        inArray(deliveryFanouts.status, ["pending", "published"]),
      ),
    );
}

/** Persist one initial fanout intent and publish its wakeup when configured. */
export async function enqueueDeliveryFanoutJob(
  db: Database,
  queue: IQueueProducer<DeliveryQueueMessageV1> | undefined,
  intent: DeliveryFanoutIntent,
): Promise<number> {
  const id = await persistDeliveryFanoutJob(db, intent);
  if (!queue) return 0;
  const row = await db
    .select({
      id: deliveryFanouts.id,
      activityApId: deliveryFanouts.activityApId,
      kind: deliveryFanouts.kind,
      targetApId: deliveryFanouts.targetApId,
      announceActivityApId: deliveryFanouts.announceActivityApId,
    })
    .from(deliveryFanouts)
    .where(
      and(eq(deliveryFanouts.id, id), eq(deliveryFanouts.status, "pending")),
    )
    .get();
  if (!row) return 0;
  // Preserve the original public producer behavior for the request path: one
  // semantic fanout is one Queue send. Recovery uses bounded sendBatch below.
  await queue.send(buildFanoutMessage(row));
  await markRowsPublished(db, [row.id]);
  return 1;
}

/** Recover pending fanout wakeups; Bun startup may also replay published rows. */
export async function enqueuePendingDeliveryFanoutJobs(
  env: Env,
  options: { readonly includePublished?: boolean } = {},
): Promise<number> {
  await purgeTerminalDeliveryFanoutJobs(env.DB_INSTANCE);
  if (!env.DELIVERY_QUEUE || !env.DELIVERY_DLQ) return 0;
  const statuses = options.includePublished
    ? ["pending", "published"]
    : ["pending"];
  const rows = await env.DB_INSTANCE.select({
    id: deliveryFanouts.id,
    activityApId: deliveryFanouts.activityApId,
    kind: deliveryFanouts.kind,
    targetApId: deliveryFanouts.targetApId,
    announceActivityApId: deliveryFanouts.announceActivityApId,
  })
    .from(deliveryFanouts)
    .where(inArray(deliveryFanouts.status, statuses))
    .orderBy(asc(deliveryFanouts.createdAt))
    .limit(OUTBOX_SCAN_LIMIT);
  return await publishRows(env.DB_INSTANCE, env.DELIVERY_QUEUE, rows);
}

export async function getDeliveryFanoutState(
  db: Database,
  intent: DeliveryFanoutIntent,
): Promise<DeliveryFanoutState> {
  const id = await computeDeliveryFanoutId(intent);
  const row = await db
    .select({ status: deliveryFanouts.status })
    .from(deliveryFanouts)
    .where(eq(deliveryFanouts.id, id))
    .get();
  if (!row) return "missing";
  return (TERMINAL_STATUSES as readonly string[]).includes(row.status)
    ? "terminal"
    : "active";
}

async function setDeliveryFanoutStatus(
  db: Database,
  intent: DeliveryFanoutIntent,
  status: "pending" | "completed" | "failed" | "discarded",
  reason?: string,
): Promise<boolean> {
  const id = await computeDeliveryFanoutId(intent);
  const terminal = status !== "pending";
  const now = new Date().toISOString();
  const result = await db
    .update(deliveryFanouts)
    .set({
      status,
      lastError: reason ?? null,
      updatedAt: now,
      completedAt: terminal ? now : null,
    })
    .where(
      and(
        eq(deliveryFanouts.id, id),
        inArray(deliveryFanouts.status, ["pending", "published"]),
      ),
    );
  return affectedRowCount(result) > 0;
}

export async function resetDeliveryFanoutJob(
  db: Database,
  intent: DeliveryFanoutIntent,
  reason?: string,
): Promise<boolean> {
  return await setDeliveryFanoutStatus(db, intent, "pending", reason);
}

export async function completeDeliveryFanoutJob(
  db: Database,
  intent: DeliveryFanoutIntent,
  status: "completed" | "discarded" = "completed",
  reason?: string,
): Promise<boolean> {
  return await setDeliveryFanoutStatus(db, intent, status, reason);
}

export async function failDeliveryFanoutJob(
  db: Database,
  intent: DeliveryFanoutIntent,
  reason: string,
): Promise<boolean> {
  return await setDeliveryFanoutStatus(db, intent, "failed", reason);
}

export async function purgeTerminalDeliveryFanoutJobs(
  db: Database,
  nowDate = new Date(),
): Promise<number> {
  const cutoff = new Date(
    nowDate.getTime() - TERMINAL_RETENTION_MS,
  ).toISOString();
  const rows = await db
    .select({ id: deliveryFanouts.id })
    .from(deliveryFanouts)
    .where(
      and(
        inArray(deliveryFanouts.status, [...TERMINAL_STATUSES]),
        lte(deliveryFanouts.updatedAt, cutoff),
      ),
    )
    .orderBy(asc(deliveryFanouts.updatedAt))
    .limit(TERMINAL_PURGE_LIMIT);
  if (rows.length === 0) return 0;
  const result = await db.delete(deliveryFanouts).where(
    and(
      inArray(
        deliveryFanouts.id,
        rows.map((row) => row.id),
      ),
      inArray(deliveryFanouts.status, [...TERMINAL_STATUSES]),
      lte(deliveryFanouts.updatedAt, cutoff),
    ),
  );
  return affectedRowCount(result);
}
