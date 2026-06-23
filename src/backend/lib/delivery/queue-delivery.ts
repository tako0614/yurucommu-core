/**
 * Delivery endpoint processing - handles the actual HTTP delivery of ActivityPub activities.
 * Includes signing, circuit breaker checks, retry logic, and dead-letter handling.
 */

import type { Message } from "@cloudflare/workers-types";
import type { Env } from "../../types.ts";
import type { Database } from "../../../db/index.ts";
import { and, eq, lt, notInArray, or, sql } from "drizzle-orm";
import {
  activities,
  actorCache,
  actors,
  communities,
  deliveryQueue,
  instanceActor,
} from "../../../db/index.ts";
import {
  fetchWithTimeout,
  isSafeRemoteUrl,
  signRequest,
} from "../../federation-helpers.ts";
import { emitMetric } from "./metrics.ts";
import { logger } from "../logger.ts";
import {
  checkCircuit,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "./circuit.ts";

const log = logger.child({ component: "delivery.queue" });
import {
  type DeliveryDeliverEndpointMessageV1,
  type DeliveryQueueMessageV1,
} from "./types.ts";
import {
  computeRetryDelaySeconds,
  DELIVERY_MAX_ATTEMPTS,
  safeEndpointHost,
  safeParseIsoTimeMs,
} from "./transformers.ts";
import {
  buildDeliverEndpointMessage,
  type Bulkhead,
  enqueueResolveForEndpointActors,
  nowIso,
  type QueueEnv,
  requireQueue,
  sendDlqMessage,
  sendQueueMessage,
} from "./queue.ts";

const DELIVERY_HTTP_TIMEOUT_MS = 8000;
const STALE_PROCESSING_MS = 2 * 60 * 1000;
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

// 4xx statuses that are RETRYABLE rather than permanent (see isPermanentDeliveryFailure):
//   429 Too Many Requests, 408 Request Timeout, 425 Too Early.
//   401 Unauthorized: in secure-mode / authorized-fetch this is the remote FAILING
//     to verify our HTTP signature, which is frequently TRANSIENT — it recovers
//     once the remote (re-)fetches our actor #main-key (our origin was briefly
//     down, mid key-rotation, the remote's key cache raced) or a brief Date/clock
//     skew passes. A job is keyed by the SHARED INBOX endpoint, so treating this
//     as permanent black-holed the activity for EVERY co-tenant recipient.
//   404 Not Found: a shared inbox returning 404 is usually a transient blip
//     (deploy/restart/misroute). It also triggers endpoint re-resolution, and
//     failing permanently here left the re-resolved job colliding on the same
//     terminal jobId (silently dropped). Retrying lets the endpoint recover.
// 410 Gone (endpoint genuinely removed) and 400/403/422 (a remote per-activity /
// deliberate-relationship verdict, not endpoint health) stay PERMANENT.
export const TRANSIENT_DELIVERY_4XX: ReadonlySet<number> = new Set([
  401, 404, 408, 425, 429,
]);

/**
 * A delivery response status that should be PERMANENTLY failed (no retry): a 4xx
 * that is not in the transient set. 5xx and transient 4xx are retried; a null
 * status (network error) is not classified here.
 */
export function isPermanentDeliveryFailure(status: number | null): boolean {
  return (
    status !== null &&
    status >= 400 &&
    status < 500 &&
    !TRANSIENT_DELIVERY_4XX.has(status)
  );
}

type TimedFetchResult = {
  response: Response | null;
  error: unknown;
  latencyMs: number;
};

async function timedFetch(
  url: string,
  init: RequestInit & { timeout: number },
): Promise<TimedFetchResult> {
  const startedAt = Date.now();
  let response: Response | null = null;
  let error: unknown = null;
  try {
    response = await fetchWithTimeout(url, init);
  } catch (e) {
    error = e;
  }
  return { response, error, latencyMs: Date.now() - startedAt };
}

function buildErrorMessage(response: Response | null, error: unknown): string {
  if (response) return `HTTP ${response.status}`;
  if (error instanceof Error) return error.message;
  return "delivery_error";
}

function parseCommaSeparated(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function parseSampleRate(value: string | undefined): number {
  if (!value) return 1.0;
  const n = Number(value);
  if (!Number.isFinite(n)) return 1.0;
  return Math.max(0, Math.min(1, n));
}

async function resolveSigningActor(
  db: Database,
  actorApId: string,
): Promise<{ apId: string; privateKeyPem: string } | null> {
  // Check actors table. This MUST resolve tombstoned (soft-deleted) actors too:
  // when an account is deleted, the outbound Delete(actor) deliver_endpoint jobs
  // are snapshotted before teardown but drain afterwards, and the actor row is
  // tombstoned (deletedAt set) rather than hard-deleted precisely so its private
  // key survives for signing here. So this lookup deliberately does NOT filter
  // on `deletedAt`.
  const actorRow = await db
    .select({
      apId: actors.apId,
      privateKeyPem: actors.privateKeyPem,
    })
    .from(actors)
    .where(eq(actors.apId, actorApId))
    .get();
  if (actorRow?.privateKeyPem) {
    return { apId: actorRow.apId, privateKeyPem: actorRow.privateKeyPem };
  }

  // Check communities table
  const communityRow = await db
    .select({
      apId: communities.apId,
      privateKeyPem: communities.privateKeyPem,
    })
    .from(communities)
    .where(eq(communities.apId, actorApId))
    .get();
  if (communityRow?.privateKeyPem) {
    return {
      apId: communityRow.apId,
      privateKeyPem: communityRow.privateKeyPem,
    };
  }

  // Check instanceActor table
  const instanceRow = await db
    .select({
      apId: instanceActor.apId,
      privateKeyPem: instanceActor.privateKeyPem,
    })
    .from(instanceActor)
    .where(eq(instanceActor.apId, actorApId))
    .get();
  if (instanceRow?.privateKeyPem) {
    return { apId: instanceRow.apId, privateKeyPem: instanceRow.privateKeyPem };
  }

  return null;
}

async function failJob(
  db: Database,
  jobId: string,
  error: string,
  message: Message<DeliveryQueueMessageV1>,
): Promise<void> {
  await db
    .update(deliveryQueue)
    .set({
      status: "failed",
      error,
      lastAttemptAt: nowIso(),
      processingStartedAt: null,
    })
    .where(eq(deliveryQueue.id, jobId));
  message.ack();
}

async function incrementDeliveryAttempts(
  db: Database,
  jobId: string,
): Promise<number> {
  await db
    .update(deliveryQueue)
    .set({ attempts: sql`${deliveryQueue.attempts} + 1` })
    .where(eq(deliveryQueue.id, jobId));
  const updated = await db
    .select({ attempts: deliveryQueue.attempts })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, jobId))
    .get();
  return updated?.attempts ?? 0;
}

