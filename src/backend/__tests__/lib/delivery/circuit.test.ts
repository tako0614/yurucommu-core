import { expect, test } from "bun:test";

import { stub } from "jsr:@std/testing/mock";
import {
  checkCircuit,
  recordCircuitFailure,
  recordCircuitSuccess,
} from "../../../lib/delivery/circuit.ts";
import type { Database } from "../../../../db/index.ts";

type CircuitRow = {
  endpoint: string;
  state: "closed" | "open" | "half_open";
  consecutiveFailures: number;
  recentOutcomesJson: string;
  openUntil: string | null;
  halfOpenProbeAttempts: number;
  halfOpenProbeSuccesses: number;
};

/** Return type for the mock db, exposing the internal store for assertions. */
type MockCircuitDb = Database & { __store: Map<string, CircuitRow> };

/**
 * Creates a mock Drizzle-compatible db object for circuit breaker tests.
 * The production code uses:
 *   db.select({...}).from(table).where(cond).get()
 *   db.insert(table).values({...}).returning({...}).get()
 *   db.update(table).set({...}).where(cond)
 */
function createMockCircuitDb(): MockCircuitDb {
  const store = new Map<string, CircuitRow>();

  const mockDb = {
    select: (_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (...whereArgs: unknown[]) => ({
          get: async () => {
            const endpoint = extractValueFromEq(whereArgs[0]);
            if (endpoint) {
              return store.get(endpoint) ?? undefined;
            }
            return undefined;
          },
        }),
      }),
    }),

    insert: (_table: unknown) => ({
      values: (data: Partial<CircuitRow> & { endpoint: string }) => ({
        returning: (_fields?: unknown) => ({
          get: async () => {
            const row: CircuitRow = {
              endpoint: data.endpoint,
              state: data.state ?? "closed",
              consecutiveFailures: data.consecutiveFailures ?? 0,
              recentOutcomesJson: data.recentOutcomesJson ?? "[]",
              openUntil: data.openUntil ?? null,
              halfOpenProbeAttempts: data.halfOpenProbeAttempts ?? 0,
              halfOpenProbeSuccesses: data.halfOpenProbeSuccesses ?? 0,
            };
            store.set(row.endpoint, row);
            return row;
          },
        }),
      }),
    }),

    update: (_table: unknown) => ({
      set: (data: Partial<CircuitRow>) => ({
        where: (...whereArgs: unknown[]) => {
          const endpoint = extractValueFromEq(whereArgs[0]);
          if (endpoint) {
            const existing = store.get(endpoint);
            if (existing) {
              store.set(endpoint, { ...existing, ...data });
            }
          }
          return Promise.resolve();
        },
      }),
    }),

    __store: store,
  };

  return mockDb as unknown as MockCircuitDb;
}

/**
 * Extract the bound value from a drizzle eq() condition object.
 * drizzle-orm eq() stores the condition as queryChunks where
 * Param objects hold the bound values (e.g., queryChunks[3].value).
 */
function extractValueFromEq(condition: unknown): string | null {
  if (!condition || typeof condition !== "object") return null;

  const chunks = (condition as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      if (
        chunk &&
        typeof chunk === "object" &&
        (chunk as { constructor?: { name?: string } }).constructor?.name ===
          "Param" &&
        typeof (chunk as { value?: unknown }).value === "string"
      ) {
        return (chunk as { value: string }).value;
      }
    }
  }

  return null;
}

test("delivery/circuit - opens after 5 consecutive failures, then transitions to half-open", async () => {
  const endpoint = "https://remote.example/inbox";
  const db = createMockCircuitDb();

  const dateNowStub = stub(Date, "now", () => 0);
  try {
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(db, endpoint);
    }

    const res = await checkCircuit(db, endpoint);
    expect(res.allow).toEqual(false);
    if (!res.allow) {
      expect(res.deferSeconds > 0).toBeTruthy();
    }

    // Open window elapsed -> half-open and allow probes.
    dateNowStub.restore();
    const dateNowStub2 = stub(Date, "now", () => 5 * 60 * 1000 + 1);
    try {
      const res2 = await checkCircuit(db, endpoint);
      expect(res2.allow).toEqual(true);
      expect(db.__store.get(endpoint)?.state).toEqual("half_open");
    } finally {
      dateNowStub2.restore();
    }
  } finally {
    // Ensure restore even if inner stub wasn't created
    try {
      dateNowStub.restore();
    } catch { /* already restored */ }
  }
});

test("delivery/circuit - closes after 3 successful half-open probes", async () => {
  const endpoint = "https://remote.example/inbox";
  const db = createMockCircuitDb();

  const dateNowStub = stub(Date, "now", () => 0);
  try {
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(db, endpoint);
    }

    dateNowStub.restore();
    const dateNowStub2 = stub(Date, "now", () => 5 * 60 * 1000 + 1);
    try {
      await checkCircuit(db, endpoint);

      await recordCircuitSuccess(db, endpoint);
      await recordCircuitSuccess(db, endpoint);
      await recordCircuitSuccess(db, endpoint);

      const row = db.__store.get(endpoint);
      expect(row?.state).toEqual("closed");
      expect(row?.consecutiveFailures).toEqual(0);
      expect(row?.halfOpenProbeAttempts).toEqual(0);
      expect(row?.halfOpenProbeSuccesses).toEqual(0);
    } finally {
      dateNowStub2.restore();
    }
  } finally {
    try {
      dateNowStub.restore();
    } catch { /* already restored */ }
  }
});

test("delivery/circuit - re-opens immediately on half-open failure", async () => {
  const endpoint = "https://remote.example/inbox";
  const db = createMockCircuitDb();

  const dateNowStub = stub(Date, "now", () => 0);
  try {
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(db, endpoint);
    }

    dateNowStub.restore();
    const dateNowStub2 = stub(Date, "now", () => 5 * 60 * 1000 + 1);
    try {
      await checkCircuit(db, endpoint);

      await recordCircuitFailure(db, endpoint);
      const row = db.__store.get(endpoint);
      expect(row?.state).toEqual("open");
      expect((row?.consecutiveFailures ?? 0) >= 5).toBeTruthy();
      expect(row?.openUntil).toBeTruthy();
    } finally {
      dateNowStub2.restore();
    }
  } finally {
    try {
      dateNowStub.restore();
    } catch { /* already restored */ }
  }
});
