import type { TakosConfig } from "@takos/platform/config/takos-config";
import { releaseStore } from "@takos/platform/server";
import { makeData } from "../data";
import type { PlanGuardResult } from "./plan-guard";

type PlanLimitsShape = {
  dmMessagesPerDay?: number;
  dmMediaSize?: number;
};

type AuthLike = {
  userId: string | null | undefined;
  plan?: { limits?: PlanLimitsShape } | null;
};

const DM_RATE_LIMIT_PREFIX = "dm:send:";
const UNLIMITED = Number.MAX_SAFE_INTEGER;

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patternToRegex = (pattern: string): RegExp => {
  const normalized = (pattern || "").trim();
  const escaped = escapeRegex(normalized);
  return new RegExp(`^${escaped.replace(/\\\*/g, ".*")}$`);
};

export const isEndpointDisabled = (
  config: TakosConfig | null | undefined,
  path: string,
): boolean => {
  if (!path) return false;
  const patterns = config?.api?.disabled_api_endpoints;
  if (!Array.isArray(patterns) || !patterns.length) return false;
  const normalizedPath = path.endsWith("/") && path !== "/" ? path.replace(/\/+$/, "") : path;
  return patterns.some((pattern) => {
    if (typeof pattern !== "string" || !pattern.trim()) return false;
    const normalizedPattern = pattern.trim().startsWith("/")
      ? pattern.trim()
      : `/${pattern.trim()}`;
    const regex = patternToRegex(normalizedPattern);
    return regex.test(normalizedPath);
  });
};

const startOfDayUtc = (now = Date.now()): number => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
};

const formatMb = (bytes: number): number => Math.max(1, Math.ceil(bytes / 1024 / 1024));

export async function ensureDmSendAllowed(
  env: any,
  auth: AuthLike,
  options: { mediaKeys?: string[]; mediaBytes?: number } = {},
): Promise<PlanGuardResult> {
  const userId = auth?.userId ?? null;
  if (!userId) {
    return { ok: false, status: 401, message: "Authentication required" };
  }

  const limits = auth?.plan?.limits ?? {};

  const dailyLimit = limits.dmMessagesPerDay;
  if (typeof dailyLimit === "number") {
    if (dailyLimit <= 0) {
      return { ok: false, status: 402, message: "DM sending is not available for this plan" };
    }

    if (Number.isFinite(dailyLimit) && dailyLimit < UNLIMITED && env?.DB) {
      const store = makeData(env);
      const windowStart = startOfDayUtc();
      const key = `${DM_RATE_LIMIT_PREFIX}${userId}`;
      try {
        if (typeof (store as any).deleteOldRateLimits === "function") {
          await (store as any).deleteOldRateLimits(key, windowStart);
        }
        const countFn = (store as any).countRateLimits;
        const createFn = (store as any).createRateLimitEntry;
        if (typeof countFn === "function" && typeof createFn === "function") {
          const result = await countFn(key, windowStart);
          const count = result?.count ?? 0;
          if (count >= dailyLimit) {
            return {
              ok: false,
              status: 429,
              message: `DM daily limit reached (${dailyLimit} per day)`,
            };
          }
          await createFn(crypto.randomUUID(), key, windowStart, Date.now());
        }
      } finally {
        await releaseStore(store as any);
      }
    }
  }

  const mediaLimit = limits.dmMediaSize;
  const mediaKeys = (options.mediaKeys ?? []).filter(
    (key) => typeof key === "string" && key.trim().length > 0,
  );
  const hasMedia = mediaKeys.length > 0 || typeof options.mediaBytes === "number";

  if (hasMedia && typeof mediaLimit === "number") {
    if (mediaLimit <= 0) {
      return { ok: false, status: 402, message: "DM media attachments are not available for this plan" };
    }

    if (Number.isFinite(mediaLimit) && mediaLimit < UNLIMITED && mediaKeys.length) {
      const bucket = (env as any)?.MEDIA;
      if (!bucket || (typeof bucket.head !== "function" && typeof bucket.get !== "function")) {
        return { ok: false, status: 500, message: "media storage not configured" };
      }

      let total = typeof options.mediaBytes === "number" ? options.mediaBytes : 0;
      for (const key of mediaKeys) {
        const obj =
          typeof bucket.head === "function"
            ? await bucket.head(key).catch(() => null)
            : await bucket.get(key).catch(() => null);
        if (!obj) {
          return { ok: false, status: 404, message: "media not found" };
        }
        const size = (obj as any).size ?? 0;
        if (size > mediaLimit) {
          return {
            ok: false,
            status: 413,
            message: `DM media exceeds plan limit (${formatMb(mediaLimit)}MB)`,
          };
        }
        if (typeof options.mediaBytes !== "number") {
          total += size;
        }
      }

      if (total > mediaLimit) {
        return {
          ok: false,
          status: 413,
          message: `DM media exceeds plan limit (${formatMb(mediaLimit)}MB total)`,
        };
      }
    } else if (Number.isFinite(mediaLimit) && mediaLimit < UNLIMITED && typeof options.mediaBytes === "number") {
      if (options.mediaBytes > mediaLimit) {
        return {
          ok: false,
          status: 413,
          message: `DM media exceeds plan limit (${formatMb(mediaLimit)}MB)`,
        };
      }
    }
  }

  return { ok: true };
}
