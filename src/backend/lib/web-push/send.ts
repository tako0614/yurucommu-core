/**
 * One Web Push request (RFC 8030 §5) with VAPID (RFC 8292) and aes128gcm
 * encryption (RFC 8291), and the classification of the push service's answer
 * into the host's three outcome channels.
 */

import { encryptWebPushPayload } from "./encrypt.ts";
import { toArrayBuffer, utf8 } from "./bytes.ts";
import { vapidAuthorization, type VapidKeyPair } from "./vapid.ts";

/** MSC4174's default; the push service may keep the message this long. */
export const DEFAULT_WEB_PUSH_TTL_SECONDS = 172_800;
const MAX_WEB_PUSH_TTL_SECONDS = 28 * 24 * 60 * 60;
const DEFAULT_WEB_PUSH_TIMEOUT_MS = 10_000;
const MAX_RETRY_AFTER_SECONDS = 12 * 60 * 60;

export type WebPushUrgency = "very-low" | "low" | "normal" | "high";

export interface WebPushSubscriptionTarget {
  /** Push resource URL (subscription endpoint). */
  readonly endpoint: string;
  /** Subscription `p256dh`, uncompressed P-256 point. */
  readonly p256dh: Uint8Array;
  /** Subscription `auth`, 16 bytes. */
  readonly auth: Uint8Array;
}

export interface WebPushMessageOptions {
  readonly payload: Uint8Array | string;
  readonly ttlSeconds?: number;
  readonly urgency?: WebPushUrgency;
  /** Replaces an undelivered message with the same topic (≤32 base64url chars). */
  readonly topic?: string;
}

export interface WebPushSendContext {
  readonly vapid: VapidKeyPair;
  /** VAPID `sub`: the instance origin. */
  readonly subject: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
  readonly now?: () => number;
}

/**
 * - delivered: 2xx.
 * - gone: 404/410 — the subscription is dead; the host deletes it.
 * - retry: timeout, transport error, 408, 429, 5xx — send again later
 *   (`retryAfterSeconds` from Retry-After when given).
 * - failed: 3xx and every other 4xx, 403 included — keep the subscription and
 *   do not retry. A 403 usually means our own VAPID signature is wrong; deleting
 *   on it would wipe every subscription at once.
 */
export type WebPushOutcome =
  | { readonly kind: "delivered"; readonly status: number }
  | { readonly kind: "gone"; readonly status: number }
  | {
      readonly kind: "retry";
      readonly status: number | null;
      readonly retryAfterSeconds: number;
      readonly error: string;
    }
  | {
      readonly kind: "failed";
      readonly status: number | null;
      readonly error: string;
    };

export function classifyWebPushResponse(
  status: number,
  retryAfter: string | null,
  nowMs: number = Date.now(),
): WebPushOutcome {
  if (status >= 200 && status < 300) return { kind: "delivered", status };
  if (status === 404 || status === 410) return { kind: "gone", status };
  if (status === 408 || status === 429 || (status >= 500 && status < 600)) {
    return {
      kind: "retry",
      status,
      retryAfterSeconds: parseRetryAfter(retryAfter, nowMs),
      error: `push service HTTP ${status}`,
    };
  }
  // 3xx (redirects are never followed), other 4xx including 401/403/413, and
  // anything non-HTTP-shaped (status 0 for an opaque redirect).
  return {
    kind: "failed",
    status: status || null,
    error: `push service HTTP ${status}`,
  };
}

export async function sendWebPush(
  target: WebPushSubscriptionTarget,
  message: WebPushMessageOptions,
  context: WebPushSendContext,
): Promise<WebPushOutcome> {
  const now = context.now ?? Date.now;
  let request: { headers: Headers; body: Uint8Array };
  try {
    const payload =
      typeof message.payload === "string"
        ? utf8(message.payload)
        : message.payload;
    const body = await encryptWebPushPayload({
      plaintext: payload,
      userAgentPublicKey: target.p256dh,
      authSecret: target.auth,
    });
    const headers = new Headers({
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(normalizeTtl(message.ttlSeconds)),
      Authorization: await vapidAuthorization(
        context.vapid,
        { endpoint: target.endpoint, subject: context.subject },
        now(),
      ),
    });
    if (message.urgency) headers.set("Urgency", message.urgency);
    if (message.topic !== undefined) {
      if (!isValidTopic(message.topic)) {
        throw new Error("Topic must be 1-32 base64url characters");
      }
      headers.set("Topic", message.topic);
    }
    request = { headers, body };
  } catch (error) {
    // A message we cannot even build will not succeed on retry.
    return {
      kind: "failed",
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    context.timeoutMs ?? DEFAULT_WEB_PUSH_TIMEOUT_MS,
  );
  let response: Response;
  try {
    response = await (context.fetch ?? fetch)(target.endpoint, {
      method: "POST",
      headers: request.headers,
      body: toArrayBuffer(request.body),
      // Never follow: a 3xx is classified as a permanent failure.
      redirect: "manual",
      signal: controller.signal,
    });
  } catch (error) {
    return {
      kind: "retry",
      status: null,
      retryAfterSeconds: 0,
      error:
        error instanceof Error && error.name === "AbortError"
          ? "push service timed out"
          : error instanceof Error
            ? error.message
            : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
  // The body is never needed; release the connection.
  try {
    await response.body?.cancel();
  } catch {
    // ignore
  }
  return classifyWebPushResponse(
    response.type === "opaqueredirect" ? 0 : response.status,
    response.headers.get("Retry-After"),
    now(),
  );
}

export function isValidTopic(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,32}$/.test(value);
}

function normalizeTtl(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_WEB_PUSH_TTL_SECONDS;
  }
  return Math.max(0, Math.min(MAX_WEB_PUSH_TTL_SECONDS, Math.floor(value)));
}

function parseRetryAfter(value: string | null, nowMs: number): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(seconds));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 0;
  return Math.min(
    MAX_RETRY_AFTER_SECONDS,
    Math.max(0, Math.ceil((timestamp - nowMs) / 1000)),
  );
}
