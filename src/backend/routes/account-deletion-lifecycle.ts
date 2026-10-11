import { and, asc, eq, lte, sql } from "drizzle-orm";

import {
  accountDeletions,
  accountDeletionTargets,
  actors,
  affectedRowCount,
  rawBatchStatement,
  runBatch,
  type Database,
  type D1Statement,
} from "../../db/index.ts";
import { createGuardedDatabase } from "../../db/guarded-writes.ts";
import type { Env } from "../types.ts";
import { generateId } from "../federation-helpers.ts";
import {
  AccountDeletionConflictError,
  isAccountDeletionWriteConflict,
} from "../lib/errors.ts";
import { reconcileActorUploadAttempts } from "../lib/media-upload-lifecycle.ts";
import { purgeActorMediaUploads, teardownActor } from "./account-teardown.ts";

// A lease is an execution fence, never the lifetime of a deletion reservation.
// Expired operations remain in account_deletions and are acquired by a new
// request or retention worker without making any target writable again.
const LEASE_MS = 2 * 60 * 1000;
const RETENTION_LIMIT = 2;

type Operation = typeof accountDeletions.$inferSelect;
type Target = typeof accountDeletionTargets.$inferSelect;

function leaseExpiry(): string {
  return new Date(Date.now() + LEASE_MS).toISOString();
}

function staleWorker(): Error {
  return new AccountDeletionConflictError();
}

/**
 * Persist the entire owner/self actor set in one atomic batch. INSERT SELECT
 * captures legacy sets of any size without binding each actor or splitting the
 * reservation across D1 statements. The DELETE Activity ID belongs to the
 * target row, so a retry never creates a second outbound Delete intent.
 */
async function reserveOperation(
  db: Database,
  baseUrl: string,
  rootActorApId: string,
  rootPublicKeyPem: string,
  expectedTakosUserId: string | null,
  expectedOwnerActorApId: string | null,
  cascadeOwnedAccounts: boolean,
): Promise<Operation | null> {
  const id = generateId();
  const workerToken = generateId();
  const markerId = generateId();
  const targetPredicate = cascadeOwnedAccounts
    ? sql`(${actors.apId} = ${rootActorApId} OR ${actors.ownerActorApId} = ${rootActorApId})`
    : sql`${actors.apId} = ${rootActorApId}`;
  // Existing outbound Delete rows from a previous build must keep their
  // durable projections. For a new target, mint once inside this reservation.
  const deletePrefix = `${baseUrl.replace(/\/$/, "")}/ap/activities/`;
  try {
    await runBatch(db, [
      db.insert(accountDeletions).values({
        id,
        rootActorApId,
        rootPublicKeyPem,
        workerToken,
        leaseExpiresAt: leaseExpiry(),
      }) as D1Statement,
      rawBatchStatement(
        db,
        sql`
        INSERT INTO account_deletion_targets
          (actor_ap_id, operation_id, public_key_pem, followers_url,
           delete_activity_ap_id, cascade_complete)
        SELECT ${actors.apId}, ${id}, ${actors.publicKeyPem},
               ${actors.followersUrl},
               COALESCE((
                 SELECT activity.ap_id FROM activities AS activity
                 WHERE activity.actor_ap_id = ${actors.apId}
                   AND activity.type = 'Delete'
                   AND activity.direction = 'outbound'
                 ORDER BY activity.created_at ASC LIMIT 1
               ), ${deletePrefix} || lower(hex(randomblob(16)))), 0
        FROM ${actors}
        WHERE ${targetPredicate} AND ${actors.deletedAt} IS NULL
      `,
      ) as D1Statement,
      rawBatchStatement(
        db,
        sql`
        INSERT INTO account_deletion_object_targets (object_ap_id, operation_id)
        SELECT authored.ap_id, ${id}
        FROM objects AS authored
        WHERE authored.attributed_to IN (
          SELECT target.actor_ap_id FROM account_deletion_targets AS target
          WHERE target.operation_id = ${id}
        )
      `,
      ) as D1Statement,
      // A zero-row INSERT SELECT is an error, never an empty deletion plan.
      rawBatchStatement(
        db,
        sql`
        INSERT INTO actor_write_assertions (id, witness, operation_id)
        VALUES (${markerId}, (
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM account_deletion_targets AS target
            JOIN actors AS root ON root.ap_id = target.actor_ap_id
            WHERE target.operation_id = ${id}
              AND target.actor_ap_id = ${rootActorApId}
              AND target.public_key_pem = ${rootPublicKeyPem}
              AND root.public_key_pem = ${rootPublicKeyPem}
              AND root.takos_user_id IS ${expectedTakosUserId}
              AND root.owner_actor_ap_id IS ${expectedOwnerActorApId}
          ) THEN 1 ELSE NULL END
        ), ${id})
      `,
      ) as D1Statement,
      rawBatchStatement(
        db,
        sql`DELETE FROM actor_write_assertions WHERE id = ${markerId}`,
      ) as D1Statement,
    ]);
  } catch (error) {
    // A competing request may have reserved the root or a child first. The
    // caller distinguishes a resumable root operation from an overlap below.
    if (
      !isAccountDeletionWriteConflict(error) &&
      !/UNIQUE constraint failed|SQLITE_CONSTRAINT_UNIQUE/i.test(String(error))
    ) {
      throw error;
    }
    return null;
  }
  return {
    id,
    rootActorApId,
    rootPublicKeyPem,
    workerToken,
    leaseExpiresAt: leaseExpiry(),
  };
}

