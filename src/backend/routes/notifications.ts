// Notifications routes for Yurucommu backend
// AP Native: Notifications are derived from inbox (activities addressed to the actor)
import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { formatUsername } from '../utils';
import type { PrismaClient, Prisma } from '../../generated/prisma';

const notifications = new Hono<{ Bindings: Env; Variables: Variables }>();

const ARCHIVE_RETENTION_DAYS = 90;

async function cleanupArchivedNotifications(prisma: PrismaClient, actorApId: string): Promise<void> {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - ARCHIVE_RETENTION_DAYS);
  const retentionDateStr = retentionDate.toISOString();

  // Get archived notification IDs that are past retention period
  const archivedToDelete = await prisma.notificationArchived.findMany({
    where: {
      actorApId,
      archivedAt: { lt: retentionDateStr },
    },
    select: { activityApId: true },
  });

  if (archivedToDelete.length > 0) {
    const activityApIds = archivedToDelete.map(a => a.activityApId);

    // Delete from inbox
    await prisma.inbox.deleteMany({
      where: {
        actorApId,
        activityApId: { in: activityApIds },
      },
    });

    // Delete from notification_archived
    await prisma.notificationArchived.deleteMany({
      where: {
        actorApId,
        archivedAt: { lt: retentionDateStr },
      },
    });
  }
}

// Map activity types to notification types
function activityToNotificationType(activityType: string, hasInReplyTo: boolean, followStatus?: string | null): string | null {
  switch (activityType) {
    case 'Follow':
      return followStatus === 'pending' ? 'follow_request' : 'follow';
    case 'Like':
      return 'like';
    case 'Announce':
      return 'announce';
    case 'Create':
      // Create activity for replies or mentions
      return hasInReplyTo ? 'reply' : 'mention';
    default:
      return null;
  }
}

// Get notifications with actor details (AP Native: from inbox + activities)
// Supports ?type=follow|like|announce|reply|mention filter
// Supports ?archived=true to show archived notifications
notifications.get('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  await cleanupArchivedNotifications(prisma, actor.ap_id);

  const limit = Math.min(parseInt(c.req.query('limit') || '20'), 100);
  const offset = parseInt(c.req.query('offset') || '0');
  const before = c.req.query('before');
  const typeFilter = c.req.query('type'); // follow, like, announce, reply, mention
  const showArchived = c.req.query('archived') === 'true';

  // Map filter type to activity types
  const typeToActivityType: Record<string, string[]> = {
    'follow': ['Follow'],
    'like': ['Like'],
    'announce': ['Announce'],
    'reply': ['Create'], // Create with in_reply_to
    'mention': ['Create'], // Create without in_reply_to
  };

  // Build activity type filter
  let activityTypes = ['Follow', 'Like', 'Announce', 'Create'];
  if (typeFilter && typeToActivityType[typeFilter]) {
    activityTypes = typeToActivityType[typeFilter];
  }

  // Get archived activity IDs for this actor
  const archivedActivities = await prisma.notificationArchived.findMany({
    where: { actorApId: actor.ap_id },
    select: { activityApId: true },
  });
  const archivedActivityIds = new Set(archivedActivities.map(a => a.activityApId));

  // Build where clause for inbox query
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

  // Get inbox entries with activity data
  const inboxEntries = await prisma.inbox.findMany({
    where: whereClause,
    include: {
      activity: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit * 5, // Fetch more to account for filtering
  });

  // Get all unique actor IDs and object IDs for batch fetching
  const actorApIds = [...new Set(inboxEntries.map(i => i.activity.actorApId))];
  const objectApIds = [...new Set(inboxEntries.map(i => i.activity.objectApId).filter((id): id is string => id !== null))];
  const activityApIds = [...new Set(inboxEntries.map(i => i.activityApId))];

  // Batch fetch actors (local and cached)
  const [localActors, cachedActors, objects, follows] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: actorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: actorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.object.findMany({
      where: { apId: { in: objectApIds } },
      select: { apId: true, content: true, inReplyTo: true },
    }),
    prisma.follow.findMany({
      where: { activityApId: { in: activityApIds } },
      select: { activityApId: true, status: true },
    }),
  ]);

  // Create lookup maps
  const actorMap = new Map<string, { preferredUsername: string | null; name: string | null; iconUrl: string | null }>();
  for (const a of localActors) {
    actorMap.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
  }
  for (const a of cachedActors) {
    if (!actorMap.has(a.apId)) {
      actorMap.set(a.apId, { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl });
    }
  }

  const objectMap = new Map<string, { content: string; inReplyTo: string | null }>();
  for (const o of objects) {
    objectMap.set(o.apId, { content: o.content, inReplyTo: o.inReplyTo });
  }

  const followMap = new Map<string | null, string>();
  for (const f of follows) {
    if (f.activityApId) {
      followMap.set(f.activityApId, f.status);
    }
  }

  // Filter and process entries
  const processedEntries: Array<{
    activityApId: string;
    read: number;
    createdAt: string;
    activityType: string;
    actorApId: string;
    objectApId: string | null;
    followStatus: string | null;
    actorUsername: string | null;
    actorName: string | null;
    actorIconUrl: string | null;
    objectContent: string | null;
    inReplyTo: string | null;
  }> = [];

  for (const entry of inboxEntries) {
    const isArchived = archivedActivityIds.has(entry.activityApId);

    // Filter by archived status
    if (showArchived !== isArchived) {
      continue;
    }

    const objectData = entry.activity.objectApId ? objectMap.get(entry.activity.objectApId) : null;
    const inReplyTo = objectData?.inReplyTo ?? null;

    // For reply vs mention distinction
    if (typeFilter === 'reply' && entry.activity.type === 'Create' && !inReplyTo) {
      continue;
    }
    if (typeFilter === 'mention' && entry.activity.type === 'Create' && inReplyTo) {
      continue;
    }

    const actorData = actorMap.get(entry.activity.actorApId);
    const followStatus = followMap.get(entry.activityApId) ?? null;

    processedEntries.push({
      activityApId: entry.activityApId,
      read: entry.read,
      createdAt: entry.createdAt,
      activityType: entry.activity.type,
      actorApId: entry.activity.actorApId,
      objectApId: entry.activity.objectApId,
      followStatus,
      actorUsername: actorData?.preferredUsername ?? null,
      actorName: actorData?.name ?? null,
      actorIconUrl: actorData?.iconUrl ?? null,
      objectContent: objectData?.content ?? null,
      inReplyTo,
    });

    if (processedEntries.length > limit) {
      break;
    }
  }

  // Check if there are more results
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
        preferred_username: n.actorUsername,
        name: n.actorName,
        icon_url: n.actorIconUrl,
      },
      object_content: n.objectContent || '',
    };
  });

  return c.json({ notifications: notifications_list, limit, offset, has_more });
});

