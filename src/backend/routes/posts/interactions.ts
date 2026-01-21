import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, isLocal, formatUsername, safeJsonParse } from '../../utils';
import { MAX_POSTS_PAGE_LIMIT, formatPost, parseLimit, PostRow } from './utils';
import { deliverActivity } from '../../lib/activitypub-helpers';

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

// Like post
posts.post('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    }
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Check if already liked
  const existingLike = await prisma.like.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });

  if (existingLike) return c.json({ error: 'Already liked' }, 400);

  // Create like, update count, and store activity atomically
  const likeId = generateId();
  const likeActivityApId = activityApId(baseUrl, likeId);
  const likeActivityRaw = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: likeActivityApId,
    type: 'Like',
    actor: actor.ap_id,
    object: post.apId,
  };
  const now = new Date().toISOString();

  // Use transaction to ensure atomicity of like creation, count update, and activity storage
  const shouldNotifyLocal = post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl);

  await prisma.$transaction(async (tx) => {
    // Create like
    await tx.like.create({
      data: {
        actorApId: actor.ap_id,
        objectApId: post.apId,
        activityApId: likeActivityApId
      }
    });

    // Update like count
    await tx.object.update({
      where: { apId: post.apId },
      data: { likeCount: { increment: 1 } }
    });

    // Store Like activity
    await tx.activity.create({
      data: {
        apId: likeActivityApId,
        type: 'Like',
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(likeActivityRaw),
        createdAt: now
      }
    });

    // Add to inbox of post author if local (AP Native notification)
    if (shouldNotifyLocal) {
      await tx.inbox.create({
        data: {
          actorApId: post.attributedTo,
          activityApId: likeActivityApId,
          read: 0,
          createdAt: now
        }
      });
    }
  });

  // Send Like activity to remote post author (outside transaction - delivery is best-effort)
  if (!isLocal(post.apId, baseUrl)) {
    await deliverActivity(prisma, { apId: actor.ap_id, privateKeyPem: actor.private_key_pem }, post.attributedTo, likeActivityRaw);
  }

  return c.json({ success: true, liked: true });
});

// Unlike post
posts.delete('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    }
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Get the like
  const like = await prisma.like.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });

  if (!like) return c.json({ error: 'Not liked' }, 400);

  // Use transaction to ensure atomicity of like deletion and count update
  await prisma.$transaction(async (tx) => {
    // Delete the like
    await tx.like.delete({
      where: {
        actorApId_objectApId: {
          actorApId: actor.ap_id,
          objectApId: post.apId
        }
      }
    });

    // Update like count
    await tx.object.updateMany({
      where: {
        apId: post.apId,
        likeCount: { gt: 0 }
      },
      data: { likeCount: { decrement: 1 } }
    });
  });

  // Send Undo Like if post is remote (outside transaction - delivery is best-effort)
  if (!isLocal(post.apId, baseUrl)) {
    const undoObject = like.activityApId
      ? like.activityApId
      : {
        type: 'Like',
        actor: actor.ap_id,
        object: post.apId,
      };
    const undoLikeActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityApId(baseUrl, generateId()),
      type: 'Undo',
      actor: actor.ap_id,
      object: undoObject,
    };

    const delivered = await deliverActivity(prisma, { apId: actor.ap_id, privateKeyPem: actor.private_key_pem }, post.attributedTo, undoLikeActivity);
    if (delivered) {
      // Store activity (best-effort, outside main transaction)
      await prisma.activity.create({
        data: {
          apId: undoLikeActivity.id,
          type: 'Undo',
          actorApId: actor.ap_id,
          objectApId: post.apId,
          rawJson: JSON.stringify(undoLikeActivity),
          direction: 'outbound'
        }
      });
    }
  }

  return c.json({ success: true, liked: false });
});

// Repost (Announce)
posts.post('/:id/repost', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    }
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Check if already reposted
  const existingRepost = await prisma.announce.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });

  if (existingRepost) return c.json({ error: 'Already reposted' }, 400);

  // Create repost, update count, and store activity atomically
  const announceId = generateId();
  const announceActivityApId = activityApId(baseUrl, announceId);
  const announceActivityRaw = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: announceActivityApId,
    type: 'Announce',
    actor: actor.ap_id,
    object: post.apId,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [actor.ap_id + '/followers'],
  };
  const now = new Date().toISOString();

  // Use transaction to ensure atomicity of announce creation, count update, and activity storage
  const shouldNotifyLocal = post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl);

  await prisma.$transaction(async (tx) => {
    // Create repost
    await tx.announce.create({
      data: {
        actorApId: actor.ap_id,
        objectApId: post.apId,
        activityApId: announceActivityApId
      }
    });

    // Update announce count
    await tx.object.update({
      where: { apId: post.apId },
      data: { announceCount: { increment: 1 } }
    });

    // Store Announce activity
    await tx.activity.create({
      data: {
        apId: announceActivityApId,
        type: 'Announce',
        actorApId: actor.ap_id,
        objectApId: post.apId,
        rawJson: JSON.stringify(announceActivityRaw),
        createdAt: now
      }
    });

    // Add to inbox of post author if local (AP Native notification)
    if (shouldNotifyLocal) {
      await tx.inbox.create({
        data: {
          actorApId: post.attributedTo,
          activityApId: announceActivityApId,
          read: 0,
          createdAt: now
        }
      });
    }
  });

  // Send Announce activity to remote post author (outside transaction - delivery is best-effort)
  if (!isLocal(post.apId, baseUrl)) {
    await deliverActivity(prisma, { apId: actor.ap_id, privateKeyPem: actor.private_key_pem }, post.attributedTo, announceActivityRaw);
  }

  return c.json({ success: true, reposted: true });
});

