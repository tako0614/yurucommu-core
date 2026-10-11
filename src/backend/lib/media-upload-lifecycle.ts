import { and, asc, eq } from "drizzle-orm";
import { mediaUploadAttempts, type Database } from "../../db/index.ts";
import type { Env } from "../types.ts";
import { AccountDeletionConflictError } from "./errors.ts";

export type MediaUploadAttempt = typeof mediaUploadAttempts.$inferSelect;

function attemptIdentity(attempt: MediaUploadAttempt) {
  return and(
    eq(mediaUploadAttempts.id, attempt.id),
    eq(mediaUploadAttempts.r2Key, attempt.r2Key),
    eq(mediaUploadAttempts.uploaderApId, attempt.uploaderApId),
    eq(mediaUploadAttempts.publicKeyPem, attempt.publicKeyPem),
  );
}

/** Called only after the writer observed its put promise settle. */
export async function settleMediaUploadAttempt(
  db: Database,
  attempt: MediaUploadAttempt,
): Promise<void> {
  await db
    .update(mediaUploadAttempts)
    .set({ phase: "cleanup" })
    .where(
      and(attemptIdentity(attempt), eq(mediaUploadAttempts.phase, "putting")),
    );
}

/** No put can follow cleanup: putting rows are never selected or expired. */
export async function cleanupMediaUploadAttempt(
  db: Database,
  env: Pick<Env, "MEDIA">,
  attempt: MediaUploadAttempt,
): Promise<void> {
  const current = await db
    .select()
    .from(mediaUploadAttempts)
    .where(
      and(attemptIdentity(attempt), eq(mediaUploadAttempts.phase, "cleanup")),
    )
    .get();
  if (!current) return;
  if (!env.MEDIA)
    throw new Error("Object storage unavailable for upload cleanup");
  await env.MEDIA.delete(current.r2Key);
  await db
    .delete(mediaUploadAttempts)
    .where(
      and(attemptIdentity(current), eq(mediaUploadAttempts.phase, "cleanup")),
    );
}

/** A bounded global sweep recovers settled uploads after a request disappears. */
export async function drainSettledMediaUploadAttempts(
  env: Env,
): Promise<number> {
  const db = env.DB_INSTANCE;
  const attempts = await db
    .select()
    .from(mediaUploadAttempts)
    .where(eq(mediaUploadAttempts.phase, "cleanup"))
    .orderBy(asc(mediaUploadAttempts.createdAt), asc(mediaUploadAttempts.id))
    .limit(50);
  for (const attempt of attempts) {
    await cleanupMediaUploadAttempt(db, env, attempt);
  }
  return attempts.length;
}

/** Retain the deletion plan until all physical writes and cleanup are settled. */
export async function reconcileActorUploadAttempts(
  db: Database,
  env: Env,
  actorApId: string,
): Promise<void> {
  const attempts = await db
    .select()
    .from(mediaUploadAttempts)
    .where(
      and(
        eq(mediaUploadAttempts.uploaderApId, actorApId),
        eq(mediaUploadAttempts.phase, "cleanup"),
      ),
    )
    .orderBy(asc(mediaUploadAttempts.createdAt), asc(mediaUploadAttempts.id))
    .limit(50);
  for (const attempt of attempts) {
    await cleanupMediaUploadAttempt(db, env, attempt);
  }
  const unresolved = await db
    .select({ id: mediaUploadAttempts.id })
    .from(mediaUploadAttempts)
    .where(eq(mediaUploadAttempts.uploaderApId, actorApId))
    .get();
  if (unresolved) throw new AccountDeletionConflictError();
}