async function claimExpiredOperation(
  db: Database,
  operation: Operation,
): Promise<Operation | null> {
  const token = generateId();
  const expires = leaseExpiry();
  const now = new Date().toISOString();
  const claimed = await db
    .update(accountDeletions)
    .set({ workerToken: token, leaseExpiresAt: expires })
    .where(
      and(
        eq(accountDeletions.id, operation.id),
        lte(accountDeletions.leaseExpiresAt, now),
        sql`EXISTS (SELECT 1 FROM actors AS root
          WHERE root.ap_id = ${operation.rootActorApId}
            AND root.public_key_pem = ${operation.rootPublicKeyPem}
            AND root.deleted_at IS NULL)`,
        allTargetIncarnationsValid(operation.id),
      ),
    );
  return affectedRowCount(claimed) === 1
    ? { ...operation, workerToken: token, leaseExpiresAt: expires }
    : null;
}

async function renewLease(db: Database, operation: Operation): Promise<void> {
  const renewed = await db
    .update(accountDeletions)
    .set({ leaseExpiresAt: leaseExpiry() })
    .where(
      and(
        eq(accountDeletions.id, operation.id),
        eq(accountDeletions.workerToken, operation.workerToken),
        sql`${accountDeletions.leaseExpiresAt} > ${new Date().toISOString()}`,
        sql`EXISTS (SELECT 1 FROM actors AS root
          WHERE root.ap_id = ${operation.rootActorApId}
            AND root.public_key_pem = ${operation.rootPublicKeyPem}
            AND root.deleted_at IS NULL)`,
        allTargetIncarnationsValid(operation.id),
      ),
    );
  if (affectedRowCount(renewed) !== 1) throw staleWorker();
}

function allTargetIncarnationsValid(operationId: string) {
  return sql`NOT EXISTS (
    SELECT 1 FROM account_deletion_targets AS planned
    LEFT JOIN actors AS current_actor ON current_actor.ap_id = planned.actor_ap_id
    WHERE planned.operation_id = ${operationId}
      AND (current_actor.ap_id IS NULL
        OR current_actor.public_key_pem <> planned.public_key_pem
        OR current_actor.deleted_at IS NOT NULL)
  )`;
}

