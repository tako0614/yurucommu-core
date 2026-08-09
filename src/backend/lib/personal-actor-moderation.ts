import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";

import type { Database } from "../../db/index.ts";
import { blocks, mutes } from "../../db/index.ts";
import { runBatch } from "../../db/d1-write.ts";
import {
  isSameActivityPubActor,
  normalizeActivityPubActorId,
} from "./activitypub-actor-identity.ts";
import { activityPubActorIdentitySetSql } from "./activitypub-actor-identity-sql.ts";
import { chunkForInClause } from "./chunk.ts";

// Relation mutation needs the retained raw spelling, so its compatibility scan
// stays bounded: an API write is not a migration pass. Authorization and read
// decisions below never use this bound; they ask the SQL identity set, which
// covers the complete per-actor relation cap without adding one parameter per
// relation.
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

  const candidates = await db
    .select({ actorApId: blocks.blockedApId })
    .from(blocks)
    .where(eq(blocks.blockerApId, blockerApId))
    .orderBy(desc(blocks.createdAt), desc(blocks.blockedApId))
    .limit(LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT);
  return (
    candidates.find((candidate) =>
      isSameActivityPubActor(candidate.actorApId, blockedApId),
    )?.actorApId ?? null
  );
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

  const candidates = await db
    .select({ actorApId: mutes.mutedApId })
    .from(mutes)
    .where(eq(mutes.muterApId, muterApId))
    .orderBy(desc(mutes.createdAt), desc(mutes.mutedApId))
    .limit(LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT);
  return (
    candidates.find((candidate) =>
      isSameActivityPubActor(candidate.actorApId, mutedApId),
    )?.actorApId ?? null
  );
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
  const [exact, candidates] = await Promise.all([
    db
      .select({ actorApId: blocks.blockedApId })
      .from(blocks)
      .where(
        and(
          eq(blocks.blockerApId, blockerApId),
          eq(blocks.blockedApId, blockedApId),
        ),
      )
      .get(),
    db
      .select({ actorApId: blocks.blockedApId })
      .from(blocks)
      .where(eq(blocks.blockerApId, blockerApId))
      .orderBy(desc(blocks.createdAt), desc(blocks.blockedApId))
      .limit(LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT),
  ]);
  const retained = [
    ...new Set([
      ...(exact ? [exact.actorApId] : []),
      ...candidates
        .filter((candidate) =>
          isSameActivityPubActor(candidate.actorApId, blockedApId),
        )
        .map((candidate) => candidate.actorApId),
    ]),
  ];
  const statements = chunkForInClause(retained).map((chunk) =>
    db
      .delete(blocks)
      .where(
        and(
          eq(blocks.blockerApId, blockerApId),
          inArray(blocks.blockedApId, chunk),
        ),
      ),
  );
  const [first, ...rest] = statements;
  if (!first) return;
  await runBatch(db, [first, ...rest]);
}

export async function deletePersonalActorMute(
  db: Database,
  muterApId: string,
  mutedApId: string,
): Promise<void> {
  const [exact, candidates] = await Promise.all([
    db
      .select({ actorApId: mutes.mutedApId })
      .from(mutes)
      .where(
        and(eq(mutes.muterApId, muterApId), eq(mutes.mutedApId, mutedApId)),
      )
      .get(),
    db
      .select({ actorApId: mutes.mutedApId })
      .from(mutes)
      .where(eq(mutes.muterApId, muterApId))
      .orderBy(desc(mutes.createdAt), desc(mutes.mutedApId))
      .limit(LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT),
  ]);
  const retained = [
    ...new Set([
      ...(exact ? [exact.actorApId] : []),
      ...candidates
        .filter((candidate) =>
          isSameActivityPubActor(candidate.actorApId, mutedApId),
        )
        .map((candidate) => candidate.actorApId),
    ]),
  ];
  const statements = chunkForInClause(retained).map((chunk) =>
    db
      .delete(mutes)
      .where(
        and(eq(mutes.muterApId, muterApId), inArray(mutes.mutedApId, chunk)),
      ),
  );
  const [first, ...rest] = statements;
  if (!first) return;
  await runBatch(db, [first, ...rest]);
}
