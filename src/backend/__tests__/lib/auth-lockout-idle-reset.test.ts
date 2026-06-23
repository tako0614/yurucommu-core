import { expect, test } from "bun:test";

/**
 * Audit #16 #12 — the login lockout's tracking window MUST be longer than the
 * lockout duration. When they were equal (both 15m), a paced attacker who made
 * <=4 failures then idled 15m got a fully-reset record and NEVER tripped the
 * lock, repeatable forever, so the control contributed nothing against a
 * low-and-slow brute force. With a 60m window over a 5-attempt cap, idling no
 * longer resets the counter and the 5th failure within the hour engages the lock.
 */

import {
  getLoginLockoutStatus,
  LOGIN_LOCKOUT_CONFIG,
  recordFailedLoginAttempt,
} from "../../lib/auth-lockout.ts";
import type { IKeyValueStore } from "../../runtime/types.ts";

function memoryKv(): IKeyValueStore {
  const store = new Map<string, string>();
  return {
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string | ArrayBuffer | ReadableStream) {
      store.set(key, String(value));
    },
    async delete(key: string) {
      store.delete(key);
    },
    async list() {
      return { keys: [], list_complete: true };
    },
  } as unknown as IKeyValueStore;
}

test("the tracking window is longer than the lockout duration (idle cannot instantly reset)", () => {
  expect(LOGIN_LOCKOUT_CONFIG.trackingWindowMs).toBeGreaterThan(
    LOGIN_LOCKOUT_CONFIG.lockoutMs,
  );
});

test("a paced attacker (4 fails, then idle past the lockout duration) STILL trips the lock", async () => {
  const kv = memoryKv();
  const t0 = 1_000_000_000;

  // 4 failures — under the cap, not locked.
  for (let i = 0; i < 4; i++) {
    const s = await recordFailedLoginAttempt(kv, "1.2.3.4", t0 + i * 1000);
    expect(s.locked).toBe(false);
  }

  // Idle PAST the lockout duration (the old tracking window) but within the new
  // 60-minute tracking window: the counter is NOT reset, so the 5th failure
  // engages the lock. Under the old (equal) window this 5th attempt would have
  // started a fresh record (failedAttempts=1, not locked) — the bypass.
  const afterIdle = t0 + LOGIN_LOCKOUT_CONFIG.lockoutMs + 1000;
  const locked = await recordFailedLoginAttempt(kv, "1.2.3.4", afterIdle);
  expect(locked.locked).toBe(true);
  expect(locked.failedAttempts).toBe(5);

  // And the status reflects the lock for a subsequent check.
  const status = await getLoginLockoutStatus(kv, "1.2.3.4", afterIdle + 1000);
  expect(status.locked).toBe(true);
});

test("the record still fully expires once the tracking window elapses", async () => {
  const kv = memoryKv();
  const t0 = 2_000_000_000;
  for (let i = 0; i < 4; i++) {
    await recordFailedLoginAttempt(kv, "5.6.7.8", t0 + i * 1000);
  }
  // Past the full tracking window: the record is discarded, so a new failure
  // starts fresh (a legitimate user is not penalised indefinitely).
  const afterWindow = t0 + LOGIN_LOCKOUT_CONFIG.trackingWindowMs + 1000;
  const fresh = await recordFailedLoginAttempt(kv, "5.6.7.8", afterWindow);
  expect(fresh.locked).toBe(false);
  expect(fresh.failedAttempts).toBe(1);
});
