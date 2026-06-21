import type { Database } from "../../../../db/index.ts";
import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  activities,
  announces,
  follows,
  inbox as inboxTable,
  likes,
  objects,
} from "../../../../db/index.ts";
import { isLocal } from "../../../federation-helpers.ts";
import type { Activity } from "../inbox-types.ts";

// ---------------------------------------------------------------------------
// Atomic multi-statement commit (mirrors posts/interactions.ts `runBatch`)
//
// D1 has no interactive transactions, but both the D1 and libsql drivers
// expose `db.batch([...])`, which commits a list of prepared statements
// atomically. The shared `Database` union aliases the abstract
// `BaseSQLiteDatabase` base (which does not surface `batch`), so we narrow to
// the concrete batch surface here rather than weakening the shared type.
// ---------------------------------------------------------------------------

type BatchStatement = BatchItem<"sqlite">;
interface BatchableDb {
  batch(
    statements: readonly [BatchStatement, ...BatchStatement[]],
  ): Promise<unknown>;
}

export async function runBatch(
  db: Database,
  statements: readonly [BatchStatement, ...BatchStatement[]],
): Promise<void> {
  await (db as unknown as BatchableDb).batch(statements);
}

// ---------------------------------------------------------------------------
// Shared helpers used by multiple inbox handler files
// ---------------------------------------------------------------------------

/** Upsert an activity record and create an inbox entry for a local actor. */
export async function upsertActivityAndNotify(
  db: Database,
  activityId: string,
  type: string,
  actorApId: string,
  objectApIdValue: string,
  rawActivity: Activity,
  recipientApId: string,
): Promise<void> {
  const now = new Date().toISOString();

  await db
    .insert(activities)
    .values({
      apId: activityId,
      type,
      actorApId,
      objectApId: objectApIdValue,
      rawJson: JSON.stringify(rawActivity),
    })
    .onConflictDoNothing();

  await db.insert(inboxTable).values({
    actorApId: recipientApId,
    activityApId: activityId,
    read: 0,
    createdAt: now,
  });
}

/**
 * Interaction table descriptor used by generic helpers.
 * Both `likes` and `announces` share the same column shape.
 */
type InteractionTable = typeof likes | typeof announces;

const INTERACTION_TABLES: Record<"like" | "announce", InteractionTable> = {
  like: likes,
  announce: announces,
};

/** Find a follow by activityApId and return it (or null). */
export async function findFollowByActivityId(
  db: Database,
  activityApIdValue: string,
): Promise<{
  followerApId: string;
  followingApId: string;
  status: string;
} | null> {
  const row = await db
    .select({
      followerApId: follows.followerApId,
      followingApId: follows.followingApId,
      status: follows.status,
    })
    .from(follows)
    .where(eq(follows.activityApId, activityApIdValue))
    .get();
  return row ?? null;
}

/**
 * Delete a follow using its compound key. Returns the deleted rows (with their
 * prior status) so callers can gate denormalized count updates on a row
 * actually being removed AND on whether it had been counted (status
 * 'accepted'). `.returning()` yields the deleted rows across both D1 and
 * libsql backends.
 */
export async function deleteFollowByCompoundKey(
  db: Database,
  followerApId: string,
  followingApId: string,
): Promise<Array<{ status: string }>> {
  return await db
    .delete(follows)
    .where(
      and(
        eq(follows.followerApId, followerApId),
        eq(follows.followingApId, followingApId),
      ),
    )
    .returning({ status: follows.status });
}

/**
 * Lookup the owner of an object and, if local, notify via upsertActivityAndNotify.
 * Returns the attributedTo value, or null if the object was not found.
 */
