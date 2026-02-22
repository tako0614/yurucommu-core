// Notifications routes for Yurucommu backend
// AP Native: Notifications are derived from inbox (activities addressed to the actor)
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername, parseLimit, parseOffset } from '../utils';
import type { PrismaClient, Prisma } from '../../generated/prisma';

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

const ARCHIVE_RETENTION_DAYS = 90;
const ARCHIVED_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_ARCHIVE_BATCH_SIZE = 100;
const ARCHIVE_CREATE_BATCH_SIZE = 100;
const ARCHIVE_ALL_CAP = 1000;
const ARCHIVE_BATCH_SIZE = 100;
const NOTIFICATION_ACTIVITY_TYPES = ['Follow', 'Like', 'Announce', 'Create'];
const archivedCleanupTimestamps = new Map<string, number>();

type ActorInfo = { preferredUsername: string | null; name: string | null; iconUrl: string | null };

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'P2002';
}

/** Require authenticated actor or return 401. */
function requireActor(c: { get(key: 'actor'): { ap_id: string } | null }): { ap_id: string } | null {
  return c.get('actor');
}

/**
 * Batch-insert archive rows with unique-constraint tolerance.
 * Returns the number of rows actually inserted.
 */
async function batchArchiveInsert(
  prisma: PrismaClient,
  rows: Array<{ actorApId: string; activityApId: string; archivedAt: string }>,
  batchSize: number,
): Promise<number> {
  let inserted = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    try {
      const result = await prisma.notificationArchived.createMany({ data: batch });
      inserted += result.count;
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
      // Race-condition duplicates: fall back to row-by-row insert
      for (const row of batch) {
        try {
          await prisma.notificationArchived.create({ data: row });
          inserted++;
        } catch (innerError) {
          if (!isUniqueConstraintError(innerError)) {
            throw innerError;
          }
        }
      }
    }
  }

  return inserted;
}

async function cleanupArchivedNotifications(prisma: PrismaClient, actorApId: string): Promise<void> {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - ARCHIVE_RETENTION_DAYS);
  const retentionDateStr = retentionDate.toISOString();

  const archivedToDelete = await prisma.notificationArchived.findMany({
    where: {
      actorApId,
      archivedAt: { lt: retentionDateStr },
    },
    select: { activityApId: true },
  });

  if (archivedToDelete.length === 0) return;

  const activityApIds = archivedToDelete.map(a => a.activityApId);

  await prisma.inbox.deleteMany({
    where: {
      actorApId,
      activityApId: { in: activityApIds },
    },
  });

  await prisma.notificationArchived.deleteMany({
    where: {
      actorApId,
      archivedAt: { lt: retentionDateStr },
    },
  });
}

async function maybeCleanupArchivedNotifications(prisma: PrismaClient, actorApId: string): Promise<void> {
  const now = Date.now();
  const lastRun = archivedCleanupTimestamps.get(actorApId) ?? 0;
  if (now - lastRun < ARCHIVED_CLEANUP_INTERVAL_MS) return;

  archivedCleanupTimestamps.set(actorApId, now);
  await cleanupArchivedNotifications(prisma, actorApId);
}

function activityToNotificationType(activityType: string, hasInReplyTo: boolean, followStatus?: string | null): string | null {
  switch (activityType) {
    case 'Follow':
      return followStatus === 'pending' ? 'follow_request' : 'follow';
    case 'Like':
      return 'like';
    case 'Announce':
      return 'announce';
    case 'Create':
      return hasInReplyTo ? 'reply' : 'mention';
    default:
      return null;
  }
}