// Unrepost (Undo Announce)
posts.delete('/:id/repost', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    }
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Get the announce
  const announce = await prisma.announce.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });

  if (!announce) return c.json({ error: 'Not reposted' }, 400);

  // Use transaction to ensure atomicity of announce deletion and count update
  await prisma.$transaction(async (tx) => {
    // Delete the announce
    await tx.announce.delete({
      where: {
        actorApId_objectApId: {
          actorApId: actor.ap_id,
          objectApId: post.apId
        }
      }
    });

    // Update announce count
    await tx.object.updateMany({
      where: {
        apId: post.apId,
        announceCount: { gt: 0 }
      },
      data: { announceCount: { decrement: 1 } }
    });
  });

  // Send Undo Announce if post is remote (outside transaction - delivery is best-effort)
  if (!isLocal(post.apId, baseUrl)) {
    const undoAnnounceActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityApId(baseUrl, generateId()),
      type: 'Undo',
      actor: actor.ap_id,
      object: {
        type: 'Announce',
        actor: actor.ap_id,
        object: post.apId,
      },
    };

    const delivered = await deliverActivity(prisma, { apId: actor.ap_id, privateKeyPem: actor.private_key_pem }, post.attributedTo, undoAnnounceActivity);
    if (delivered) {
      // Store activity (best-effort, outside main transaction)
      await prisma.activity.create({
        data: {
          apId: undoAnnounceActivity.id,
          type: 'Undo',
          actorApId: actor.ap_id,
          objectApId: post.apId,
          rawJson: JSON.stringify(undoAnnounceActivity),
          direction: 'outbound'
        }
      });
    }
  }

  return c.json({ success: true, reposted: false });
});

// Bookmark post
posts.post('/:id/bookmark', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    },
    select: { apId: true }
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Check if already bookmarked
  const existingBookmark = await prisma.bookmark.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });

  if (existingBookmark) return c.json({ error: 'Already bookmarked' }, 400);

  // Create bookmark
  await prisma.bookmark.create({
    data: {
      actorApId: actor.ap_id,
      objectApId: post.apId
    }
  });

  return c.json({ success: true, bookmarked: true });
});

// Remove bookmark
posts.delete('/:id/bookmark', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: objectApId(baseUrl, postId) },
        { apId: postId }
      ]
    },
    select: { apId: true }
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Get the bookmark
  const bookmark = await prisma.bookmark.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });

  if (!bookmark) return c.json({ error: 'Not bookmarked' }, 400);

  // Delete the bookmark
  await prisma.bookmark.delete({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });

  return c.json({ success: true, bookmarked: false });
});

// Get user's bookmarks
posts.get('/bookmarks', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const limit = parseLimit(c.req.query('limit'), 20, MAX_POSTS_PAGE_LIMIT);
  const before = c.req.query('before');

  // Get bookmarks with their objects
  const bookmarks = await prisma.bookmark.findMany({
    where: {
      actorApId: actor.ap_id,
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    include: {
      object: true,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  // Batch load author info to avoid N+1 queries
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

  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));

  // Batch load likes for all bookmarked posts
  const postApIds = bookmarks.map((b) => b.object.apId);
  const likes = await prisma.like.findMany({
    where: { actorApId: actor.ap_id, objectApId: { in: postApIds } },
    select: { objectApId: true },
  });
  const likedPostIds = new Set(likes.map((l) => l.objectApId));

  const result = bookmarks.map((b) => {
    const obj = b.object;
    const authorInfo = localActorMap.get(obj.attributedTo) || cachedActorMap.get(obj.attributedTo);

    return {
      ap_id: obj.apId,
      type: obj.type,
      author: {
        ap_id: obj.attributedTo,
        username: formatUsername(obj.attributedTo),
        preferred_username: authorInfo?.preferredUsername || null,
        name: authorInfo?.name || null,
        icon_url: authorInfo?.iconUrl || null,
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
