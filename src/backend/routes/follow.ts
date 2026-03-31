import { Hono } from 'hono';
import { eq, and, inArray, sql, desc } from 'drizzle-orm';
import type { Env, Variables } from '../types.ts';
import { actors, actorCache, follows, activities, inbox } from '../../db/index.ts';
import { activityApId, isLocal, isSafeRemoteUrl, formatUsername, parseLimit, parseOffset, generateId } from '../federation-helpers.ts';
import { enqueueDeliveryToActor } from '../lib/delivery/queue.ts';
import {
  parseNonEmptyString,
  parseStringArray,
  buildApActivity,
  requireActorAndBody,
  isResponse,
  createAndDeliverActivity,
  deliverResponseIfRemote,
  findPendingFollow,
  handleLocalFollow,
  handleRemoteFollow,
} from './follow-helpers.ts';

const MAX_BATCH_ACCEPT_SIZE = 100;

const follow = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// POST / -- Follow an actor (local or remote)
// ---------------------------------------------------------------------------

follow.post('/', async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const targetApId = parseNonEmptyString(body.target_ap_id);
  if (!targetApId) return c.json({ error: 'target_ap_id required', code: 'BAD_REQUEST' }, 400);
  if (targetApId === actor.ap_id) return c.json({ error: 'Cannot follow yourself' }, 400);

  const existing = await db.select().from(follows).where(
    and(eq(follows.followerApId, actor.ap_id), eq(follows.followingApId, targetApId)),
  ).get();
  if (existing) return c.json({ error: 'Already following or pending' }, 400);

  if (isLocal(targetApId, baseUrl)) {
    return handleLocalFollow(c, db, baseUrl, actor, targetApId);
  }
  return handleRemoteFollow(c, db, baseUrl, actor, targetApId);
});

// ---------------------------------------------------------------------------
// DELETE / -- Unfollow
// ---------------------------------------------------------------------------

