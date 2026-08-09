import { and, eq, gt, not, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
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

function followDirectionIdentityWhere(
  followerApId: string,
  followingApId: string,
): SQL {
  // Every personal follow edge has at least one exact local endpoint. Narrow on
  // that indexed endpoint, then compare the retained remote endpoint through
  // the complete verified-actor identity set.
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
  return or(
    and(
      eq(follows.followerApId, followerApId),
      sql`${follows.followingApId} IN (${followingMatches})`,
    ),
    and(
      eq(follows.followingApId, followingApId),
      sql`${follows.followerApId} IN (${followerMatches})`,
    ),
  ) as SQL;
}

function actorIdentityWhere(actorApId: string): SQL {
  const retainedActors = activityPubActorIdentityMatchesSql(
    sql`SELECT ${actors.apId} FROM ${actors}`,
    actorApId,
  );
  return sql`${actors.apId} IN (${retainedActors})`;
}

function severFollowDirectionStatements(
  db: Database,
  followerApId: string,
  followingApId: string,
): [BatchStatement, BatchStatement, BatchStatement] {
  const edgeWhere = followDirectionIdentityWhere(followerApId, followingApId);
  const acceptedEdgeCount = sql<number>`(
    SELECT COUNT(*)
    FROM ${follows}
    WHERE ${edgeWhere} AND ${follows.status} = 'accepted'
  )`;
  return [
    db
      .update(actors)
      .set({
        followingCount: sql`MAX(0, ${actors.followingCount} - ${acceptedEdgeCount})`,
      })
      .where(
        and(actorIdentityWhere(followerApId), gt(actors.followingCount, 0)),
      ),
    db
      .update(actors)
      .set({
        followerCount: sql`MAX(0, ${actors.followerCount} - ${acceptedEdgeCount})`,
      })
      .where(
        and(actorIdentityWhere(followingApId), gt(actors.followerCount, 0)),
      ),
    db.delete(follows).where(edgeWhere),
  ];
}

/**
 * Remove every retained spelling of one logical follow direction and reconcile
 * both endpoint counters in the same atomic batch.
 *
 * At least one endpoint must be the exact local actor/group IRI. The other may
 * be any verified cosmetic spelling of the same remote actor. This keeps the
 * query bounded to an indexed local endpoint while preventing a Reject,
 * Remove, or Undo from leaving a second equivalent row with delivery or
 * membership authority.
 */
export async function severFollowDirection(
  db: Database,
  followerApId: string,
  followingApId: string,
): Promise<void> {
  await runBatch(
    db,
    severFollowDirectionStatements(db, followerApId, followingApId),
  );
}

/**
 * Converge one logical follow direction to exactly one accepted retained row.
 *
 * Cosmetic remote-actor spellings can coexist in legacy data because the raw
 * pair is the physical primary key. Accept/Add must not accept one row while a
 * second remains pending, nor count two already-accepted spellings as two
 * people. Reconcile each endpoint by the accepted-row delta, delete equivalent
 * duplicates, and transition the retained row in one batch.
 */
export async function acceptRetainedFollowDirection(
  db: Database,
  retainedFollowerApId: string,
  retainedFollowingApId: string,
  acceptedAt: string,
): Promise<void> {
  const edgeWhere = followDirectionIdentityWhere(
    retainedFollowerApId,
    retainedFollowingApId,
  );
  const eligibleContribution = sql<number>`(
    CASE WHEN EXISTS (
      SELECT 1
      FROM ${follows}
      WHERE ${edgeWhere}
        AND ${follows.status} IN ('pending', 'accepted')
    ) THEN 1 ELSE 0 END
  )`;
  const acceptedEdgeCount = sql<number>`(
    SELECT COUNT(*)
    FROM ${follows}
    WHERE ${edgeWhere} AND ${follows.status} = 'accepted'
  )`;
  const retainedEdge = and(
    eq(follows.followerApId, retainedFollowerApId),
    eq(follows.followingApId, retainedFollowingApId),
  ) as SQL;

  await runBatch(db, [
    db
      .update(actors)
      .set({
        followingCount: sql`MAX(0, ${actors.followingCount} + ${eligibleContribution} - ${acceptedEdgeCount})`,
      })
      .where(actorIdentityWhere(retainedFollowerApId)),
    db
      .update(actors)
      .set({
        followerCount: sql`MAX(0, ${actors.followerCount} + ${eligibleContribution} - ${acceptedEdgeCount})`,
      })
      .where(actorIdentityWhere(retainedFollowingApId)),
    db.delete(follows).where(and(edgeWhere, not(retainedEdge))),
    db
      .update(follows)
      .set({ status: "accepted", acceptedAt })
      .where(and(retainedEdge, eq(follows.status, "pending"))),
  ]);
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
    ...severFollowDirectionStatements(db, leftApId, rightApId),
    ...severFollowDirectionStatements(db, rightApId, leftApId),
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
  const retainedBlockTarget = await resolveRetainedPersonalBlockTarget(
    db,
    blockerApId,
    blockedApId,
  );
  await runBatch(db, [
    db
      .insert(blocks)
      .values({
        blockerApId,
        blockedApId: retainedBlockTarget ?? blockedApId,
      })
      .onConflictDoNothing(),
    ...severFollowDirectionStatements(db, blockedApId, blockerApId),
    ...severFollowDirectionStatements(db, blockerApId, blockedApId),
  ]);
}
