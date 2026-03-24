import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkCircuit, recordCircuitFailure, recordCircuitSuccess } from '../../../lib/delivery/circuit';

type CircuitRow = {
  endpoint: string;
  state: 'closed' | 'open' | 'half_open';
  consecutiveFailures: number;
  recentOutcomesJson: string;
  openUntil: string | null;
  halfOpenProbeAttempts: number;
  halfOpenProbeSuccesses: number;
};

/**
 * Creates a mock Drizzle-compatible db object for circuit breaker tests.
 * The production code uses:
 *   db.select({...}).from(table).where(cond).get()
 *   db.insert(table).values({...}).returning({...}).get()
 *   db.update(table).set({...}).where(cond)
 */
function createMockCircuitDb() {
  const store = new Map<string, CircuitRow>();

  function chainable(terminatorValue: unknown) {
    const chain: Record<string, any> = {};
    const proxy = new Proxy(chain, {
      get(_target, prop) {
        if (prop === 'then') return undefined; // not a thenable
        if (prop === 'get') return () => Promise.resolve(terminatorValue);
        return (..._args: any[]) => proxy;
      },
    });
    return proxy;
  }

  const db = {
    select: vi.fn((_fields?: any) => {
      // Returns chainable .from().where().get()
      return {
        from: (_table: any) => ({
          where: (..._args: any[]) => ({
            get: async () => {
              // We need the endpoint from the where clause.
              // Since we can't easily parse drizzle-orm eq() calls,
              // use a workaround: inspect store entries.
              // The circuit code always queries by endpoint, so we
              // intercept via a different approach below.
              return undefined;
            },
          }),
        }),
      };
    }),

    insert: vi.fn((_table: any) => {
      return {
        values: (data: any) => ({
          returning: (_fields?: any) => ({
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
      };
    }),

    update: vi.fn((_table: any) => {
      return {
        set: (data: any) => ({
          where: (..._args: any[]) => {
            // Need to find which endpoint is being updated.
            // The circuit code calls: db.update(deliveryCircuit).set(data).where(eq(deliveryCircuit.endpoint, endpoint))
            // We'll update all matching rows (there's typically one).
            // Since we can't parse eq() args easily, use a deferred approach.
            return Promise.resolve();
          },
        }),
      };
    }),

    __store: store,
  };

  // Override with a more sophisticated implementation that actually tracks endpoints
  // The production code pattern:
  //   getOrCreateCircuit: db.select({...}).from(deliveryCircuit).where(eq(deliveryCircuit.endpoint, endpoint)).get()
  //   insert: db.insert(deliveryCircuit).values({endpoint, ...data}).returning({...}).get()
  //   update: db.update(deliveryCircuit).set(data).where(eq(deliveryCircuit.endpoint, endpoint))

  // We need to capture the endpoint argument from eq() calls.
  // Let's intercept at a higher level with proper argument capture.

  const lastSelectEndpoint: string | null = null;
  const lastUpdateEndpoint: string | null = null;
  const lastUpdateData: Partial<CircuitRow> | null = null;

  // Create a function that captures the first string arg from eq()-like calls
  function captureEndpointFromWhere(args: any[]): string | null {
    // drizzle eq() returns an object. The second arg to eq() is the value.
    // We look for the endpoint value in the args or scan the store.
    // Actually, drizzle's eq() result is an opaque SQL object.
    // We need a different strategy: mock at the store level.
    return null;
  }

  // Better approach: create a proxy-based mock that intercepts the full chain
  const mockDb = {
    select: vi.fn((_fields?: any) => ({
      from: (_table: any) => ({
        where: (...whereArgs: any[]) => ({
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

    insert: vi.fn((_table: any) => ({
      values: (data: any) => ({
        returning: (_fields?: any) => ({
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

    update: vi.fn((_table: any) => ({
      set: (data: any) => ({
        where: (...whereArgs: any[]) => {
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

  return mockDb;
}

/**
 * Extract the bound value from a drizzle eq() condition object.
 * drizzle-orm eq() stores the condition as queryChunks where
 * Param objects hold the bound values (e.g., queryChunks[3].value).
 */
function extractValueFromEq(condition: any): string | null {
  if (!condition) return null;

  // drizzle-orm stores query chunks; Param objects have a .value property
  const chunks = condition?.queryChunks;
  if (Array.isArray(chunks)) {
    for (const chunk of chunks) {
      if (chunk?.constructor?.name === 'Param' && typeof chunk.value === 'string') {
        return chunk.value;
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

    vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(db as any, endpoint);
    }

    const res = await checkCircuit(db as any, endpoint);
    expect(res.allow).toBe(false);
    if (!res.allow) {
      expect(res.deferSeconds).toBeGreaterThan(0);
    }

    // Open window elapsed -> half-open and allow probes.
    (Date.now as any).mockReturnValue(5 * 60 * 1000 + 1);
    const res2 = await checkCircuit(db as any, endpoint);
    expect(res2.allow).toBe(true);
    expect(db.__store.get(endpoint)?.state).toBe('half_open');
  });

  it('closes after 3 successful half-open probes', async () => {
    const endpoint = 'https://remote.example/inbox';
    const db = createMockCircuitDb();

    vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(db as any, endpoint);
    }
    (Date.now as any).mockReturnValue(5 * 60 * 1000 + 1);
    await checkCircuit(db as any, endpoint);

    await recordCircuitSuccess(db as any, endpoint);
    await recordCircuitSuccess(db as any, endpoint);
    await recordCircuitSuccess(db as any, endpoint);

    const row = db.__store.get(endpoint);
    expect(row?.state).toBe('closed');
    expect(row?.consecutiveFailures).toBe(0);
    expect(row?.halfOpenProbeAttempts).toBe(0);
    expect(row?.halfOpenProbeSuccesses).toBe(0);
  });

  it('re-opens immediately on half-open failure', async () => {
    const endpoint = 'https://remote.example/inbox';
    const db = createMockCircuitDb();

    vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(db as any, endpoint);
    }
    (Date.now as any).mockReturnValue(5 * 60 * 1000 + 1);
    await checkCircuit(db as any, endpoint);

    await recordCircuitFailure(db as any, endpoint);
    const row = db.__store.get(endpoint);
    expect(row?.state).toBe('open');
    expect(row?.consecutiveFailures).toBeGreaterThanOrEqual(5);
    expect(row?.openUntil).toBeTruthy();
  });
});
