import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, formatUsername, isLocal, safeJsonParse } from '../../utils';
import { MAX_POST_CONTENT_LENGTH, MAX_POST_SUMMARY_LENGTH, MAX_POSTS_PAGE_LIMIT, extractMentions, formatPost, normalizeVisibility, parseLimit, PostRow } from './utils';
import { deliverActivity } from '../../lib/activitypub-helpers';

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

type PostAttachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

type CreatePostBody = {
  content: string;
  summary?: string;
  attachments?: PostAttachment[];
  in_reply_to?: string;
  visibility?: string;
  community_ap_id?: string;
};

type CommunityPolicyRow = {
  ap_id: string;
  post_policy: string | null;
};

type CommunityMemberRoleRow = {
  role: 'owner' | 'moderator' | 'member';
};

type ApIdRow = {
  ap_id: string;
};

type AttributedToRow = {
  attributed_to: string;
};

type FollowerRow = {
  follower_ap_id: string;
};

type PostDetailRow = PostRow & {
  to_json?: string | null;
  bookmarked?: number;
};

// Create post
posts.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<CreatePostBody>();

  const content = body.content?.trim();
  const summary = body.summary?.trim();

  if (!content) {
    return c.json({ error: 'Content required' }, 400);
  }
  if (content.length > MAX_POST_CONTENT_LENGTH) {
    return c.json({ error: `Content too long (max ${MAX_POST_CONTENT_LENGTH} chars)` }, 400);
  }
  if (summary && summary.length > MAX_POST_SUMMARY_LENGTH) {
    return c.json({ error: `Summary too long (max ${MAX_POST_SUMMARY_LENGTH} chars)` }, 400);
  }

  const visibility = normalizeVisibility(body.visibility);
  let communityId: string | null = null;
  if (body.community_ap_id) {
    const community = await c.env.DB.prepare(
      'SELECT ap_id, post_policy FROM communities WHERE ap_id = ? OR preferred_username = ?'
    ).bind(body.community_ap_id, body.community_ap_id).first<CommunityPolicyRow>();

    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    communityId = community.ap_id;

    const membership = await c.env.DB.prepare(
      'SELECT role FROM community_members WHERE community_ap_id = ? AND actor_ap_id = ?'
    ).bind(community.ap_id, actor.ap_id).first<CommunityMemberRoleRow>();

    const policy = community.post_policy || 'members';
    const role = membership?.role;
    const isManager = role === 'owner' || role === 'moderator';

    if (policy !== 'anyone' && !membership) {
      return c.json({ error: 'Not a community member' }, 403);
    }
    if (policy === 'mods' && !isManager) {
      return c.json({ error: 'Moderator role required' }, 403);
    }
    if (policy === 'owners' && role !== 'owner') {
      return c.json({ error: 'Owner role required' }, 403);
    }
  }

  const baseUrl = c.env.APP_URL;
  const postId = generateId();
  const apId = objectApId(baseUrl, postId);
  const now = new Date().toISOString();

  // Insert the post
  try {
    await c.env.DB.prepare(`
      INSERT INTO objects (ap_id, type, attributed_to, content, summary, attachments_json, in_reply_to, visibility, community_ap_id, published, is_local)
      VALUES (?, 'Note', ?, ?, ?, ?, ?, ?, ?, ?, 1)
    `).bind(
      apId,
      actor.ap_id,
      content,
      summary || null,
      JSON.stringify(body.attachments || []),
      body.in_reply_to || null,
      visibility,
      communityId,
      now
    ).run();
  } catch (e) {
    console.error('[Posts] Failed to insert post:', e);
    return c.json({ error: 'Failed to create post' }, 500);
  }

  // Update author's post count
  try {
    await c.env.DB.prepare('UPDATE actors SET post_count = post_count + 1 WHERE ap_id = ?').bind(actor.ap_id).run();
  } catch (e) {
    console.error('[Posts] Failed to update post count:', e);
    // Non-critical error, continue
  }

  // If replying to someone, update reply count
  if (body.in_reply_to) {
    try {
      await c.env.DB.prepare('UPDATE objects SET reply_count = reply_count + 1 WHERE ap_id = ?').bind(body.in_reply_to).run();
    } catch (e) {
      console.error('[Posts] Failed to update reply count:', e);
      // Non-critical error, continue
    }

    // Add to inbox of the post author being replied to (AP Native notification)
    try {
      const parentPost = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(body.in_reply_to).first<AttributedToRow>();
      if (parentPost && parentPost.attributed_to !== actor.ap_id && isLocal(parentPost.attributed_to, baseUrl)) {
        // Create activity for the inbox
        const replyActivityId = activityApId(baseUrl, generateId());
        await c.env.DB.prepare(`
          INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, published, local)
          VALUES (?, 'Create', ?, ?, ?, 1)
        `).bind(replyActivityId, actor.ap_id, apId, now).run();

        // Add to recipient's inbox
        await c.env.DB.prepare(`
          INSERT INTO inbox (actor_ap_id, activity_ap_id, read, created_at)
          VALUES (?, ?, 0, ?)
        `).bind(parentPost.attributed_to, replyActivityId, now).run();
      }
    } catch (e) {
      console.error('[Posts] Failed to create reply notification:', e);
      // Non-critical error, continue
    }
  }

  // Process mentions and create notifications
  const mentions = extractMentions(content);
  for (const mention of mentions) {
    try {
      let mentionedActorApId: string | null = null;

      if (mention.includes('@')) {
        // Remote mention @username@domain - lookup in actor_cache
        const [username, domain] = mention.split('@');
        const cached = await c.env.DB.prepare(
          `SELECT ap_id FROM actor_cache WHERE preferred_username = ? AND ap_id LIKE ?`
        ).bind(username, `%${domain}%`).first<ApIdRow>();
        if (cached) mentionedActorApId = cached.ap_id;
      } else {
        // Local mention @username
        const localActor = await c.env.DB.prepare(
          `SELECT ap_id FROM actors WHERE preferred_username = ?`
        ).bind(mention).first<ApIdRow>();
        if (localActor) mentionedActorApId = localActor.ap_id;
      }

      // Skip if not found, is self, or already notified as reply recipient
      if (!mentionedActorApId || mentionedActorApId === actor.ap_id) continue;
      if (body.in_reply_to) {
        const parentPost = await c.env.DB.prepare('SELECT attributed_to FROM objects WHERE ap_id = ?').bind(body.in_reply_to).first<AttributedToRow>();
        if (parentPost?.attributed_to === mentionedActorApId) continue; // Already notified via reply
      }

      // Create mention activity if local
      if (isLocal(mentionedActorApId, baseUrl)) {
        const mentionActivityId = activityApId(baseUrl, generateId());
        await c.env.DB.prepare(`
          INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, published, local)
          VALUES (?, 'Create', ?, ?, ?, 1)
        `).bind(mentionActivityId, actor.ap_id, apId, now).run();

        await c.env.DB.prepare(`
          INSERT INTO inbox (actor_ap_id, activity_ap_id, read, created_at)
          VALUES (?, ?, 0, ?)
        `).bind(mentionedActorApId, mentionActivityId, now).run();
      }
    } catch (e) {
      console.error(`Failed to process mention ${mention}:`, e);
    }
  }

  // Federate to followers if visibility is public
  if (visibility !== 'direct') {
    const followers = await c.env.DB.prepare(`
      SELECT DISTINCT f.follower_ap_id
      FROM follows f
      WHERE f.following_ap_id = ? AND f.status = 'accepted'
    `).bind(actor.ap_id).all<FollowerRow>();

    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityApId(baseUrl, generateId()),
      type: 'Create',
      actor: actor.ap_id,
      object: {
        id: apId,
        type: 'Note',
        attributedTo: actor.ap_id,
        content,
        summary: summary || null,
        attachments: body.attachments || [],
        inReplyTo: body.in_reply_to || null,
        visibility,
        published: now,
      },
    };

    // Send to remote followers
    const remoteFollowers = (followers.results || []).filter((f: FollowerRow) => !isLocal(f.follower_ap_id, baseUrl));
    for (const follower of remoteFollowers) {
      await deliverActivity(c.env.DB, actor, follower.follower_ap_id, createActivity);
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
    content,
    summary: summary || null,
    attachments: body.attachments || [],
    visibility,
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
  `).bind(...(currentActor ? [currentActor.ap_id, currentActor.ap_id] : []), objectApId(baseUrl, postId), postId).first<PostDetailRow>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Check visibility
  if (post.visibility === 'followers') {
    if (!currentActor) {
      return c.json({ error: 'Post not found' }, 404);
    }
    if (currentActor.ap_id !== post.attributed_to) {
      const follows = await c.env.DB.prepare(
        'SELECT 1 FROM follows WHERE follower_ap_id = ? AND following_ap_id = ? AND status = ?'
      ).bind(currentActor.ap_id, post.attributed_to, 'accepted').first();
      if (!follows) {
        return c.json({ error: 'Post not found' }, 404);
      }
    }
  }

  if (post.visibility === 'direct') {
    if (!currentActor) {
      return c.json({ error: 'Post not found' }, 404);
    }
    if (currentActor.ap_id !== post.attributed_to) {
      const recipients = safeJsonParse<string[]>(post.to_json, []);
      if (!recipients.includes(currentActor.ap_id)) {
        return c.json({ error: 'Post not found' }, 404);
      }
    }
  }

  return c.json({ post: formatPost(post, currentActor?.ap_id) });
});

// Get post replies
posts.get('/:id/replies', async (c) => {
  const currentActor = c.get('actor');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const limit = parseLimit(c.req.query('limit'), 20, MAX_POSTS_PAGE_LIMIT);
  const before = c.req.query('before');

  // Verify post exists
  const parentPost = await c.env.DB.prepare('SELECT ap_id FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<ApIdRow>();

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
  const params: Array<string | number | null> = currentActor ? [currentActor.ap_id, currentActor.ap_id] : [];
  params.push(parentPost.ap_id);

  if (before) {
    query += ` AND o.published < ?`;
    params.push(before);
  }

  query += ` ORDER BY o.published DESC LIMIT ?`;
  params.push(limit);

  const replies = await c.env.DB.prepare(query).bind(...params).all<PostRow>();

  const result = (replies.results || []).map((r) => formatPost(r, currentActor?.ap_id));

  return c.json({ replies: result });
});

// Edit post
posts.patch('/:id', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const body = await c.req.json<{ content?: string; summary?: string }>();

  // Get the post
  const post = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<PostDetailRow>();

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Only author can edit
  if (post.attributed_to !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Validate content
  let trimmedContent: string | undefined;
  if (body.content !== undefined) {
    trimmedContent = body.content.trim();
    if (trimmedContent.length === 0) {
      return c.json({ error: 'Content cannot be empty' }, 400);
    }
    if (trimmedContent.length > MAX_POST_CONTENT_LENGTH) {
      return c.json({ error: `Content too long (max ${MAX_POST_CONTENT_LENGTH} chars)` }, 400);
    }
  }
  let trimmedSummary: string | undefined;
  if (body.summary !== undefined) {
    trimmedSummary = body.summary.trim();
    if (trimmedSummary.length > MAX_POST_SUMMARY_LENGTH) {
      return c.json({ error: `Summary too long (max ${MAX_POST_SUMMARY_LENGTH} chars)` }, 400);
    }
  }

  const nextContent = body.content !== undefined ? (trimmedContent as string) : post.content;
  const nextSummary = body.summary !== undefined ? trimmedSummary || null : post.summary;

  const now = new Date().toISOString();
  const updates: string[] = [];
  const params: Array<string | number | null> = [];

  if (body.content !== undefined) {
    updates.push('content = ?');
    params.push(trimmedContent ?? null);
  }
  if (body.summary !== undefined) {
    updates.push('summary = ?');
    params.push(trimmedSummary || null);
  }
  updates.push('updated_at = ?');
  params.push(now);

  if (updates.length === 1) {
    return c.json({ error: 'No changes provided' }, 400);
  }

  params.push(post.ap_id);

  await c.env.DB.prepare(`UPDATE objects SET ${updates.join(', ')} WHERE ap_id = ?`).bind(...params).run();

  // Send Update activity to followers
  const followers = await c.env.DB.prepare(`
    SELECT DISTINCT f.follower_ap_id
    FROM follows f
    WHERE f.following_ap_id = ? AND f.status = 'accepted'
  `).bind(actor.ap_id).all<FollowerRow>();

  const updateActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityApId(baseUrl, generateId()),
    type: 'Update',
    actor: actor.ap_id,
    object: {
      id: post.ap_id,
      type: 'Note',
      attributedTo: actor.ap_id,
      content: nextContent,
      summary: nextSummary,
      updated: now,
    },
  };

  // Send to remote followers
  const remoteFollowers = (followers.results || []).filter((f: FollowerRow) => !isLocal(f.follower_ap_id, baseUrl));
  for (const follower of remoteFollowers) {
    await deliverActivity(c.env.DB, actor, follower.follower_ap_id, updateActivity);
  }

  // Store activity
  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
    VALUES (?, 'Update', ?, ?, ?, 'outbound')
  `).bind(updateActivity.id, actor.ap_id, post.ap_id, JSON.stringify(updateActivity)).run();

  return c.json({
    success: true,
    post: {
      ap_id: post.ap_id,
      content: nextContent,
      summary: nextSummary,
      updated_at: now,
    },
  });
});

// Delete post
posts.delete('/:id', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;

  // Get the post
  const post = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? OR ap_id = ?')
    .bind(objectApId(baseUrl, postId), postId).first<PostDetailRow>();

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
  `).bind(actor.ap_id).all<FollowerRow>();

  const deleteActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityApId(baseUrl, generateId()),
    type: 'Delete',
    actor: actor.ap_id,
    object: post.ap_id,
  };

  // Send to remote followers
  const remoteFollowers = (followers.results || []).filter((f: FollowerRow) => !isLocal(f.follower_ap_id, baseUrl));
  for (const follower of remoteFollowers) {
    await deliverActivity(c.env.DB, actor, follower.follower_ap_id, deleteActivity);
  }

  return c.json({ success: true });
});


export default posts;
