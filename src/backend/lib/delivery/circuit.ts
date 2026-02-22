import type { PrismaClient } from '../../../generated/prisma';
import { safeParseIsoTimeMs } from './utils';

export type CircuitState = 'closed' | 'open' | 'half_open';

const OPEN_DURATION_MS = 5 * 60 * 1000;
const HALF_OPEN_PROBES = 3;
const HALF_OPEN_DEFER_SECONDS = 30;
const RECENT_WINDOW_SIZE = 20;
const CONSECUTIVE_FAILURE_THRESHOLD = 5;
const FAILURE_RATE_THRESHOLD = 0.6;

type CircuitRow = {
  endpoint: string;
  state: CircuitState;
  consecutiveFailures: number;
  recentOutcomesJson: string; // JSON array of 0(success)/1(failure)
  openUntil: string | null;
  halfOpenProbeAttempts: number;
  halfOpenProbeSuccesses: number;
};

type CircuitData = Partial<Omit<CircuitRow, 'endpoint'>>;

const CIRCUIT_SELECT = {
  endpoint: true,
  state: true,
  consecutiveFailures: true,
  recentOutcomesJson: true,
  openUntil: true,
  halfOpenProbeAttempts: true,
  halfOpenProbeSuccesses: true,
} as const;

const INITIAL_CIRCUIT_DATA: CircuitData = {
  state: 'closed',
  consecutiveFailures: 0,
  recentOutcomesJson: '[]',
  openUntil: null,
  halfOpenProbeAttempts: 0,
  halfOpenProbeSuccesses: 0,
};

function parseRecentOutcomes(json: string): number[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => (v === 1 ? 1 : 0))
      .slice(-RECENT_WINDOW_SIZE);
  } catch {
    return [];
  }
}

function serializeRecentOutcomes(values: number[]): string {
  return JSON.stringify(values.slice(-RECENT_WINDOW_SIZE));
}

/**
 * Loads the circuit row for an endpoint and appends an outcome (0=success, 1=failure).
 * Returns the row and the updated recent-outcomes array ready for persistence.
 */
async function loadCircuitWithOutcome(
  prisma: PrismaClient,
  endpoint: string,
  outcome: 0 | 1
): Promise<{ circuit: CircuitRow; recent: number[] }> {
  const circuit = await getOrCreateCircuit(prisma, endpoint);
  const recent = parseRecentOutcomes(circuit.recentOutcomesJson);
  recent.push(outcome);
  return { circuit, recent };
}

function buildOpenData(recent: number[], consecutiveFailures: number): CircuitData {
  return {
    state: 'open',
    consecutiveFailures,
    recentOutcomesJson: serializeRecentOutcomes(recent),
    openUntil: new Date(Date.now() + OPEN_DURATION_MS).toISOString(),
    halfOpenProbeAttempts: 0,
    halfOpenProbeSuccesses: 0,
  };
}

async function updateCircuit(prisma: PrismaClient, endpoint: string, data: CircuitData): Promise<void> {
  await prisma.deliveryCircuit.update({ where: { endpoint }, data });
}

async function getOrCreateCircuit(prisma: PrismaClient, endpoint: string): Promise<CircuitRow> {
  const existing = await prisma.deliveryCircuit.findUnique({
    where: { endpoint },
    select: CIRCUIT_SELECT,
  });
  if (existing) return existing as CircuitRow;

  const created = await prisma.deliveryCircuit.create({
    data: { endpoint, ...INITIAL_CIRCUIT_DATA },
    select: CIRCUIT_SELECT,
  });
  return created as CircuitRow;
}

export async function checkCircuit(
  prisma: PrismaClient,
  endpoint: string
): Promise<{ allow: true } | { allow: false; deferSeconds: number }> {
  const now = Date.now();
  const circuit = await getOrCreateCircuit(prisma, endpoint);

  if (circuit.state === 'open') {
    const untilMs = safeParseIsoTimeMs(circuit.openUntil);
    if (untilMs !== null && now < untilMs) {
      const deferSeconds = Math.max(1, Math.ceil((untilMs - now) / 1000));
      return { allow: false, deferSeconds };
    }

    // Transition to half-open when open window elapsed.
    await updateCircuit(prisma, endpoint, {
      state: 'half_open',
      openUntil: null,
      halfOpenProbeAttempts: 0,
      halfOpenProbeSuccesses: 0,
    });
    return { allow: true };
  }

  if (circuit.state === 'half_open' && circuit.halfOpenProbeAttempts >= HALF_OPEN_PROBES) {
    return { allow: false, deferSeconds: HALF_OPEN_DEFER_SECONDS };
  }

  return { allow: true };
}

export async function recordCircuitSuccess(prisma: PrismaClient, endpoint: string): Promise<void> {
  const { circuit, recent } = await loadCircuitWithOutcome(prisma, endpoint, 0);
  const serialized = serializeRecentOutcomes(recent);

  if (circuit.state === 'half_open') {
    const nextAttempts = circuit.halfOpenProbeAttempts + 1;
    const nextSuccesses = circuit.halfOpenProbeSuccesses + 1;
    const allProbesSucceeded = nextAttempts >= HALF_OPEN_PROBES && nextSuccesses >= HALF_OPEN_PROBES;

    await updateCircuit(prisma, endpoint, allProbesSucceeded
      ? { ...INITIAL_CIRCUIT_DATA, recentOutcomesJson: serialized }
      : {
          consecutiveFailures: 0,
          recentOutcomesJson: serialized,
          halfOpenProbeAttempts: nextAttempts,
          halfOpenProbeSuccesses: nextSuccesses,
        });
    return;
  }

  await updateCircuit(prisma, endpoint, { consecutiveFailures: 0, recentOutcomesJson: serialized });
}

export async function recordCircuitFailure(prisma: PrismaClient, endpoint: string): Promise<void> {
  const { circuit, recent } = await loadCircuitWithOutcome(prisma, endpoint, 1);

  // Half-open failure: immediately re-open.
  if (circuit.state === 'half_open') {
    await updateCircuit(prisma, endpoint, buildOpenData(recent, CONSECUTIVE_FAILURE_THRESHOLD));
    return;
  }

  const consecutiveFailures = circuit.consecutiveFailures + 1;
  const window = recent.slice(-RECENT_WINDOW_SIZE);
  const failures = window.reduce((sum, v) => sum + v, 0);
  const fullWindow = window.length === RECENT_WINDOW_SIZE;

  // Open conditions (contract):
  // - N consecutive failures OR
  // - failure rate >= threshold over a full recent window.
  const shouldOpen =
    consecutiveFailures >= CONSECUTIVE_FAILURE_THRESHOLD ||
    (fullWindow && failures / RECENT_WINDOW_SIZE >= FAILURE_RATE_THRESHOLD);

  if (shouldOpen) {
    await updateCircuit(prisma, endpoint, buildOpenData(recent, consecutiveFailures));
    console.warn('[DeliveryCircuit] OPEN', {
      endpoint,
      at: new Date().toISOString(),
      consecutiveFailures,
      failures,
      window: window.length,
    });
    return;
  }

  await updateCircuit(prisma, endpoint, {
    consecutiveFailures,
    recentOutcomesJson: serializeRecentOutcomes(recent),
  });
}

