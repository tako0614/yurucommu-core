import { describe, it, expect, vi, afterEach } from 'vitest';
import { checkCircuit, recordCircuitFailure, recordCircuitSuccess } from './circuit';

type CircuitRow = {
  endpoint: string;
  state: 'closed' | 'open' | 'half_open';
  consecutiveFailures: number;
  recentOutcomesJson: string;
  openUntil: string | null;
  halfOpenProbeAttempts: number;
  halfOpenProbeSuccesses: number;
};

function applySelect<T extends Record<string, unknown>>(row: T, select?: Record<string, boolean>) {
  if (!select) return row;
  const out: Record<string, unknown> = {};
  for (const [k, enabled] of Object.entries(select)) {
    if (enabled) out[k] = row[k as keyof T];
  }
  return out;
}

function createMockCircuitPrisma() {
  const store = new Map<string, CircuitRow>();

  const prisma = {
    deliveryCircuit: {
      findUnique: vi.fn(async (args: { where: { endpoint: string }; select?: Record<string, boolean> }) => {
        const row = store.get(args.where.endpoint) ?? null;
        return row ? applySelect(row, args.select) : null;
      }),
      create: vi.fn(async (args: { data: CircuitRow; select?: Record<string, boolean> }) => {
        store.set(args.data.endpoint, { ...args.data });
        const row = store.get(args.data.endpoint)!;
        return applySelect(row, args.select);
      }),
      update: vi.fn(async (args: { where: { endpoint: string }; data: Partial<CircuitRow>; select?: Record<string, boolean> }) => {
        const existing = store.get(args.where.endpoint);
        if (!existing) throw new Error('missing circuit');
        const next = { ...existing, ...args.data } as CircuitRow;
        store.set(args.where.endpoint, next);
        return applySelect(next, args.select);
      }),
    },
    __store: store,
  };

  return prisma;
}

describe('delivery/circuit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('opens after 5 consecutive failures, then transitions to half-open', async () => {
    const endpoint = 'https://remote.example/inbox';
    const prisma = createMockCircuitPrisma();

    vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(prisma as any, endpoint);
    }

    const res = await checkCircuit(prisma as any, endpoint);
    expect(res.allow).toBe(false);
    if (!res.allow) {
      expect(res.deferSeconds).toBeGreaterThan(0);
    }

    // Open window elapsed -> half-open and allow probes.
    (Date.now as any).mockReturnValue(5 * 60 * 1000 + 1);
    const res2 = await checkCircuit(prisma as any, endpoint);
    expect(res2.allow).toBe(true);
    expect(prisma.__store.get(endpoint)?.state).toBe('half_open');
  });

  it('closes after 3 successful half-open probes', async () => {
    const endpoint = 'https://remote.example/inbox';
    const prisma = createMockCircuitPrisma();

    vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(prisma as any, endpoint);
    }
    (Date.now as any).mockReturnValue(5 * 60 * 1000 + 1);
    await checkCircuit(prisma as any, endpoint);

    await recordCircuitSuccess(prisma as any, endpoint);
    await recordCircuitSuccess(prisma as any, endpoint);
    await recordCircuitSuccess(prisma as any, endpoint);

    const row = prisma.__store.get(endpoint);
    expect(row?.state).toBe('closed');
    expect(row?.consecutiveFailures).toBe(0);
    expect(row?.halfOpenProbeAttempts).toBe(0);
    expect(row?.halfOpenProbeSuccesses).toBe(0);
  });

  it('re-opens immediately on half-open failure', async () => {
    const endpoint = 'https://remote.example/inbox';
    const prisma = createMockCircuitPrisma();

    vi.spyOn(Date, 'now').mockReturnValue(0);
    for (let i = 0; i < 5; i++) {
      await recordCircuitFailure(prisma as any, endpoint);
    }
    (Date.now as any).mockReturnValue(5 * 60 * 1000 + 1);
    await checkCircuit(prisma as any, endpoint);

    await recordCircuitFailure(prisma as any, endpoint);
    const row = prisma.__store.get(endpoint);
    expect(row?.state).toBe('open');
    expect(row?.consecutiveFailures).toBeGreaterThanOrEqual(5);
    expect(row?.openUntil).toBeTruthy();
  });
});

