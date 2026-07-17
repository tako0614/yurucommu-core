/**
 * IRealtimeHub — the seam that decouples the realtime event stream from the
 * Durable Object runtime (mirrors `signaling-hub.ts` for calls).
 *
 * On Cloudflare it forwards to the per-user `RealtimeStreamDO`
 * (`idFromName(actorApId)`); on a runtime without the DO binding the hub is a
 * null object: `emit` is a no-op and upgrades answer 503, so clients detect
 * the missing capability (`GET /api/realtime/config`) and fall back to their
 * low-frequency polling loops. Emits are ALWAYS best-effort — a realtime
 * delivery failure must never fail the REST write that produced it.
 */

import { gt } from "drizzle-orm";
import type { Env } from "../types.ts";
import { notificationPushJobs } from "../../db/index.ts";
import { computeUnreadSnapshot } from "../lib/unread-counts.ts";
import { logger } from "../lib/logger.ts";

const log = logger.child({ component: "realtime.hub" });

export interface IRealtimeHub {
  /** Forward a browser WebSocket upgrade to `actorApId`'s stream (101). */
  upgrade(
    request: Request,
    actorApId: string,
    auth: "session" | "ticket",
    ticket?: string,
  ): Promise<Response>;
  /** Mint a one-time short-lived WS ticket inside the user's stream DO. */
  mintTicket(actorApId: string): Promise<string | null>;
  /** Push one event to `actorApId`'s live sockets (best-effort). */
  emit(
    actorApId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Cloudflare: forward to the per-user Durable Object
// ---------------------------------------------------------------------------
class CloudflareRealtimeHub implements IRealtimeHub {
  constructor(private readonly ns: DurableObjectNamespace) {}

  private stub(actorApId: string): DurableObjectStub {
    return this.ns.get(this.ns.idFromName(actorApId));
  }

  async upgrade(
    request: Request,
    actorApId: string,
    auth: "session" | "ticket",
    ticket?: string,
  ): Promise<Response> {
    const headers = new Headers(request.headers);
    headers.set("X-Realtime-Auth", auth);
    if (ticket) headers.set("X-Realtime-Ticket", ticket);
    const forwarded = new Request("https://realtime-do/_ws", {
      method: "GET",
      headers,
    });
    return this.stub(actorApId).fetch(
      forwarded as unknown as Parameters<DurableObjectStub["fetch"]>[0],
    ) as unknown as Promise<Response>;
  }

  async mintTicket(actorApId: string): Promise<string | null> {
    const response = await this.stub(actorApId).fetch(
      "https://realtime-do/_ticket",
      { method: "POST" },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as { ticket?: unknown };
    return typeof body.ticket === "string" ? body.ticket : null;
  }

  async emit(
    actorApId: string,
    type: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    await this.stub(actorApId).fetch("https://realtime-do/_emit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, data }),
    });
  }
}

// ---------------------------------------------------------------------------
// Null hub (no DO binding): clients fall back to polling
// ---------------------------------------------------------------------------
class NullRealtimeHub implements IRealtimeHub {
  async upgrade(): Promise<Response> {
    return new Response(
      JSON.stringify({
        error: "realtime_unavailable",
        message: "Realtime streaming requires the Durable Objects runtime.",
      }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    );
  }

  async mintTicket(): Promise<string | null> {
    return null;
  }

  async emit(): Promise<void> {
    // no-op: clients poll
  }
}

const nullHub = new NullRealtimeHub();

/** Resolve the realtime hub for this runtime. */
export function getRealtimeHub(env: Env): IRealtimeHub {
  if (env.REALTIME_STREAM) {
    return new CloudflareRealtimeHub(env.REALTIME_STREAM);
  }
  return nullHub;
}

/** Whether realtime streaming can be served on this runtime. */
export function isRealtimeAvailable(env: Env): boolean {
  return Boolean(env.REALTIME_STREAM);
}

// ---------------------------------------------------------------------------
// Best-effort emit helpers (producers call these; failures never propagate)
// ---------------------------------------------------------------------------

export interface RealtimeEmitInput {
  actorApId: string;
  type: string;
  data: Record<string, unknown>;
}

/** Emit a batch of events, swallowing (but logging) any delivery failure. */
export async function emitRealtimeBestEffort(
  env: Env,
  events: RealtimeEmitInput[],
): Promise<void> {
  if (!isRealtimeAvailable(env) || events.length === 0) return;
  const hub = getRealtimeHub(env);
  await Promise.all(
    events.map(async ({ actorApId, type, data }) => {
      try {
        await hub.emit(actorApId, type, data);
      } catch (error) {
        log.warn("Realtime emit failed", {
          event: "realtime.emit_failed",
          type,
          error,
        });
      }
    }),
  );
}

/**
 * Compute and push the authoritative unread counters for one user. The
 * counters are always server-derived (the same SQL as the badge endpoints) so
 * a pushed badge can never drift from what the client would fetch.
 */
export async function emitUnreadSnapshot(
  env: Env,
  actorApId: string,
): Promise<void> {
  if (!isRealtimeAvailable(env)) return;
  try {
    const snapshot = await computeUnreadSnapshot(env.DB_INSTANCE, actorApId);
    await getRealtimeHub(env).emit(actorApId, "unread", {
      dm: snapshot.dm,
      community: snapshot.community,
      talk_total: snapshot.talkTotal,
      notifications: snapshot.notifications,
    });
  } catch (error) {
    log.warn("Realtime unread emit failed", {
      event: "realtime.unread_emit_failed",
      error,
    });
  }
}

/**
 * Schedule best-effort realtime work after the response is sent. Mirrors the
 * push-outbox sweep in index.ts: prefer `executionCtx.waitUntil`, fall back to
 * awaiting inline where no runtime context exists (tests / plain fetch).
 */
export async function runRealtimeAfterResponse(
  c: { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } },
  task: () => Promise<void>,
): Promise<void> {
  const wrapped = task().catch((error) => {
    log.warn("Realtime after-response task failed", {
      event: "realtime.after_response_failed",
      error,
    });
  });
  try {
    const ctx = c.executionCtx;
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(wrapped);
      return;
    }
  } catch {
    // No execution context; await inline below.
  }
  await wrapped;
}

// ---------------------------------------------------------------------------
// Notification sweep (the same choke points that flush the push outbox)
// ---------------------------------------------------------------------------

// Every unread inbox insert is captured by the notification_push_jobs DB
// trigger — the single choke point covering all nine scattered insert sites
// (follow/like/reply/mention/DM/federation/community fanout). A DB trigger
// cannot call a Durable Object, so this sweep reads the jobs the trigger
// wrote and emits `notification.new` + `unread` to each affected user. It is
// called from the SAME two flush points as `enqueuePendingNotificationPushJobs`
// (the post-response middleware and the queue-consumer tail).
//
// The cursor is per-isolate in-memory, initialized to isolate start so a cold
// isolate never replays history; a double-emit across isolates is harmless
// (clients treat both event types idempotently: refetch + set-counter).
let realtimeSweepCursor = new Date().toISOString();

export async function sweepRealtimeNotifications(env: Env): Promise<void> {
  if (!isRealtimeAvailable(env)) return;
  const since = realtimeSweepCursor;
  const nextCursor = new Date().toISOString();
  try {
    const rows = await env.DB_INSTANCE.selectDistinct({
      actorApId: notificationPushJobs.actorApId,
    })
      .from(notificationPushJobs)
      .where(gt(notificationPushJobs.createdAt, since))
      .limit(50);
    realtimeSweepCursor = nextCursor;
    if (rows.length === 0) return;
    await Promise.all(
      rows.map(async ({ actorApId }) => {
        await emitRealtimeBestEffort(env, [
          { actorApId, type: "notification.new", data: {} },
        ]);
        await emitUnreadSnapshot(env, actorApId);
      }),
    );
  } catch (error) {
    log.warn("Realtime notification sweep failed", {
      event: "realtime.sweep_failed",
      error,
    });
  }
}
