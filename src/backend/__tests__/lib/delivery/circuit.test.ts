import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest';
import { checkCircuit, recordCircuitFailure, recordCircuitSuccess } from '../../../lib/delivery/circuit';
import type { Database } from '../../../../db';

type CircuitRow = {
  endpoint: string;
  state: 'closed' | 'open' | 'half_open';
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

  // Better approach: create a proxy-based mock that intercepts the full chain
  const mockDb = {
    select: vi.fn((_fields?: unknown) => ({
      from: (_table: unknown) => ({
        where: (...whereArgs: unknown[]) => ({
          get: async () => {
            // Extract endpoint from the eq() condition.
            // The whereArgs[0] is the result of eq(deliveryCircuit.endpoint, endpoint).
            // In drizzle-orm, eq() returns a SQL condition object.
            // We need to extract the value. Let's inspect the structure.
            const endpoint = extractValueFromEq(whereArgs[0]);
            if (endpoint) {
              return store.get(endpoint) ?? undefined;
            }
            return undefined;
          },
        }),
      }),
    })),

    insert: vi.fn((_table: unknown) => ({
      values: (data: Partial<CircuitRow> & { endpoint: string }) => ({
        returning: (_fields?: unknown) => ({
          get: async () => {
            const row: CircuitRow = {
              endpoint: data.endpoint,
              state: data.state ?? 'closed',
              consecutiveFailures: data.consecutiveFailures ?? 0,
              recentOutcomesJson: data.recentOutcomesJson ?? '[]',
              openUntil: data.openUntil ?? null,
              halfOpenProbeAttempts: data.halfOpenProbeAttempts ?? 0,
              halfOpenProbeSuccesses: data.halfOpenProbeSuccesses ?? 0,
            };
            store.set(row.endpoint, row);
            return row;
          },
        }),
      }),
    })),

    update: vi.fn((_table: unknown) => ({
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
    })),

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
  if (!condition || typeof condition !== 'object') return null;

  // drizzle-orm stores query chunks; Param objects have a .value property
  const chunks = (condition as { queryChunks?: unknown[] }).queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      if (
        chunk &&
        typeof chunk === 'object' &&
        (chunk as { constructor?: { name?: string } }).constructor?.name === 'Param' &&
        typeof (chunk as { value?: unknown }).value === 'string'
      ) {
        return (chunk as { value: string }).value;
      }
    }
  }

  return null;
}

describe('delivery/circuit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens after 5 consecutive failures, then transitions to half-open', async () => {
    const endpoint = 'https://remote.example/inbox';
    const db = createMockCircuitDb();

    const dateNowSpy: MockInstance = vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(db, endpoint);
    }

    const res = await checkCircuit(db, endpoint);
    expect(res.allow).toBe(false);
    if (!res.allow) {
      expect(res.deferSeconds).toBeGreaterThan(0);
    }

    // Open window elapsed -> half-open and allow probes.
    dateNowSpy.mockReturnValue(5 * 60 * 1000 + 1);
    const res2 = await checkCircuit(db, endpoint);
    expect(res2.allow).toBe(true);
    expect(db.__store.get(endpoint)?.state).toBe('half_open');
  });

  it('closes after 3 successful half-open probes', async () => {
    const endpoint = 'https://remote.example/inbox';
    const db = createMockCircuitDb();

    const dateNowSpy: MockInstance = vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(db, endpoint);
    }
    dateNowSpy.mockReturnValue(5 * 60 * 1000 + 1);
    await checkCircuit(db, endpoint);

    await recordCircuitSuccess(db, endpoint);
    await recordCircuitSuccess(db, endpoint);
    await recordCircuitSuccess(db, endpoint);

    const row = db.__store.get(endpoint);
    expect(row?.state).toBe('closed');
    expect(row?.consecutiveFailures).toBe(0);
    expect(row?.halfOpenProbeAttempts).toBe(0);
    expect(row?.halfOpenProbeSuccesses).toBe(0);
  });

  it('re-opens immediately on half-open failure', async () => {
    const endpoint = 'https://remote.example/inbox';
    const db = createMockCircuitDb();

    const dateNowSpy: MockInstance = vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(db, endpoint);
    }
    dateNowSpy.mockReturnValue(5 * 60 * 1000 + 1);
    await checkCircuit(db, endpoint);

    await recordCircuitFailure(db, endpoint);
    const row = db.__store.get(endpoint);
    expect(row?.state).toBe('open');
    expect(row?.consecutiveFailures).toBeGreaterThanOrEqual(5);
    expect(row?.openUntil).toBeTruthy();
  });
});
