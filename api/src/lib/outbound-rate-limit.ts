import { makeData } from "../data";
import { releaseStore } from "@takos/platform/server";
import type { PlanGuardResult } from "./plan-guard";

type OutboundAuthLike = {
  userId: string | null | undefined;
};

type OutboundRateLimitOptions = {
  /**
   * Optional namespace for the caller (e.g. "app-scheduled").
   * Included in the rate-limit key to avoid mixing sources.
   */
  actorKey?: string;
  perMinute?: number;
  perDay?: number;
};

const UNLIMITED = Number.MAX_SAFE_INTEGER;

const startOfDayUtc = (now = Date.now()): number => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

const startOfMinuteUtc = (now = Date.now()): number => {
  const d = new Date(now);
  d.setUTCSeconds(0, 0);
  return d.getTime();
};

const parseLimit = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) return Math.floor(value);
  if (typeof value !== "string") return null;
  const parsed = parseInt(value.trim(), 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const resolveEnvLimit = (env: Record<string, unknown>, keys: string[]): number | null => {
  for (const key of keys) {
    const value = env[key];
    const parsed = parseLimit(value);
    if (parsed !== null) return parsed;
  }
  return null;
};

const buildError = (code: "RATE_LIMIT_MINUTE" | "RATE_LIMIT_DAY", limit: number): PlanGuardResult => ({
  ok: false,
  status: 429,
  code,
  message: code === "RATE_LIMIT_MINUTE"
    ? `Outbound per-minute limit reached (${limit} per minute)`
    : `Outbound daily limit reached (${limit} per day)`,
  details: { limit },
});

/**
 * Rate limit outbound RPC calls made by app isolates.
 *
 * Backed by `ap_rate_limits` (D1) when available; otherwise no-op.
 */
export async function ensureOutboundCallAllowed(
  env: Record<string, unknown>,
  auth: OutboundAuthLike | null | undefined,
  options: OutboundRateLimitOptions = {},
): Promise<PlanGuardResult> {
  const userId = auth?.userId ?? null;
  const actorKey = userId ?? (options.actorKey ? `anon:${options.actorKey}` : "anonymous");

  const perMinute =
    typeof options.perMinute === "number"
      ? options.perMinute
      : resolveEnvLimit(env, ["OUTBOUND_RATE_LIMIT_PER_MINUTE"]) ?? 30;
  const perDay =
    typeof options.perDay === "number"
      ? options.perDay
      : resolveEnvLimit(env, ["OUTBOUND_RATE_LIMIT_PER_DAY"]) ?? 5000;

  if (perMinute <= 0) return buildError("RATE_LIMIT_MINUTE", perMinute);
  if (perDay <= 0) return buildError("RATE_LIMIT_DAY", perDay);

  if (!env?.DB) return { ok: true };
  if (
    (typeof perMinute !== "number" || !Number.isFinite(perMinute) || perMinute >= UNLIMITED) &&
    (typeof perDay !== "number" || !Number.isFinite(perDay) || perDay >= UNLIMITED)
  ) {
    return { ok: true };
  }

  const store = makeData(env as any);
  try {
    const deleteOld = (store as any).deleteOldRateLimits;
    const countFn = (store as any).countRateLimits;
    const createFn = (store as any).createRateLimitEntry;
    if (typeof countFn !== "function" || typeof createFn !== "function") {
      return { ok: true };
    }

    const now = Date.now();

    if (typeof perMinute === "number" && Number.isFinite(perMinute) && perMinute < UNLIMITED) {
      const windowStart = startOfMinuteUtc(now);
      const key = `outbound:fetch:minute:${actorKey}`;
      if (typeof deleteOld === "function") {
        await deleteOld(key, windowStart);
      }
      const current = await countFn(key, windowStart);
      const count = current?.count ?? 0;
      if (count >= perMinute) return buildError("RATE_LIMIT_MINUTE", perMinute);
      await createFn(crypto.randomUUID(), key, windowStart, now);
    }

    if (typeof perDay === "number" && Number.isFinite(perDay) && perDay < UNLIMITED) {
      const windowStart = startOfDayUtc(now);
      const key = `outbound:fetch:day:${actorKey}`;
      if (typeof deleteOld === "function") {
        await deleteOld(key, windowStart);
      }
      const current = await countFn(key, windowStart);
      const count = current?.count ?? 0;
      if (count >= perDay) return buildError("RATE_LIMIT_DAY", perDay);
      await createFn(crypto.randomUUID(), key, windowStart, now);
    }

    return { ok: true };
  } finally {
    await releaseStore(store as any);
  }
}

