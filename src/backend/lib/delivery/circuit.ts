import type { Database } from "../../../db/index.ts";
import { eq } from "drizzle-orm";
import { deliveryCircuit } from "../../../db/index.ts";
import { safeParseIsoTimeMs } from "./transformers.ts";
import { logger } from "../logger.ts";

const log = logger.child({ component: "delivery.circuit" });

export type CircuitState = "closed" | "open" | "half_open";

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

type CircuitData = Partial<Omit<CircuitRow, "endpoint">>;

const INITIAL_CIRCUIT_DATA: CircuitData = {
  state: "closed",
  consecutiveFailures: 0,
  recentOutcomesJson: "[]",
  openUntil: null,
  halfOpenProbeAttempts: 0,
  halfOpenProbeSuccesses: 0,
};

function parseRecentOutcomes(json: string): number[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((v) => (v === 1 ? 1 : 0)).slice(-RECENT_WINDOW_SIZE);
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
  db: Database,
  endpoint: string,
  outcome: 0 | 1,
): Promise<{ circuit: CircuitRow; recent: number[] }> {
  const circuit = await getOrCreateCircuit(db, endpoint);
  const recent = parseRecentOutcomes(circuit.recentOutcomesJson);
  recent.push(outcome);
  return { circuit, recent };
}

function buildOpenData(
  recent: number[],
  consecutiveFailures: number,
): CircuitData {
  return {
    state: "open",
    consecutiveFailures,
    recentOutcomesJson: serializeRecentOutcomes(recent),
    openUntil: new Date(Date.now() + OPEN_DURATION_MS).toISOString(),
    halfOpenProbeAttempts: 0,
    halfOpenProbeSuccesses: 0,
  };
}

async function updateCircuit(
  db: Database,
  endpoint: string,
  data: CircuitData,
): Promise<void> {
  await db
    .update(deliveryCircuit)
    .set(data)
    .where(eq(deliveryCircuit.endpoint, endpoint));
}

async function getOrCreateCircuit(
  db: Database,
  endpoint: string,
): Promise<CircuitRow> {
  const columns = {
    endpoint: deliveryCircuit.endpoint,
    state: deliveryCircuit.state,
    consecutiveFailures: deliveryCircuit.consecutiveFailures,
    recentOutcomesJson: deliveryCircuit.recentOutcomesJson,
    openUntil: deliveryCircuit.openUntil,
    halfOpenProbeAttempts: deliveryCircuit.halfOpenProbeAttempts,
    halfOpenProbeSuccesses: deliveryCircuit.halfOpenProbeSuccesses,
  };

  const existing = await db
    .select(columns)
    .from(deliveryCircuit)
    .where(eq(deliveryCircuit.endpoint, endpoint))
    .get();
  if (existing) return existing as CircuitRow;

  // Race-safe create. checkCircuit() calls this BEFORE the per-host bulkhead is
  // acquired, and deliver_endpoint messages run concurrently (Cloudflare Queues
  // is at-least-once), so two deliveries to the SAME never-seen endpoint can both
  // pass the SELECT and reach this INSERT. `endpoint` is the PRIMARY KEY, so the
  // second bare INSERT would throw a UNIQUE/PK violation and force a 60s message
  // redelivery. onConflictDoNothing makes it race-safe; if the conflict swallowed
  // our row (returning() empty), re-select the row the winner created. (Mirrors
  // the actor_cache cold-insert discipline.)
  const created = await db
    .insert(deliveryCircuit)
    .values({ endpoint, ...INITIAL_CIRCUIT_DATA })
    .onConflictDoNothing()
    .returning(columns)
    .get();
  if (created) return created as CircuitRow;

  const winner = await db
    .select(columns)
    .from(deliveryCircuit)
    .where(eq(deliveryCircuit.endpoint, endpoint))
    .get();
  return winner as CircuitRow;
}