function guardedOperationDb(
  db: Database,
  operation: Operation,
  target: Target,
  allComplete = false,
): Database {
  return createGuardedDatabase(db, () => {
    const markerId = generateId();
    return {
      before: rawBatchStatement(
        db,
        sql`
        INSERT INTO actor_write_assertions (id, witness, operation_id)
        VALUES (${markerId}, (
          SELECT CASE WHEN EXISTS (
            SELECT 1 FROM account_deletions AS operation
            JOIN account_deletion_targets AS target
              ON target.operation_id = operation.id
            JOIN actors AS root ON root.ap_id = operation.root_actor_ap_id
            JOIN actors AS current_target ON current_target.ap_id = target.actor_ap_id
            WHERE operation.id = ${operation.id}
              AND operation.worker_token = ${operation.workerToken}
              AND operation.lease_expires_at > ${new Date().toISOString()}
              AND operation.root_public_key_pem = root.public_key_pem
              AND operation.root_public_key_pem = ${operation.rootPublicKeyPem}
              AND target.actor_ap_id = ${target.actorApId}
              AND target.public_key_pem = current_target.public_key_pem
              AND target.public_key_pem = ${target.publicKeyPem}
              ${
                allComplete
                  ? sql`AND ${allTargetIncarnationsValid(operation.id)}
                AND NOT EXISTS (
                SELECT 1 FROM account_deletion_targets AS pending
                WHERE pending.operation_id = operation.id
                  AND pending.cascade_complete = 0
              )
                AND NOT EXISTS (
                  SELECT 1 FROM media_uploads AS retained_media
                  JOIN account_deletion_targets AS planned
                    ON planned.actor_ap_id=retained_media.uploader_ap_id
                  WHERE planned.operation_id=${operation.id}
                )
                AND NOT EXISTS (
                  SELECT 1 FROM media_blob_deletion_jobs AS pending_media
                  JOIN account_deletion_targets AS planned
                    ON planned.actor_ap_id=pending_media.uploader_ap_id
                  WHERE planned.operation_id=${operation.id}
                )
                AND NOT EXISTS (
                  SELECT 1 FROM media_upload_attempts AS uploading
                  JOIN account_deletion_targets AS planned
                    ON planned.actor_ap_id = uploading.uploader_ap_id
                  WHERE planned.operation_id = operation.id
              )`
                  : sql``
              }
          ) THEN 1 ELSE NULL END
        ), ${operation.id})
      `,
      ) as D1Statement,
      after: rawBatchStatement(
        db,
        sql`
      DELETE FROM actor_write_assertions WHERE id = ${markerId}
      `,
      ) as D1Statement,
      onError: (error: unknown) =>
        isAccountDeletionWriteConflict(error)
          ? new AccountDeletionConflictError()
          : error,
    };
  });
}

async function releaseLease(db: Database, operation: Operation): Promise<void> {
  await db
    .update(accountDeletions)
    .set({ leaseExpiresAt: new Date(0).toISOString() })
    .where(
      and(
        eq(accountDeletions.id, operation.id),
        eq(accountDeletions.workerToken, operation.workerToken),
      ),
    );
}

async function runOperation(
  db: Database,
  env: Env,
  operation: Operation,
): Promise<void> {
  const targets = await db
    .select()
    .from(accountDeletionTargets)
    .where(eq(accountDeletionTargets.operationId, operation.id))
    .orderBy(asc(accountDeletionTargets.actorApId));
  const root = targets.find(
    (target) => target.actorApId === operation.rootActorApId,
  );
  if (!root) throw new Error("Account deletion plan lost its root target");

  for (const target of targets) {
    if (target.cascadeComplete) continue;
    await renewLease(db, operation);
    const guardedDb = guardedOperationDb(db, operation, target);
    await reconcileActorUploadAttempts(guardedDb, env, target.actorApId);
    await teardownActor(
      guardedDb,
      env,
      env.APP_URL,
      target.actorApId,
      target.followersUrl,
      {
        finalizeActor: false,
        deleteActivityApId: target.deleteActivityApId,
        beforeExternalWait: () => renewLease(db, operation),
      },
    );
    await guardedDb
      .update(accountDeletionTargets)
      .set({ cascadeComplete: true })
      .where(
        and(
          eq(accountDeletionTargets.actorApId, target.actorApId),
          eq(accountDeletionTargets.operationId, operation.id),
        ),
      );
  }

  // A PUT started before reservation may outlive an earlier teardown attempt.
  // Pre-0035 completed targets can also retain failed physical deletion jobs
  // whose metadata was already removed. Reconcile both under their operation
  // guard rather than stranding them behind cascadeComplete forever.
  // The final SQL assertion repeats the absence proof at commit time.
  for (const target of targets) {
    await renewLease(db, operation);
    const guardedDb = guardedOperationDb(db, operation, target);
    await reconcileActorUploadAttempts(guardedDb, env, target.actorApId);
    await purgeActorMediaUploads(guardedDb, env.MEDIA, target.actorApId, () =>
      renewLease(db, operation),
    );
  }
  await renewLease(db, operation);
  const finalDb = guardedOperationDb(db, operation, root, true);
  // The plan remains present through actor and session changes. The batch
  // assertion proves every target's cascade complete; it rolls back the whole
  // finalization if another worker took the lease or an incarnation changed.
  await runBatch(finalDb, [
    rawBatchStatement(
      db,
      sql`
      UPDATE actors
      SET preferred_username = 'deleted-' || lower(hex(randomblob(16))),
          name = NULL, summary = NULL, icon_url = NULL, header_url = NULL,
          takos_user_id = NULL, follower_count = 0, following_count = 0,
          post_count = 0, fields_json = '[]', also_known_as_json = '[]',
          moved_to = NULL, owner_actor_ap_id = NULL, role = 'member',
          deleted_at = ${new Date().toISOString()}
      WHERE ap_id IN (
        SELECT actor_ap_id FROM account_deletion_targets
        WHERE operation_id = ${operation.id}
      )
    `,
    ) as D1Statement,
    rawBatchStatement(
      db,
      sql`
      DELETE FROM sessions WHERE member_id IN (
        SELECT actor_ap_id FROM account_deletion_targets
        WHERE operation_id = ${operation.id}
      )
    `,
    ) as D1Statement,
    rawBatchStatement(
      db,
      sql`
      DELETE FROM account_deletion_object_targets WHERE operation_id = ${operation.id}
    `,
    ) as D1Statement,
    rawBatchStatement(
      db,
      sql`
      DELETE FROM account_deletion_targets WHERE operation_id = ${operation.id}
    `,
    ) as D1Statement,
    rawBatchStatement(
      db,
      sql`DELETE FROM account_deletions WHERE id = ${operation.id}`,
    ) as D1Statement,
  ]);
}

