import { isSafeRemoteUrl } from "../../federation-helpers.ts";
import { bytesToHex } from "../hex.ts";

export const DELIVERY_ENDPOINT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// 1m, 2m, 4m, 8m, 16m, 32m, 64m, 128m (contract)
const BACKOFF_SERIES_SECONDS = [
  60, 120, 240, 480, 960, 1920, 3840, 7680,
] as const;

export const DELIVERY_MAX_ATTEMPTS = BACKOFF_SERIES_SECONDS.length;

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export async function computeDeliveryJobId(
  activityId: string,
  endpoint: string,
): Promise<string> {
  // Deterministic idempotency key: activityId + endpoint (+ attemptGroup if needed).
  return sha256Hex(`${activityId}|${endpoint}`);
}

export function computeRetryDelaySeconds(nextAttempt: number): number {
  // nextAttempt is 1-based: first retry => 1.
  const idx = Math.max(
    0,
    Math.min(nextAttempt - 1, BACKOFF_SERIES_SECONDS.length - 1),
  );
  const base = BACKOFF_SERIES_SECONDS[idx];
  // jitter: +/- 20%
  const jitterFactor = 0.8 + Math.random() * 0.4;
  return Math.max(1, Math.round(base * jitterFactor));
}

export function safeParseIsoTimeMs(
  value: string | null | undefined,
): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

export function safeEndpointHost(endpoint: string): string | null {
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!isSafeRemoteUrl(endpoint)) return null;
    return url.host;
  } catch {
    return null;
  }
}
