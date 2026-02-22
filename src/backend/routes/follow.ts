import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { generateId, activityApId, isLocal, formatUsername, isSafeRemoteUrl, parseLimit, parseOffset, fetchWithTimeout } from '../utils';
import { enqueueDeliveryToActor } from '../lib/delivery/queue';

// P07: Network timeout for remote requests (10 seconds)
const REMOTE_FETCH_TIMEOUT_MS = 10000;

// P07: Maximum batch size for follow accept to prevent DoS
const MAX_BATCH_ACCEPT_SIZE = 100;

const follow = new Hono<{ Bindings: Env; Variables: Variables }>();

type RemoteActor = {
  id: string;
  type?: string;
  preferredUsername?: string;
  name?: string;
  summary?: string;
  icon?: { url?: string };
  inbox?: string;
  outbox?: string;
  followers?: string;
  following?: string;
  endpoints?: { sharedInbox?: string };
  publicKey?: { id?: string; publicKeyPem?: string };
};

// ---------------------------------------------------------------------------
// Shared helpers (file-local)
// ---------------------------------------------------------------------------

async function parseJsonObject(
  c: { req: { json: () => Promise<unknown> } }
): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return null;
    }
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value
    .map((v) => parseNonEmptyString(v))
    .filter((v): v is string => v !== null);
  if (parsed.length !== value.length) return null;
  return parsed;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'P2002';
}

/** Builds the Prisma compound-key object used by every follow lookup. */
function followKey(followerApId: string, followingApId: string) {
  return { followerApId_followingApId: { followerApId, followingApId } } as const;
}

/** Builds a standard ActivityPub activity JSON envelope. */
function buildApActivity(
  type: string,
  actorApId: string,
  object: unknown,
  activityId: string,
): Record<string, unknown> {
  return {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityId,
    type,
    actor: actorApId,
    object,
    published: new Date().toISOString(),
  };
}

type PrismaClient = ReturnType<typeof import('hono').Context.prototype.get<'prisma'>>;

/**
 * Creates an outbound AP activity record and enqueues it for delivery.
 * Used by unfollow (Undo), accept, and reject flows.
 */
async function createAndDeliverActivity(
  env: Env,
  prisma: PrismaClient,
  baseUrl: string,
  type: string,
  actorApId: string,
  object: unknown,
  recipientApId: string,
  objectApId?: string | null,
): Promise<void> {
  const activityId = activityApId(baseUrl, generateId());
  const activity = buildApActivity(type, actorApId, object, activityId);

  await prisma.activity.create({
    data: {
      apId: activityId,
      type,
      actorApId,
      objectApId: objectApId || undefined,
      rawJson: JSON.stringify(activity),
      direction: 'outbound',
    },
  });

  await enqueueDeliveryToActor(env, activityId, recipientApId);
}

// ---------------------------------------------------------------------------
// POST / — Follow an actor (local or remote)
// ---------------------------------------------------------------------------

follow.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await parseJsonObject(c);
  if (!body) return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);

  const targetApId = parseNonEmptyString(body.target_ap_id);
  if (!targetApId) return c.json({ error: 'target_ap_id required', code: 'BAD_REQUEST' }, 400);
  if (targetApId === actor.ap_id) return c.json({ error: 'Cannot follow yourself' }, 400);

  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  const existing = await prisma.follow.findUnique({
    where: followKey(actor.ap_id, targetApId),
  });
  if (existing) return c.json({ error: 'Already following or pending' }, 400);

  if (isLocal(targetApId, baseUrl)) {
    return handleLocalFollow(c, prisma, baseUrl, actor, targetApId);
  }
  return handleRemoteFollow(c, prisma, baseUrl, actor, targetApId);
});

