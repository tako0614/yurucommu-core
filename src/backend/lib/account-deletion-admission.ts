import { eq, sql, type SQL } from "drizzle-orm";
import type { Context } from "hono";
import {
  actors,
  actorWriteAssertions,
  type Database,
  type D1Statement,
} from "../../db/index.ts";
import { createGuardedDatabase } from "../../db/guarded-writes.ts";
import type { Actor, Env, Variables } from "../types.ts";
import {
  AccountDeletionConflictError,
  isAccountDeletionWriteConflict,
} from "./errors.ts";
import {
  cleanupMediaUploadAttempt,
  settleMediaUploadAttempt,
  type MediaUploadAttempt,
} from "./media-upload-lifecycle.ts";

// Kept outside Variables/Env: ordinary routes never receive a raw write escape.
const requestDatabases = new WeakMap<object, Database>();

/** The only reservation-exempt request effect is cleaning its own settled put. */
export async function cleanupFailedMediaUpload(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  attempt: MediaUploadAttempt,
): Promise<void> {
  const actor = c.get("actor");
  if (
    !actor ||
    actor.ap_id !== attempt.uploaderApId ||
    actor.public_key_pem !== attempt.publicKeyPem
  ) {
    throw new AccountDeletionConflictError();
  }
  const db = requestDatabases.get(c) ?? c.get("db");
  await settleMediaUploadAttempt(db, attempt);
  await cleanupMediaUploadAttempt(db, c.env, attempt);
}

/** A deleting parent remains reserved even when a legacy child was not live. */
export function actorNotReservedSql(apId: string) {
  return sql`NOT EXISTS (
    SELECT 1 FROM account_deletion_targets AS deletion_target
    WHERE deletion_target.actor_ap_id = ${apId}
      OR deletion_target.actor_ap_id = (
        SELECT owner_actor_ap_id FROM actors WHERE ap_id = ${apId}
      )
  )`;
}

export async function assertActorNotReserved(db: Database, apId: string) {
  const available = await db
    .select({ available: actorNotReservedSql(apId) })
    .from(actors)
    .where(eq(actors.apId, apId))
    .get();
  if (available && !available.available)
    throw new AccountDeletionConflictError();
}

/** Build an aborting assertion and remove its marker in the same atomic batch. */
export function admissionGuard(
  db: Database,
  predicate: SQL,
  conflict?: () => Error,
) {
  const id = crypto.randomUUID();
  return {
    before: db.insert(actorWriteAssertions).values({
      id,
      witness: sql`(SELECT 1 WHERE ${predicate})`,
      operationId: null,
    }) as D1Statement,
    after: db
      .delete(actorWriteAssertions)
      .where(eq(actorWriteAssertions.id, id)) as D1Statement,
    onError: (error: unknown) =>
      isAccountDeletionWriteConflict(error)
        ? (conflict?.() ?? new AccountDeletionConflictError())
        : error,
  };
}

export function guardActorWrites(db: Database, actor: Actor) {
  const predicate = sql`EXISTS (
    SELECT 1 FROM actors
    WHERE ap_id = ${actor.ap_id}
      AND public_key_pem = ${actor.public_key_pem}
      AND takos_user_id IS ${actor.takos_user_id}
      AND deleted_at IS NULL
      AND ${actorNotReservedSql(actor.ap_id)}
  )`;
  return createGuardedDatabase(db, () => admissionGuard(db, predicate));
}

/** App interactions resolve stored objects; recheck that target at commit. */
export function guardObjectWrites(
  db: Database,
  apId: string,
  authorApId: string,
) {
  const predicate = sql`EXISTS (
    SELECT 1 FROM objects WHERE ap_id = ${apId}
      AND attributed_to = ${authorApId} AND deleted_at IS NULL
      AND ${actorNotReservedSql(authorApId)}
  )`;
  return createGuardedDatabase(db, () => admissionGuard(db, predicate));
}

/** Preserve the host bindings: only this request sees its authority facade. */
export async function admitSessionRequest(
  c: Context<{ Bindings: Env; Variables: Variables }>,
  next: () => Promise<void>,
) {
  const actor = c.get("actor");
  if (!actor) return next();
  const db = c.get("db");
  // This dedicated route owns the durable worker guard. The retained session
  // authorizes retry, and never authorizes ordinary writes during reservation.
  if (c.req.path === "/api/actors/me/delete" && c.req.method === "POST")
    return next();
  await assertActorNotReserved(db, actor.ap_id);
  const baseEnv = c.env;
  const guarded = guardActorWrites(db, actor);
  requestDatabases.set(c, db);
  c.set("db", guarded);
  c.env = { ...baseEnv, DB_INSTANCE: guarded };
  try {
    await next();
  } finally {
    requestDatabases.delete(c);
    c.env = baseEnv;
    c.set("db", db);
  }
}
