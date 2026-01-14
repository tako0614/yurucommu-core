// Posts, Likes, and Bookmarks routes for Yurucommu backend
import { Hono } from 'hono';
import type { Env, Variables, APObject, Actor, ActorCache } from '../types';
import { generateId, objectApId, activityApId, formatUsername, isLocal, signRequest } from '../utils';

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper function to format a post response
function formatPost(p: any, currentActorApId?: string): any {
  return {
    ap_id: p.ap_id,
    type: p.type,
    author: {
      ap_id: p.attributed_to,
      username: formatUsername(p.attributed_to),
      preferred_username: p.author_username,
      name: p.author_name,
      icon_url: p.author_icon_url,
    },
    content: p.content,
    summary: p.summary,
    attachments: JSON.parse(p.attachments_json || '[]'),
    in_reply_to: p.in_reply_to,
    visibility: p.visibility,
    community_ap_id: p.community_ap_id,
    like_count: p.like_count,
    reply_count: p.reply_count,
    announce_count: p.announce_count,
    published: p.published,
    liked: currentActorApId ? !!p.liked : false,
  };
}

// Create post
posts.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{
    content: string;
    summary?: string;
    attachments?: any[];
    in_reply_to?: string;
    visibility?: string;
    community_ap_id?: string;
  }>();

  if (!body.content || body.content.trim().length === 0) {
    return c.json({ error: 'Content required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const postId = generateId();
  const apId = objectApId(baseUrl, postId);
  const now = new Date().toISOString();

  // Insert the post
  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, summary, attachments_json, in_reply_to, visibility, community_ap_id, published, is_local)
    VALUES (?, 'Note', ?, ?, ?, ?, ?, ?, ?, ?, 1)
  `).bind(
    apId,
    actor.ap_id,
    body.content,
    body.summary || null,
    JSON.stringify(body.attachments || []),
    body.in_reply_to || null,
    body.visibility || 'public',
    body.community_ap_id || null,
    now
  ).run();

  // Update author's post count
  await c.env.DB.prepare('UPDATE actors SET post_count = post_count + 1 WHERE ap_id = ?').bind(actor.ap_id).run();

  // If replying to someone, update reply count
  if (body.in_reply_to) {
    await c.env.DB.prepare('UPDATE objects SET reply_count = reply_count + 1 WHERE ap_id = ?').bind(body.in_reply_to).run();

    // Create notification for the post author being replied to
    const parentPost = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(body.in_reply_to).first<any>();
    if (parentPost && parentPost.attributed_to !== actor.ap_id) {
      const notifId = generateId();
      await c.env.DB.prepare(`
        INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type, object_ap_id)
        VALUES (?, ?, ?, 'reply', ?)
      `).bind(notifId, parentPost.attributed_to, actor.ap_id, apId).run();
    }
  }

  // Federate to followers if visibility is public
  if (body.visibility !== 'private' && body.visibility !== 'followers_only') {
    const followers = await c.env.DB.prepare(`
      SELECT DISTINCT f.follower_ap_id
      FROM follows f
      WHERE f.following_ap_id = ? AND f.status = 'accepted'
    `).bind(actor.ap_id).all();

    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityApId(baseUrl, generateId()),
      type: 'Create',
      actor: actor.ap_id,
      object: {
        id: apId,
        type: 'Note',
        attributedTo: actor.ap_id,
        content: body.content,
        summary: body.summary || null,
        attachments: body.attachments || [],
        inReplyTo: body.in_reply_to || null,
        visibility: body.visibility || 'public',
        published: now,
      },
    };

    // Send to remote followers
    const remoteFollowers = (followers.results || []).filter((f: any) => !isLocal(f.follower_ap_id, baseUrl));
    for (const follower of remoteFollowers) {
      try {
        const cachedActor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(follower.follower_ap_id).first<any>();
        if (cachedActor?.inbox) {
          const keyId = `${actor.ap_id}#main-key`;
          const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(createActivity));

          await fetch(cachedActor.inbox, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/activity+json' },
            body: JSON.stringify(createActivity),
          });
        }
      } catch (e) {
        console.error(`Failed to federate to ${follower.follower_ap_id}:`, e);
      }
    }

    // Store activity
    await c.env.DB.prepare(`
      INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
      VALUES (?, 'Create', ?, ?, ?, 'outbound')
    `).bind(createActivity.id, actor.ap_id, apId, JSON.stringify(createActivity)).run();
  }

  return c.json({
    ap_id: apId,
    type: 'Note',
    author: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
      preferred_username: actor.preferred_username,
      name: actor.name,
      icon_url: actor.icon_url,
    },
    content: body.content,
    summary: body.summary || null,
    attachments: body.attachments || [],
    visibility: body.visibility || 'public',
    published: now,
    like_count: 0,
    reply_count: 0,
    announce_count: 0,
    liked: false,
    bookmarked: false,
  });
});

