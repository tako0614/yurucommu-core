import type { PrismaClient } from '../../../generated/prisma';
import { safeParseIsoTimeMs } from './utils';

export type CircuitState = 'closed' | 'open' | 'half_open';

const OPEN_DURATION_MS = 5 * 60 * 1000;
const HALF_OPEN_PROBES = 3;

type CircuitRow = {
  endpoint: string;
  state: CircuitState;
  consecutiveFailures: number;
  recentOutcomesJson: string; // JSON array of 0(success)/1(failure)
  openUntil: string | null;
  halfOpenProbeAttempts: number;
  halfOpenProbeSuccesses: number;
};

function parseRecent(json: string): number[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => (v === 1 ? 1 : 0))
      .slice(-20);
  } catch {
    return [];
  }
}

function serializeRecent(values: number[]): string {
  return JSON.stringify(values.slice(-20));
}

async function getOrCreateCircuit(prisma: PrismaClient, endpoint: string): Promise<CircuitRow> {
  const existing = await prisma.deliveryCircuit.findUnique({
    where: { endpoint },
    select: {
      endpoint: true,
      state: true,
      consecutiveFailures: true,
      recentOutcomesJson: true,
      openUntil: true,
      halfOpenProbeAttempts: true,
      halfOpenProbeSuccesses: true,
    },
  });
  if (existing) return existing as CircuitRow;

  const created = await prisma.deliveryCircuit.create({
    data: {
      endpoint,
      state: 'closed',
      consecutiveFailures: 0,
      recentOutcomesJson: '[]',
      openUntil: null,
      halfOpenProbeAttempts: 0,
      halfOpenProbeSuccesses: 0,
    },
    select: {
      endpoint: true,
      state: true,
      consecutiveFailures: true,
      recentOutcomesJson: true,
      openUntil: true,
      halfOpenProbeAttempts: true,
      halfOpenProbeSuccesses: true,
    },
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
    await prisma.deliveryCircuit.update({
      where: { endpoint },
      data: {
        state: 'half_open',
        openUntil: null,
        halfOpenProbeAttempts: 0,
        halfOpenProbeSuccesses: 0,
      },
    });
    return { allow: true };
  }

  if (circuit.state === 'half_open') {
    if (circuit.halfOpenProbeAttempts >= HALF_OPEN_PROBES) {
      // Only allow a small number of probes. Defer the rest.
      return { allow: false, deferSeconds: 30 };
    }
  }

  return { allow: true };
}

export async function recordCircuitSuccess(prisma: PrismaClient, endpoint: string): Promise<void> {
  const circuit = await getOrCreateCircuit(prisma, endpoint);
  const recent = parseRecent(circuit.recentOutcomesJson);
  recent.push(0);

  if (circuit.state === 'half_open') {
    const nextAttempts = circuit.halfOpenProbeAttempts + 1;
    const nextSuccesses = circuit.halfOpenProbeSuccesses + 1;

    if (nextAttempts >= HALF_OPEN_PROBES) {
      // Close only if all probes succeeded.
      if (nextSuccesses >= HALF_OPEN_PROBES) {
        await prisma.deliveryCircuit.update({
          where: { endpoint },
          data: {
            state: 'closed',
            consecutiveFailures: 0,
            recentOutcomesJson: serializeRecent(recent),
            openUntil: null,
            halfOpenProbeAttempts: 0,
            halfOpenProbeSuccesses: 0,
          },
        });
        return;
      }
    }

    await prisma.deliveryCircuit.update({
      where: { endpoint },
      data: {
        consecutiveFailures: 0,
        recentOutcomesJson: serializeRecent(recent),
        halfOpenProbeAttempts: nextAttempts,
        halfOpenProbeSuccesses: nextSuccesses,
      },
    });
    return;
  }

  await prisma.deliveryCircuit.update({
    where: { endpoint },
    data: {
      consecutiveFailures: 0,
      recentOutcomesJson: serializeRecent(recent),
    },
  });
}

export async function recordCircuitFailure(prisma: PrismaClient, endpoint: string): Promise<void> {
  const nowIso = new Date().toISOString();
  const circuit = await getOrCreateCircuit(prisma, endpoint);
  const recent = parseRecent(circuit.recentOutcomesJson);
  recent.push(1);

  // Half-open failure: immediately re-open.
  if (circuit.state === 'half_open') {
    const openUntil = new Date(Date.now() + OPEN_DURATION_MS).toISOString();
    await prisma.deliveryCircuit.update({
      where: { endpoint },
      data: {
        state: 'open',
        consecutiveFailures: 5,
        recentOutcomesJson: serializeRecent(recent),
        openUntil,
        halfOpenProbeAttempts: 0,
        halfOpenProbeSuccesses: 0,
      },
    });
    return;
  }

  const consecutiveFailures = circuit.consecutiveFailures + 1;
  const window = recent.slice(-20);
  const failures = window.reduce((sum, v) => sum + (v === 1 ? 1 : 0), 0);
  const failureRate = window.length === 20 ? failures / 20 : 0;

  // Open conditions (contract):
  // - 5 consecutive failures OR
  // - >=60% failures over the last 20 attempts.
  const shouldOpen = consecutiveFailures >= 5 || (window.length === 20 && failureRate >= 0.6);

  if (shouldOpen) {
    const openUntil = new Date(Date.now() + OPEN_DURATION_MS).toISOString();
    await prisma.deliveryCircuit.update({
      where: { endpoint },
      data: {
        state: 'open',
        consecutiveFailures,
        recentOutcomesJson: serializeRecent(recent),
        openUntil,
        halfOpenProbeAttempts: 0,
        halfOpenProbeSuccesses: 0,
      },
    });
    console.warn('[DeliveryCircuit] OPEN', { endpoint, at: nowIso, consecutiveFailures, failures, window: window.length });
    return;
  }

  await prisma.deliveryCircuit.update({
    where: { endpoint },
    data: {
      consecutiveFailures,
      recentOutcomesJson: serializeRecent(recent),
    },
  });
}

