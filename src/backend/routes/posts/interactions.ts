import { Hono } from 'hono';
import type { Env, Variables, APObject } from '../../types';
import { generateId, objectApId, activityApId, isLocal, signRequest, isSafeRemoteUrl } from '../../utils';
import { MAX_POSTS_PAGE_LIMIT, formatPost, parseLimit, PostRow } from './utils';

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

type ActorCacheInboxRow = {
  inbox: string | null;
};

type LikeRow = {
  activity_ap_id: string | null;
};

type AnnounceRow = {
  activity_ap_id: string | null;
};

type PostIdRow = {
  ap_id: string;
};

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
  const likeActivityApId = activityApId(baseUrl, likeId);
  await c.env.DB.prepare(`
    INSERT INTO likes (object_ap_id, actor_ap_id, activity_ap_id)
    VALUES (?, ?, ?)
  `).bind(post.ap_id, actor.ap_id, likeActivityApId).run();

  // Update like count
  await c.env.DB.prepare('UPDATE objects SET like_count = like_count + 1 WHERE ap_id = ?').bind(post.ap_id).run();

  // Store Like activity
  const likeActivityRaw = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: likeActivityApId,
    type: 'Like',
    actor: actor.ap_id,
    object: post.ap_id,
  };
  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, published, local)
    VALUES (?, 'Like', ?, ?, ?, ?, 1)
  `).bind(likeActivityApId, actor.ap_id, post.ap_id, JSON.stringify(likeActivityRaw), new Date().toISOString()).run();

  // Add to inbox of post author if local (AP Native notification)
  if (post.attributed_to !== actor.ap_id && isLocal(post.attributed_to, baseUrl)) {
    await c.env.DB.prepare(`
      INSERT INTO inbox (actor_ap_id, activity_ap_id, read, created_at)
      VALUES (?, ?, 0, ?)
    `).bind(post.attributed_to, likeActivityApId, new Date().toISOString()).run();
  }

  // Send Like activity to remote post author
  if (!isLocal(post.ap_id, baseUrl)) {
    try {
      const postAuthor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(post.attributed_to).first<ActorCacheInboxRow>();
      if (postAuthor?.inbox) {
        if (!isSafeRemoteUrl(postAuthor.inbox)) {
          console.warn(`[Posts] Blocked unsafe inbox URL: ${postAuthor.inbox}`);
        } else {
          const keyId = `${actor.ap_id}#main-key`;
          const headers = await signRequest(actor.private_key_pem, keyId, 'POST', postAuthor.inbox, JSON.stringify(likeActivityRaw));

          await fetch(postAuthor.inbox, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/activity+json' },
            body: JSON.stringify(likeActivityRaw),
          });
        }
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
  ).bind(post.ap_id, actor.ap_id).first<LikeRow>();

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
      const postAuthor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(post.attributed_to).first<ActorCacheInboxRow>();
      if (postAuthor?.inbox) {
        if (!isSafeRemoteUrl(postAuthor.inbox)) {
          console.warn(`[Posts] Blocked unsafe inbox URL: ${postAuthor.inbox}`);
          return c.json({ success: true, liked: false });
        }
        const undoObject = like.activity_ap_id
          ? like.activity_ap_id
          : {
            type: 'Like',
            actor: actor.ap_id,
            object: post.ap_id,
          };
        const undoLikeActivity = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: activityApId(baseUrl, generateId()),
          type: 'Undo',
          actor: actor.ap_id,
          object: undoObject,
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

// Repost (Announce)
posts.post('/:id/repost', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<APObject>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Check if already reposted
  const existingRepost = await c.env.DB.prepare(
    'SELECT * FROM announces WHERE object_ap_id = ? AND actor_ap_id = ?'
  ).bind(post.ap_id, actor.ap_id).first();

  if (existingRepost) return c.json({ error: 'Already reposted' }, 400);

  // Create repost
  const announceId = generateId();
  const announceActivityApId = activityApId(baseUrl, announceId);
  await c.env.DB.prepare(`
    INSERT INTO announces (object_ap_id, actor_ap_id, activity_ap_id)
    VALUES (?, ?, ?)
  `).bind(post.ap_id, actor.ap_id, announceActivityApId).run();

  // Update announce count
  await c.env.DB.prepare('UPDATE objects SET announce_count = announce_count + 1 WHERE ap_id = ?').bind(post.ap_id).run();

  // Store Announce activity
  const announceActivityRaw = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: announceActivityApId,
    type: 'Announce',
    actor: actor.ap_id,
    object: post.ap_id,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [actor.ap_id + '/followers'],
  };
  const now = new Date().toISOString();
  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, published, local)
    VALUES (?, 'Announce', ?, ?, ?, ?, 1)
  `).bind(announceActivityApId, actor.ap_id, post.ap_id, JSON.stringify(announceActivityRaw), now).run();

  // Add to inbox of post author if local (AP Native notification)
  if (post.attributed_to !== actor.ap_id && isLocal(post.attributed_to, baseUrl)) {
    await c.env.DB.prepare(`
      INSERT INTO inbox (actor_ap_id, activity_ap_id, read, created_at)
      VALUES (?, ?, 0, ?)
    `).bind(post.attributed_to, announceActivityApId, now).run();
  }

  // Send Announce activity to remote post author
  if (!isLocal(post.ap_id, baseUrl)) {
    try {
      const postAuthor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(post.attributed_to).first<ActorCacheInboxRow>();
      if (postAuthor?.inbox) {
        if (!isSafeRemoteUrl(postAuthor.inbox)) {
          console.warn(`[Posts] Blocked unsafe inbox URL: ${postAuthor.inbox}`);
        } else {
          const keyId = `${actor.ap_id}#main-key`;
          const headers = await signRequest(actor.private_key_pem, keyId, 'POST', postAuthor.inbox, JSON.stringify(announceActivityRaw));

          await fetch(postAuthor.inbox, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/activity+json' },
            body: JSON.stringify(announceActivityRaw),
          });
        }
      }
    } catch (e) {
      console.error('Failed to send Announce activity:', e);
    }
  }

  return c.json({ success: true, reposted: true });
});