async function handleLocalFollow(
  c: import('hono').Context<{ Bindings: Env; Variables: Variables }>,
  prisma: PrismaClient,
  baseUrl: string,
  actor: { ap_id: string },
  targetApId: string,
) {
  const target = await prisma.actor.findUnique({
    where: { apId: targetApId },
    select: { isPrivate: true },
  });
  if (!target) return c.json({ error: 'Target actor not found' }, 404);

  const status = target.isPrivate ? 'pending' : 'accepted';
  const id = activityApId(baseUrl, generateId());
  const now = new Date().toISOString();

  const followActivity = buildApActivity('Follow', actor.ap_id, targetApId, id);
  followActivity.published = now;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.follow.create({
        data: {
          followerApId: actor.ap_id,
          followingApId: targetApId,
          status,
          activityApId: id,
          acceptedAt: status === 'accepted' ? now : null,
        },
      });

      if (status === 'accepted') {
        await tx.actor.update({
          where: { apId: actor.ap_id },
          data: { followingCount: { increment: 1 } },
        });
        await tx.actor.update({
          where: { apId: targetApId },
          data: { followerCount: { increment: 1 } },
        });
      }

      await tx.activity.create({
        data: {
          apId: id,
          type: 'Follow',
          actorApId: actor.ap_id,
          objectApId: targetApId,
          rawJson: JSON.stringify(followActivity),
          direction: 'local',
        },
      });

      await tx.inbox.create({
        data: {
          actorApId: targetApId,
          activityApId: id,
          read: 0,
        },
      });
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return c.json({ error: 'Already following or pending' }, 400);
    }
    throw error;
  }

  return c.json({ success: true, status });
}

async function handleRemoteFollow(
  c: import('hono').Context<{ Bindings: Env; Variables: Variables }>,
  prisma: PrismaClient,
  baseUrl: string,
  actor: { ap_id: string },
  targetApId: string,
) {
  if (!isSafeRemoteUrl(targetApId)) {
    return c.json({ error: 'Invalid target_ap_id' }, 400);
  }

  let cachedActor = await prisma.actorCache.findUnique({
    where: { apId: targetApId },
  });

  if (!cachedActor) {
    try {
      const res = await fetchWithTimeout(targetApId, {
        headers: { 'Accept': 'application/activity+json, application/ld+json' },
        timeout: REMOTE_FETCH_TIMEOUT_MS,
      });
      if (!res.ok) return c.json({ error: 'Could not fetch remote actor' }, 400);

      const actorData = await res.json() as RemoteActor;
      if (
        !actorData?.id ||
        !actorData?.inbox ||
        !isSafeRemoteUrl(actorData.id) ||
        !isSafeRemoteUrl(actorData.inbox)
      ) {
        return c.json({ error: 'Invalid remote actor data' }, 400);
      }

      cachedActor = await prisma.actorCache.create({
        data: {
          apId: actorData.id,
          type: actorData.type || 'Person',
          preferredUsername: actorData.preferredUsername || null,
          name: actorData.name || null,
          summary: actorData.summary || null,
          iconUrl: actorData.icon?.url || null,
          inbox: actorData.inbox,
          outbox: actorData.outbox || null,
          followersUrl: actorData.followers || null,
          followingUrl: actorData.following || null,
          sharedInbox: actorData.endpoints?.sharedInbox || null,
          publicKeyId: actorData.publicKey?.id || null,
          publicKeyPem: actorData.publicKey?.publicKeyPem || null,
          rawJson: JSON.stringify(actorData),
          lastFetchedAt: new Date().toISOString(),
        },
      });
    } catch {
      return c.json({ error: 'Failed to fetch remote actor' }, 400);
    }
  }

  if (!cachedActor?.inbox || !isSafeRemoteUrl(cachedActor.inbox)) {
    return c.json({ error: 'Invalid inbox URL' }, 400);
  }

  const id = activityApId(baseUrl, generateId());
  const followActivity = buildApActivity('Follow', actor.ap_id, targetApId, id);

  try {
    await prisma.$transaction(async (tx) => {
      await tx.follow.create({
        data: {
          followerApId: actor.ap_id,
          followingApId: targetApId,
          status: 'pending',
          activityApId: id,
        },
      });

      await tx.activity.create({
        data: {
          apId: id,
          type: 'Follow',
          actorApId: actor.ap_id,
          objectApId: targetApId,
          rawJson: JSON.stringify(followActivity),
          direction: 'outbound',
        },
      });
    });
  } catch (e) {
    console.error('[Follow] Failed to create remote follow:', e);
    return c.json({ error: 'Failed to follow remote actor' }, 500);
  }

  await enqueueDeliveryToActor(c.env, id, targetApId);
  return c.json({ success: true, status: 'pending' });
}

// ---------------------------------------------------------------------------
// DELETE / — Unfollow
// ---------------------------------------------------------------------------

