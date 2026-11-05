import { and, asc, eq, gt, lte, sql, type SQL } from "drizzle-orm";
import {
  inboundNoteUpdateEvents,
  inboundNoteUpdateHeads,
  inboundObjectDeletions,
  runBatch,
  type Database,
  type D1Statement,
} from "../../db/index.ts";
import { createGuardedDatabase } from "../../db/guarded-writes.ts";
import { admissionGuard } from "./account-deletion-admission.ts";
import { normalizeActivityPubActorId } from "./activitypub-actor-identity.ts";
import { inboundObjectNotDeletedSql } from "./inbound-object-deletion.ts";

export const MAX_PENDING_NOTE_UPDATES = 16;

/** Already bounded wire fields; later projection rechecks current policy. */
export type AdmittedNotePatch = {
  content?: string;
  summary?: string | null;
  attachmentsJson?: string;
  tagsJson?: string;
  addressing?: { to: string[]; cc: string[]; bto: string[]; bcc: string[] };
  audience?: string[];
  inReplyTo?: string | null;
  room?: string;
};

export class InboundNoteUpdateConflict extends Error {}

function actorKey(actor: string): string {
  const key = normalizeActivityPubActorId(actor);
  if (!key) throw new TypeError("Invalid admitted Note actor");
  return key;
}

export async function hasTerminalNoteDeletion(
  db: Database,
  actor: string,
  objectId: string,
) {
  return Boolean(
    await db
      .select({ objectApId: inboundObjectDeletions.objectApId })
      .from(inboundObjectDeletions)
      .where(
        and(
          eq(inboundObjectDeletions.actorApId, actorKey(actor)),
          eq(inboundObjectDeletions.objectApId, objectId),
        ),
      )
      .get(),
  );
}

/** Caller owns signer, Note identity and patch-shape admission; no historical import. */
export async function admitInboundNoteUpdate(
  db: Database,
  actor: string,
  objectId: string,
  activityId: string,
  patch: AdmittedNotePatch,
) {
  if (!activityId)
    throw new TypeError("Admitted Note Update needs its dispatch identity");
  const key = actorKey(actor);
  const sameKey = sql`${inboundNoteUpdateEvents.actorApId} = ${key} AND ${inboundNoteUpdateEvents.objectApId} = ${objectId}`;
  const applied = sql`COALESCE((SELECT ${inboundNoteUpdateHeads.appliedSequence} FROM ${inboundNoteUpdateHeads}
    WHERE ${inboundNoteUpdateHeads.actorApId} = ${key} AND ${inboundNoteUpdateHeads.objectApId} = ${objectId}), 0)`;
  const duplicate = sql`EXISTS (SELECT 1 FROM ${inboundNoteUpdateEvents} WHERE ${inboundNoteUpdateEvents.activityApId} = ${activityId})`;
  const identity = sql`NOT EXISTS (SELECT 1 FROM ${inboundNoteUpdateEvents}
    WHERE ${inboundNoteUpdateEvents.activityApId} = ${activityId} AND NOT (${sameKey}))`;
  const capacity = sql`(${duplicate} OR (SELECT COUNT(*) FROM ${inboundNoteUpdateEvents} WHERE ${sameKey}
    AND ${inboundNoteUpdateEvents.sequence} > ${applied}) < ${MAX_PENDING_NOTE_UPDATES})`;
  const guarded = createGuardedDatabase(db, () =>
    admissionGuard(
      db,
      sql`${identity} AND ${capacity} AND ${inboundObjectNotDeletedSql(objectId, key)}`,
      () => new InboundNoteUpdateConflict(),
    ),
  );
  try {
    await runBatch(guarded, [
      guarded
        .insert(inboundNoteUpdateHeads)
        .values({ actorApId: key, objectApId: objectId })
        .onConflictDoNothing(),
      guarded
        .insert(inboundNoteUpdateEvents)
        .values({
          activityApId: activityId,
          actorApId: key,
          objectApId: objectId,
          patchJson: JSON.stringify(patch),
        })
        .onConflictDoNothing(),
    ]);
  } catch (error) {
    if (
      error instanceof InboundNoteUpdateConflict &&
      (await hasTerminalNoteDeletion(db, key, objectId))
    )
      return null;
    throw error;
  }
  const event = await db
    .select()
    .from(inboundNoteUpdateEvents)
    .where(eq(inboundNoteUpdateEvents.activityApId, activityId))
    .get();
  if (!event || event.actorApId !== key || event.objectApId !== objectId)
    throw new InboundNoteUpdateConflict();
  return event;
}

export type NoteUpdateWindow = {
  actor: string;
  objectId: string;
  applied: number;
  latest: number;
  creationActivityId: string | null;
  events: (typeof inboundNoteUpdateEvents.$inferSelect)[];
};