// Get single post
posts.get('/:id', async (c) => {
  const currentActor = c.get('actor');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Try to find the post
  let post = await c.env.DB.prepare(`
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url
           ${currentActor ? ', EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked, EXISTS(SELECT 1 FROM bookmarks b WHERE b.object_ap_id = o.ap_id AND b.actor_ap_id = ?) as bookmarked' : ''}
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.ap_id = ? OR o.ap_id = ?
  `).bind(...(currentActor ? [currentActor.ap_id, currentActor.ap_id] : []), objectApId(baseUrl, postId), postId).first<any>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Check visibility
  if (post.visibility === 'private' && (!currentActor || currentActor.ap_id !== post.attributed_to)) {
    return c.json({ error: 'Post not found' }, 404);
  }

  return c.json({ post: formatPost(post, currentActor?.ap_id) });
});

// Get post replies
posts.get('/:id/replies', async (c) => {
  const currentActor = c.get('actor');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

  // Verify post exists
  const parentPost = await c.env.DB.prepare('SELECT ap_id FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<any>();

  if (!parentPost) return c.json({ error: 'Post not found' }, 404);

  let query = `
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url
           ${currentActor ? ', EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked, EXISTS(SELECT 1 FROM bookmarks b WHERE b.object_ap_id = o.ap_id AND b.actor_ap_id = ?) as bookmarked' : ''}
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    WHERE o.in_reply_to = ?
  `;
  const params: any[] = currentActor ? [currentActor.ap_id, currentActor.ap_id] : [];
  params.push(parentPost.ap_id);

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY o.published DESC LIMIT ?`;
  params.push(limit);

  const replies = await c.env.DB.prepare(query).bind(...params).all();

  const result = (replies.results || []).map((r: any) => formatPost(r, currentActor?.ap_id));

  return c.json({ replies: result });
});

// Delete post
posts.delete('/:id', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<any>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Only author can delete
  if (post.attributed_to !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Delete the post
  await c.env.DB.prepare('DELETE FROM objects WHERE ap_id = ?').bind(post.ap_id).run();

  // Update author's post count
  await c.env.DB.prepare('UPDATE actors SET post_count = post_count - 1 WHERE ap_id = ? AND post_count > 0')
    .bind(actor.ap_id).run();

  // If this was a reply, update parent's reply count
  if (post.in_reply_to) {
    await c.env.DB.prepare('UPDATE objects SET reply_count = reply_count - 1 WHERE ap_id = ? AND reply_count > 0')
      .bind(post.in_reply_to).run();
  }

  // Send Delete activity to followers
  const followers = await c.env.DB.prepare(`
    SELECT DISTINCT f.follower_ap_id
    FROM follows f
    WHERE f.following_ap_id = ? AND f.status = 'accepted'
  `).bind(actor.ap_id).all();

  const deleteActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityApId(baseUrl, generateId()),
    type: 'Delete',
    actor: actor.ap_id,
    object: post.ap_id,
  };

  // Send to remote followers
  const remoteFollowers = (followers.results || []).filter((f: any) => !isLocal(f.follower_ap_id, baseUrl));
  for (const follower of remoteFollowers) {
    try {
      const cachedActor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(follower.follower_ap_id).first<any>();
      if (cachedActor?.inbox) {
        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, 'POST', cachedActor.inbox, JSON.stringify(deleteActivity));

        await fetch(cachedActor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(deleteActivity),
        });
      }
    } catch (e) {
      console.error(`Failed to federate delete to ${follower.follower_ap_id}:`, e);
    }
  }

  return c.json({ success: true });
});

// Like post
posts.post('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<APObject>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Check if already liked
  const existingLike = await c.env.DB.prepare(
    'SELECT * FROM likes WHERE object_ap_id = ? AND actor_ap_id = ?'
  ).bind(post.ap_id, actor.ap_id).first();

  if (existingLike) return c.json({ error: 'Already liked' }, 400);

  // Create like
  const likeId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO likes (id, object_ap_id, actor_ap_id, activity_ap_id)
    VALUES (?, ?, ?, ?)
  `).bind(likeId, post.ap_id, actor.ap_id, activityApId(baseUrl, likeId)).run();

  // Update like count
  await c.env.DB.prepare('UPDATE objects SET like_count = like_count + 1 WHERE ap_id = ?').bind(post.ap_id).run();

  // Create notification if post is not authored by current user
  if (post.attributed_to !== actor.ap_id) {
    const notifId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO notifications (id, recipient_ap_id, actor_ap_id, type, object_ap_id)
      VALUES (?, ?, ?, 'like', ?)
    `).bind(notifId, post.attributed_to, actor.ap_id, post.ap_id).run();
  }

  // Send Like activity if post is remote
  if (!isLocal(post.ap_id, baseUrl)) {
    try {
      const postAuthor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(post.attributed_to).first<any>();
      if (postAuthor?.inbox) {
        const likeActivity = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: activityApId(baseUrl, likeId),
          type: 'Like',
          actor: actor.ap_id,
          object: post.ap_id,
        };

        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, 'POST', postAuthor.inbox, JSON.stringify(likeActivity));

        await fetch(postAuthor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(likeActivity),
        });

        // Store activity
        await c.env.DB.prepare(`
          INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
          VALUES (?, 'Like', ?, ?, ?, 'outbound')
        `).bind(activityApId(baseUrl, likeId), actor.ap_id, post.ap_id, JSON.stringify(likeActivity)).run();
      }
    } catch (e) {
      console.error('Failed to send Like activity:', e);
    }
  }

  return c.json({ success: true, liked: true });
});

// Unlike post
posts.delete('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<APObject>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Get the like
  const like = await c.env.DB.prepare(
    'SELECT * FROM likes WHERE object_ap_id = ? AND actor_ap_id = ?'
  ).bind(post.ap_id, actor.ap_id).first<any>();

  if (!like) return c.json({ error: 'Not liked' }, 400);

  // Delete the like
  await c.env.DB.prepare('DELETE FROM likes WHERE object_ap_id = ? AND actor_ap_id = ?')
    .bind(post.ap_id, actor.ap_id).run();

  // Update like count
  await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0')
    .bind(post.ap_id).run();

  // Send Undo Like if post is remote
  if (!isLocal(post.ap_id, baseUrl)) {
    try {
      const postAuthor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(post.attributed_to).first<any>();
      if (postAuthor?.inbox) {
        const undoLikeActivity = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: activityApId(baseUrl, generateId()),
          type: 'Undo',
          actor: actor.ap_id,
          object: {
            type: 'Like',
            actor: actor.ap_id,
            object: post.ap_id,
          },
        };

        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, 'POST', postAuthor.inbox, JSON.stringify(undoLikeActivity));

        await fetch(postAuthor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(undoLikeActivity),
        });

        // Store activity
        await c.env.DB.prepare(`
          INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
          VALUES (?, 'Undo', ?, ?, ?, 'outbound')
        `).bind(undoLikeActivity.id, actor.ap_id, post.ap_id, JSON.stringify(undoLikeActivity)).run();
      }
    } catch (e) {
      console.error('Failed to send Undo Like activity:', e);
    }
  }

  return c.json({ success: true, liked: false });
});

// Bookmark post
posts.post('/:id/bookmark', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await c.env.DB.prepare('SELECT ap_id FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<any>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Check if already bookmarked
  const existingBookmark = await c.env.DB.prepare(
    'SELECT * FROM bookmarks WHERE object_ap_id = ? AND actor_ap_id = ?'
  ).bind(post.ap_id, actor.ap_id).first();

  if (existingBookmark) return c.json({ error: 'Already bookmarked' }, 400);

  // Create bookmark
  const bookmarkId = generateId();
  await c.env.DB.prepare(`
    INSERT INTO bookmarks (id, object_ap_id, actor_ap_id)
    VALUES (?, ?, ?)
  `).bind(bookmarkId, post.ap_id, actor.ap_id).run();

  return c.json({ success: true, bookmarked: true });
});

// Remove bookmark
posts.delete('/:id/bookmark', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await c.env.DB.prepare('SELECT ap_id FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<any>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Get the bookmark
  const bookmark = await c.env.DB.prepare(
    'SELECT * FROM bookmarks WHERE object_ap_id = ? AND actor_ap_id = ?'
  ).bind(post.ap_id, actor.ap_id).first<any>();

  if (!bookmark) return c.json({ error: 'Not bookmarked' }, 400);

  // Delete the bookmark
  await c.env.DB.prepare('DELETE FROM bookmarks WHERE object_ap_id = ? AND actor_ap_id = ?')
    .bind(post.ap_id, actor.ap_id).run();

  return c.json({ success: true, bookmarked: false });
});

// Get user's bookmarks
posts.get('/bookmarks', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const limit = parseInt(c.req.query('limit') || '20');
  const before = c.req.query('before');

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
  const params: any[] = [actor.ap_id, actor.ap_id];

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY b.created_at DESC LIMIT ?`;
  params.push(limit);

  const bookmarks = await c.env.DB.prepare(query).bind(...params).all();

  const result = (bookmarks.results || []).map((p: any) => formatPost(p, actor.ap_id));

  return c.json({ bookmarks: result });
});

export default posts;
