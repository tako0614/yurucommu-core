// Notifications routes for Yurucommu backend
// AP Native: Notifications are derived from inbox (activities addressed to the actor)
import { Hono } from "hono";
import { and, count, desc, eq, inArray, lt, ne } from "drizzle-orm";
import type { Env, Variables } from "../types.ts";
import {
  formatUsername,
  parseLimit,
  parseOffset,
} from "../federation-helpers.ts";
import type { Database } from "../../db/index.ts";
import {
  activities,
  follows,
  inbox as inboxTable,
  notificationArchived,
  objects,
} from "../../db/index.ts";
import { batchLoadActorInfo } from "./communities/membership-shared.ts";
import { requireActor } from "./actors-helpers.ts";
import { canViewerReadObject } from "../lib/community-visibility.ts";

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

const ARCHIVE_RETENTION_DAYS = 90;
const ARCHIVED_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ARCHIVE_BATCH_SIZE = 100;
const MAX_READ_BATCH_SIZE = 100;
const ARCHIVE_CREATE_BATCH_SIZE = 100;
const ARCHIVE_ALL_CAP = 1000;
const NOTIFICATION_ACTIVITY_TYPES = ["Follow", "Like", "Announce", "Create"];

/**
 * Tracks the last cleanup timestamp per actor so cleanup is throttled to one
 * run per `ARCHIVED_CLEANUP_INTERVAL_MS`. Entries older than the interval no
 * longer gate work and can be evicted. A hard cap also bounds worst-case
 * growth when many unique actors hit notifications in a single window.
 */
const ARCHIVED_CLEANUP_TIMESTAMPS_MAX = 10_000;
const archivedCleanupTimestamps = new Map<string, number>();

function pruneArchivedCleanupTimestamps(now: number): void {
  for (const [actor, lastRun] of archivedCleanupTimestamps) {
    if (now - lastRun >= ARCHIVED_CLEANUP_INTERVAL_MS) {
      archivedCleanupTimestamps.delete(actor);
    }
  }
  if (archivedCleanupTimestamps.size >= ARCHIVED_CLEANUP_TIMESTAMPS_MAX) {
    // Last-resort: every entry is still fresh but cap is hit. Clear to bound
    // memory; the worst that happens is duplicate cleanup work within the
    // window for actors evicted here.
    archivedCleanupTimestamps.clear();
  }
}

/** @internal Test-only inspector for the cleanup-timestamps bookkeeping. */
export const __archivedCleanupInternals = {
  size: () => archivedCleanupTimestamps.size,
  clear: () => archivedCleanupTimestamps.clear(),
  set: (key: string, value: number) =>
    archivedCleanupTimestamps.set(key, value),
  prune: pruneArchivedCleanupTimestamps,
  maxEntries: ARCHIVED_CLEANUP_TIMESTAMPS_MAX,
  intervalMs: ARCHIVED_CLEANUP_INTERVAL_MS,
};

/**
 * Batch-insert archive rows with unique-constraint tolerance.
 * Returns the number of rows actually inserted.
 */
async function batchArchiveInsert(
  db: Database,
  rows: Array<{ actorApId: string; activityApId: string; archivedAt: string }>,
  batchSize: number,
): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const result = await db
      .insert(notificationArchived)
      .values(batch)
      .onConflictDoNothing();
    inserted += (result as { meta?: { changes?: number } }).meta?.changes ?? 0;
  }

  return inserted;
}

async function cleanupArchivedNotifications(
  db: Database,
  actorApId: string,
): Promise<void> {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - ARCHIVE_RETENTION_DAYS);
  const retentionDateStr = retentionDate.toISOString();

  const archivedToDelete = await db
    .select({ activityApId: notificationArchived.activityApId })
    .from(notificationArchived)
    .where(
      and(
        eq(notificationArchived.actorApId, actorApId),
        lt(notificationArchived.archivedAt, retentionDateStr),
      ),
    );

  if (archivedToDelete.length === 0) return;

  const activityApIds = archivedToDelete.map((a) => a.activityApId);

  await db
    .delete(inboxTable)
    .where(
      and(
        eq(inboxTable.actorApId, actorApId),
        inArray(inboxTable.activityApId, activityApIds),
      ),
    );

  await db
    .delete(notificationArchived)
    .where(
      and(
        eq(notificationArchived.actorApId, actorApId),
        lt(notificationArchived.archivedAt, retentionDateStr),
      ),
    );
}

