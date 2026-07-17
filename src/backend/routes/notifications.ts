// Notifications routes for Yurucommu backend
// AP Native: Notifications are derived from inbox (activities addressed to the actor)
import { Hono } from "hono";
import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  type SQL,
} from "drizzle-orm";
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
import { communityReadableApIds } from "../lib/community-visibility.ts";
import { chunkForInClause } from "../lib/chunk.ts";
import {
  NOTIFICATION_ACTIVITY_TYPES,
  notificationEligibilityWhere,
} from "../lib/notification-eligibility.ts";
import {
  emitUnreadSnapshot,
  runRealtimeAfterResponse,
} from "../runtime/realtime-hub.ts";

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

const ARCHIVE_RETENTION_DAYS = 90;
const ARCHIVED_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
// Client-facing batch caps. <=90 because each id is re-queried via
// `inArray(..., body.ids)` plus an `eq()` param, and Cloudflare D1 caps a query
// at 100 bound parameters (libsql, used by tests, allows ~32k and hides this).
const MAX_ARCHIVE_BATCH_SIZE = 90;
const MAX_READ_BATCH_SIZE = 90;
// Multi-row INSERT chunk: each archive row binds 3 columns, so a chunk of N
// rows uses 3*N bound params. 30*3 = 90, under D1's 100-param ceiling.
const ARCHIVE_CREATE_BATCH_SIZE = 30;
// Bound the opportunistic retention-cleanup per run so a user with a very large
// archived backlog doesn't load + delete it all in one fired-from-read-path run;
// the rest drains on later runs.
const ARCHIVE_CLEANUP_BATCH = 200;
const ARCHIVE_ALL_CAP = 1000;

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
    )
    .limit(ARCHIVE_CLEANUP_BATCH);

  if (archivedToDelete.length === 0) return;

  const activityApIds = archivedToDelete.map((a) => a.activityApId);

  // Delete the inbox rows AND the archived markers for EXACTLY the bounded set,
  // chunked for D1's 100-bound-parameter cap. Both target the same activity ids
  // (not a broad `archivedAt < retentionDate`): with the per-run limit, a broad
  // archived-marker delete would drop markers for rows whose inbox entry wasn't
  // deleted this run, re-surfacing an expired-archived notification as active.
  // The inbox delete runs first so a crash can't leave a notification visible
  // with its retention marker already gone.
  for (const ids of chunkForInClause(activityApIds)) {
    await db
      .delete(inboxTable)
      .where(
        and(
          eq(inboxTable.actorApId, actorApId),
          inArray(inboxTable.activityApId, ids),
        ),
      );
    await db
      .delete(notificationArchived)
      .where(
        and(
          eq(notificationArchived.actorApId, actorApId),
          inArray(notificationArchived.activityApId, ids),
        ),
      );
  }
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

// Notifications order by createdAt desc, but createdAt is NOT unique — several
// inbox rows can share a millisecond — so an exclusive cursor on createdAt alone
// would skip the rows on either side of a page boundary that share the cursor's
// timestamp. The cursor is therefore a composite of (createdAt, activityApId);
// activityApId is unique within an actor's inbox, so (createdAt desc,
// activityApId desc) is a total order. The two parts are encoded into the opaque
// `before` string with a NUL separator (NUL cannot appear in an ISO timestamp or
// an http(s) ap_id URL). A legacy plain-createdAt cursor (no separator) is still
// accepted — it is never wider than the composite form.
const NOTIF_CURSOR_SEP = "\u0000";

type NotifCursor = { createdAt: string; activityApId?: string };

function decodeNotifCursor(before: string): NotifCursor {
  const idx = before.indexOf(NOTIF_CURSOR_SEP);
  if (idx === -1) return { createdAt: before };
  return {
    createdAt: before.slice(0, idx),
    activityApId: before.slice(idx + 1),
  };
}

function notifCursorPredicate(cursor: NotifCursor): SQL {
  if (cursor.activityApId === undefined) {
    return lt(inboxTable.createdAt, cursor.createdAt);
  }
  return or(
    lt(inboxTable.createdAt, cursor.createdAt),
    and(
      eq(inboxTable.createdAt, cursor.createdAt),
      lt(inboxTable.activityApId, cursor.activityApId),
    ),
  )!;
}

function encodeNotifCursor(row: { created_at: string; id: string }): string {
  return `${row.created_at}${NOTIF_CURSOR_SEP}${row.id}`;
}

