import { isEnvelopeFresh } from "../../../packages/api/src/types/call.ts";
import {
  CALL_RELAY_CALLBACK_TIMEOUT_MS,
  CALL_RELAY_JOB_MAX_BYTES,
  CALL_RELAY_TIMEOUT_MS,
  callRelayResult,
  parseCallRelayJob,
  type CallRelayJob,
  type CallRelayResult,
} from "./call-relay.ts";

const MAX_ACTIVE_JOBS = 8;
const MAX_LIVE_JOB_BYTES = 16 * 1024 * 1024;
// Admission byte-copy accounting, not a hard JavaScript heap measurement.
const LIVE_BYTES_PER_WIRE_BYTE = 4;

interface CallDispatcherDependencies {
  /** Performs exactly one peer POST. This owns signing and transport policy. */
  send(job: CallRelayJob, signal: AbortSignal): Promise<void>;
  /** Reports a compact result to the source actor; never receives the job. */
  report(
    result: CallRelayResult,
    localActorApId: string,
    signal: AbortSignal,
  ): Promise<void>;
  now?(): number;
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

type ReadBodyResult =
  | { ok: true; bytes: Uint8Array; wireBytes: number }
  | { ok: false; status: 400 | 413 | 503 };

/**
 * In-process, non-durable dispatcher for the unpublished application handoff.
 * The Worker that owns this service is responsible for keeping it private.
 */
export function createCallDispatcher(deps: CallDispatcherDependencies) {
  let activeJobs = 0;
  let activeBytes = 0;
  const now = deps.now ?? Date.now;

  const releaseBytes = (bytes: number) => {
    activeBytes = Math.max(0, activeBytes - bytes);
  };

  async function readBody(request: Request): Promise<ReadBodyResult> {
    const declaredLength = request.headers.get("Content-Length");
    if (declaredLength !== null) {
      const length = Number(declaredLength);
      if (!Number.isSafeInteger(length) || length < 0)
        return { ok: false, status: 400 };
      if (length > CALL_RELAY_JOB_MAX_BYTES) return { ok: false, status: 413 };
    }
    if (!request.body) return { ok: false, status: 400 };

    const reader = request.body.getReader();
    let bytes = new Uint8Array(0);
    let size = 0;
    let reserved = 0;
    let complete = false;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const nextSize = size + value.byteLength;
        if (nextSize > CALL_RELAY_JOB_MAX_BYTES) {
          await reader.cancel().catch(() => {});
          return { ok: false, status: 413 };
        }
        const nextReservation = nextSize * LIVE_BYTES_PER_WIRE_BYTE;
        const additional = nextReservation - reserved;
        if (activeBytes + additional > MAX_LIVE_JOB_BYTES) {
          await reader.cancel().catch(() => {});
          return { ok: false, status: 503 };
        }
        activeBytes += additional;
        reserved = nextReservation;

        if (nextSize > bytes.byteLength) {
          const grown = new Uint8Array(
            Math.min(
              CALL_RELAY_JOB_MAX_BYTES,
              Math.max(nextSize, Math.max(bytes.byteLength * 2, 1024)),
            ),
          );
          grown.set(bytes.subarray(0, size));
          bytes = grown;
        }
        bytes.set(value, size);
        size = nextSize;
      }
      if (size === 0) return { ok: false, status: 400 };
      complete = true;
      return { ok: true, bytes: bytes.subarray(0, size), wireBytes: size };
    } catch {
      return { ok: false, status: 400 };
    } finally {
      reader.releaseLock();
      if (!complete) releaseBytes(reserved);
    }
  }

  function validJobAt(job: CallRelayJob, current: number): boolean {
    const remaining = job.effect.deadline - current;
    const envelopeDeadline = job.envelope.ts + job.envelope.ttlMs;
    return (
      Number.isFinite(current) &&
      Number.isFinite(job.effect.deadline) &&
      Number.isFinite(envelopeDeadline) &&
      job.effect.deadline <= envelopeDeadline &&
      isEnvelopeFresh(job.envelope, current) &&
      remaining > 0 &&
      remaining <= CALL_RELAY_TIMEOUT_MS
    );
  }

  async function sendOnce(
    job: CallRelayJob,
  ): Promise<{ result: CallRelayResult; localActorApId: string }> {
    const effect = job.effect;
    const localActorApId = job.envelope.from;
    const result = callRelayResult(effect, "failed");
    const beforeSend = now();
    const remaining = effect.deadline - beforeSend;
    if (!validJobAt(job, beforeSend) || !Number.isFinite(remaining)) {
      return { result, localActorApId };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    try {
      await deps.send(job, controller.signal);
      if (!controller.signal.aborted && now() < effect.deadline)
        result.outcome = "peer_ack";
    } catch {
      // A failed or ambiguous peer attempt is never retried here.
    } finally {
      clearTimeout(timer);
    }
    return { result, localActorApId };
  }

  async function deliver(
    payload: CallRelayJob | null,
    reservation: number,
  ): Promise<void> {
    if (!payload) return;
    let result: CallRelayResult;
    let localActorApId: string;
    try {
      ({ result, localActorApId } = await sendOnce(payload));
    } catch {
      result = callRelayResult(payload.effect, "failed");
      localActorApId = payload.envelope.from;
    }

    // The outbound producer has settled. Drop all SDP/ICE and envelope
    // references before invoking the independent compact-result callback.
    payload = null;
    releaseBytes(reservation);

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      CALL_RELAY_CALLBACK_TIMEOUT_MS,
    );
    try {
      await deps.report(result, localActorApId, controller.signal);
    } catch {
      // Callback is best effort, single attempt, and never retries on ambiguity.
    } finally {
      clearTimeout(timer);
      activeJobs -= 1;
    }
  }

  async function handle(
    request: Request,
    context: WorkerContext,
  ): Promise<Response> {
    if (request.method !== "POST")
      return new Response("method not allowed", { status: 405 });
    if (activeJobs >= MAX_ACTIVE_JOBS)
      return new Response("dispatcher busy", { status: 503 });
    activeJobs += 1;

    let reservation = 0;
    let inputBytes: Uint8Array | null = null;
    let rawText: string | null = null;
    let parsed: unknown;
    let job: CallRelayJob | null = null;
    let body: ReadBodyResult | null = null;
    let slotTransferred = false;
    try {
      body = await readBody(request);
      if (!body.ok)
        return new Response("invalid request body", { status: body.status });
      reservation = body.wireBytes * LIVE_BYTES_PER_WIRE_BYTE;
      inputBytes = body.bytes;
      rawText = new TextDecoder("utf-8", { fatal: true }).decode(inputBytes);
      inputBytes = null;
      body = null;
      parsed = JSON.parse(rawText);
      job = parseCallRelayJob(parsed);
      parsed = null;
      rawText = null;
      inputBytes = null;
      if (!job) return new Response("invalid call relay job", { status: 400 });
      if (!validJobAt(job, now()))
        return new Response("call relay deadline invalid or expired", {
          status: 400,
        });

      const url = new URL(request.url);
      if (url.pathname === "/_send") {
        const sent = await sendOnce(job);
        job = null;
        return Response.json(sent.result);
      }

      // Defer execution one microtask so waitUntil owns the producer before it
      // can perform any network or callback work.
      const effectId = job.effect.effectId;
      const holder: { job: CallRelayJob | null; reservation: number } = {
        job,
        reservation,
      };
      let startProducer!: () => void;
      const admission = new Promise<void>((resolve) => {
        startProducer = resolve;
      });
      const producer = admission.then(() => {
        const payload = holder.job;
        holder.job = null;
        if (!payload) {
          releaseBytes(holder.reservation);
          activeJobs -= 1;
          return;
        }
        return deliver(payload, holder.reservation);
      });
      context.waitUntil(producer);
      slotTransferred = true;
      job = null;
      reservation = 0; // deliver() now owns and releases this reservation.
      startProducer();
      return Response.json({ accepted: true, effectId }, { status: 202 });
    } catch {
      return new Response("invalid call relay request", { status: 400 });
    } finally {
      if (reservation > 0) releaseBytes(reservation);
      // Once waitUntil accepted the producer, it owns the job slot.
      if (!slotTransferred) activeJobs -= 1;
      // Keep these references local only while parsing. The producer captures
      // only the validated job object, never input bytes or JSON text.
      parsed = null;
      rawText = null;
      inputBytes = null;
      body = null;
    }
  }

  return {
    async fetch(request: Request, context: WorkerContext): Promise<Response> {
      const pathname = new URL(request.url).pathname;
      if (pathname !== "/_dispatch" && pathname !== "/_send")
        return new Response("not found", { status: 404 });
      return handle(request, context);
    },
  };
}
