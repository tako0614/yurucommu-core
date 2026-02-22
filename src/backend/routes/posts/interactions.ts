import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, isLocal, formatUsername, safeJsonParse } from '../../utils';
import { MAX_POSTS_PAGE_LIMIT, parseLimit } from './utils';
import { enqueueDeliveryToActor } from '../../lib/delivery/queue';

type AppContext = Context<{ Bindings: Env; Variables: Variables }>;

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---------------------------------------------------------------------------
// Shared helpers (file-local)
// ---------------------------------------------------------------------------

/** Compound unique key used by like, announce, and bookmark tables. */
function compoundKey(actorApId: string, objectApId: string) {
  return { actorApId_objectApId: { actorApId, objectApId } };
}

/** Look up a post by local ID or full AP ID. Returns null when not found. */
async function findPost(c: AppContext, select?: Record<string, boolean>) {
  const prisma = c.get('prisma');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  return prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId },
      ],
    },
    ...(select ? { select } : {}),
  });
}

/**
 * Best-effort delivery of an activity to a remote actor.
 * Errors are logged but never propagated.
 */
async function deliverToRemote(env: Env, activityId: string, recipientApId: string): Promise<void> {
  try {
    await enqueueDeliveryToActor(env, activityId, recipientApId);
  } catch (err) {
    console.error('[Posts] Failed to enqueue delivery:', err);
  }
}

// ---------------------------------------------------------------------------
// Like / Unlike
// ---------------------------------------------------------------------------

posts.post('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const post = await findPost(c);
  if (!post) return c.json({ error: 'Post not found' }, 404);

  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;

  const existingLike = await prisma.like.findUnique({
    where: compoundKey(actor.ap_id, post.apId),
  });
  if (existingLike) return c.json({ error: 'Already liked' }, 400);

  const likeId = generateId();
  const likeActivityId = activityApId(baseUrl, likeId);
  const likeActivityRaw = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: likeActivityId,
    type: 'Like',
    actor: actor.ap_id,
    object: post.apId,
  };
  const now = new Date().toISOString();
  const shouldNotifyLocal = post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl);

  await prisma.$transaction(async (tx) => {
    await tx.like.create({
      data: { actorApId: actor.ap_id, objectApId: post.apId, activityApId: likeActivityId },
    });

    await tx.object.update({
      where: { apId: post.apId },
      data: { likeCount: { increment: 1 } },
    });

    await tx.activity.create({
      data: {
        apId: likeActivityId,
        type: 'Like',
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(likeActivityRaw),
        createdAt: now,
      },
    });

    if (shouldNotifyLocal) {
      await tx.inbox.create({
        data: { actorApId: post.attributedTo, activityApId: likeActivityId, read: 0, createdAt: now },
      });
    }
  });

  if (!isLocal(post.apId, baseUrl)) {
    await deliverToRemote(c.env, likeActivityId, post.attributedTo);
  }

  return c.json({ success: true, liked: true });
});

posts.delete('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const post = await findPost(c);
  if (!post) return c.json({ error: 'Post not found' }, 404);

  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;

  const like = await prisma.like.findUnique({
    where: compoundKey(actor.ap_id, post.apId),
  });
  if (!like) return c.json({ error: 'Not liked' }, 400);

  await prisma.$transaction(async (tx) => {
    await tx.like.delete({ where: compoundKey(actor.ap_id, post.apId) });

    await tx.object.updateMany({
      where: { apId: post.apId, likeCount: { gt: 0 } },
      data: { likeCount: { decrement: 1 } },
    });
  });

  if (!isLocal(post.apId, baseUrl)) {
    const undoObject = like.activityApId
      ? like.activityApId
      : { type: 'Like', actor: actor.ap_id, object: post.apId };

    const undoActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityApId(baseUrl, generateId()),
      type: 'Undo',
      actor: actor.ap_id,
      object: undoObject,
    };

    await prisma.activity.upsert({
      where: { apId: undoActivity.id },
      update: {},
      create: {
        apId: undoActivity.id,
        type: 'Undo',
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(undoActivity),
        direction: 'outbound',
      },
    });

    await deliverToRemote(c.env, undoActivity.id, post.attributedTo);
  }

  return c.json({ success: true, liked: false });
});

// ---------------------------------------------------------------------------
// Repost (Announce) / Unrepost (Undo Announce)
// ---------------------------------------------------------------------------

posts.post('/:id/repost', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const post = await findPost(c);
  if (!post) return c.json({ error: 'Post not found' }, 404);

  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;

  const existingRepost = await prisma.announce.findUnique({
    where: compoundKey(actor.ap_id, post.apId),
  });
  if (existingRepost) return c.json({ error: 'Already reposted' }, 400);

  const announceId = generateId();
  const announceActivityId = activityApId(baseUrl, announceId);
  const announceActivityRaw = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: announceActivityId,
    type: 'Announce',
    actor: actor.ap_id,
    object: post.apId,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [actor.ap_id + '/followers'],
  };
  const now = new Date().toISOString();
  const shouldNotifyLocal = post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl);

  await prisma.$transaction(async (tx) => {
    await tx.announce.create({
      data: { actorApId: actor.ap_id, objectApId: post.apId, activityApId: announceActivityId },
    });

    await tx.object.update({
      where: { apId: post.apId },
      data: { announceCount: { increment: 1 } },
    });

    await tx.activity.create({
      data: {
        apId: announceActivityId,
        type: 'Announce',
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(announceActivityRaw),
        createdAt: now,
      },
    });

    if (shouldNotifyLocal) {
      await tx.inbox.create({
        data: { actorApId: post.attributedTo, activityApId: announceActivityId, read: 0, createdAt: now },
      });
    }
  });

  if (!isLocal(post.apId, baseUrl)) {
    await deliverToRemote(c.env, announceActivityId, post.attributedTo);
  }

  return c.json({ success: true, reposted: true });
});