// Get unread notification count (AP Native: from inbox)
notifications.get('/unread/count', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  await cleanupArchivedNotifications(prisma, actor.ap_id);

  const unreadCount = await prisma.inbox.count({
    where: {
      actorApId: actor.ap_id,
      read: 0,
      activity: {
        actorApId: { not: actor.ap_id },
        type: { in: ['Follow', 'Like', 'Announce', 'Create'] },
      },
    },
  });

  return c.json({
    count: unreadCount,
  });
});

// Mark notifications as read (AP Native: updates inbox)
notifications.post('/read', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ ids?: string[]; read_all?: boolean }>();

  if (body.read_all) {
    // Mark all inbox entries as read
    await prisma.inbox.updateMany({
      where: { actorApId: actor.ap_id },
      data: { read: 1 },
    });
  } else if (body.ids && body.ids.length > 0) {
    // Mark specific activities as read in inbox
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

// Archive notifications
notifications.post('/archive', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ ids: string[] }>();
  if (!body.ids || body.ids.length === 0) {
    return c.json({ error: 'ids array is required' }, 400);
  }

  const now = new Date().toISOString();
  let archivedCount = 0;

  for (const id of body.ids) {
    try {
      await prisma.notificationArchived.create({
        data: {
          actorApId: actor.ap_id,
          activityApId: id,
          archivedAt: now,
        },
      });
      archivedCount++;
    } catch {
      // Ignore duplicate key errors (already archived)
    }
  }

  return c.json({ success: true, archived_count: archivedCount });
});

// Unarchive notifications
notifications.delete('/archive', async (c) => {
  const actor = c.get('actor');
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

// Archive all notifications
notifications.post('/archive/all', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const now = new Date().toISOString();

  // Get all activity IDs from inbox
  const inboxItems = await prisma.inbox.findMany({
    where: { actorApId: actor.ap_id },
    select: { activityApId: true },
  });

  let archivedCount = 0;
  for (const item of inboxItems) {
    try {
      await prisma.notificationArchived.create({
        data: {
          actorApId: actor.ap_id,
          activityApId: item.activityApId,
          archivedAt: now,
        },
      });
      archivedCount++;
    } catch {
      // Ignore duplicate key errors (already archived)
    }
  }

  return c.json({ success: true, archived_count: archivedCount });
});

export default notifications;