/** Build a merged actor lookup map (local actors take priority over cached). */
async function buildActorMap(
  prisma: PrismaClient,
  apIds: string[],
): Promise<Map<string, ActorInfo>> {
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: apIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: apIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  const map = new Map<string, ActorInfo>();
  // Insert cached first so local actors override them
  for (const a of cachedActors) {
    map.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
  }
  for (const a of localActors) {
    map.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET / -- List notifications with type/archive filters
notifications.get('/', async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  await maybeCleanupArchivedNotifications(prisma, actor.ap_id);

  const limit = parseLimit(c.req.query('limit'), 20, 100);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);
  const before = c.req.query('before');
  const typeFilter = c.req.query('type');
  const showArchived = c.req.query('archived') === 'true';

  const typeToActivityType: Record<string, string[]> = {
    'follow': ['Follow'],
    'like': ['Like'],
    'announce': ['Announce'],
    'reply': ['Create'],
    'mention': ['Create'],
  };

  const activityTypes = (typeFilter && typeToActivityType[typeFilter])
    ? typeToActivityType[typeFilter]
    : NOTIFICATION_ACTIVITY_TYPES;

  // Get archived activity IDs for filtering
  const archivedActivities = await prisma.notificationArchived.findMany({
    where: { actorApId: actor.ap_id },
    select: { activityApId: true },
  });
  const archivedActivityIds = new Set(archivedActivities.map(a => a.activityApId));

  // Build inbox query
  const whereClause: Prisma.InboxWhereInput = {
    actorApId: actor.ap_id,
    activity: {
      actorApId: { not: actor.ap_id },
      type: { in: activityTypes },
    },
  };
  if (before) {
    whereClause.createdAt = { lt: before };
  }

  const inboxEntries = await prisma.inbox.findMany({
    where: whereClause,
    include: { activity: true },
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
  });

  // Batch fetch related data
  const actorApIds = [...new Set(inboxEntries.map(i => i.activity.actorApId))];
  const objectApIds = [...new Set(inboxEntries.map(i => i.activity.objectApId).filter((id): id is string => id !== null))];
  const activityApIds = [...new Set(inboxEntries.map(i => i.activityApId))];

  const [actorMap, objects, follows] = await Promise.all([
    buildActorMap(prisma, actorApIds),
    prisma.object.findMany({
      where: { apId: { in: objectApIds } },
      select: { apId: true, content: true, inReplyTo: true },
    }),
    prisma.follow.findMany({
      where: { activityApId: { in: activityApIds } },
      select: { activityApId: true, status: true },
    }),
  ]);

  const objectMap = new Map(objects.map(o => [o.apId, { content: o.content, inReplyTo: o.inReplyTo }]));
  const followMap = new Map(follows.filter(f => f.activityApId).map(f => [f.activityApId!, f.status]));

  // Filter and transform inbox entries into notifications
  type ProcessedEntry = {
    activityApId: string;
    read: number;
    createdAt: string;
    activityType: string;
    actorApId: string;
    objectApId: string | null;
    followStatus: string | null;
    actorInfo: ActorInfo | undefined;
    objectContent: string | null;
    inReplyTo: string | null;
  };
  const processedEntries: ProcessedEntry[] = [];

  for (const entry of inboxEntries) {
    if (processedEntries.length > limit) break;

    const isArchived = archivedActivityIds.has(entry.activityApId);
    if (showArchived !== isArchived) continue;

    const objectData = entry.activity.objectApId ? objectMap.get(entry.activity.objectApId) : null;
    const inReplyTo = objectData?.inReplyTo ?? null;

    // Distinguish reply vs mention for Create activities
    if (typeFilter === 'reply' && entry.activity.type === 'Create' && !inReplyTo) continue;
    if (typeFilter === 'mention' && entry.activity.type === 'Create' && inReplyTo) continue;

    processedEntries.push({
      activityApId: entry.activityApId,
      read: entry.read,
      createdAt: entry.createdAt,
      activityType: entry.activity.type,
      actorApId: entry.activity.actorApId,
      objectApId: entry.activity.objectApId,
      followStatus: followMap.get(entry.activityApId) ?? null,
      actorInfo: actorMap.get(entry.activity.actorApId),
      objectContent: objectData?.content ?? null,
      inReplyTo,
    });
  }

  const has_more = processedEntries.length > limit;
  const actualResults = has_more ? processedEntries.slice(0, limit) : processedEntries;

  const notifications_list = actualResults.map((n) => {
    const notifType = activityToNotificationType(n.activityType, !!n.inReplyTo, n.followStatus);
    return {
      id: n.activityApId,
      type: notifType || n.activityType.toLowerCase(),
      object_ap_id: n.objectApId,
      read: !!n.read,
      created_at: n.createdAt,
      actor: {
        ap_id: n.actorApId,
        username: formatUsername(n.actorApId),
        preferred_username: n.actorInfo?.preferredUsername ?? null,
        name: n.actorInfo?.name ?? null,
        icon_url: n.actorInfo?.iconUrl ?? null,
      },
      object_content: n.objectContent || '',
    };
  });

  return c.json({ notifications: notifications_list, limit, offset, has_more });
});