follow.delete('/', async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const targetApId = parseNonEmptyString(body.target_ap_id);
  if (!targetApId) return c.json({ error: 'target_ap_id required', code: 'BAD_REQUEST' }, 400);

  const existingFollow = await db.select().from(follows).where(
    and(eq(follows.followerApId, actor.ap_id), eq(follows.followingApId, targetApId)),
  ).get();
  if (!existingFollow) return c.json({ error: 'Not following' }, 400);

  const wasAccepted = existingFollow.status === 'accepted';
  const targetIsLocal = isLocal(targetApId, baseUrl);

  await db.delete(follows).where(
    and(eq(follows.followerApId, actor.ap_id), eq(follows.followingApId, targetApId)),
  );

  if (wasAccepted) {
    await db.update(actors).set({
      followingCount: sql`${actors.followingCount} - 1`,
    }).where(eq(actors.apId, actor.ap_id));

    if (targetIsLocal) {
      await db.update(actors).set({
        followerCount: sql`${actors.followerCount} - 1`,
      }).where(eq(actors.apId, targetApId));
    }
  }

  if (!targetIsLocal) {
    const undoObject = { type: 'Follow', actor: actor.ap_id, object: targetApId };
    await createAndDeliverActivity(
      c.env, db, baseUrl, 'Undo', actor.ap_id, undoObject, targetApId, targetApId,
    );
  }

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /accept -- Accept a single follow request
// ---------------------------------------------------------------------------

follow.post('/accept', async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const requesterApId = parseNonEmptyString(body.requester_ap_id);
  if (!requesterApId) return c.json({ error: 'requester_ap_id required', code: 'BAD_REQUEST' }, 400);

  let pendingFollow: Awaited<ReturnType<typeof findPendingFollow>>;
  try {
    const found = await db.select().from(follows).where(
      and(
        eq(follows.followerApId, requesterApId),
        eq(follows.followingApId, actor.ap_id),
        eq(follows.status, 'pending'),
      ),
    ).get();
    if (!found) {
      pendingFollow = undefined;
    } else {
      await db.update(follows).set({
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      }).where(
        and(eq(follows.followerApId, requesterApId), eq(follows.followingApId, actor.ap_id)),
      );

      await db.update(actors).set({
        followerCount: sql`${actors.followerCount} + 1`,
      }).where(eq(actors.apId, actor.ap_id));

      if (isLocal(requesterApId, baseUrl)) {
        await db.update(actors).set({
          followingCount: sql`${actors.followingCount} + 1`,
        }).where(eq(actors.apId, requesterApId));
      }

      pendingFollow = found;
    }
  } catch (e) {
    console.error('[Follow] Error in accept:', e);
    return c.json({ error: 'Internal error' }, 500);
  }

  if (!pendingFollow) return c.json({ error: 'No pending follow request' }, 404);

  await deliverResponseIfRemote(
    c.env, db, baseUrl, 'Accept', actor.ap_id,
    requesterApId, pendingFollow.activityApId,
  );

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /accept/batch -- Batch accept follow requests
// ---------------------------------------------------------------------------

follow.post('/accept/batch', async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const requesterApIds = parseStringArray(body.requester_ap_ids);
  if (!requesterApIds || requesterApIds.length === 0) {
    return c.json({ error: 'requester_ap_ids array required', code: 'BAD_REQUEST' }, 400);
  }
  if (requesterApIds.length > MAX_BATCH_ACCEPT_SIZE) {
    return c.json({ error: `Batch size exceeds maximum of ${MAX_BATCH_ACCEPT_SIZE}` }, 400);
  }

  const pendingFollows = await db.select().from(follows).where(
    and(
      inArray(follows.followerApId, requesterApIds),
      eq(follows.followingApId, actor.ap_id),
      eq(follows.status, 'pending'),
    ),
  );
  const pendingFollowMap = new Map(pendingFollows.map((f) => [f.followerApId, f]));

  const results: { ap_id: string; success: boolean; error?: string }[] = [];
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
      await db.update(follows).set({
        status: 'accepted',
        acceptedAt: new Date().toISOString(),
      }).where(
        and(eq(follows.followerApId, requesterApId), eq(follows.followingApId, actor.ap_id)),
      );

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

  if (followerCountIncrement > 0) {
    await db.update(actors).set({
      followerCount: sql`${actors.followerCount} + ${followerCountIncrement}`,
    }).where(eq(actors.apId, actor.ap_id));
  }
  if (localFollowerIds.length > 0) {
    await db.update(actors).set({
      followingCount: sql`${actors.followingCount} + 1`,
    }).where(inArray(actors.apId, localFollowerIds));
  }

  if (activitiesToCreate.length > 0) {
    await db.insert(activities).values(activitiesToCreate);
  }

  if (remoteEnqueues.length > 0) {
    await Promise.allSettled(
      remoteEnqueues.map((e) => enqueueDeliveryToActor(c.env, e.activityId, e.recipientApId)),
    );
  }

  return c.json({ results, accepted_count: results.filter((r) => r.success).length });
});

// ---------------------------------------------------------------------------
// POST /reject -- Reject a follow request
// ---------------------------------------------------------------------------

follow.post('/reject', async (c) => {
  const ctx = await requireActorAndBody(c);
  if (isResponse(ctx)) return ctx;
  const { actor, body, baseUrl, db } = ctx;

  const requesterApId = parseNonEmptyString(body.requester_ap_id);
  if (!requesterApId) return c.json({ error: 'requester_ap_id required', code: 'BAD_REQUEST' }, 400);

  const pendingFollow = await findPendingFollow(db, requesterApId, actor.ap_id);
  if (!pendingFollow) return c.json({ error: 'No pending follow request' }, 404);

  await db.update(follows).set({ status: 'rejected' }).where(
    and(eq(follows.followerApId, requesterApId), eq(follows.followingApId, actor.ap_id)),
  );

  if (pendingFollow.activityApId) {
    await db.update(inbox).set({ read: 1 }).where(
      and(eq(inbox.actorApId, actor.ap_id), eq(inbox.activityApId, pendingFollow.activityApId)),
    );
  }

  await deliverResponseIfRemote(
    c.env, db, baseUrl, 'Reject', actor.ap_id,
    requesterApId, pendingFollow.activityApId,
  );

  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// GET /requests -- Pending follow requests
// ---------------------------------------------------------------------------

follow.get('/requests', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const db = c.get('db');
  const limit = parseLimit(c.req.query('limit'), 100, 500);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);

  const followRows = await db.select().from(follows).where(
    and(eq(follows.followingApId, actor.ap_id), eq(follows.status, 'pending')),
  ).orderBy(desc(follows.createdAt)).limit(limit).offset(offset);

  const followerApIds = followRows.map((f) => f.followerApId);
  const [localActors, cachedActors] = await Promise.all([
    followerApIds.length > 0
      ? db.select({
          apId: actors.apId,
          preferredUsername: actors.preferredUsername,
          name: actors.name,
          iconUrl: actors.iconUrl,
        }).from(actors).where(inArray(actors.apId, followerApIds))
      : Promise.resolve([]),
    followerApIds.length > 0
      ? db.select({
          apId: actorCache.apId,
          preferredUsername: actorCache.preferredUsername,
          name: actorCache.name,
          iconUrl: actorCache.iconUrl,
        }).from(actorCache).where(inArray(actorCache.apId, followerApIds))
      : Promise.resolve([]),
  ]);

  const actorInfoMap = new Map<string, { preferredUsername: string | null; name: string | null; iconUrl: string | null }>();
  for (const a of cachedActors) actorInfoMap.set(a.apId, a);
  for (const a of localActors) actorInfoMap.set(a.apId, a);

  const result = followRows.map((f) => {
    const actorInfo = actorInfoMap.get(f.followerApId);
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
