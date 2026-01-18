import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, isLocal } from '../../utils';
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

  // Create like
  const likeId = generateId();
  const likeActivityApId = activityApId(baseUrl, likeId);
  await prisma.like.create({
    data: {
      actorApId: actor.ap_id,
      objectApId: post.apId,
      activityApId: likeActivityApId
    }
  });

  // Update like count
  await prisma.object.update({
    where: { apId: post.apId },
    data: { likeCount: { increment: 1 } }
  });

  // Store Like activity
  const likeActivityRaw = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: likeActivityApId,
    type: 'Like',
    actor: actor.ap_id,
    object: post.apId,
  };
  const now = new Date().toISOString();
  await prisma.activity.create({
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
  if (post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl)) {
    await prisma.inbox.create({
      data: {
        actorApId: post.attributedTo,
        activityApId: likeActivityApId,
        read: 0,
        createdAt: now
      }
    });
  }

  // Send Like activity to remote post author
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

  // Delete the like
  await prisma.like.delete({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });

  // Update like count
  await prisma.object.updateMany({
    where: {
      apId: post.apId,
      likeCount: { gt: 0 }
    },
    data: { likeCount: { decrement: 1 } }
  });

  // Send Undo Like if post is remote
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
      // Store activity
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

  // Create repost
  const announceId = generateId();
  const announceActivityApId = activityApId(baseUrl, announceId);
  await prisma.announce.create({
    data: {
      actorApId: actor.ap_id,
      objectApId: post.apId,
      activityApId: announceActivityApId
    }
  });

  // Update announce count
  await prisma.object.update({
    where: { apId: post.apId },
    data: { announceCount: { increment: 1 } }
  });

  // Store Announce activity
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
  await prisma.activity.create({
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
  if (post.attributedTo !== actor.ap_id && isLocal(post.attributedTo, baseUrl)) {
    await prisma.inbox.create({
      data: {
        actorApId: post.attributedTo,
        activityApId: announceActivityApId,
        read: 0,
        createdAt: now
      }
    });
  }

  // Send Announce activity to remote post author
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

  // Delete the announce
  await prisma.announce.delete({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: post.apId
      }
    }
  });

  // Update announce count
  await prisma.object.updateMany({
    where: {
      apId: post.apId,
      announceCount: { gt: 0 }
    },
    data: { announceCount: { decrement: 1 } }
  });

  // Send Undo Announce if post is remote
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
      // Store activity
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

  // Get bookmarks with object details using raw query for complex joins
  // Since Prisma doesn't easily support COALESCE across different tables in include,
  // we use $queryRaw for this complex query
  let query = `
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    INNER JOIN bookmarks b ON o.ap_id = b.object_ap_id
    WHERE b.actor_ap_id = ?
  `;
  const params: Array<string | number | null> = [actor.ap_id, actor.ap_id];

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY b.created_at DESC LIMIT ?`;
  params.push(limit);

  const bookmarks = await c.env.DB.prepare(query).bind(...params).all<PostRow>();

  const result = (bookmarks.results || []).map((p: PostRow) => formatPost(p, actor.ap_id));

  return c.json({ bookmarks: result });
});

export default posts;