follow.delete('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await parseJsonObject(c);
  if (!body) return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);

  const targetApId = parseNonEmptyString(body.target_ap_id);
  if (!targetApId) return c.json({ error: 'target_ap_id required', code: 'BAD_REQUEST' }, 400);

  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  const existingFollow = await prisma.follow.findUnique({
    where: followKey(actor.ap_id, targetApId),
  });
  if (!existingFollow) return c.json({ error: 'Not following' }, 400);

  const wasAccepted = existingFollow.status === 'accepted';
  const targetIsLocal = isLocal(targetApId, baseUrl);

  await prisma.$transaction(async (tx) => {
    await tx.follow.delete({
      where: followKey(actor.ap_id, targetApId),
    });

    if (!wasAccepted) return;

    await tx.actor.update({
      where: { apId: actor.ap_id },
      data: { followingCount: { decrement: 1 } },
    });

    if (targetIsLocal) {
      await tx.actor.update({
        where: { apId: targetApId },
        data: { followerCount: { decrement: 1 } },
      });
    }
  });

  if (!targetIsLocal) {
    const undoObject = { type: 'Follow', actor: actor.ap_id, object: targetApId };
    await createAndDeliverActivity(
      c.env, prisma, baseUrl, 'Undo', actor.ap_id, undoObject, targetApId, targetApId,
    );
  }

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /accept — Accept a single follow request
// ---------------------------------------------------------------------------

follow.post('/accept', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await parseJsonObject(c);
  if (!body) return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);

  const requesterApId = parseNonEmptyString(body.requester_ap_id);
  if (!requesterApId) return c.json({ error: 'requester_ap_id required', code: 'BAD_REQUEST' }, 400);

  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  // P07: Wrap in transaction to prevent race condition where two accepts could increment counts twice
  let pendingFollow: Awaited<ReturnType<typeof prisma.follow.findFirst>>;
  try {
    pendingFollow = await prisma.$transaction(async (tx) => {
      const found = await tx.follow.findFirst({
        where: {
          followerApId: requesterApId,
          followingApId: actor.ap_id,
          status: 'pending',
        },
      });
      if (!found) return null;

      await tx.follow.update({
        where: followKey(requesterApId, actor.ap_id),
        data: { status: 'accepted', acceptedAt: new Date().toISOString() },
      });

      await tx.actor.update({
        where: { apId: actor.ap_id },
        data: { followerCount: { increment: 1 } },
      });

      if (isLocal(requesterApId, baseUrl)) {
        await tx.actor.update({
          where: { apId: requesterApId },
          data: { followingCount: { increment: 1 } },
        });
      }

      return found;
    });
  } catch (e) {
    console.error('[Follow] Transaction error in accept:', e);
    return c.json({ error: 'Internal error' }, 500);
  }

  if (!pendingFollow) return c.json({ error: 'No pending follow request' }, 404);

  if (!isLocal(requesterApId, baseUrl)) {
    await createAndDeliverActivity(
      c.env, prisma, baseUrl, 'Accept', actor.ap_id,
      pendingFollow.activityApId, requesterApId, pendingFollow.activityApId,
    );
  }

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /accept/batch — Batch accept follow requests
// ---------------------------------------------------------------------------