async function maybeShadowProbeInbox(
  db: Database,
  env: Env,
  params: {
    activityId: string;
    sharedInboxEndpoint: string;
    endpointHost: string;
    sender: { apId: string; privateKeyPem: string };
    body: string;
  },
): Promise<void> {
  const allowedHosts = parseCommaSeparated(env.DELIVERY_SHADOW_PROBE_HOSTS);
  if (allowedHosts.length === 0) return;
  if (!allowedHosts.includes(params.endpointHost)) return;

  const sampleRate = parseSampleRate(env.DELIVERY_SHADOW_PROBE_SAMPLE_RATE);
  if (sampleRate <= 0) return;
  if (sampleRate < 1 && Math.random() > sampleRate) return;

  const rep = await db
    .select({
      apId: actorCache.apId,
      inbox: actorCache.inbox,
    })
    .from(actorCache)
    .where(eq(actorCache.sharedInbox, params.sharedInboxEndpoint))
    .limit(1)
    .get();
  const inbox = rep?.inbox;
  if (!inbox || !isSafeRemoteUrl(inbox)) return;

  const inboxHost = safeEndpointHost(inbox);
  const keyId = `${params.sender.apId}#main-key`;
  const headers = await signRequest(
    params.sender.privateKeyPem,
    keyId,
    "POST",
    inbox,
    params.body,
  );

  const { response, error, latencyMs } = await timedFetch(inbox, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/activity+json",
      "X-Yurucommu-Shadow-Probe": "1",
    },
    body: params.body,
    timeout: DELIVERY_HTTP_TIMEOUT_MS,
  });

  emitMetric("delivery_shadow_probe_inbox_latency_ms", latencyMs, {
    endpoint_host: params.endpointHost,
    inbox_host: inboxHost ?? "unknown",
    ok: response?.ok ?? false,
    status: response?.status ?? null,
  });
  emitMetric("delivery_shadow_probe_inbox_ok", response?.ok ? 1 : 0, {
    endpoint_host: params.endpointHost,
    inbox_host: inboxHost ?? "unknown",
    status: response?.status ?? null,
    error: error instanceof Error ? error.message : null,
  });
}

