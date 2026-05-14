import type { IKeyValueStore } from "../runtime/types.ts";
import { logger } from "./logger.ts";

const log = logger.child({ component: "auth.lockout" });

export interface LoginLockoutStatus {
  locked: boolean;
  failedAttempts: number;
  retryAfterSeconds: number;
}

interface LoginLockoutRecord {
  failedAttempts: number;
  firstFailedAt: number;
  lockoutUntil: number | null;
}

export const LOGIN_LOCKOUT_CONFIG = {
  maxFailedAttempts: 5,
  lockoutMs: 15 * 60 * 1000,
  trackingWindowMs: 15 * 60 * 1000,
} as const;

const LOCKOUT_KEY_PREFIX = "auth-lockout:v1";
const lockoutFallbackStore = new Map<string, LoginLockoutRecord>();

function getLockoutStorageKey(clientKey: string): string {
  return `${LOCKOUT_KEY_PREFIX}:${encodeURIComponent(clientKey)}`;
}

function isValidRecord(v: unknown): v is LoginLockoutRecord {
  if (typeof v !== "object" || v === null) return false;
  const entry = v as Record<string, unknown>;
  return (
    typeof entry.failedAttempts === "number" &&
    typeof entry.firstFailedAt === "number" &&
    (entry.lockoutUntil === null || typeof entry.lockoutUntil === "number")
  );
}

function parseLockoutRecord(raw: string | null): LoginLockoutRecord | null {
  if (!raw) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isValidRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecordExpired(record: LoginLockoutRecord, now: number): boolean {
  if (record.lockoutUntil !== null && record.lockoutUntil <= now) return true;
  if (now - record.firstFailedAt > LOGIN_LOCKOUT_CONFIG.trackingWindowMs) {
    return true;
  }
  return false;
}

function normalizeLockoutRecord(
  record: LoginLockoutRecord | null,
  now: number,
): LoginLockoutRecord | null {
  if (!record) return null;
  return isRecordExpired(record, now) ? null : record;
}

const UNLOCKED_STATUS: LoginLockoutStatus = Object.freeze({
  locked: false,
  failedAttempts: 0,
  retryAfterSeconds: 0,
});

function toStatus(
  record: LoginLockoutRecord | null,
  now: number,
): LoginLockoutStatus {
  if (!record) return UNLOCKED_STATUS;

  const locked = record.lockoutUntil !== null && record.lockoutUntil > now;
  return {
    locked,
    failedAttempts: record.failedAttempts,
    retryAfterSeconds: locked
      ? Math.max(1, Math.ceil((record.lockoutUntil! - now) / 1000))
      : 0,
  };
}

function fallbackRead(
  storageKey: string,
  now: number,
): LoginLockoutRecord | null {
  const record = normalizeLockoutRecord(
    lockoutFallbackStore.get(storageKey) || null,
    now,
  );
  if (!record) {
    lockoutFallbackStore.delete(storageKey);
  }
  return record;
}

function fallbackWrite(storageKey: string, record: LoginLockoutRecord): void {
  lockoutFallbackStore.set(storageKey, record);
}

async function readRecord(
  kv: IKeyValueStore,
  storageKey: string,
  now: number,
): Promise<LoginLockoutRecord | null> {
  try {
    const raw = await kv.get(storageKey);
    const record = normalizeLockoutRecord(parseLockoutRecord(raw), now);
    if (!record) {
      await kv.delete(storageKey);
    }
    return record;
  } catch (err) {
    log.warn("Failed to read login lockout from KV, using local fallback", {
      event: "auth.lockout.kv_read_failed",
      error: err,
    });
    return fallbackRead(storageKey, now);
  }
}

async function writeRecord(
  kv: IKeyValueStore,
  storageKey: string,
  record: LoginLockoutRecord,
  now: number,
): Promise<void> {
  const ttlMs = record.lockoutUntil
    ? record.lockoutUntil - now
    : LOGIN_LOCKOUT_CONFIG.trackingWindowMs - (now - record.firstFailedAt);
  const expirationTtl = Math.max(60, Math.ceil(ttlMs / 1000) + 60);

  try {
    await kv.put(storageKey, JSON.stringify(record), { expirationTtl });
  } catch (err) {
    log.warn("Failed to write login lockout to KV, using local fallback", {
      event: "auth.lockout.kv_write_failed",
      error: err,
    });
    fallbackWrite(storageKey, record);
  }
}

async function deleteRecord(
  kv: IKeyValueStore,
  storageKey: string,
): Promise<void> {
  lockoutFallbackStore.delete(storageKey);
  try {
    await kv.delete(storageKey);
  } catch (err) {
    log.warn("Failed to clear login lockout from KV", {
      event: "auth.lockout.kv_delete_failed",
      error: err,
    });
  }
}

export async function getLoginLockoutStatus(
  kv: IKeyValueStore,
  clientKey: string,
  now = Date.now(),
): Promise<LoginLockoutStatus> {
  const storageKey = getLockoutStorageKey(clientKey);
  const record = await readRecord(kv, storageKey, now);
  return toStatus(record, now);
}

export async function recordFailedLoginAttempt(
  kv: IKeyValueStore,
  clientKey: string,
  now = Date.now(),
): Promise<LoginLockoutStatus> {
  const storageKey = getLockoutStorageKey(clientKey);
  const existing = await readRecord(kv, storageKey, now);

  // Already locked out -- return current status without extending
  if (
    existing?.lockoutUntil !== null && existing?.lockoutUntil !== undefined &&
    existing.lockoutUntil > now
  ) {
    return toStatus(existing, now);
  }

  const failedAttempts = (existing?.failedAttempts ?? 0) + 1;
  const firstFailedAt = existing?.firstFailedAt ?? now;
  const shouldLock = failedAttempts >= LOGIN_LOCKOUT_CONFIG.maxFailedAttempts;

  const next: LoginLockoutRecord = {
    failedAttempts,
    firstFailedAt,
    lockoutUntil: shouldLock ? now + LOGIN_LOCKOUT_CONFIG.lockoutMs : null,
  };

  await writeRecord(kv, storageKey, next, now);
  return toStatus(next, now);
}

export async function clearLoginLockout(
  kv: IKeyValueStore,
  clientKey: string,
): Promise<void> {
  const storageKey = getLockoutStorageKey(clientKey);
  await deleteRecord(kv, storageKey);
}
