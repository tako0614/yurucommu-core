import { sql, type SQL } from "drizzle-orm";
import { inboundObjectDeletions, type Database } from "../../db/index.ts";
import { createGuardedDatabase } from "../../db/guarded-writes.ts";
import { admissionGuard } from "./account-deletion-admission.ts";
import { normalizeActivityPubActorId } from "./activitypub-actor-identity.ts";

export class InboundObjectDeletionConflict extends Error {}

/** Canonical actor identity, exact object IRI; another actor's intent is unrelated. */
export function inboundObjectNotDeletedSql(
  objectId: string,
  actor: string,
): SQL {
  const actorId = normalizeActivityPubActorId(actor) ?? actor;
  return sql`NOT EXISTS (
    SELECT 1 FROM ${inboundObjectDeletions}
    WHERE ${inboundObjectDeletions.actorApId} = ${actorId}
      AND ${inboundObjectDeletions.objectApId} = ${objectId}
  )`;
}

/** Check terminal evidence inside the same atomic batch as materialization. */
export function guardInboundObjectCreation(
  db: Database,
  objectId: string,
  actor: string,
): Database {
  return createGuardedDatabase(db, () =>
    admissionGuard(
      db,
      inboundObjectNotDeletedSql(objectId, actor),
      () => new InboundObjectDeletionConflict(),
    ),
  );
}