async function maybeCleanupArchivedNotifications(
  db: Database,
  actorApId: string,
): Promise<void> {
  const now = Date.now();
  const lastRun = archivedCleanupTimestamps.get(actorApId) ?? 0;
  if (now - lastRun < ARCHIVED_CLEANUP_INTERVAL_MS) return;

  pruneArchivedCleanupTimestamps(now);
  archivedCleanupTimestamps.set(actorApId, now);
  await cleanupArchivedNotifications(db, actorApId);
}

function activityToNotificationType(
  activityType: string,
  hasInReplyTo: boolean,
  followStatus?: string | null,
): string | null {
  switch (activityType) {
    case "Follow":
      return followStatus === "pending" ? "follow_request" : "follow";
    case "Like":
      return "like";
    case "Announce":
      return "announce";
    case "Create":
      return hasInReplyTo ? "reply" : "mention";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / -- List notifications with type/archive filters
notifications.get("/", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const db = c.get("db");
  await maybeCleanupArchivedNotifications(db, actor.ap_id);

  const limit = parseLimit(c.req.query("limit"), 20, 100);
  const offset = parseOffset(c.req.query("offset"), 0, 10000);
  const before = c.req.query("before");
  const typeFilter = c.req.query("type");
  const showArchived = c.req.query("archived") === "true";

  const typeToActivityType: Record<string, string[]> = {
    follow: ["Follow"],
    like: ["Like"],
    announce: ["Announce"],
    reply: ["Create"],
    mention: ["Create"],
  };

  const activityTypes =
    typeFilter && typeToActivityType[typeFilter]
      ? typeToActivityType[typeFilter]
      : NOTIFICATION_ACTIVITY_TYPES;

  // Get archived activity IDs for filtering
  const archivedActivities = await db
    .select({ activityApId: notificationArchived.activityApId })
    .from(notificationArchived)
    .where(eq(notificationArchived.actorApId, actor.ap_id));
  const archivedActivityIds = new Set(
    archivedActivities.map((a) => a.activityApId),
  );

  // Build inbox query with JOIN to activities
  const conditions = [
    eq(inboxTable.actorApId, actor.ap_id),
    ne(activities.actorApId, actor.ap_id),
    inArray(activities.type, activityTypes),
  ];
  if (before) {
    conditions.push(lt(inboxTable.createdAt, before));
  }

  const inboxEntries = await db
    .select({
      actorApId: inboxTable.actorApId,
      activityApId: inboxTable.activityApId,
      read: inboxTable.read,
      createdAt: inboxTable.createdAt,
      activityType: activities.type,
      activityActorApId: activities.actorApId,
      activityObjectApId: activities.objectApId,
    })
    .from(inboxTable)
    .innerJoin(activities, eq(inboxTable.activityApId, activities.apId))
    .where(and(...conditions))
    .orderBy(desc(inboxTable.createdAt))
    .limit(limit + 1);

  // Batch fetch related data
  const actorApIds = [...new Set(inboxEntries.map((i) => i.activityActorApId))];
  const objectApIds = [
    ...new Set(
      inboxEntries
        .map((i) => i.activityObjectApId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const activityApIdsArr = [
    ...new Set(inboxEntries.map((i) => i.activityApId)),
  ];

  const [actorMap, objectRows, followRows] = await Promise.all([
    batchLoadActorInfo(db, actorApIds),
    objectApIds.length > 0
      ? db
          .select({
            apId: objects.apId,
            content: objects.content,
            inReplyTo: objects.inReplyTo,
            audienceJson: objects.audienceJson,
            communityApId: objects.communityApId,
          })
          .from(objects)
          .where(inArray(objects.apId, objectApIds))
      : Promise.resolve([]),
    activityApIdsArr.length > 0
      ? db
          .select({
            activityApId: follows.activityApId,
            status: follows.status,
          })
          .from(follows)
          .where(inArray(follows.activityApId, activityApIdsArr))
      : Promise.resolve([]),
  ]);

  // Community read-gate: a private-community post can land in a NON-member's
  // inbox (e.g. an @-mention Create), so projecting its body verbatim would
  // leak community-scoped content. Gate each object's content against the
  // notification recipient (actor.ap_id) before exposing object_content.
  const readableObjectIds = new Set<string>(
    (
      await Promise.all(
        objectRows.map(async (o) =>
          (await canViewerReadObject(
            db,
            { audienceJson: o.audienceJson, communityApId: o.communityApId },
            actor.ap_id,
          ))
            ? o.apId
            : null,
        ),
      )
    ).filter((id): id is string => id !== null),
  );

  const objectMap = new Map(
    objectRows.map((o) => [
      o.apId,
      {
        content: readableObjectIds.has(o.apId) ? o.content : "",
        inReplyTo: o.inReplyTo,
      },
    ]),
  );
  const followMap = new Map(
    followRows
      .filter((f) => f.activityApId)
      .map((f) => [f.activityApId!, f.status]),
  );

  // Filter and transform inbox entries into notifications in a single pass
  const notifications_list: Array<{
    id: string;
    type: string;
    object_ap_id: string | null;
    read: boolean;
    created_at: string;
    actor: {
      ap_id: string;
      username: string;
      preferred_username: string | null;
      name: string | null;
      icon_url: string | null;
    };
    object_content: string;
  }> = [];

  for (const entry of inboxEntries) {
    if (notifications_list.length > limit) break;

    const isArchived = archivedActivityIds.has(entry.activityApId);
    if (showArchived !== isArchived) continue;

    const objectData = entry.activityObjectApId
      ? objectMap.get(entry.activityObjectApId)
      : null;
    const inReplyTo = objectData?.inReplyTo ?? null;

    // Distinguish reply vs mention for Create activities
    if (typeFilter === "reply" && entry.activityType === "Create" && !inReplyTo)
      continue;
    if (
      typeFilter === "mention" &&
      entry.activityType === "Create" &&
      inReplyTo
    )
      continue;

    const followStatus = followMap.get(entry.activityApId) ?? null;
    const notifType = activityToNotificationType(
      entry.activityType,
      !!inReplyTo,
      followStatus,
    );
    const actorInfo = actorMap.get(entry.activityActorApId);

    notifications_list.push({
      id: entry.activityApId,
      type: notifType || entry.activityType.toLowerCase(),
      object_ap_id: entry.activityObjectApId,
      read: !!entry.read,
      created_at: entry.createdAt,
      actor: {
        ap_id: entry.activityActorApId,
        username: formatUsername(entry.activityActorApId),
        preferred_username: actorInfo?.preferredUsername ?? null,
        name: actorInfo?.name ?? null,
        icon_url: actorInfo?.iconUrl ?? null,
      },
      object_content: objectData?.content ?? "",
    });
  }

  const has_more = notifications_list.length > limit;
  if (has_more) notifications_list.length = limit;

  return c.json({ notifications: notifications_list, limit, offset, has_more });
});

// GET /unread/count
notifications.get("/unread/count", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const db = c.get("db");
  await maybeCleanupArchivedNotifications(db, actor.ap_id);

  const result = await db
    .select({ count: count() })
    .from(inboxTable)
    .innerJoin(activities, eq(inboxTable.activityApId, activities.apId))
    .where(
      and(
        eq(inboxTable.actorApId, actor.ap_id),
        eq(inboxTable.read, 0),
        ne(activities.actorApId, actor.ap_id),
        inArray(activities.type, NOTIFICATION_ACTIVITY_TYPES),
      ),
    )
    .get();

  return c.json({ count: result?.count ?? 0 });
});

// POST /read -- Mark notifications as read
notifications.post("/read", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const db = c.get("db");
  const body = await c.req.json<{ ids?: string[]; read_all?: boolean }>();

  if (body.read_all) {
    await db
      .update(inboxTable)
      .set({ read: 1 })
      .where(eq(inboxTable.actorApId, actor.ap_id));
  } else if (body.ids && body.ids.length > 0) {
    if (body.ids.length > MAX_READ_BATCH_SIZE) {
      return c.json(
        {
          error: "array_too_long",
          message: `Batch size exceeds maximum of ${MAX_READ_BATCH_SIZE}`,
        },
        400,
      );
    }
    await db
      .update(inboxTable)
      .set({ read: 1 })
      .where(
        and(
          eq(inboxTable.actorApId, actor.ap_id),
          inArray(inboxTable.activityApId, body.ids),
        ),
      );
  } else {
    return c.json(
      { error: "Either ids array or read_all flag is required" },
      400,
    );
  }

  return c.json({ success: true });
});

// POST /archive -- Archive specific notifications
notifications.post("/archive", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const db = c.get("db");
  const body = await c.req.json<{ ids: string[] }>();

  if (
    !body.ids ||
    !Array.isArray(body.ids) ||
    body.ids.length === 0 ||
    body.ids.some((id) => typeof id !== "string" || id.trim().length === 0)
  ) {
    return c.json({ error: "ids array is required" }, 400);
  }
  if (body.ids.length > MAX_ARCHIVE_BATCH_SIZE) {
    return c.json(
      {
        error: `Batch size exceeds maximum of ${MAX_ARCHIVE_BATCH_SIZE}`,
      },
      400,
    );
  }

  const now = new Date().toISOString();
  const uniqueIds = [...new Set(body.ids.map((id) => id.trim()))];

  const alreadyArchived = await db
    .select({ activityApId: notificationArchived.activityApId })
    .from(notificationArchived)
    .where(
      and(
        eq(notificationArchived.actorApId, actor.ap_id),
        inArray(notificationArchived.activityApId, uniqueIds),
      ),
    );
  const alreadyArchivedSet = new Set(
    alreadyArchived.map((row) => row.activityApId),
  );
  const toArchive = uniqueIds.filter((id) => !alreadyArchivedSet.has(id));

  const rows = toArchive.map((id) => ({
    actorApId: actor.ap_id,
    activityApId: id,
    archivedAt: now,
  }));
  const archived_count = await batchArchiveInsert(
    db,
    rows,
    ARCHIVE_CREATE_BATCH_SIZE,
  );

  return c.json({ success: true, archived_count });
});

// DELETE /archive -- Unarchive notifications
notifications.delete("/archive", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const db = c.get("db");
  const body = await c.req.json<{ ids: string[] }>();
  if (!body.ids || body.ids.length === 0) {
    return c.json({ error: "ids array is required" }, 400);
  }
  if (body.ids.length > MAX_ARCHIVE_BATCH_SIZE) {
    return c.json(
      {
        error: "array_too_long",
        message: `Batch size exceeds maximum of ${MAX_ARCHIVE_BATCH_SIZE}`,
      },
      400,
    );
  }

  await db
    .delete(notificationArchived)
    .where(
      and(
        eq(notificationArchived.actorApId, actor.ap_id),
        inArray(notificationArchived.activityApId, body.ids),
      ),
    );

  return c.json({ success: true });
});

// POST /archive/all -- Archive all notifications
notifications.post("/archive/all", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const db = c.get("db");
  const now = new Date().toISOString();

  const [alreadyArchived, inboxItems] = await Promise.all([
    db
      .select({ activityApId: notificationArchived.activityApId })
      .from(notificationArchived)
      .where(eq(notificationArchived.actorApId, actor.ap_id))
      .limit(ARCHIVE_ALL_CAP),
    db
      .select({ activityApId: inboxTable.activityApId })
      .from(inboxTable)
      .where(eq(inboxTable.actorApId, actor.ap_id))
      .limit(ARCHIVE_ALL_CAP),
  ]);

  const alreadyArchivedIds = new Set(
    alreadyArchived.map((a) => a.activityApId),
  );
  const toArchive = inboxItems.filter(
    (item) => !alreadyArchivedIds.has(item.activityApId),
  );

  const rows = toArchive.map((item) => ({
    actorApId: actor.ap_id,
    activityApId: item.activityApId,
    archivedAt: now,
  }));

  const archived_count = await batchArchiveInsert(
    db,
    rows,
    ARCHIVE_CREATE_BATCH_SIZE,
  );
  return c.json({ success: true, archived_count });
});

export default notifications;
