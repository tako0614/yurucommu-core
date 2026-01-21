import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { generateId, activityApId, isLocal, formatUsername, signRequest, isSafeRemoteUrl } from '../utils';

// P07: Network timeout for remote requests (10 seconds)
const REMOTE_FETCH_TIMEOUT_MS = 10000;

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
  publicKey?: { id?: string; publicKeyPem?: string };
};

// Follow an actor (handles local and remote)
follow.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ target_ap_id: string }>();
  if (!body.target_ap_id) return c.json({ error: 'target_ap_id required' }, 400);
  if (body.target_ap_id === actor.ap_id) return c.json({ error: 'Cannot follow yourself' }, 400);

  const baseUrl = c.env.APP_URL;
  const targetApId = body.target_ap_id;
  const prisma = c.get('prisma');

  // Check if already following
  const existing = await prisma.follow.findUnique({
    where: {
      followerApId_followingApId: { followerApId: actor.ap_id, followingApId: targetApId },
    },
  });

  if (existing) return c.json({ error: 'Already following or pending' }, 400);

  // Check if target is local or remote
  const isLocalTarget = isLocal(targetApId, baseUrl);

  if (isLocalTarget) {
    // Local target - check if they require approval
    const target = await prisma.actor.findUnique({
      where: { apId: targetApId },
      select: { isPrivate: true },
    });
    if (!target) return c.json({ error: 'Target actor not found' }, 404);

    const status = target.isPrivate ? 'pending' : 'accepted';
    const activityId = activityApId(baseUrl, generateId());
    const now = new Date().toISOString();

    // P07: Wrap in transaction to prevent race condition with concurrent follow requests
    try {
      await prisma.$transaction(async (tx) => {
        // Re-check in transaction to prevent race condition
        const existingInTx = await tx.follow.findUnique({
          where: {
            followerApId_followingApId: { followerApId: actor.ap_id, followingApId: targetApId },
          },
        });
        if (existingInTx) {
          throw new Error('ALREADY_FOLLOWING');
        }

        await tx.follow.create({
          data: {
            followerApId: actor.ap_id,
            followingApId: targetApId,
            status,
            activityApId: activityId,
            acceptedAt: status === 'accepted' ? now : null,
          },
        });

        // Update counts if accepted (atomically)
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

        // Store Follow activity and add to inbox (AP Native notification)
        await tx.activity.create({
          data: {
            apId: activityId,
            type: 'Follow',
            actorApId: actor.ap_id,
            objectApId: targetApId,
            rawJson: JSON.stringify({
              '@context': 'https://www.w3.org/ns/activitystreams',
              id: activityId,
              type: 'Follow',
              actor: actor.ap_id,
              object: targetApId,
              published: now,
            }),
            direction: 'local',
          },
        });

        await tx.inbox.create({
          data: {
            actorApId: targetApId,
            activityApId: activityId,
            read: 0,
          },
        });
      });
    } catch (e) {
      if (e instanceof Error && e.message === 'ALREADY_FOLLOWING') {
        return c.json({ error: 'Already following or pending' }, 400);
      }
      throw e;
    }

    return c.json({ success: true, status });
  } else {
    // Remote target - send Follow activity
    // First, ensure we have cached the remote actor
    let cachedActor = await prisma.actorCache.findUnique({
      where: { apId: targetApId },
    });

    if (!cachedActor) {
      // Fetch remote actor
      try {
        if (!isSafeRemoteUrl(targetApId)) {
          return c.json({ error: 'Invalid target_ap_id' }, 400);
        }
        // P07: Add timeout using AbortController
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), REMOTE_FETCH_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(targetApId, {
            headers: { 'Accept': 'application/activity+json, application/ld+json' },
            signal: controller.signal
          });
        } finally {
          clearTimeout(timeoutId);
        }
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
            publicKeyId: actorData.publicKey?.id || null,
            publicKeyPem: actorData.publicKey?.publicKeyPem || null,
            rawJson: JSON.stringify(actorData),
          },
        });
      } catch (e) {
        return c.json({ error: 'Failed to fetch remote actor' }, 400);
      }
    }

    if (!cachedActor?.inbox || !isSafeRemoteUrl(cachedActor.inbox)) {
      return c.json({ error: 'Invalid inbox URL' }, 400);
    }

    // Create pending follow
    const activityId = activityApId(baseUrl, generateId());
    await prisma.follow.create({
      data: {
        followerApId: actor.ap_id,
        followingApId: targetApId,
        status: 'pending',
        activityApId: activityId,
      },
    });

    // Send Follow activity
    const followActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityId,
      type: 'Follow',
      actor: actor.ap_id,
      object: targetApId,
      published: new Date().toISOString(),
    };

    const keyId = `${actor.ap_id}#main-key`;
    const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(followActivity));

    // P07: Add timeout for activity delivery
    try {
      const deliveryController = new AbortController();
      const deliveryTimeoutId = setTimeout(() => deliveryController.abort(), REMOTE_FETCH_TIMEOUT_MS);
      try {
        await fetch(cachedActor.inbox, {
          method: 'POST',
          headers: {
            ...headers,
            'Content-Type': 'application/activity+json',
          },
          body: JSON.stringify(followActivity),
          signal: deliveryController.signal
        });
      } finally {
        clearTimeout(deliveryTimeoutId);
      }
    } catch (e) {
      console.error('Failed to send Follow activity:', e);
    }

    // Store activity
    await prisma.activity.create({
      data: {
        apId: activityId,
        type: 'Follow',
        actorApId: actor.ap_id,
        objectApId: targetApId,
        rawJson: JSON.stringify(followActivity),
        direction: 'outbound',
      },
    });

    return c.json({ success: true, status: 'pending' });
  }
});

