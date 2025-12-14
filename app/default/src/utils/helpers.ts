import type { AppEnv } from "@takos/app-sdk/server";
import { json } from "@takos/app-sdk/server";
import { computeDigest, verifySignature } from "@takos/ap-utils";
import { buildActivityPubPolicy } from "@takos/platform/activitypub/federation-policy";
import { getOrFetchActor, verifyActorOwnsKey } from "@takos/platform/activitypub/actor-fetch";

// ============================================================================
// Common Helpers
// ============================================================================

export const parseBooleanEnv = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
};

export const createSystemCtx = () =>
  ({
    userId: null,
    sessionId: null,
    isAuthenticated: false,
    plan: { name: "system", limits: {}, features: [] },
    limits: {},
  }) as any;

// ============================================================================
// ActivityPub Helpers
// ============================================================================

export const activityPubJson = <T,>(data: T, status = 200): Response =>
  json(data, {
    status,
    headers: {
      "Content-Type": "application/activity+json; charset=utf-8",
    },
  });

export const activityPubError = (message: string, status = 400): Response =>
  activityPubJson({ ok: false, error: message }, status);

// Helper to check if activity is public or unlisted
export const isPublicOrUnlisted = (activity: any): boolean => {
  const PUBLIC = "https://www.w3.org/ns/activitystreams#Public";
  const checkField = (field: any): boolean => {
    if (!field) return false;
    const arr = Array.isArray(field) ? field : [field];
    return arr.includes(PUBLIC);
  };
  // Check activity level
  if (checkField(activity?.to) || checkField(activity?.cc)) return true;
  // Check object level (for Create/Update activities)
  const obj = activity?.object;
  if (obj && typeof obj === "object") {
    if (checkField(obj.to) || checkField(obj.cc)) return true;
  }
  return false;
};

// ============================================================================
// Digest Verification
// ============================================================================

export const digestHeaderValue = (digestHeader: string | null): string | null => {
  if (!digestHeader) return null;
  for (const part of digestHeader.split(",")) {
    const trimmed = part.trim();
    const match = trimmed.match(/^sha-256=(.+)$/i);
    if (match?.[1]) return match[1].trim();
  }
  return null;
};

export const verifyInboxDigest = async (bodyText: string, digestHeader: string | null): Promise<boolean> => {
  const expectedRaw = digestHeaderValue(digestHeader);
  if (!expectedRaw) return false;
  const computed = await computeDigest(bodyText);
  const computedRaw = digestHeaderValue(computed);
  return Boolean(computedRaw && expectedRaw && computedRaw === expectedRaw);
};

// ============================================================================
// Date Header Verification
// ============================================================================

export const verifyInboxDateHeader = (dateHeader: string | null): boolean => {
  if (!dateHeader) return false;

  // RFC 2616 date format should end with "GMT"
  // Example: "Sun, 06 Nov 1994 08:49:37 GMT"
  const trimmed = dateHeader.trim();
  if (!trimmed.endsWith("GMT")) {
    console.warn(`[inbox] Date header not in RFC 2616 format (missing GMT): ${dateHeader}`);
    // Allow non-GMT dates for compatibility, but log the warning
  }

  const requestTime = new Date(dateHeader).getTime();
  if (Number.isNaN(requestTime)) return false;

  const now = Date.now();
  // Stricter 2-minute window (ActivityPub best practice)
  const maxAge = 2 * 60 * 1000;
  const diff = Math.abs(now - requestTime);

  if (diff > maxAge) {
    console.warn(`[inbox] Date header out of range: ${dateHeader} (diff: ${Math.round(diff / 1000)}s)`);
    return false;
  }

  return true;
};

// ============================================================================
// Federation Policy
// ============================================================================

export const resolveFederationPolicy = (env: AppEnv) =>
  buildActivityPubPolicy({
    env: env as any,
    config: (env as any)?.takosConfig?.activitypub ?? (env as any)?.activitypub ?? null,
  });

// ============================================================================
// Rate Limiting
// ============================================================================

export const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
export const RATE_LIMIT_MAX_REQUESTS = 100; // 100 requests per minute per actor
const rateLimitCache = new Map<string, { count: number; resetAt: number }>();

export const checkInboxRateLimit = (actorId: string): { allowed: boolean; remaining: number; resetAt: number } => {
  const now = Date.now();
  const key = `inbox:${actorId}`;

  // Clean up old entries periodically (every 100 checks)
  if (Math.random() < 0.01) {
    for (const [k, v] of rateLimitCache.entries()) {
      if (v.resetAt < now) rateLimitCache.delete(k);
    }
  }

  const entry = rateLimitCache.get(key);

  if (!entry || entry.resetAt < now) {
    // New window
    const resetAt = now + RATE_LIMIT_WINDOW_MS;
    rateLimitCache.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1, resetAt };
  }

  if (entry.count >= RATE_LIMIT_MAX_REQUESTS) {
    return { allowed: false, remaining: 0, resetAt: entry.resetAt };
  }

  entry.count += 1;
  return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - entry.count, resetAt: entry.resetAt };
};

// ============================================================================
// Activity Deduplication
// ============================================================================

const ACTIVITY_DEDUP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ACTIVITY_DEDUP_MAX_SIZE = 10000; // Max cached activity IDs
const activityDedupCache = new Map<string, number>(); // activity_id -> timestamp

export const isActivityDuplicate = (activityId: string | undefined): boolean => {
  if (!activityId || typeof activityId !== "string") return false;

  const now = Date.now();

  // Clean up old entries if cache is getting large
  if (activityDedupCache.size > ACTIVITY_DEDUP_MAX_SIZE) {
    const cutoff = now - ACTIVITY_DEDUP_TTL_MS;
    for (const [id, ts] of activityDedupCache.entries()) {
      if (ts < cutoff) activityDedupCache.delete(id);
    }
  }

  const existing = activityDedupCache.get(activityId);
  if (existing && (now - existing) < ACTIVITY_DEDUP_TTL_MS) {
    console.warn(`[inbox] Duplicate activity detected: ${activityId}`);
    return true;
  }

  // Mark as seen
  activityDedupCache.set(activityId, now);
  return false;
};

// ============================================================================
// Signature Verification
// ============================================================================

export const verifyInboxSignature = async (env: AppEnv, request: Request, actorId: string): Promise<boolean> => {
  try {
    const ok = await verifySignature(request, async (keyId: string) => {
      const ownsKey = await verifyActorOwnsKey(actorId, keyId, env as any, fetch);
      if (!ownsKey) throw new Error("key ownership verification failed");
      const actor = await getOrFetchActor(actorId, env as any, false, fetch);
      const publicKeyPem = actor?.publicKey?.publicKeyPem;
      if (!publicKeyPem) throw new Error("missing public key");
      return publicKeyPem;
    });
    return ok;
  } catch {
    return false;
  }
};