function notificationTarget(
  type: string | null,
  activityActorApId: string,
  objectApId: string | null,
  objectType: string | null,
): {
  target_kind: "post" | "story" | "profile" | "notifications";
  target_id: string | null;
  // Same-origin in-app path shaped for the yurucommu web client's routing.
  // Other clients (e.g. yurume's distinct IA) must treat target_kind/target_id
  // as authoritative and build their own path, not follow target_url blindly.
  target_url: string;
} {
  if (type === "follow" || type === "follow_request") {
    return {
      target_kind: "profile",
      target_id: activityActorApId,
      target_url: `/profile/${encodeURIComponent(activityActorApId)}`,
    };
  }
  if (objectApId && objectType === "Story") {
    return {
      target_kind: "story",
      target_id: objectApId,
      target_url: `/?story=${encodeURIComponent(objectApId)}`,
    };
  }
  if (objectApId) {
    return {
      target_kind: "post",
      target_id: objectApId,
      target_url: `/post/${encodeURIComponent(objectApId)}`,
    };
  }
  return {
    target_kind: "notifications",
    target_id: null,
    target_url: "/notifications",
  };
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

  // Max 90 (not 100): this page's activityApIds are re-queried via
  // `inArray(inboxTable.activityApId, ...)` for the archived-state join, and
  // Cloudflare D1 allows at most 100 bound parameters per query.
  const limit = parseLimit(c.req.query("limit"), 20, 90);
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

  // Build inbox query with JOIN to activities. Shared eligibility predicate
  // (lib/notification-eligibility.ts) — the SAME builder used by the unread
  // badge and push delivery — supplies: not-self, user-facing types, the
  // archive partition (pushed into SQL as a correlated EXISTS/NOT EXISTS so the
  // limit+1 probe counts only rows that belong on the page, not a post-query
  // filter), the direct-DM exclusion (a DM's `Create` inbox row must not
  // double-surface here as a mention), and block/mute suppression. Direct
  // Creates are dropped via LEFT JOIN + NULL-visibility keep (Follow's object
  // is an actor, no `objects` row).
  const conditions = [
    eq(inboxTable.actorApId, actor.ap_id),
    ...notificationEligibilityWhere(db, actor.ap_id, {
      direct: "exclude",
      archived: showArchived ? "only" : "exclude",
      activityTypes,
    }),
  ];
  // reply vs mention both map to a Create; the split is whether the Create's
  // object is a reply (`inReplyTo` set). Pushed into SQL too so a type-filtered
  // page can't under-report has_more for the same reason as the archive split.
  if (typeFilter === "reply") {
    conditions.push(isNotNull(objects.inReplyTo));
  } else if (typeFilter === "mention") {
    conditions.push(isNull(objects.inReplyTo));
  }
  if (before) {
    conditions.push(notifCursorPredicate(decodeNotifCursor(before)));
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
    .leftJoin(objects, eq(activities.objectApId, objects.apId))
    .where(and(...conditions))
    .orderBy(desc(inboxTable.createdAt), desc(inboxTable.activityApId))
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
            type: objects.type,
            content: objects.content,
            inReplyTo: objects.inReplyTo,
            audienceJson: objects.audienceJson,
            communityApId: objects.communityApId,
            visibility: objects.visibility,
            attributedTo: objects.attributedTo,
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

  // Content read-gate. A restricted object can land in a NON-entitled inbox: a
  // private-community post via an @-mention Create, or — since a local reply
  // creates a notification for the parent author regardless of the reply's
  // visibility (post-helpers.ts) — a FOLLOWERS-ONLY reply by someone the
  // recipient neither follows nor authored. Projecting the body verbatim would
  // leak it. Gate each object's content against the recipient (actor.ap_id):
  // the community membership gate AND the followers-only gate (mirrors the
  // post-detail / replies gate: own post or an accepted follow to the author).
  // Direct posts are already dropped from the query above.
  const followerGateAuthors = [
    ...new Set(
      objectRows
        .filter(
          (o) => o.visibility === "followers" && o.attributedTo !== actor.ap_id,
        )
        .map((o) => o.attributedTo),
    ),
  ];
  const followedAuthors =
    followerGateAuthors.length > 0
      ? new Set(
          (
            await db
              .select({ followingApId: follows.followingApId })
              .from(follows)
              .where(
                and(
                  eq(follows.followerApId, actor.ap_id),
                  inArray(follows.followingApId, followerGateAuthors),
                  eq(follows.status, "accepted"),
                ),
              )
          ).map((r) => r.followingApId),
        )
      : new Set<string>();

  const followersGateAllows = (o: {
    visibility: string;
    attributedTo: string;
  }): boolean => {
    if (o.visibility !== "followers") return true;
    return (
      o.attributedTo === actor.ap_id || followedAuthors.has(o.attributedTo)
    );
  };

  // Apply the synchronous followers-gate first, then resolve the community
  // read-gate for all survivors in ONE batched call (2 queries) rather than
  // 1-2 queries per row.
  const readableObjectIds = await communityReadableApIds(
    db,
    objectRows.filter(followersGateAllows),
    actor.ap_id,
  );

  const objectMap = new Map(
    objectRows.map((o) => [
      o.apId,
      {
        type: o.type,
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
    target_kind: "post" | "story" | "profile" | "notifications";
    target_id: string | null;
    target_url: string;
  }> = [];

  for (const entry of inboxEntries) {
    if (notifications_list.length > limit) break;

    // Archive partition and reply/mention split are now enforced in SQL (see the
    // conditions above), so this pass is a pure transform — no row is dropped
    // here, which is what keeps `has_more` honest.
    const objectData = entry.activityObjectApId
      ? objectMap.get(entry.activityObjectApId)
      : null;
    const inReplyTo = objectData?.inReplyTo ?? null;

    const followStatus = followMap.get(entry.activityApId) ?? null;
    const notifType = activityToNotificationType(
      entry.activityType,
      !!inReplyTo,
      followStatus,
    );
    const actorInfo = actorMap.get(entry.activityActorApId);
    const target = notificationTarget(
      notifType,
      entry.activityActorApId,
      entry.activityObjectApId,
      objectData?.type ?? null,
    );

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
      ...target,
    });
  }

  const has_more = notifications_list.length > limit;
  if (has_more) notifications_list.length = limit;

  // Composite keyset cursor for the next page — resume strictly after the last
  // returned row. The client should prefer this over a bare created_at so
  // same-millisecond rows straddling the page boundary are not skipped.
  const last = notifications_list[notifications_list.length - 1];
  const next_cursor = has_more && last ? encodeNotifCursor(last) : null;

  return c.json({
    notifications: notifications_list,
    limit,
    offset,
    has_more,
    next_cursor,
  });
});

// GET /unread/count
notifications.get("/unread/count", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const db = c.get("db");
  await maybeCleanupArchivedNotifications(db, actor.ap_id);

  // SAME shared eligibility builder as the list and push delivery: not-self,
  // user-facing types, archive exclusion (an archived UNREAD notification must
  // not leave a phantom count the client can never clear), the direct-DM
  // exclusion (a DM has its own badge), and block/mute suppression.
  const result = await db
    .select({ count: count() })
    .from(inboxTable)
    .innerJoin(activities, eq(inboxTable.activityApId, activities.apId))
    .leftJoin(objects, eq(activities.objectApId, objects.apId))
    .where(
      and(
        eq(inboxTable.actorApId, actor.ap_id),
        eq(inboxTable.read, 0),
        ...notificationEligibilityWhere(db, actor.ap_id, { direct: "exclude" }),
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
  // A literal `null`/primitive JSON body parses without throwing, then field
  // access throws a TypeError that the global handler maps to 500 (not 400).
  // Guard the body shape so a malformed request is a clean 400.
  const body = await c.req
    .json<{ ids?: string[]; read_all?: boolean }>()
    .catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400);
  }

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

  // Sync the reader's OTHER tabs/devices: push the fresh authoritative badge.
  await runRealtimeAfterResponse(c, () =>
    emitUnreadSnapshot(c.env, actor.ap_id),
  );

  return c.json({ success: true });
});

// POST /archive -- Archive specific notifications
notifications.post("/archive", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const db = c.get("db");
  const body = await c.req.json<{ ids: string[] }>().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400);
  }

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

  // Archiving an unread notification removes it from the badge count.
  await runRealtimeAfterResponse(c, () =>
    emitUnreadSnapshot(c.env, actor.ap_id),
  );

  return c.json({ success: true, archived_count });
});

// DELETE /archive -- Unarchive notifications
notifications.delete("/archive", async (c) => {
  const actor = requireActor(c);
  if (actor instanceof Response) return actor;

  const db = c.get("db");
  const body = await c.req.json<{ ids: string[] }>().catch(() => null);
  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid request body" }, 400);
  }
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

  // Unarchiving can resurface unread rows into the badge count.
  await runRealtimeAfterResponse(c, () =>
    emitUnreadSnapshot(c.env, actor.ap_id),
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

  // Archive-all clears the whole badge; sync the reader's other tabs/devices.
  await runRealtimeAfterResponse(c, () =>
    emitUnreadSnapshot(c.env, actor.ap_id),
  );

  return c.json({ success: true, archived_count });
});

export default notifications;