follow.post('/accept/batch', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await parseJsonObject(c);
  if (!body) return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);

  const requesterApIds = parseStringArray(body.requester_ap_ids);
  if (!requesterApIds || requesterApIds.length === 0) {
    return c.json({ error: 'requester_ap_ids array required', code: 'BAD_REQUEST' }, 400);
  }
  if (requesterApIds.length > MAX_BATCH_ACCEPT_SIZE) {
    return c.json({ error: `Batch size exceeds maximum of ${MAX_BATCH_ACCEPT_SIZE}` }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');
  const results: { ap_id: string; success: boolean; error?: string }[] = [];

  const pendingFollows = await prisma.follow.findMany({
    where: {
      followerApId: { in: requesterApIds },
      followingApId: actor.ap_id,
      status: 'pending',
    },
  });

  const pendingFollowMap = new Map(pendingFollows.map((f) => [f.followerApId, f]));

  let followerCountIncrement = 0;
  const localFollowerIds: string[] = [];
  const activitiesToCreate: Array<{
    apId: string;
    type: string;
    actorApId: string;
    objectApId: string | undefined;
    rawJson: string;
    direction: string;
  }> = [];
  const remoteEnqueues: Array<{ activityId: string; recipientApId: string }> = [];

  for (const requesterApId of requesterApIds) {
    const pendingFollow = pendingFollowMap.get(requesterApId);
    if (!pendingFollow) {
      results.push({ ap_id: requesterApId, success: false, error: 'No pending follow request' });
      continue;
    }

    try {
      await prisma.follow.update({
        where: followKey(requesterApId, actor.ap_id),
        data: { status: 'accepted', acceptedAt: new Date().toISOString() },
      });

      followerCountIncrement++;

      if (isLocal(requesterApId, baseUrl)) {
        localFollowerIds.push(requesterApId);
      } else if (isSafeRemoteUrl(requesterApId)) {
        const id = activityApId(baseUrl, generateId());
        const activity = buildApActivity('Accept', actor.ap_id, pendingFollow.activityApId, id);

        activitiesToCreate.push({
          apId: id,
          type: 'Accept',
          actorApId: actor.ap_id,
          objectApId: pendingFollow.activityApId || undefined,
          rawJson: JSON.stringify(activity),
          direction: 'outbound',
        });
        remoteEnqueues.push({ activityId: id, recipientApId: requesterApId });
      } else {
        console.warn(`[Follow] Blocked unsafe remote actor: ${requesterApId}`);
      }

      results.push({ ap_id: requesterApId, success: true });
    } catch {
      results.push({ ap_id: requesterApId, success: false, error: 'Internal error' });
    }
  }

  // Batch update counts
  if (followerCountIncrement > 0) {
    await prisma.actor.update({
      where: { apId: actor.ap_id },
      data: { followerCount: { increment: followerCountIncrement } },
    });
  }
  if (localFollowerIds.length > 0) {
    await prisma.actor.updateMany({
      where: { apId: { in: localFollowerIds } },
      data: { followingCount: { increment: 1 } },
    });
  }

  // Batch create activities
  if (activitiesToCreate.length > 0) {
    await prisma.activity.createMany({ data: activitiesToCreate });
  }

  // Enqueue delivery after activities are persisted
  if (remoteEnqueues.length > 0) {
    await Promise.allSettled(
      remoteEnqueues.map((e) => enqueueDeliveryToActor(c.env, e.activityId, e.recipientApId)),
    );
  }

  return c.json({ results, accepted_count: results.filter((r) => r.success).length });
});

// ---------------------------------------------------------------------------
// POST /reject — Reject a follow request
// ---------------------------------------------------------------------------

follow.post('/reject', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await parseJsonObject(c);
  if (!body) return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);

  const requesterApId = parseNonEmptyString(body.requester_ap_id);
  if (!requesterApId) return c.json({ error: 'requester_ap_id required', code: 'BAD_REQUEST' }, 400);

  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  const pendingFollow = await prisma.follow.findFirst({
    where: {
      followerApId: requesterApId,
      followingApId: actor.ap_id,
      status: 'pending',
    },
  });
  if (!pendingFollow) return c.json({ error: 'No pending follow request' }, 404);

  await prisma.follow.update({
    where: followKey(requesterApId, actor.ap_id),
    data: { status: 'rejected' },
  });

  if (pendingFollow.activityApId) {
    await prisma.inbox.updateMany({
      where: { actorApId: actor.ap_id, activityApId: pendingFollow.activityApId },
      data: { read: 1 },
    });
  }

  if (!isLocal(requesterApId, baseUrl)) {
    await createAndDeliverActivity(
      c.env, prisma, baseUrl, 'Reject', actor.ap_id,
      pendingFollow.activityApId, requesterApId, pendingFollow.activityApId,
    );
  }

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /requests — Pending follow requests
// ---------------------------------------------------------------------------

follow.get('/requests', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const limit = parseLimit(c.req.query('limit'), 100, 500);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);

  const follows = await prisma.follow.findMany({
    where: { followingApId: actor.ap_id, status: 'pending' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  const followerApIds = follows.map((f) => f.followerApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: followerApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: followerApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));

  const result = follows.map((f) => {
    const actorInfo = localActorMap.get(f.followerApId) || cachedActorMap.get(f.followerApId);
    return {
      ap_id: f.followerApId,
      username: formatUsername(f.followerApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      created_at: f.createdAt,
    };
  });

  return c.json({ requests: result });
});

export default follow;