export async function notifyLocalObjectOwner(
  db: Database,
  objectApIdValue: string,
  activityId: string,
  activityType: string,
  actorApIdValue: string,
  rawActivity: Activity,
  baseUrl: string,
): Promise<string | null> {
  const obj = await db
    .select({ attributedTo: objects.attributedTo })
    .from(objects)
    .where(eq(objects.apId, objectApIdValue))
    .get();
  if (!obj) return null;

  if (isLocal(obj.attributedTo, baseUrl)) {
    await upsertActivityAndNotify(
      db,
      activityId,
      activityType,
      actorApIdValue,
      objectApIdValue,
      rawActivity,
      obj.attributedTo,
    );
  }
  return obj.attributedTo;
}

/** Map interaction kind to the corresponding count column on `objects`. */
const COUNT_FIELDS: Record<"like" | "announce", "likeCount" | "announceCount"> =
  {
    like: "likeCount",
    announce: "announceCount",
  };

/**
 * Generic undo for Like or Announce: delete by direct object ID or fallback
 * to the activityId lookup, then RECOMPUTE the count field.
 * Returns true if the deletion was handled, false otherwise.
 *
 * #COUNTER-SYM (crash-retry convergence): the edge delete and the counter
 * maintenance MUST commit together. Previously the edge was deleted in one
 * statement and the counter decremented (`- 1`) in a SEPARATE statement; under
 * the claim/processed re-dispatch model an interruption between the two left
 * the edge gone but the counter un-decremented, and the peer's retry matched 0
 * rows so the decrement was SKIPPED → a permanent OVER-count. Group the delete
 * and the counter update into a single atomic `db.batch`, and derive the
 * counter from `COUNT(*)` of the edge table (idempotent recompute, mirrors the
 * inbound insert path in handleInteraction) rather than a blind `- 1`, so a
 * retry after a mid-write crash CONVERGES to the true edge count.
 */
export async function undoInteraction(
  db: Database,
  kind: "like" | "announce",
  countField: "likeCount" | "announceCount",
  directObjectId: string | undefined,
  activityId: string | null,
  actor: string,
): Promise<boolean> {
  const table = INTERACTION_TABLES[kind];
  const cf = countField ?? COUNT_FIELDS[kind];

  if (directObjectId) {
    // Delete the edge and recompute the counter from the remaining edge rows
    // atomically. A duplicate Undo (or an Undo of an interaction we never
    // recorded) deletes 0 rows and the recompute is a no-op against the
    // already-correct edge set, so the count cannot drift in either direction.
    await runBatch(db, [
      db
        .delete(table)
        .where(
          and(eq(table.actorApId, actor), eq(table.objectApId, directObjectId)),
        ),
      db
        .update(objects)
        .set({
          [cf]: sql`(SELECT COUNT(*) FROM ${table} WHERE ${table.objectApId} = ${directObjectId})`,
        })
        .where(eq(objects.apId, directObjectId)),
    ]);
    return true;
  }

  if (!activityId) return false;

  // Resolve the edge by its activity ID, then commit the delete + recompute in
  // one batch keyed on the resolved objectApId.
  const record = await db
    .select({
      actorApId: table.actorApId,
      objectApId: table.objectApId,
    })
    .from(table)
    .where(eq(table.activityApId, activityId))
    .get();
  if (record) {
    // Bind the undo to the VERIFIED signer. The activity id is public, so a
    // resolved edge whose owner != the signing actor is a cross-actor forgery
    // (a remote attacker undoing someone else's like/announce by id). The
    // directObjectId branch above already keys its delete on `actor`; mirror it.
    if (record.actorApId !== actor) return false;
    await runBatch(db, [
      db
        .delete(table)
        .where(
          and(
            eq(table.actorApId, record.actorApId),
            eq(table.objectApId, record.objectApId),
          ),
        ),
      db
        .update(objects)
        .set({
          [cf]: sql`(SELECT COUNT(*) FROM ${table} WHERE ${table.objectApId} = ${record.objectApId})`,
        })
        .where(eq(objects.apId, record.objectApId)),
    ]);
    return true;
  }

  return false;
}
