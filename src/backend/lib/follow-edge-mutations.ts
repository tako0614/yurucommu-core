import { and, eq, gt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { actors, blocks, follows } from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import { isSameActivityPubActor } from "./activitypub-actor-identity.ts";

const LEGACY_FOLLOW_EDGE_CANDIDATE_LIMIT = 64;

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

async function resolveRetainedFollowEdge(
  db: Database,
  followerApId: string,
  followingApId: string,
): Promise<{ followerApId: string; followingApId: string }> {
  const exact = await db
    .select({
      followerApId: follows.followerApId,
      followingApId: follows.followingApId,
    })
    .from(follows)
    .where(
      and(
        eq(follows.followerApId, followerApId),
        eq(follows.followingApId, followingApId),
      ),
    )
    .get();
  if (exact) return exact;

  const candidates = await db
    .select({
      followerApId: follows.followerApId,
      followingApId: follows.followingApId,
    })
    .from(follows)
    .where(
      or(
        eq(follows.followerApId, followerApId),
        eq(follows.followingApId, followingApId),
      ),
    )
    .limit(LEGACY_FOLLOW_EDGE_CANDIDATE_LIMIT)
    .all();
  return (
    candidates.find(
      (candidate) =>
        isSameActivityPubActor(candidate.followerApId, followerApId) &&
        isSameActivityPubActor(candidate.followingApId, followingApId),
    ) ?? { followerApId, followingApId }
  );
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
  const [leftToRight, rightToLeft] = await Promise.all([
    resolveRetainedFollowEdge(db, leftApId, rightApId),
    resolveRetainedFollowEdge(db, rightApId, leftApId),
  ]);
  await runBatch(db, [
    ...severFollowEdgeStatements(
      db,
      leftToRight.followerApId,
      leftToRight.followingApId,
    ),
    ...severFollowEdgeStatements(
      db,
      rightToLeft.followerApId,
      rightToLeft.followingApId,
    ),
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
  const [blockedToBlocker, blockerToBlocked] = await Promise.all([
    resolveRetainedFollowEdge(db, blockedApId, blockerApId),
    resolveRetainedFollowEdge(db, blockerApId, blockedApId),
  ]);
  await runBatch(db, [
    db
      .insert(blocks)
      .values({ blockerApId, blockedApId })
      .onConflictDoNothing(),
    ...severFollowEdgeStatements(
      db,
      blockedToBlocker.followerApId,
      blockedToBlocker.followingApId,
    ),
    ...severFollowEdgeStatements(
      db,
      blockerToBlocked.followerApId,
      blockerToBlocked.followingApId,
    ),
  ]);
}