// Unrepost (Undo Announce)
posts.delete('/:id/repost', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<APObject>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Get the announce
  const announce = await c.env.DB.prepare(
    'SELECT * FROM announces WHERE object_ap_id = ? AND actor_ap_id = ?'
  ).bind(post.ap_id, actor.ap_id).first<AnnounceRow>();

  if (!announce) return c.json({ error: 'Not reposted' }, 400);

  // Delete the announce
  await c.env.DB.prepare('DELETE FROM announces WHERE object_ap_id = ? AND actor_ap_id = ?')
    .bind(post.ap_id, actor.ap_id).run();

  // Update announce count
  await c.env.DB.prepare('UPDATE objects SET announce_count = announce_count - 1 WHERE ap_id = ? AND announce_count > 0')
    .bind(post.ap_id).run();

  // Send Undo Announce if post is remote
  if (!isLocal(post.ap_id, baseUrl)) {
    try {
      const postAuthor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?').bind(post.attributed_to).first<ActorCacheInboxRow>();
      if (postAuthor?.inbox) {
        if (!isSafeRemoteUrl(postAuthor.inbox)) {
          console.warn(`[Posts] Blocked unsafe inbox URL: ${postAuthor.inbox}`);
          return c.json({ success: true, reposted: false });
        }
        const undoAnnounceActivity = {
          '@context': 'https://www.w3.org/ns/activitystreams',
          id: activityApId(baseUrl, generateId()),
          type: 'Undo',
          actor: actor.ap_id,
          object: {
            type: 'Announce',
            actor: actor.ap_id,
            object: post.ap_id,
          },
        };

        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, 'POST', postAuthor.inbox, JSON.stringify(undoAnnounceActivity));

        await fetch(postAuthor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(undoAnnounceActivity),
        });

        // Store activity
        await c.env.DB.prepare(`
          INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
          VALUES (?, 'Undo', ?, ?, ?, 'outbound')
        `).bind(undoAnnounceActivity.id, actor.ap_id, post.ap_id, JSON.stringify(undoAnnounceActivity)).run();
      }
    } catch (e) {
      console.error('Failed to send Undo Announce activity:', e);
    }
  }

  return c.json({ success: true, reposted: false });
});

// Bookmark post
posts.post('/:id/bookmark', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await c.env.DB.prepare('SELECT ap_id FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<PostIdRow>();

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
    .bind(objectApId(baseUrl, postId), postId).first<PostIdRow>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Get the bookmark
  const bookmark = await c.env.DB.prepare(
    'SELECT * FROM bookmarks WHERE object_ap_id = ? AND actor_ap_id = ?'
  ).bind(post.ap_id, actor.ap_id).first<{ id: string }>();

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

  const limit = parseLimit(c.req.query('limit'), 20, MAX_POSTS_PAGE_LIMIT);
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
  const params: Array<string | number | null> = [actor.ap_id, actor.ap_id];

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY b.created_at DESC LIMIT ?`;
  params.push(limit);

  const bookmarks = await c.env.DB.prepare(query).bind(...params).all();

  const result = (bookmarks.results || []).map((p: PostRow) => formatPost(p, actor.ap_id));

  return c.json({ bookmarks: result });
});

export default posts;
