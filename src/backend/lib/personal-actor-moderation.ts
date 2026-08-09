import { and, eq, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../db/index.ts";
import { blocks, mutes } from "../../db/index.ts";
import { normalizeActivityPubActorId } from "./activitypub-actor-identity.ts";
import {
  activityPubActorIdentityMatchesSql,
  activityPubActorIdentitySetSql,
} from "./activitypub-actor-identity-sql.ts";

// Historical regression boundary retained for fixtures: mutation compatibility
// used to inspect only the newest 512 rows. Production mutation queries no
// longer use this value; they match the complete SQL identity set.
export const LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT = 512;

export function canonicalPersonalModerationActorId(actorApId: string): string {
  return normalizeActivityPubActorId(actorApId) ?? actorApId;
}

async function actorIdentitySetContains(
  db: Database,
  actorApId: string,
  rawActorIds: SQL,
): Promise<boolean> {
  const identitySet = activityPubActorIdentitySetSql(rawActorIds);
  const canonicalActorApId = canonicalPersonalModerationActorId(actorApId);
  const match = (await db.get(sql`
    SELECT CASE
      WHEN ${canonicalActorApId} IN (${identitySet}) THEN 1
      ELSE 0
    END AS matched
  `)) as { matched: number } | undefined;
  return match?.matched === 1;
}

export async function resolveRetainedPersonalBlockTarget(
  db: Database,
  blockerApId: string,
  blockedApId: string,
): Promise<string | null> {
  const exact = await db
    .select({ actorApId: blocks.blockedApId })
    .from(blocks)
    .where(
      and(
        eq(blocks.blockerApId, blockerApId),
        eq(blocks.blockedApId, blockedApId),
      ),
    )
    .get();
  if (exact) return exact.actorApId;

  const matches = activityPubActorIdentityMatchesSql(
    sql`
      SELECT ${blocks.blockedApId}
      FROM ${blocks}
      WHERE ${blocks.blockerApId} = ${blockerApId}
    `,
    blockedApId,
  );
  // BaseSQLiteDatabase.get() normalizes a missing libsql row as an object and
  // throws before returning. A scalar subquery always yields one row and uses
  // NULL for the normal "no retained spelling" case on both libsql and D1.
  const retained = (await db.get(sql`
    SELECT (${matches}) AS actor_id
  `)) as { actor_id: string | null } | undefined;
  return retained?.actor_id ?? null;
}

export async function resolveRetainedPersonalMuteTarget(
  db: Database,
  muterApId: string,
  mutedApId: string,
): Promise<string | null> {
  const exact = await db
    .select({ actorApId: mutes.mutedApId })
    .from(mutes)
    .where(and(eq(mutes.muterApId, muterApId), eq(mutes.mutedApId, mutedApId)))
    .get();
  if (exact) return exact.actorApId;

  const matches = activityPubActorIdentityMatchesSql(
    sql`
      SELECT ${mutes.mutedApId}
      FROM ${mutes}
      WHERE ${mutes.muterApId} = ${muterApId}
    `,
    mutedApId,
  );
  const retained = (await db.get(sql`
    SELECT (${matches}) AS actor_id
  `)) as { actor_id: string | null } | undefined;
  return retained?.actor_id ?? null;
}

export async function personalActorIsBlockedBy(
  db: Database,
  blockerApId: string,
  blockedApId: string,
): Promise<boolean> {
  const exact = await db
    .select({ actorApId: blocks.blockedApId })
    .from(blocks)
    .where(
      and(
        eq(blocks.blockerApId, blockerApId),
        eq(blocks.blockedApId, blockedApId),
      ),
    )
    .get();
  if (exact) return true;

  return actorIdentitySetContains(
    db,
    blockedApId,
    sql`
      SELECT ${blocks.blockedApId}
      FROM ${blocks}
      WHERE ${blocks.blockerApId} = ${blockerApId}
    `,
  );
}

export async function personalActorIsSuppressedBy(
  db: Database,
  ownerApId: string,
  actorApId: string,
): Promise<boolean> {
  const [exactBlock, exactMute] = await Promise.all([
    db
      .select({ actorApId: blocks.blockedApId })
      .from(blocks)
      .where(
        and(
          eq(blocks.blockerApId, ownerApId),
          eq(blocks.blockedApId, actorApId),
        ),
      )
      .get(),
    db
      .select({ actorApId: mutes.mutedApId })
      .from(mutes)
      .where(
        and(eq(mutes.muterApId, ownerApId), eq(mutes.mutedApId, actorApId)),
      )
      .get(),
  ]);
  if (exactBlock || exactMute) return true;

  return actorIdentitySetContains(
    db,
    actorApId,
    sql`
      SELECT ${blocks.blockedApId}
      FROM ${blocks}
      WHERE ${blocks.blockerApId} = ${ownerApId}
      UNION ALL
      SELECT ${mutes.mutedApId}
      FROM ${mutes}
      WHERE ${mutes.muterApId} = ${ownerApId}
    `,
  );
}

/** Single-user policy: any local owner's block/mute suppresses public ingress. */
export async function anyOwnerSuppressesInboundActor(
  db: Database,
  actorApId: string,
): Promise<boolean> {
  const [exactBlock, exactMute] = await Promise.all([
    db
      .select({ actorApId: blocks.blockerApId })
      .from(blocks)
      .where(eq(blocks.blockedApId, actorApId))
      .get(),
    db
      .select({ actorApId: mutes.muterApId })
      .from(mutes)
      .where(eq(mutes.mutedApId, actorApId))
      .get(),
  ]);
  if (exactBlock || exactMute) return true;

  return actorIdentitySetContains(
    db,
    actorApId,
    sql`
      SELECT ${blocks.blockedApId} FROM ${blocks}
      UNION ALL
      SELECT ${mutes.mutedApId} FROM ${mutes}
    `,
  );
}

export async function deletePersonalActorBlock(
  db: Database,
  blockerApId: string,
  blockedApId: string,
): Promise<void> {
  const matches = activityPubActorIdentityMatchesSql(
    sql`
      SELECT ${blocks.blockedApId}
      FROM ${blocks}
      WHERE ${blocks.blockerApId} = ${blockerApId}
    `,
    blockedApId,
  );
  await db
    .delete(blocks)
    .where(
      and(
        eq(blocks.blockerApId, blockerApId),
        sql`${blocks.blockedApId} IN (${matches})`,
      ),
    );
}

export async function deletePersonalActorMute(
  db: Database,
  muterApId: string,
  mutedApId: string,
): Promise<void> {
  const matches = activityPubActorIdentityMatchesSql(
    sql`
      SELECT ${mutes.mutedApId}
      FROM ${mutes}
      WHERE ${mutes.muterApId} = ${muterApId}
    `,
    mutedApId,
  );
  await db
    .delete(mutes)
    .where(
      and(
        eq(mutes.muterApId, muterApId),
        sql`${mutes.mutedApId} IN (${matches})`,
      ),
    );
}