// Unfollow
follow.delete('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ target_ap_id: string }>();
  if (!body.target_ap_id) return c.json({ error: 'target_ap_id required' }, 400);

  const baseUrl = c.env.APP_URL;
  const targetApId = body.target_ap_id;
  const prisma = c.get('prisma');

  const existingFollow = await prisma.follow.findUnique({
    where: {
      followerApId_followingApId: { followerApId: actor.ap_id, followingApId: targetApId },
    },
  });

  if (!existingFollow) return c.json({ error: 'Not following' }, 400);

  // Delete the follow
  await prisma.follow.delete({
    where: {
      followerApId_followingApId: { followerApId: actor.ap_id, followingApId: targetApId },
    },
  });

  // Update counts if was accepted
  if (existingFollow.status === 'accepted') {
    await prisma.actor.update({
      where: { apId: actor.ap_id },
      data: { followingCount: { decrement: 1 } },
    }).catch(() => {});

    if (isLocal(targetApId, baseUrl)) {
      await prisma.actor.update({
        where: { apId: targetApId },
        data: { followerCount: { decrement: 1 } },
      }).catch(() => {});
    }
  }

  // Send Undo Follow to remote
  if (!isLocal(targetApId, baseUrl)) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: targetApId },
      select: { inbox: true },
    });
    if (cachedActor?.inbox) {
      if (isSafeRemoteUrl(cachedActor.inbox)) {
        const activityId = activityApId(baseUrl, generateId());
        const undoActivity = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: activityId,
          type: 'Undo',
          actor: actor.ap_id,
          published: new Date().toISOString(),
          object: {
            type: 'Follow',
            actor: actor.ap_id,
            object: targetApId,
          },
        };

        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(undoActivity));

        // P07: Add timeout for activity delivery
        try {
          const undoController = new AbortController();
          const undoTimeoutId = setTimeout(() => undoController.abort(), REMOTE_FETCH_TIMEOUT_MS);
          try {
            await fetch(cachedActor.inbox, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/activity+json' },
              body: JSON.stringify(undoActivity),
              signal: undoController.signal,
            });
          } finally {
            clearTimeout(undoTimeoutId);
          }
        } catch (e) {
          console.error('Failed to send Undo Follow:', e);
        }

        // Store activity
        await prisma.activity.create({
          data: {
            apId: activityId,
            type: 'Undo',
            actorApId: actor.ap_id,
            objectApId: targetApId,
            rawJson: JSON.stringify(undoActivity),
            direction: 'outbound',
          },
        });
      } else {
        console.warn(`[Follow] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
      }
    }
  }

  return c.json({ success: true });
});

// Accept follow request
follow.post('/accept', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ requester_ap_id: string }>();
  if (!body.requester_ap_id) return c.json({ error: 'requester_ap_id required' }, 400);

  const prisma = c.get('prisma');

  // P07: Wrap in transaction to prevent race condition where two accepts could increment counts twice
  let pendingFollow: Awaited<ReturnType<typeof prisma.follow.findFirst>>;
  try {
    pendingFollow = await prisma.$transaction(async (tx) => {
      const follow = await tx.follow.findFirst({
        where: {
          followerApId: body.requester_ap_id,
          followingApId: actor.ap_id,
          status: 'pending',
        },
      });

      if (!follow) return null;

      await tx.follow.update({
        where: {
          followerApId_followingApId: { followerApId: body.requester_ap_id, followingApId: actor.ap_id },
        },
        data: { status: 'accepted', acceptedAt: new Date().toISOString() },
      });

      // Update counts atomically
      await tx.actor.update({
        where: { apId: actor.ap_id },
        data: { followerCount: { increment: 1 } },
      });
      if (isLocal(body.requester_ap_id, c.env.APP_URL)) {
        await tx.actor.update({
          where: { apId: body.requester_ap_id },
          data: { followingCount: { increment: 1 } },
        });
      }

      return follow;
    });
  } catch (e) {
    console.error('[Follow] Transaction error in accept:', e);
    return c.json({ error: 'Internal error' }, 500);
  }

  if (!pendingFollow) return c.json({ error: 'No pending follow request' }, 404);

  // Send Accept to remote
  if (!isLocal(body.requester_ap_id, c.env.APP_URL)) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: body.requester_ap_id },
      select: { inbox: true },
    });
    if (cachedActor?.inbox) {
      const baseUrl = c.env.APP_URL;
      const activityId = activityApId(baseUrl, generateId());
      const acceptActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Accept',
        actor: actor.ap_id,
        object: pendingFollow.activityApId,
        published: new Date().toISOString(),
      };

      const keyId = `${actor.ap_id}#main-key`;
      if (!isSafeRemoteUrl(cachedActor.inbox)) {
        console.warn(`[Follow] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
        return c.json({ success: true });
      }
      const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(acceptActivity));

      // P07: Add timeout for activity delivery
      try {
        const acceptController = new AbortController();
        const acceptTimeoutId = setTimeout(() => acceptController.abort(), REMOTE_FETCH_TIMEOUT_MS);
        try {
          await fetch(cachedActor.inbox, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/activity+json' },
            body: JSON.stringify(acceptActivity),
            signal: acceptController.signal,
          });
        } finally {
          clearTimeout(acceptTimeoutId);
        }
      } catch (e) {
        console.error('Failed to send Accept:', e);
      }

      // Store activity
      await prisma.activity.create({
        data: {
          apId: activityId,
          type: 'Accept',
          actorApId: actor.ap_id,
          objectApId: pendingFollow.activityApId || undefined,
          rawJson: JSON.stringify(acceptActivity),
          direction: 'outbound',
        },
      });
    }
  }

  return c.json({ success: true });
});

// P07: Maximum batch size for follow accept to prevent DoS
const MAX_BATCH_ACCEPT_SIZE = 100;

// Batch accept follow requests
follow.post('/accept/batch', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ requester_ap_ids: string[] }>();
  if (!body.requester_ap_ids || !Array.isArray(body.requester_ap_ids) || body.requester_ap_ids.length === 0) {
    return c.json({ error: 'requester_ap_ids array required' }, 400);
  }

  // P07: Enforce size limit on batch accept
  if (body.requester_ap_ids.length > MAX_BATCH_ACCEPT_SIZE) {
    return c.json({ error: `Batch size exceeds maximum of ${MAX_BATCH_ACCEPT_SIZE}` }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');
  const results: { ap_id: string; success: boolean; error?: string }[] = [];

  // Batch fetch all pending follows at once
  const pendingFollows = await prisma.follow.findMany({
    where: {
      followerApId: { in: body.requester_ap_ids },
      followingApId: actor.ap_id,
      status: 'pending',
    },
  });

  const pendingFollowMap = new Map(pendingFollows.map((f) => [f.followerApId, f]));

  // Batch fetch cached actors for remote followers
  const remoteRequesterIds = body.requester_ap_ids.filter((id) => !isLocal(id, baseUrl));
  const cachedActors = remoteRequesterIds.length > 0
    ? await prisma.actorCache.findMany({
        where: { apId: { in: remoteRequesterIds } },
        select: { apId: true, inbox: true },
      })
    : [];
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));

  // Track counts to update
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

  for (const requesterApId of body.requester_ap_ids) {
    try {
      const pendingFollow = pendingFollowMap.get(requesterApId);

      if (!pendingFollow) {
        results.push({ ap_id: requesterApId, success: false, error: 'No pending follow request' });
        continue;
      }

      await prisma.follow.update({
        where: {
          followerApId_followingApId: { followerApId: requesterApId, followingApId: actor.ap_id },
        },
        data: { status: 'accepted', acceptedAt: new Date().toISOString() },
      });

      // Track count updates
      followerCountIncrement++;
      if (isLocal(requesterApId, baseUrl)) {
        localFollowerIds.push(requesterApId);
      }

      // Send Accept to remote
      if (!isLocal(requesterApId, baseUrl)) {
        const cachedActor = cachedActorMap.get(requesterApId);
        if (cachedActor?.inbox) {
          const activityId = activityApId(baseUrl, generateId());
          const acceptActivity = {
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: activityId,
            type: 'Accept',
            actor: actor.ap_id,
            object: pendingFollow.activityApId,
            published: new Date().toISOString(),
          };

          const keyId = `${actor.ap_id}#main-key`;
          if (!isSafeRemoteUrl(cachedActor.inbox)) {
            console.warn(`[Follow] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
          } else {
            const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(acceptActivity));

            // Log failures instead of silently swallowing them
            fetch(cachedActor.inbox, {
              method: 'POST',
              headers: { ...headers, 'Content-Type': 'application/activity+json' },
              body: JSON.stringify(acceptActivity),
            }).catch((err) => {
              console.error(`[Follow] Batch Accept delivery failed to ${cachedActor.inbox}:`, err);
            });

            activitiesToCreate.push({
              apId: activityId,
              type: 'Accept',
              actorApId: actor.ap_id,
              objectApId: pendingFollow.activityApId || undefined,
              rawJson: JSON.stringify(acceptActivity),
              direction: 'outbound',
            });
          }
        }
      }

      results.push({ ap_id: requesterApId, success: true });
    } catch (e) {
      results.push({ ap_id: requesterApId, success: false, error: 'Internal error' });
    }
  }

  // Batch update counts - single update for actor's follower count
  if (followerCountIncrement > 0) {
    await prisma.actor.update({
      where: { apId: actor.ap_id },
      data: { followerCount: { increment: followerCountIncrement } },
    });
  }

  // Batch update following counts for local followers
  if (localFollowerIds.length > 0) {
    await prisma.actor.updateMany({
      where: { apId: { in: localFollowerIds } },
      data: { followingCount: { increment: 1 } },
    });
  }

  // Batch create activities
  if (activitiesToCreate.length > 0) {
    await prisma.activity.createMany({
      data: activitiesToCreate,
    });
  }

  return c.json({ results, accepted_count: results.filter(r => r.success).length });
});

// Reject follow request
follow.post('/reject', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ requester_ap_id: string }>();
  if (!body.requester_ap_id) return c.json({ error: 'requester_ap_id required' }, 400);

  const prisma = c.get('prisma');

  const pendingFollow = await prisma.follow.findFirst({
    where: {
      followerApId: body.requester_ap_id,
      followingApId: actor.ap_id,
      status: 'pending',
    },
  });

  if (!pendingFollow) return c.json({ error: 'No pending follow request' }, 404);

  await prisma.follow.update({
    where: {
      followerApId_followingApId: { followerApId: body.requester_ap_id, followingApId: actor.ap_id },
    },
    data: { status: 'rejected' },
  });

  if (pendingFollow.activityApId) {
    await prisma.inbox.updateMany({
      where: { actorApId: actor.ap_id, activityApId: pendingFollow.activityApId },
      data: { read: 1 },
    });
  }

  if (!isLocal(body.requester_ap_id, c.env.APP_URL)) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: body.requester_ap_id },
      select: { inbox: true },
    });
    if (cachedActor?.inbox) {
      if (!isSafeRemoteUrl(cachedActor.inbox)) {
        console.warn(`[Follow] Blocked unsafe inbox URL: ${cachedActor.inbox}`);
        return c.json({ success: true });
      }
      const baseUrl = c.env.APP_URL;
      const activityId = activityApId(baseUrl, generateId());
      const rejectActivity = {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: activityId,
        type: 'Reject',
        actor: actor.ap_id,
        object: pendingFollow.activityApId,
        published: new Date().toISOString(),
      };

      const keyId = `${actor.ap_id}#main-key`;
      const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(rejectActivity));

      // P07: Add timeout for activity delivery
      try {
        const rejectController = new AbortController();
        const rejectTimeoutId = setTimeout(() => rejectController.abort(), REMOTE_FETCH_TIMEOUT_MS);
        try {
          await fetch(cachedActor.inbox, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/activity+json' },
            body: JSON.stringify(rejectActivity),
            signal: rejectController.signal,
          });
        } finally {
          clearTimeout(rejectTimeoutId);
        }
      } catch (e) {
        console.error('Failed to send Reject:', e);
      }

      await prisma.activity.create({
        data: {
          apId: activityId,
          type: 'Reject',
          actorApId: actor.ap_id,
          objectApId: pendingFollow.activityApId || undefined,
          rawJson: JSON.stringify(rejectActivity),
          direction: 'outbound',
        },
      });
    }
  }

  return c.json({ success: true });
});

// Get pending follow requests
follow.get('/requests', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const limit = Math.min(parseInt(c.req.query('limit') || '100'), 500);
  const offset = parseInt(c.req.query('offset') || '0');

  const follows = await prisma.follow.findMany({
    where: { followingApId: actor.ap_id, status: 'pending' },
    orderBy: { createdAt: 'desc' },
    take: limit,
    skip: offset,
  });

  // Batch load actor info to avoid N+1 queries
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
