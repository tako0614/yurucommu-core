import { and, eq, gt, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { actors, blocks, follows } from "../../db/index.ts";
import type { Database } from "../../db/index.ts";

type BatchStatement = BatchItem<"sqlite">;
interface BatchableDb {
  batch(
    statements: readonly [BatchStatement, ...BatchStatement[]],
  ): Promise<unknown>;
}

function severFollowEdgeStatements(
  db: Database,
  followerApId: string,
  followingApId: string,
): [BatchStatement, BatchStatement, BatchStatement] {
  const acceptedEdgeExists = sql`EXISTS (SELECT 1 FROM ${follows} WHERE ${follows.followerApId} = ${followerApId} AND ${follows.followingApId} = ${followingApId} AND ${follows.status} = 'accepted')`;
  return [
    db
      .update(actors)
      .set({ followingCount: sql`${actors.followingCount} - 1` })
      .where(
        and(
          eq(actors.apId, followerApId),
          gt(actors.followingCount, 0),
          acceptedEdgeExists,
        ),
      ),
    db
      .update(actors)
      .set({ followerCount: sql`${actors.followerCount} - 1` })
      .where(
        and(
          eq(actors.apId, followingApId),
          gt(actors.followerCount, 0),
          acceptedEdgeExists,
        ),
      ),
    db
      .delete(follows)
      .where(
        and(
          eq(follows.followerApId, followerApId),
          eq(follows.followingApId, followingApId),
        ),
      ),
  ];
}

async function runBatch(
  db: Database,
  statements: readonly [BatchStatement, ...BatchStatement[]],
): Promise<void> {
  await (db as unknown as BatchableDb).batch(statements);
}

/**
 * Atomically sever both follow directions and reconcile their denormalized
 * counters. Pending/absent edges are clean no-ops and retries cannot underflow.
 */
export async function severFollowPair(
  db: Database,
  leftApId: string,
  rightApId: string,
): Promise<void> {
  await runBatch(db, [
    ...severFollowEdgeStatements(db, leftApId, rightApId),
    ...severFollowEdgeStatements(db, rightApId, leftApId),
  ]);
}

/**
 * Persist a local personal block and sever both follow directions as one D1
 * commit. A storage failure must not leave either authority state half-applied.
 */
export async function blockActorAndSeverFollowPair(
  db: Database,
  blockerApId: string,
  blockedApId: string,
): Promise<void> {
  await runBatch(db, [
    db
      .insert(blocks)
      .values({ blockerApId, blockedApId })
      .onConflictDoNothing(),
    ...severFollowEdgeStatements(db, blockedApId, blockerApId),
    ...severFollowEdgeStatements(db, blockerApId, blockedApId),
  ]);
}
