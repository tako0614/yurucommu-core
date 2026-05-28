import type { Database } from "../../../../db/index.ts";
import { and, eq, sql } from "drizzle-orm";
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

  await db.insert(activities)
    .values({
      apId: activityId,
      type,
      actorApId,
      objectApId: objectApIdValue,
      rawJson: JSON.stringify(rawActivity),
    })
    .onConflictDoNothing();

  await db.insert(inboxTable)
    .values({
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

/**
 * Find a record by activityApId, then delete it using its compound key.
 * Returns the deleted record (or null if not found).
 */
export async function findAndDeleteInteractionByActivityId(
  db: Database,
  kind: "like" | "announce",
  activityApIdValue: string,
): Promise<{ actorApId: string; objectApId: string } | null> {
  const table = INTERACTION_TABLES[kind];
  const record = await db.select({
    actorApId: table.actorApId,
    objectApId: table.objectApId,
  })
    .from(table)
    .where(eq(table.activityApId, activityApIdValue))
    .get();
  if (!record) return null;
  await db.delete(table)
    .where(
      and(
        eq(table.actorApId, record.actorApId),
        eq(table.objectApId, record.objectApId),
      ),
    );
  return record;
}

/** Find a follow by activityApId and return it (or null). */
export async function findFollowByActivityId(
  db: Database,
  activityApIdValue: string,
): Promise<
  { followerApId: string; followingApId: string; status: string } | null
> {
  const row = await db.select({
    followerApId: follows.followerApId,
    followingApId: follows.followingApId,
    status: follows.status,
  })
    .from(follows)
    .where(eq(follows.activityApId, activityApIdValue))
    .get();
  return row ?? null;
}

/** Delete a follow using its compound key. */
export async function deleteFollowByCompoundKey(
  db: Database,
  followerApId: string,
  followingApId: string,
): Promise<void> {
  await db.delete(follows)
    .where(
      and(
        eq(follows.followerApId, followerApId),
        eq(follows.followingApId, followingApId),
      ),
    );
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
  const obj = await db.select({ attributedTo: objects.attributedTo })
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
 * to findAndDeleteInteractionByActivityId, then decrement the count field.
 * Returns true if the deletion was handled, false otherwise.
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
    // Gate the count decrement on a row actually being deleted, so a
    // duplicate Undo (or an Undo of an interaction we never recorded) does
    // not drift the count negative. `.returning()` yields the deleted rows
    // across both D1 and libsql backends.
    const deleted = await db.delete(table)
      .where(
        and(eq(table.actorApId, actor), eq(table.objectApId, directObjectId)),
      )
      .returning({ objectApId: table.objectApId });
    if (deleted.length > 0) {
      await db.update(objects)
        .set({ [cf]: sql`${objects[cf]} - 1` })
        .where(eq(objects.apId, directObjectId));
    }
    return true;
  }

  if (!activityId) return false;

  const record = await findAndDeleteInteractionByActivityId(
    db,
    kind,
    activityId,
  );
  if (record) {
    await db.update(objects)
      .set({ [cf]: sql`${objects[cf]} - 1` })
      .where(eq(objects.apId, record.objectApId));
    return true;
  }

  return false;
}