export async function processDeliverEndpoint(
  db: Database,
  env: Env,
  msg: DeliveryDeliverEndpointMessageV1,
  message: Message<DeliveryQueueMessageV1>,
  bulkhead: Bulkhead,
): Promise<void> {
  if (!requireQueue(env, "deliver_endpoint", message)) return;

  const job = await db
    .select({
      id: deliveryQueue.id,
      activityApId: deliveryQueue.activityApId,
      inboxUrl: deliveryQueue.inboxUrl,
      attempts: deliveryQueue.attempts,
      status: deliveryQueue.status,
      nextAttemptAt: deliveryQueue.nextAttemptAt,
      processingStartedAt: deliveryQueue.processingStartedAt,
    })
    .from(deliveryQueue)
    .where(eq(deliveryQueue.id, msg.jobId))
    .get();

  const TERMINAL_JOB_STATUSES: readonly string[] = [
    "delivered",
    "dead_letter",
    "failed",
  ];

  if (!job || TERMINAL_JOB_STATUSES.includes(job.status)) {
    message.ack();
    return;
  }

  // Queue lag metric
  const scheduledMs = safeParseIsoTimeMs(msg.scheduledAt);
  if (scheduledMs !== null) {
    emitMetric(
      "delivery_queue_lag_seconds",
      Math.max(0, (Date.now() - scheduledMs) / 1000),
      {
        endpoint_host: safeEndpointHost(job.inboxUrl) ?? "unknown",
      },
    );
  }

  // Respect job scheduling stored in DB
  const nextAttemptMs = safeParseIsoTimeMs(job.nextAttemptAt);
  if (nextAttemptMs !== null && Date.now() < nextAttemptMs) {
    const deferSeconds = Math.max(
      1,
      Math.ceil((nextAttemptMs - Date.now()) / 1000),
    );
    await sendQueueMessage(
      env,
      buildDeliverEndpointMessage(job.id),
      deferSeconds,
    );
    message.ack();
    return;
  }

  if (job.status === "processing") {
    const startedMs = safeParseIsoTimeMs(job.processingStartedAt);
    if (startedMs !== null && Date.now() - startedMs < STALE_PROCESSING_MS) {
      await sendQueueMessage(env, buildDeliverEndpointMessage(job.id), 30);
      message.ack();
      return;
    }
  }

  const endpoint = job.inboxUrl;
  const host = safeEndpointHost(endpoint);
  if (!host) {
    await failJob(db, job.id, "invalid_endpoint", message);
    return;
  }

  // Circuit breaker
  const circuit = await checkCircuit(db, endpoint);
  if (!circuit.allow) {
    emitMetric("delivery_circuit_open_count", 1, { endpoint_host: host });
    await sendQueueMessage(
      env,
      buildDeliverEndpointMessage(job.id),
      circuit.deferSeconds,
    );
    message.ack();
    return;
  }

  await bulkhead.acquire(host);
  try {
    // Mark processing — VERIFIED CAS. Cloudflare Queues is at-least-once and the
    // SELECT above ran BEFORE bulkhead.acquire (the bulkhead is keyed by host,
    // not jobId), so two runners can hold the same jobId concurrently and both
    // reach here. Claim only if the row is still claimable: a non-processing,
    // non-terminal status, OR a STALE 'processing' row (a crashed runner — the
    // same condition the pre-acquire stale check at :316 lets fall through). If
    // our UPDATE changes 0 rows another live runner already owns the job → ack
    // without re-enqueue so the signed activity is POSTed exactly once.
    const staleThresholdIso = new Date(
      Date.now() - STALE_PROCESSING_MS,
    ).toISOString();
    const claim = await db
      .update(deliveryQueue)
      .set({
        status: "processing",
        processingStartedAt: nowIso(),
      })
      .where(
        and(
          eq(deliveryQueue.id, job.id),
          or(
            notInArray(deliveryQueue.status, [
              "processing",
              ...TERMINAL_JOB_STATUSES,
            ]),
            and(
              eq(deliveryQueue.status, "processing"),
              lt(deliveryQueue.processingStartedAt, staleThresholdIso),
            ),
          ),
        ),
      );
    if (((claim as { meta?: { changes?: number } }).meta?.changes ?? 0) === 0) {
      message.ack();
      return;
    }

    const activity = await db
      .select({
        rawJson: activities.rawJson,
        actorApId: activities.actorApId,
      })
      .from(activities)
      .where(eq(activities.apId, job.activityApId))
      .get();
    if (!activity) {
      await failJob(db, job.id, "activity_not_found", message);
      return;
    }

    const sender = await resolveSigningActor(db, activity.actorApId);
    if (!sender) {
      await failJob(db, job.id, "signing_actor_not_found", message);
      return;
    }

    const body = activity.rawJson;
    const keyId = `${sender.apId}#main-key`;
    const headers = await signRequest(
      sender.privateKeyPem,
      keyId,
      "POST",
      endpoint,
      body,
    );

    const { response, error, latencyMs } = await timedFetch(endpoint, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/activity+json" },
      body,
      timeout: DELIVERY_HTTP_TIMEOUT_MS,
    });

    emitMetric("delivery_latency_ms", latencyMs, {
      endpoint_host: host,
      ok: response?.ok ?? false,
      status: response?.status ?? null,
    });

    if (response?.ok) {
      // The remote POST already succeeded. From here on the message MUST be
      // acked even if the bookkeeping DB writes fail: re-running the batch
      // would re-POST the same activity and produce a duplicate delivery. A
      // stale 'processing' row left behind by a failed update is harmless
      // (it gets reaped/retried only via reconcile, which re-checks state).
      const now = nowIso();
      try {
        await db
          .update(deliveryQueue)
          .set({
            status: "delivered",
            deliveredAt: now,
            error: null,
            lastAttemptAt: now,
            processingStartedAt: null,
          })
          .where(eq(deliveryQueue.id, job.id));
        await recordCircuitSuccess(db, endpoint);
      } catch (e) {
        log.error("Post-delivery bookkeeping failed; acking to avoid re-POST", {
          event: "delivery.deliver.post_success_update_failed",
          jobId: job.id,
          activityId: job.activityApId,
          endpoint,
          endpointHost: host,
          error: e,
        });
        emitMetric("delivery_success", 1, {
          endpoint_host: host,
          bookkeeping_failed: true,
        });
        message.ack();
        return;
      }
      emitMetric("delivery_success", 1, { endpoint_host: host });

      // Shadow probe (staging-only)
      if (job.attempts === 0) {
        try {
          await maybeShadowProbeInbox(db, env, {
            activityId: job.activityApId,
            sharedInboxEndpoint: endpoint,
            endpointHost: host,
            sender,
            body,
          });
        } catch (e) {
          log.warn("Shadow probe failed", {
            event: "delivery.shadow_probe.failed",
            activityId: job.activityApId,
            endpoint,
            endpointHost: host,
            error: e,
          });
        }
      }

      message.ack();
      return;
    }

    const status = response?.status ?? null;
    const errorMessage = buildErrorMessage(response, error);

    // 404/410: expire endpoint cache immediately
    if (status === 404 || status === 410) {
      try {
        await enqueueResolveForEndpointActors(
          db,
          env,
          job.activityApId,
          endpoint,
        );
        await db
          .update(actorCache)
          .set({ sharedInbox: null, lastFetchedAt: EPOCH_ISO })
          .where(eq(actorCache.sharedInbox, endpoint));
        await db
          .update(actorCache)
          .set({ lastFetchedAt: EPOCH_ISO })
          .where(eq(actorCache.inbox, endpoint));
      } catch (e) {
        log.warn("Endpoint invalidation failed", {
          event: "delivery.endpoint.invalidation_failed",
          endpoint,
          endpointHost: host,
          status,
          error: e,
        });
      }
    }

    // Permanent 4xx => fail; transient 4xx (TRANSIENT_DELIVERY_4XX) and 5xx are
    // retried. See isPermanentDeliveryFailure for the classification rationale.
    const nonRetryable = isPermanentDeliveryFailure(status);
    if (nonRetryable) {
      await failJob(db, job.id, errorMessage, message);
      emitMetric("delivery_success", 0, {
        endpoint_host: host,
        non_retryable: true,
        status,
      });
      // Do NOT trip the circuit on a permanent 4xx: a 400/403/410/422 is the
      // remote's per-ACTIVITY verdict (malformed/forbidden/gone for THIS post),
      // not a signal the endpoint is unhealthy. The circuit is keyed by the
      // shared inbox, so counting per-activity rejections would let one bad
      // activity (or one over-strict remote) open the breaker and block delivery
      // of unrelated, valid activities to every co-located recipient. Only
      // transient failures (below) reflect endpoint health.
      return;
    }

    // Retryable failure — this DOES reflect endpoint health, so feed the circuit.
    const nextAttempts = await incrementDeliveryAttempts(db, job.id);
    await recordCircuitFailure(db, endpoint);

    if (nextAttempts >= DELIVERY_MAX_ATTEMPTS) {
      const now = nowIso();
      await db
        .update(deliveryQueue)
        .set({
          status: "dead_letter",
          error: errorMessage,
          lastAttemptAt: now,
          processingStartedAt: null,
        })
        .where(eq(deliveryQueue.id, job.id));
      emitMetric("delivery_dead_letter", 1, { endpoint_host: host });

      await sendDlqMessage(env, {
        version: 1,
        type: "dlq",
        jobId: job.id,
        activityId: job.activityApId,
        endpoint,
        attempts: nextAttempts,
        lastError: errorMessage,
        // Carry the job's reconcile-cycle count so the DLQ consumer can advance
        // (and ultimately terminate) the reconciliation budget.
        reconcileAttempt: msg.reconcileAttempt ?? 0,
        deadLetteredAt: now,
      });

      message.ack();
      return;
    }

    const delaySeconds = computeRetryDelaySeconds(nextAttempts);
    const nextAttemptAtStr = new Date(
      Date.now() + delaySeconds * 1000,
    ).toISOString();

    await db
      .update(deliveryQueue)
      .set({
        status: "retry_wait",
        error: errorMessage,
        lastAttemptAt: nowIso(),
        processingStartedAt: null,
        nextAttemptAt: nextAttemptAtStr,
      })
      .where(eq(deliveryQueue.id, job.id));

    emitMetric("delivery_success", 0, {
      endpoint_host: host,
      status: status ?? null,
    });
    await sendQueueMessage(
      env,
      buildDeliverEndpointMessage(job.id),
      delaySeconds,
    );
    message.ack();
  } finally {
    bulkhead.release(host);
  }
}
