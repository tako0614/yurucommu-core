import { and, eq, gt, or, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { actors, blocks, follows } from "../../db/index.ts";
import type { Database } from "../../db/index.ts";
import { activityPubActorIdentityMatchesSql } from "./activitypub-actor-identity-sql.ts";
import { resolveRetainedPersonalBlockTarget } from "./personal-actor-moderation.ts";

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

  // Every personal follow edge has at least one exact local endpoint. Narrow on
  // that indexed endpoint, then compare the retained remote endpoint through
  // the complete verified-actor identity set. The previous 64-row JS scan
  // forgot older edges and let a block leave follower delivery authority alive.
  const followingMatches = activityPubActorIdentityMatchesSql(
    sql`
      SELECT ${follows.followingApId}
      FROM ${follows}
      WHERE ${follows.followerApId} = ${followerApId}
    `,
    followingApId,
  );
  const followerMatches = activityPubActorIdentityMatchesSql(
    sql`
      SELECT ${follows.followerApId}
      FROM ${follows}
      WHERE ${follows.followingApId} = ${followingApId}
    `,
    followerApId,
  );
  return (
    (await db
      .select({
        followerApId: follows.followerApId,
        followingApId: follows.followingApId,
      })
      .from(follows)
      .where(
        or(
          and(
            eq(follows.followerApId, followerApId),
            sql`${follows.followingApId} IN (${followingMatches})`,
          ),
          and(
            eq(follows.followingApId, followingApId),
            sql`${follows.followerApId} IN (${followerMatches})`,
          ),
        ),
      )
      .limit(1)
      .get()) ?? { followerApId, followingApId }
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
  const [retainedBlockTarget, blockedToBlocker, blockerToBlocked] =
    await Promise.all([
      resolveRetainedPersonalBlockTarget(db, blockerApId, blockedApId),
      resolveRetainedFollowEdge(db, blockedApId, blockerApId),
      resolveRetainedFollowEdge(db, blockerApId, blockedApId),
    ]);
  await runBatch(db, [
    db
      .insert(blocks)
      .values({
        blockerApId,
        blockedApId: retainedBlockTarget ?? blockedApId,
      })
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
