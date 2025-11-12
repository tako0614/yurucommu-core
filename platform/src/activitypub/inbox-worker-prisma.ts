/**
 * Legacy Prisma-based inbox worker (kept for reference).
 * 
 * The active implementation lives in `inbox-worker.ts`.
 */

import type { Env } from "./inbox-worker";

export async function processInboxQueue(_env: Env, _batchSize = 10): Promise<void> {
  throw new Error("inbox-worker-prisma.ts is deprecated. Use processInboxQueue from inbox-worker.ts");
}