export async function loadInboundNoteUpdateWindow(
  db: Database,
  actor: string,
  objectId: string,
): Promise<NoteUpdateWindow> {
  const key = actorKey(actor);
  const head = await db
    .select()
    .from(inboundNoteUpdateHeads)
    .where(
      and(
        eq(inboundNoteUpdateHeads.actorApId, key),
        eq(inboundNoteUpdateHeads.objectApId, objectId),
      ),
    )
    .get();
  const applied = head?.appliedSequence ?? 0;
  const events = await db
    .select()
    .from(inboundNoteUpdateEvents)
    .where(
      and(
        eq(inboundNoteUpdateEvents.actorApId, key),
        eq(inboundNoteUpdateEvents.objectApId, objectId),
        gt(inboundNoteUpdateEvents.sequence, applied),
      ),
    )
    .orderBy(asc(inboundNoteUpdateEvents.sequence))
    .limit(MAX_PENDING_NOTE_UPDATES + 1);
  if (events.length > MAX_PENDING_NOTE_UPDATES)
    throw new InboundNoteUpdateConflict();
  return {
    actor: key,
    objectId,
    applied,
    latest: events.at(-1)?.sequence ?? applied,
    creationActivityId: head?.creationActivityApId ?? null,
    events,
  };
}

/** Source authorization/snapshot and the queue snapshot are one batch admission. */
export function guardInboundNoteUpdateWindow(
  db: Database,
  window: NoteUpdateWindow,
  sourcePredicate: SQL,
): Database {
  const { actor, objectId, applied, latest } = window;
  const unchanged = sql`COALESCE((SELECT ${inboundNoteUpdateHeads.appliedSequence} FROM ${inboundNoteUpdateHeads}
    WHERE ${inboundNoteUpdateHeads.actorApId} = ${actor} AND ${inboundNoteUpdateHeads.objectApId} = ${objectId}), 0) = ${applied}
    AND COALESCE((SELECT MAX(${inboundNoteUpdateEvents.sequence}) FROM ${inboundNoteUpdateEvents}
    WHERE ${inboundNoteUpdateEvents.actorApId} = ${actor} AND ${inboundNoteUpdateEvents.objectApId} = ${objectId}), 0) = ${latest}
    AND (SELECT ${inboundNoteUpdateHeads.creationActivityApId} FROM ${inboundNoteUpdateHeads}
    WHERE ${inboundNoteUpdateHeads.actorApId} = ${actor} AND ${inboundNoteUpdateHeads.objectApId} = ${objectId}) IS ${window.creationActivityId}`;
  return createGuardedDatabase(db, () =>
    admissionGuard(
      db,
      sql`(${sourcePredicate}) AND ${unchanged} AND ${inboundObjectNotDeletedSql(objectId, actor)}`,
      () => new InboundNoteUpdateConflict(),
    ),
  );
}

/** Append only to the same guarded atomic batch as the object/reach write. */
export function inboundNoteUpdateCommitStatements(
  db: Database,
  window: NoteUpdateWindow,
  creationActivityId?: string | null,
): D1Statement[] {
  return [
    db
      .insert(inboundNoteUpdateHeads)
      .values({ actorApId: window.actor, objectApId: window.objectId })
      .onConflictDoNothing() as D1Statement,
    db
      .update(inboundNoteUpdateHeads)
      .set({ appliedSequence: window.latest })
      .where(
        and(
          eq(inboundNoteUpdateHeads.actorApId, window.actor),
          eq(inboundNoteUpdateHeads.objectApId, window.objectId),
          eq(inboundNoteUpdateHeads.appliedSequence, window.applied),
        ),
      ) as D1Statement,
    // Release only this bounded window's payloads. Stable identity/sequence
    // receipts remain so later dispatch retries cannot become new edits.
    db
      .update(inboundNoteUpdateEvents)
      .set({ patchJson: null })
      .where(
        and(
          eq(inboundNoteUpdateEvents.actorApId, window.actor),
          eq(inboundNoteUpdateEvents.objectApId, window.objectId),
          gt(inboundNoteUpdateEvents.sequence, window.applied),
          lte(inboundNoteUpdateEvents.sequence, window.latest),
        ),
      ) as D1Statement,
    ...(creationActivityId !== undefined
      ? [
          db
            .update(inboundNoteUpdateHeads)
            .set({ creationActivityApId: creationActivityId })
            .where(
              and(
                eq(inboundNoteUpdateHeads.actorApId, window.actor),
                eq(inboundNoteUpdateHeads.objectApId, window.objectId),
                sql`${inboundNoteUpdateHeads.creationActivityApId} IS ${window.creationActivityId}`,
              ),
            ) as D1Statement,
        ]
      : []),
  ];
}
