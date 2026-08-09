import { and, desc, eq, inArray } from "drizzle-orm";

import type { Database } from "../../db/index.ts";
import { blocks, mutes } from "../../db/index.ts";
import { runBatch } from "../../db/d1-write.ts";
import {
  isSameActivityPubActor,
  normalizeActivityPubActorId,
} from "./activitypub-actor-identity.ts";
import { chunkForInClause } from "./chunk.ts";

// New block/mute writes are normalized, so these scans exist only for rows
// retained before actor identity became one shared contract. Keep the fallback
// bounded: personal moderation is an inbound hot path, not a migration pass.
export const LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT = 512;

export function canonicalPersonalModerationActorId(actorApId: string): string {
  return normalizeActivityPubActorId(actorApId) ?? actorApId;
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
  return Boolean(
    await resolveRetainedPersonalBlockTarget(db, blockerApId, blockedApId),
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

  const [legacyBlocks, legacyMutes] = await Promise.all([
    db
      .select({ actorApId: blocks.blockedApId })
      .from(blocks)
      .where(eq(blocks.blockerApId, ownerApId))
      .orderBy(desc(blocks.createdAt), desc(blocks.blockedApId))
      .limit(LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT),
    db
      .select({ actorApId: mutes.mutedApId })
      .from(mutes)
      .where(eq(mutes.muterApId, ownerApId))
      .orderBy(desc(mutes.createdAt), desc(mutes.mutedApId))
      .limit(LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT),
  ]);
  return [...legacyBlocks, ...legacyMutes].some((candidate) =>
    isSameActivityPubActor(candidate.actorApId, actorApId),
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

  const [legacyBlocks, legacyMutes] = await Promise.all([
    db
      .select({ actorApId: blocks.blockedApId })
      .from(blocks)
      .orderBy(desc(blocks.createdAt), desc(blocks.blockedApId))
      .limit(LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT),
    db
      .select({ actorApId: mutes.mutedApId })
      .from(mutes)
      .orderBy(desc(mutes.createdAt), desc(mutes.mutedApId))
      .limit(LEGACY_PERSONAL_MODERATION_CANDIDATE_LIMIT),
  ]);
  return [...legacyBlocks, ...legacyMutes].some((candidate) =>
    isSameActivityPubActor(candidate.actorApId, actorApId),
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
