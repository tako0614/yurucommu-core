/// <reference types="@cloudflare/workers-types" />

import type { AuthContext } from "./auth-context-model";
import { requireFileSizeWithinPlan, requireStorageWithinPlan, type PlanGuardResult } from "./plan-guard";

export type PlanGuardError = Extract<PlanGuardResult, { ok: false }>;
export type StorageQuotaResult = { ok: true; usage: number } | { ok: false; guard: PlanGuardError };

const ensureTrailingSlash = (prefix: string): string => (prefix.endsWith("/") ? prefix : `${prefix}/`);

const sumUsageForPrefix = async (bucket: R2Bucket, prefix: string): Promise<number> => {
  let cursor: string | undefined;
  let total = 0;
  const normalized = ensureTrailingSlash(prefix);
  do {
    const result = await bucket.list({ prefix: normalized, cursor });
    for (const obj of result.objects || []) {
      total += obj.size ?? 0;
    }
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return total;
};

export async function checkStorageQuota(
  bucket: R2Bucket | null | undefined,
  prefix: string,
  auth: AuthContext | null,
  incomingBytes: number,
): Promise<StorageQuotaResult> {
  const fileGuard = requireFileSizeWithinPlan(auth, incomingBytes);
  if (!fileGuard.ok) {
    return { ok: false, guard: fileGuard };
  }

  if (!bucket) {
    return { ok: true, usage: 0 };
  }

  const usage = await sumUsageForPrefix(bucket, prefix);
  const guard = requireStorageWithinPlan(auth, usage, incomingBytes);
  if (!guard.ok) {
    return { ok: false, guard };
  }

  return { ok: true, usage };
}