// GET /unread/count
notifications.get('/unread/count', async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  await maybeCleanupArchivedNotifications(prisma, actor.ap_id);

  const count = await prisma.inbox.count({
    where: {
      actorApId: actor.ap_id,
      read: 0,
      activity: {
        actorApId: { not: actor.ap_id },
        type: { in: NOTIFICATION_ACTIVITY_TYPES },
      },
    },
  });

  return c.json({ count });
});

// POST /read -- Mark notifications as read
notifications.post('/read', async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ ids?: string[]; read_all?: boolean }>();

  if (body.read_all) {
    await prisma.inbox.updateMany({
      where: { actorApId: actor.ap_id },
      data: { read: 1 },
    });
  } else if (body.ids && body.ids.length > 0) {
    await prisma.inbox.updateMany({
      where: {
        actorApId: actor.ap_id,
        activityApId: { in: body.ids },
      },
      data: { read: 1 },
    });
  } else {
    return c.json({ error: 'Either ids array or read_all flag is required' }, 400);
  }

  return c.json({ success: true });
});

// POST /archive -- Archive specific notifications
notifications.post('/archive', async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ ids: string[] }>();

  if (
    !body.ids
    || !Array.isArray(body.ids)
    || body.ids.length === 0
    || body.ids.some((id) => typeof id !== 'string' || id.trim().length === 0)
  ) {
    return c.json({ error: 'ids array is required' }, 400);
  }
  if (body.ids.length > MAX_ARCHIVE_BATCH_SIZE) {
    return c.json({ error: `Batch size exceeds maximum of ${MAX_ARCHIVE_BATCH_SIZE}` }, 400);
  }

  const now = new Date().toISOString();
  const uniqueIds = [...new Set(body.ids.map((id) => id.trim()))];

  const alreadyArchived = await prisma.notificationArchived.findMany({
    where: {
      actorApId: actor.ap_id,
      activityApId: { in: uniqueIds },
    },
    select: { activityApId: true },
  });
  const alreadyArchivedSet = new Set(alreadyArchived.map((row) => row.activityApId));
  const toArchive = uniqueIds.filter((id) => !alreadyArchivedSet.has(id));

  const rows = toArchive.map((id) => ({
    actorApId: actor.ap_id,
    activityApId: id,
    archivedAt: now,
  }));
  const archived_count = await batchArchiveInsert(prisma, rows, ARCHIVE_CREATE_BATCH_SIZE);

  return c.json({ success: true, archived_count });
});

// DELETE /archive -- Unarchive notifications
notifications.delete('/archive', async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ ids: string[] }>();
  if (!body.ids || body.ids.length === 0) {
    return c.json({ error: 'ids array is required' }, 400);
  }

  await prisma.notificationArchived.deleteMany({
    where: {
      actorApId: actor.ap_id,
      activityApId: { in: body.ids },
    },
  });

  return c.json({ success: true });
});

// POST /archive/all -- Archive all notifications
notifications.post('/archive/all', async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const now = new Date().toISOString();

  const [alreadyArchived, inboxItems] = await Promise.all([
    prisma.notificationArchived.findMany({
      where: { actorApId: actor.ap_id },
      select: { activityApId: true },
      take: ARCHIVE_ALL_CAP,
    }),
    prisma.inbox.findMany({
      where: { actorApId: actor.ap_id },
      select: { activityApId: true },
      take: ARCHIVE_ALL_CAP,
    }),
  ]);

  const alreadyArchivedIds = new Set(alreadyArchived.map(a => a.activityApId));
  const toArchive = inboxItems.filter(item => !alreadyArchivedIds.has(item.activityApId));

  const rows = toArchive.map(item => ({
    actorApId: actor.ap_id,
    activityApId: item.activityApId,
    archivedAt: now,
  }));

  let archived_count = 0;
  for (let i = 0; i < rows.length; i += ARCHIVE_BATCH_SIZE) {
    const batch = rows.slice(i, i + ARCHIVE_BATCH_SIZE);
    try {
      const result = await prisma.notificationArchived.createMany({ data: batch });
      archived_count += result.count;
    } catch (e) {
      const error = e as { code?: string };
      if (error.code !== 'P2002') {
        console.error('[Notifications] Batch archive error:', e);
      }
    }
  }

  return c.json({ success: true, archived_count });
});

export default notifications;