posts.delete('/:id/repost', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const post = await findPost(c);
  if (!post) return c.json({ error: 'Post not found' }, 404);

  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;

  const announce = await prisma.announce.findUnique({
    where: compoundKey(actor.ap_id, post.apId),
  });
  if (!announce) return c.json({ error: 'Not reposted' }, 400);

  await prisma.$transaction(async (tx) => {
    await tx.announce.delete({ where: compoundKey(actor.ap_id, post.apId) });

    await tx.object.updateMany({
      where: { apId: post.apId, announceCount: { gt: 0 } },
      data: { announceCount: { decrement: 1 } },
    });
  });

  if (!isLocal(post.apId, baseUrl)) {
    const undoActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityApId(baseUrl, generateId()),
      type: 'Undo',
      actor: actor.ap_id,
      object: { type: 'Announce', actor: actor.ap_id, object: post.apId },
    };

    await prisma.activity.upsert({
      where: { apId: undoActivity.id },
      update: {},
      create: {
        apId: undoActivity.id,
        type: 'Undo',
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(undoActivity),
        direction: 'outbound',
      },
    });

    await deliverToRemote(c.env, undoActivity.id, post.attributedTo);
  }

  return c.json({ success: true, reposted: false });
});

// ---------------------------------------------------------------------------
// Bookmark / Unbookmark / List bookmarks
// ---------------------------------------------------------------------------

posts.post('/:id/bookmark', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const post = await findPost(c, { apId: true });
  if (!post) return c.json({ error: 'Post not found' }, 404);

  const prisma = c.get('prisma');

  const existing = await prisma.bookmark.findUnique({
    where: compoundKey(actor.ap_id, post.apId),
  });
  if (existing) return c.json({ error: 'Already bookmarked' }, 400);

  await prisma.bookmark.create({
    data: { actorApId: actor.ap_id, objectApId: post.apId },
  });

  return c.json({ success: true, bookmarked: true });
});

posts.delete('/:id/bookmark', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const post = await findPost(c, { apId: true });
  if (!post) return c.json({ error: 'Post not found' }, 404);

  const prisma = c.get('prisma');

  const bookmark = await prisma.bookmark.findUnique({
    where: compoundKey(actor.ap_id, post.apId),
  });
  if (!bookmark) return c.json({ error: 'Not bookmarked' }, 400);

  await prisma.bookmark.delete({
    where: compoundKey(actor.ap_id, post.apId),
  });

  return c.json({ success: true, bookmarked: false });
});

posts.get('/bookmarks', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const limit = parseLimit(c.req.query('limit'), 20, MAX_POSTS_PAGE_LIMIT);
  const before = c.req.query('before');

  const bookmarks = await prisma.bookmark.findMany({
    where: {
      actorApId: actor.ap_id,
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    include: { object: true },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Batch-load author info to avoid N+1 queries
  const authorApIds = [...new Set(bookmarks.map((b) => b.object.attributedTo))];
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  const actorMap = new Map([
    ...cachedActors.map((a) => [a.apId, a] as const),
    ...localActors.map((a) => [a.apId, a] as const),
  ]);

  // Batch-load likes for all bookmarked posts
  const postApIds = bookmarks.map((b) => b.object.apId);
  const likes = await prisma.like.findMany({
    where: { actorApId: actor.ap_id, objectApId: { in: postApIds } },
    select: { objectApId: true },
  });
  const likedPostIds = new Set(likes.map((l) => l.objectApId));

  const result = bookmarks.map((b) => {
    const obj = b.object;
    const authorInfo = actorMap.get(obj.attributedTo);

    return {
      ap_id: obj.apId,
      type: obj.type,
      author: {
        ap_id: obj.attributedTo,
        username: formatUsername(obj.attributedTo),
        preferred_username: authorInfo?.preferredUsername ?? null,
        name: authorInfo?.name ?? null,
        icon_url: authorInfo?.iconUrl ?? null,
      },
      content: obj.content,
      summary: obj.summary,
      attachments: safeJsonParse(obj.attachmentsJson, []),
      in_reply_to: obj.inReplyTo,
      visibility: obj.visibility,
      community_ap_id: obj.communityApId,
      like_count: obj.likeCount,
      reply_count: obj.replyCount,
      announce_count: obj.announceCount,
      published: obj.published,
      liked: likedPostIds.has(obj.apId),
      bookmarked: true,
      reposted: false,
    };
  });

  return c.json({ bookmarks: result });
});

export default posts;