export async function checkCircuit(
  db: Database,
  endpoint: string,
): Promise<{ allow: true } | { allow: false; deferSeconds: number }> {
  const now = Date.now();
  const circuit = await getOrCreateCircuit(db, endpoint);

  if (circuit.state === "open") {
    const untilMs = safeParseIsoTimeMs(circuit.openUntil);
    if (untilMs !== null && now < untilMs) {
      const deferSeconds = Math.max(1, Math.ceil((untilMs - now) / 1000));
      return { allow: false, deferSeconds };
    }

    // Transition to half-open when open window elapsed.
    await updateCircuit(db, endpoint, {
      state: "half_open",
      openUntil: null,
      halfOpenProbeAttempts: 0,
      halfOpenProbeSuccesses: 0,
    });
    return { allow: true };
  }

  if (
    circuit.state === "half_open" &&
    circuit.halfOpenProbeAttempts >= HALF_OPEN_PROBES
  ) {
    return { allow: false, deferSeconds: HALF_OPEN_DEFER_SECONDS };
  }

  return { allow: true };
}

export async function recordCircuitSuccess(
  db: Database,
  endpoint: string,
): Promise<void> {
  const { circuit, recent } = await loadCircuitWithOutcome(db, endpoint, 0);
  const serialized = serializeRecentOutcomes(recent);

  if (circuit.state === "half_open") {
    const nextAttempts = circuit.halfOpenProbeAttempts + 1;
    const nextSuccesses = circuit.halfOpenProbeSuccesses + 1;
    const allProbesSucceeded =
      nextAttempts >= HALF_OPEN_PROBES && nextSuccesses >= HALF_OPEN_PROBES;

    await updateCircuit(
      db,
      endpoint,
      allProbesSucceeded
        ? { ...INITIAL_CIRCUIT_DATA, recentOutcomesJson: serialized }
        : {
            consecutiveFailures: 0,
            recentOutcomesJson: serialized,
            halfOpenProbeAttempts: nextAttempts,
            halfOpenProbeSuccesses: nextSuccesses,
          },
    );
    return;
  }

  await updateCircuit(db, endpoint, {
    consecutiveFailures: 0,
    recentOutcomesJson: serialized,
  });
}

// CONCURRENCY NOTE (accepted, bounded): the circuit state (counter + recent-
// outcome window + state machine) is read here and written via a blind UPDATE in
// updateCircuit, so two concurrent deliveries to the SAME endpoint can lose one
// of their increments / window samples (last-writer-wins). This is deliberately
// NOT made strongly consistent: it is a delivery THROTTLE heuristic, not a
// correctness/security invariant — the only effect of a lost increment is the
// breaker opening a couple of failures later than CONSECUTIVE_FAILURE_THRESHOLD,
// costing a few extra attempts to an already-failing host. The per-host bulkhead
// (BULKHEAD_PER_DOMAIN) bounds the concurrency. A strongly-consistent version
// would need a Durable Object (single-threaded) or a CAS+retry loop on this hot
// path — disproportionate for a throttle, so it is left best-effort by design.
export async function recordCircuitFailure(
  db: Database,
  endpoint: string,
): Promise<void> {
  const { circuit, recent } = await loadCircuitWithOutcome(db, endpoint, 1);

  // Half-open failure: immediately re-open.
  if (circuit.state === "half_open") {
    await updateCircuit(
      db,
      endpoint,
      buildOpenData(recent, CONSECUTIVE_FAILURE_THRESHOLD),
    );
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
    await updateCircuit(
      db,
      endpoint,
      buildOpenData(recent, consecutiveFailures),
    );
    log.warn("Circuit opened", {
      event: "delivery.circuit.opened",
      endpoint,
      consecutiveFailures,
      failures,
      windowSize: window.length,
    });
    return;
  }

  await updateCircuit(db, endpoint, {
    consecutiveFailures,
    recentOutcomesJson: serializeRecentOutcomes(recent),
  });
}
