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

const LOCKOUT_KEY_PREFIX = 'auth-lockout:v1';
const lockoutFallbackStore = new Map<string, LoginLockoutRecord>();

function getLockoutStorageKey(clientKey: string): string {
  return `${LOCKOUT_KEY_PREFIX}:${encodeURIComponent(clientKey)}`;
}

function parseLockoutRecord(raw: string | null): LoginLockoutRecord | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<LoginLockoutRecord>;
    if (
      typeof parsed.failedAttempts !== 'number'
      || typeof parsed.firstFailedAt !== 'number'
      || (parsed.lockoutUntil !== null && typeof parsed.lockoutUntil !== 'number')
    ) {
      return null;
    }
    return {
      failedAttempts: parsed.failedAttempts,
      firstFailedAt: parsed.firstFailedAt,
      lockoutUntil: parsed.lockoutUntil,
    };
  } catch {
    return null;
  }
}

function normalizeLockoutRecord(
  record: LoginLockoutRecord | null,
  now: number
): LoginLockoutRecord | null {
  if (!record) return null;

  if (record.lockoutUntil && record.lockoutUntil <= now) {
    return null;
  }

  if (now - record.firstFailedAt > LOGIN_LOCKOUT_CONFIG.trackingWindowMs) {
    return null;
  }

  return record;
}

function toStatus(record: LoginLockoutRecord | null, now: number): LoginLockoutStatus {
  if (!record) {
    return {
      locked: false,
      failedAttempts: 0,
      retryAfterSeconds: 0,
    };
  }

  const locked = !!record.lockoutUntil && record.lockoutUntil > now;
  return {
    locked,
    failedAttempts: record.failedAttempts,
    retryAfterSeconds: locked
      ? Math.max(1, Math.ceil((record.lockoutUntil! - now) / 1000))
      : 0,
  };
}

function fallbackRead(storageKey: string, now: number): LoginLockoutRecord | null {
  const record = normalizeLockoutRecord(lockoutFallbackStore.get(storageKey) || null, now);
  if (!record) {
    lockoutFallbackStore.delete(storageKey);
  }
  return record;
}

function fallbackWrite(storageKey: string, record: LoginLockoutRecord): void {
  lockoutFallbackStore.set(storageKey, record);
}

async function readRecord(
  kv: KVNamespace,
  storageKey: string,
  now: number
): Promise<LoginLockoutRecord | null> {
  try {
    const raw = await kv.get(storageKey);
    const record = normalizeLockoutRecord(parseLockoutRecord(raw), now);
    if (!record) {
      await kv.delete(storageKey);
    }
    return record;
  } catch (err) {
    console.warn('[Auth] Failed to read login lockout from KV, using local fallback', err);
    return fallbackRead(storageKey, now);
  }
}

async function writeRecord(
  kv: KVNamespace,
  storageKey: string,
  record: LoginLockoutRecord,
  now: number
): Promise<void> {
  const ttlMs = record.lockoutUntil
    ? record.lockoutUntil - now
    : LOGIN_LOCKOUT_CONFIG.trackingWindowMs - (now - record.firstFailedAt);
  const expirationTtl = Math.max(60, Math.ceil(ttlMs / 1000) + 60);

  try {
    await kv.put(storageKey, JSON.stringify(record), { expirationTtl });
  } catch (err) {
    console.warn('[Auth] Failed to write login lockout to KV, using local fallback', err);
    fallbackWrite(storageKey, record);
  }
}

async function deleteRecord(kv: KVNamespace, storageKey: string): Promise<void> {
  lockoutFallbackStore.delete(storageKey);
  try {
    await kv.delete(storageKey);
  } catch (err) {
    console.warn('[Auth] Failed to clear login lockout from KV', err);
  }
}

export async function getLoginLockoutStatus(
  kv: KVNamespace,
  clientKey: string,
  now = Date.now()
): Promise<LoginLockoutStatus> {
  const storageKey = getLockoutStorageKey(clientKey);
  const record = await readRecord(kv, storageKey, now);
  return toStatus(record, now);
}

export async function recordFailedLoginAttempt(
  kv: KVNamespace,
  clientKey: string,
  now = Date.now()
): Promise<LoginLockoutStatus> {
  const storageKey = getLockoutStorageKey(clientKey);
  const existing = await readRecord(kv, storageKey, now);

  if (existing?.lockoutUntil && existing.lockoutUntil > now) {
    return toStatus(existing, now);
  }

  const nextAttempts = existing ? existing.failedAttempts + 1 : 1;
  const firstFailedAt = existing ? existing.firstFailedAt : now;
  const shouldLock = nextAttempts >= LOGIN_LOCKOUT_CONFIG.maxFailedAttempts;

  const next: LoginLockoutRecord = {
    failedAttempts: nextAttempts,
    firstFailedAt,
    lockoutUntil: shouldLock ? now + LOGIN_LOCKOUT_CONFIG.lockoutMs : null,
  };

  await writeRecord(kv, storageKey, next, now);
  return toStatus(next, now);
}

export async function clearLoginLockout(
  kv: KVNamespace,
  clientKey: string
): Promise<void> {
  const storageKey = getLockoutStorageKey(clientKey);
  await deleteRecord(kv, storageKey);
}