/** Return `busy` for an overlapping lease; preserve the durable plan on error. */
export async function deleteLocalAccount(
  db: Database,
  env: Env,
  rootActorApId: string,
  options: {
    cascadeOwnedAccounts: boolean;
    expectedPublicKeyPem: string;
    expectedTakosUserId: string | null;
    expectedOwnerActorApId: string | null;
  },
): Promise<"deleted" | "busy"> {
  let operation = await db
    .select()
    .from(accountDeletions)
    .where(eq(accountDeletions.rootActorApId, rootActorApId))
    .get();
  if (!operation) {
    const root = await db
      .select({
        publicKeyPem: actors.publicKeyPem,
        deletedAt: actors.deletedAt,
      })
      .from(actors)
      .where(eq(actors.apId, rootActorApId))
      .get();
    if (
      !root ||
      root.deletedAt ||
      root.publicKeyPem !== options.expectedPublicKeyPem
    )
      return "busy";
    operation =
      (await reserveOperation(
        db,
        env.APP_URL,
        rootActorApId,
        options.expectedPublicKeyPem,
        options.expectedTakosUserId,
        options.expectedOwnerActorApId,
        options.cascadeOwnedAccounts,
      )) ?? undefined;
    if (!operation) {
      operation = await db
        .select()
        .from(accountDeletions)
        .where(eq(accountDeletions.rootActorApId, rootActorApId))
        .get();
      if (!operation) return "busy";
    } else {
      try {
        await runOperation(db, env, operation);
      } catch (error) {
        await releaseLease(db, operation);
        throw error;
      }
      return "deleted";
    }
  }

  if (operation.rootPublicKeyPem !== options.expectedPublicKeyPem)
    return "busy";
  const currentRoot = await db
    .select({
      takosUserId: actors.takosUserId,
      ownerActorApId: actors.ownerActorApId,
    })
    .from(actors)
    .where(eq(actors.apId, rootActorApId))
    .get();
  if (
    !currentRoot ||
    currentRoot.takosUserId !== options.expectedTakosUserId ||
    currentRoot.ownerActorApId !== options.expectedOwnerActorApId
  )
    return "busy";

  const claimed = await claimExpiredOperation(db, operation);
  if (!claimed) return "busy";
  try {
    await runOperation(db, env, claimed);
  } catch (error) {
    await releaseLease(db, claimed);
    throw error;
  }
  return "deleted";
}

/** Resume expired plans even when every login session has itself expired. */
export async function resumeAbandonedAccountDeletions(
  env: Env,
  limit = RETENTION_LIMIT,
): Promise<number> {
  const db = env.DB_INSTANCE;
  const candidates = await db
    .select()
    .from(accountDeletions)
    .where(lte(accountDeletions.leaseExpiresAt, new Date().toISOString()))
    .orderBy(asc(accountDeletions.leaseExpiresAt))
    .limit(Math.max(0, Math.min(limit, RETENTION_LIMIT)));
  let completed = 0;
  for (const candidate of candidates) {
    const claimed = await claimExpiredOperation(db, candidate);
    if (!claimed) continue;
    try {
      await runOperation(db, env, claimed);
      completed += 1;
    } catch (error) {
      await releaseLease(db, claimed);
      throw error;
    }
  }
  return completed;
}
