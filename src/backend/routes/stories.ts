// Story routes for Yurucommu backend
// v2: 1 Story = 1 Media (Instagram style)
import { Hono } from 'hono';
import type { Env, Variables, APObject } from '../types';
import { generateId, objectApId, actorApId, formatUsername, activityApId, isLocal, signRequest } from '../utils';
import { sendCreateStoryActivity, sendDeleteStoryActivity } from '../lib/activitypub-helpers';

// Types for vote results
interface VoteResults {
  [optionIndex: number]: number;
}

// Cleanup expired stories and related data
async function cleanupExpiredStories(db: D1Database): Promise<number> {
  const now = new Date().toISOString();

  // Get expired story ap_ids first
  const expiredStories = await db.prepare(`
    SELECT ap_id FROM objects
    WHERE type = 'Story' AND end_time < ?
  `).bind(now).all();

  if (!expiredStories.results || expiredStories.results.length === 0) {
    return 0;
  }

  // Delete related votes
  await db.prepare(`
    DELETE FROM story_votes
    WHERE story_ap_id IN (
      SELECT ap_id FROM objects
      WHERE type = 'Story' AND end_time < ?
    )
  `).bind(now).run();

  // Delete related likes
  await db.prepare(`
    DELETE FROM likes
    WHERE object_ap_id IN (
      SELECT ap_id FROM objects
      WHERE type = 'Story' AND end_time < ?
    )
  `).bind(now).run();

  // Delete related views
  await db.prepare(`
    DELETE FROM story_views
    WHERE story_ap_id IN (
      SELECT ap_id FROM objects
      WHERE type = 'Story' AND end_time < ?
    )
  `).bind(now).run();

  // Delete stories
  const result = await db.prepare(`
    DELETE FROM objects
    WHERE type = 'Story' AND end_time < ?
  `).bind(now).run();

  return result.meta.changes || 0;
}

// Helper to get vote counts for a story
async function getVoteCounts(db: D1Database, storyApId: string): Promise<VoteResults> {
  const votes = await db.prepare(`
    SELECT option_index, COUNT(*) as count
    FROM story_votes
    WHERE story_ap_id = ?
    GROUP BY option_index
  `).bind(storyApId).all();

  const results: VoteResults = {};
  (votes.results || []).forEach((v: any) => {
    results[v.option_index] = v.count;
  });
  return results;
}

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

// Validate overlays JSON schema
function validateOverlays(overlays: any[]): { valid: boolean; error?: string } {
  if (!Array.isArray(overlays)) {
    return { valid: false, error: 'overlays must be an array' };
  }

  for (let i = 0; i < overlays.length; i++) {
    const overlay = overlays[i];

    // type検証
    if (!overlay.type || typeof overlay.type !== 'string') {
      return { valid: false, error: `overlay[${i}].type is required` };
    }

    // position検証
    if (!overlay.position || typeof overlay.position !== 'object') {
      return { valid: false, error: `overlay[${i}].position is required` };
    }

    const { x, y, width, height } = overlay.position;
    if (typeof x !== 'number' || x < 0 || x > 1) {
      return { valid: false, error: `overlay[${i}].position.x must be 0.0-1.0` };
    }
    if (typeof y !== 'number' || y < 0 || y > 1) {
      return { valid: false, error: `overlay[${i}].position.y must be 0.0-1.0` };
    }
    if (typeof width !== 'number' || width < 0 || width > 1) {
      return { valid: false, error: `overlay[${i}].position.width must be 0.0-1.0` };
    }
    if (typeof height !== 'number' || height < 0 || height > 1) {
      return { valid: false, error: `overlay[${i}].position.height must be 0.0-1.0` };
    }

    // Question型の検証
    if (overlay.type === 'Question') {
      if (!overlay.oneOf || !Array.isArray(overlay.oneOf) || overlay.oneOf.length < 2 || overlay.oneOf.length > 4) {
        return { valid: false, error: `overlay[${i}].oneOf must have 2-4 options` };
      }
    }

    // Link型の検証
    if (overlay.type === 'Link') {
      if (!overlay.href || typeof overlay.href !== 'string') {
        return { valid: false, error: `overlay[${i}].href is required for Link` };
      }
      // URL検証
      try {
        const url = new URL(overlay.href);
        if (!['http:', 'https:'].includes(url.protocol)) {
          return { valid: false, error: `overlay[${i}].href must be http/https` };
        }
      } catch {
        return { valid: false, error: `overlay[${i}].href is invalid URL` };
      }
    }
  }

  return { valid: true };
}

// Helper to transform stored story data
function transformStoryData(attachmentsJson: string): {
  attachment: any;
  displayDuration: string;
  overlays?: any[];
} {
  const stored = JSON.parse(attachmentsJson || '{}');
  const r2Key = stored.attachment?.r2_key;
  const contentType = stored.attachment?.content_type || 'image/jpeg';
  const externalUrl = stored.attachment?.url;

  // URL decision: use local path if r2_key exists, otherwise use external URL
  let url = '';
  if (r2Key) {
    url = `/media/${r2Key.replace('uploads/', '')}`;
  } else if (externalUrl) {
    url = externalUrl;
  }

  return {
    attachment: {
      type: contentType.startsWith('video/') ? 'Video' : 'Document',
      mediaType: contentType,
      url,
      r2_key: r2Key || '',
      width: stored.attachment?.width || 1080,
      height: stored.attachment?.height || 1920,
    },
    displayDuration: stored.displayDuration || 'PT5S',
    overlays: stored.overlays || undefined,
  };
}

// Get active stories from followed users and self (grouped by author)
stories.get('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const baseUrl = c.env.APP_URL;
  const now = new Date().toISOString();

  // Probabilistic cleanup: 1% chance to run cleanup on each request
  if (Math.random() < 0.01) {
    // Run cleanup in background (don't await)
    cleanupExpiredStories(c.env.DB).catch(() => {});
  }

  // Get stories from followed users and self, ordered by end_time (unviewed first)
    const stories_data = await c.env.DB.prepare(`
      SELECT o.*,
             COALESCE(a.preferred_username, ac.preferred_username) as author_username,
             COALESCE(a.name, ac.name) as author_name,
             COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
             CASE WHEN sv.story_ap_id IS NOT NULL THEN 1 ELSE 0 END as viewed,
             EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked
      FROM objects o
      LEFT JOIN actors a ON o.attributed_to = a.ap_id
      LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
      LEFT JOIN story_views sv ON o.ap_id = sv.story_ap_id AND sv.actor_ap_id = ?
      WHERE o.type = 'Story'
        AND o.end_time > ?
        AND (o.attributed_to IN (
          SELECT following_ap_id FROM follows WHERE follower_ap_id = ? AND status = 'accepted'
        ) OR o.attributed_to = ?)
        AND NOT EXISTS (
          SELECT 1 FROM blocks b WHERE b.blocker_ap_id = ? AND b.blocked_ap_id = o.attributed_to
        )
        AND NOT EXISTS (
          SELECT 1 FROM mutes m WHERE m.muter_ap_id = ? AND m.muted_ap_id = o.attributed_to
        )
      ORDER BY viewed ASC, o.end_time DESC
    `).bind(
      actor.ap_id,
      actor.ap_id,
      now,
      actor.ap_id,
      actor.ap_id,
      actor.ap_id,
      actor.ap_id
    ).all();

  // Get all story ap_ids for batch vote query
  const storyApIds = (stories_data.results || []).map((s: any) => s.ap_id);

  // Batch query for all votes
  let allVotes: Record<string, VoteResults> = {};
  let userVotes: Record<string, number> = {};

  if (storyApIds.length > 0) {
    // Get vote counts grouped by story and option
    const votesQuery = await c.env.DB.prepare(`
      SELECT story_ap_id, option_index, COUNT(*) as count
      FROM story_votes
      WHERE story_ap_id IN (${storyApIds.map(() => '?').join(',')})
      GROUP BY story_ap_id, option_index
    `).bind(...storyApIds).all();

    (votesQuery.results || []).forEach((v: any) => {
      if (!allVotes[v.story_ap_id]) {
        allVotes[v.story_ap_id] = {};
      }
      allVotes[v.story_ap_id][v.option_index] = v.count;
    });

    // Get user's own votes
    const userVotesQuery = await c.env.DB.prepare(`
      SELECT story_ap_id, option_index
      FROM story_votes
      WHERE story_ap_id IN (${storyApIds.map(() => '?').join(',')})
        AND actor_ap_id = ?
    `).bind(...storyApIds, actor.ap_id).all();

    (userVotesQuery.results || []).forEach((v: any) => {
      userVotes[v.story_ap_id] = v.option_index;
    });
  }

  // Group by author
  const grouped: Record<string, any> = {};
  const authorOrder: string[] = [];

  (stories_data.results || []).forEach((s: any) => {
    const authorApId = s.attributed_to;
    const authorInfo = {
      ap_id: authorApId,
      username: formatUsername(authorApId),
      preferred_username: s.author_username,
      name: s.author_name,
      icon_url: s.author_icon_url,
    };

    if (!grouped[authorApId]) {
      grouped[authorApId] = {
        actor: authorInfo,
        stories: [],
        has_unviewed: false,
      };
      // Add self first, then others
      if (authorApId === actor.ap_id) {
        authorOrder.unshift(authorApId);
      } else {
        authorOrder.push(authorApId);
      }
    }

    const isViewed = !!s.viewed;
    if (!isViewed) {
      grouped[authorApId].has_unviewed = true;
    }

    // Transform to new format
    const storyData = transformStoryData(s.attachments_json);

    // Calculate vote totals
    const storyVotes = allVotes[s.ap_id] || {};
    const total = Object.values(storyVotes).reduce((sum: number, count: number) => sum + count, 0);

    grouped[authorApId].stories.push({
      ap_id: s.ap_id,
      author: authorInfo,
      attachment: storyData.attachment,
      displayDuration: storyData.displayDuration,
      overlays: storyData.overlays,
      end_time: s.end_time,
      published: s.published,
      viewed: isViewed,
      like_count: s.like_count,
      share_count: s.share_count || 0,
      liked: !!s.liked,
      votes: storyVotes,
      votes_total: total,
      user_vote: userVotes[s.ap_id],
    });
  });

  const result = authorOrder.map(apId => grouped[apId]);

  return c.json({ actor_stories: result });
});

// Cleanup expired stories (admin/scheduled endpoint)
// Must be defined before /:actorId to avoid route conflict
stories.post('/cleanup', async (c) => {
  const deleted = await cleanupExpiredStories(c.env.DB);
  return c.json({ deleted });
});

// Get stories for a specific user
stories.get('/:actorId', async (c) => {
  const targetActorId = c.req.param('actorId');
  const actor = c.get('actor');

  const baseUrl = c.env.APP_URL;
  const now = new Date().toISOString();

  // Find the actor by username or full ap_id
  let targetApId = targetActorId;
  if (!targetActorId.startsWith('http')) {
    // It's a username, convert to ap_id
    targetApId = actorApId(baseUrl, targetActorId);
  }

    const user_stories = await c.env.DB.prepare(`
      SELECT o.*,
             COALESCE(a.preferred_username, ac.preferred_username) as author_username,
             COALESCE(a.name, ac.name) as author_name,
             COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
             CASE WHEN sv.story_ap_id IS NOT NULL THEN 1 ELSE 0 END as viewed,
             EXISTS(SELECT 1 FROM likes l WHERE l.object_ap_id = o.ap_id AND l.actor_ap_id = ?) as liked
      FROM objects o
      LEFT JOIN actors a ON o.attributed_to = a.ap_id
      LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
      LEFT JOIN story_views sv ON o.ap_id = sv.story_ap_id AND sv.actor_ap_id = ?
      WHERE o.type = 'Story'
        AND o.attributed_to = ?
        AND o.end_time > ?
        AND NOT EXISTS (
          SELECT 1 FROM blocks b WHERE b.blocker_ap_id = ? AND b.blocked_ap_id = o.attributed_to
        )
        AND NOT EXISTS (
          SELECT 1 FROM mutes m WHERE m.muter_ap_id = ? AND m.muted_ap_id = o.attributed_to
        )
      ORDER BY o.published DESC
    `).bind(
      actor?.ap_id || '',
      actor?.ap_id || '',
      targetApId,
      now,
      actor?.ap_id || '',
      actor?.ap_id || ''
    ).all();

  // Get all story ap_ids for batch vote query
  const storyApIds = (user_stories.results || []).map((s: any) => s.ap_id);

  // Batch query for all votes
  let allVotes: Record<string, VoteResults> = {};
  let userVotes: Record<string, number> = {};

  if (storyApIds.length > 0) {
    // Get vote counts grouped by story and option
    const votesQuery = await c.env.DB.prepare(`
      SELECT story_ap_id, option_index, COUNT(*) as count
      FROM story_votes
      WHERE story_ap_id IN (${storyApIds.map(() => '?').join(',')})
      GROUP BY story_ap_id, option_index
    `).bind(...storyApIds).all();

    (votesQuery.results || []).forEach((v: any) => {
      if (!allVotes[v.story_ap_id]) {
        allVotes[v.story_ap_id] = {};
      }
      allVotes[v.story_ap_id][v.option_index] = v.count;
    });

    // Get user's own votes (if authenticated)
    if (actor) {
      const userVotesQuery = await c.env.DB.prepare(`
        SELECT story_ap_id, option_index
        FROM story_votes
        WHERE story_ap_id IN (${storyApIds.map(() => '?').join(',')})
          AND actor_ap_id = ?
      `).bind(...storyApIds, actor.ap_id).all();

      (userVotesQuery.results || []).forEach((v: any) => {
        userVotes[v.story_ap_id] = v.option_index;
      });
    }
  }

  const result = (user_stories.results || []).map((s: any) => {
    const storyData = transformStoryData(s.attachments_json);

    // Calculate vote totals
    const storyVotes = allVotes[s.ap_id] || {};
    const total = Object.values(storyVotes).reduce((sum: number, count: number) => sum + count, 0);

    return {
      ap_id: s.ap_id,
      author: {
        ap_id: s.attributed_to,
        username: formatUsername(s.attributed_to),
        preferred_username: s.author_username,
        name: s.author_name,
        icon_url: s.author_icon_url,
      },
      attachment: storyData.attachment,
      displayDuration: storyData.displayDuration,
      overlays: storyData.overlays,
      end_time: s.end_time,
      published: s.published,
      viewed: !!s.viewed,
      like_count: s.like_count,
      share_count: s.share_count || 0,
      liked: !!s.liked,
      votes: storyVotes,
      votes_total: total,
      user_vote: userVotes[s.ap_id],
    };
  });

  return c.json({ stories: result });
});

// Create story (v2: single attachment format)
stories.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{
    attachment: {
      r2_key: string;
      content_type: string;
      width?: number;
      height?: number;
    };
    displayDuration: string;
    overlays?: any[];
  }>();

  if (!body.attachment || !body.attachment.r2_key) {
    return c.json({ error: 'attachment with r2_key required' }, 400);
  }

  // Validate overlays if provided
  if (body.overlays && body.overlays.length > 0) {
    const validation = validateOverlays(body.overlays);
    if (!validation.valid) {
      return c.json({ error: validation.error }, 400);
    }
  }

  const baseUrl = c.env.APP_URL;
  const id = generateId();
  const apId = objectApId(baseUrl, id);
  const now = new Date().toISOString();

  // Set expiration to 24 hours from now
  const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  // Store in new format with width/height
  const storyData = {
    attachment: {
      ...body.attachment,
      width: body.attachment.width || 1080,
      height: body.attachment.height || 1920,
    },
    displayDuration: body.displayDuration || 'PT5S',
    overlays: body.overlays || undefined,
  };
  const attachmentsJson = JSON.stringify(storyData);

  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, attachments_json, end_time, published, is_local)
    VALUES (?, 'Story', ?, '', ?, ?, ?, 1)
  `).bind(apId, actor.ap_id, attachmentsJson, endTime, now).run();

  // Update post count
  await c.env.DB.prepare('UPDATE actors SET post_count = post_count + 1 WHERE ap_id = ?')
    .bind(actor.ap_id).run();

  // Transform for response
  const responseData = transformStoryData(attachmentsJson);

  const story = {
    ap_id: apId,
    author: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
      preferred_username: actor.preferred_username,
      name: actor.name,
      icon_url: actor.icon_url,
    },
    attachment: responseData.attachment,
    displayDuration: responseData.displayDuration,
    overlays: responseData.overlays,
    end_time: endTime,
    published: now,
    viewed: false,
    like_count: 0,
    liked: false,
  };

  // Send Create(Story) activity to followers (async, don't block response)
  sendCreateStoryActivity(
    {
      ap_id: apId,
      attributed_to: actor.ap_id,
      attachment: responseData.attachment,
      displayDuration: responseData.displayDuration,
      overlays: responseData.overlays,
      end_time: endTime,
      published: now,
    },
    actor,
    c.env
  ).catch(console.error);

  return c.json({ story }, 201);
});

// Delete story
stories.post('/delete', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  const apId = body.ap_id;

  // Verify ownership
  const story = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ?')
    .bind(apId).first<APObject>();

  if (!story) return c.json({ error: 'Story not found' }, 404);
  if (story.attributed_to !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Send Delete(Story) activity to followers before deleting (async, don't block response)
  sendDeleteStoryActivity(apId, actor, c.env).catch(console.error);

  // Delete story votes first
  await c.env.DB.prepare('DELETE FROM story_votes WHERE story_ap_id = ?')
    .bind(apId).run();

  // Delete story likes
  await c.env.DB.prepare('DELETE FROM likes WHERE object_ap_id = ?')
    .bind(apId).run();

  // Delete story views
  await c.env.DB.prepare('DELETE FROM story_views WHERE story_ap_id = ?')
    .bind(apId).run();

  // Delete story
  await c.env.DB.prepare('DELETE FROM objects WHERE ap_id = ?')
    .bind(apId).run();

  // Update post count
  await c.env.DB.prepare('UPDATE actors SET post_count = post_count - 1 WHERE ap_id = ? AND post_count > 0')
    .bind(actor.ap_id).run();

  return c.json({ success: true });
});

// Mark story as viewed
stories.post('/view', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  const apId = body.ap_id;

  // Check if story exists
  const story = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? AND type = ?')
    .bind(apId, 'Story').first<APObject>();

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Check if already viewed
  const existing = await c.env.DB.prepare(
    'SELECT * FROM story_views WHERE story_ap_id = ? AND actor_ap_id = ?'
  ).bind(apId, actor.ap_id).first();

  if (existing) return c.json({ success: true });

  // Insert view record
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO story_views (actor_ap_id, story_ap_id, viewed_at)
    VALUES (?, ?, ?)
  `).bind(actor.ap_id, apId, now).run();

  return c.json({ success: true });
});

// Vote on a story poll
stories.post('/vote', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string; option_index: number }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  const apId = body.ap_id;

  if (typeof body.option_index !== 'number' || body.option_index < 0) {
    return c.json({ error: 'Invalid option_index' }, 400);
  }

  // Check if story exists
  const story = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? AND type = ?')
    .bind(apId, 'Story').first<APObject>();

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Check if user is trying to vote on their own story
  if (story.attributed_to === actor.ap_id) {
    return c.json({ error: 'Cannot vote on your own story' }, 403);
  }

  // Check if story is still active (not expired)
  const now = new Date().toISOString();
  if (story.end_time && story.end_time < now) {
    return c.json({ error: 'Story has expired' }, 410); // 410 Gone
  }

  // Get story data and validate option_index range
  const storyData = JSON.parse(story.attachments_json || '{}');
  const questionOverlays = (storyData.overlays || []).filter((o: any) => o.type === 'Question');

  if (questionOverlays.length === 0) {
    return c.json({ error: 'Story has no poll' }, 400);
  }

  // Check option_index against the first Question overlay's options
  const maxOptionIndex = questionOverlays[0].oneOf?.length || 0;
  if (body.option_index >= maxOptionIndex) {
    return c.json({ error: `option_index must be 0-${maxOptionIndex - 1}` }, 400);
  }

  // Check if user already voted
  const existingVote = await c.env.DB.prepare(
    'SELECT * FROM story_votes WHERE story_ap_id = ? AND actor_ap_id = ?'
  ).bind(apId, actor.ap_id).first();

  if (existingVote) {
    // Update existing vote
    await c.env.DB.prepare(
      'UPDATE story_votes SET option_index = ?, created_at = ? WHERE story_ap_id = ? AND actor_ap_id = ?'
    ).bind(body.option_index, now, apId, actor.ap_id).run();
  } else {
    // Insert new vote
    const voteId = generateId();
    await c.env.DB.prepare(`
      INSERT INTO story_votes (id, story_ap_id, actor_ap_id, option_index, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).bind(voteId, apId, actor.ap_id, body.option_index, now).run();
  }

  // Get updated vote counts
  const votes = await getVoteCounts(c.env.DB, apId);
  const total = Object.values(votes).reduce((sum: number, count: number) => sum + count, 0);

  return c.json({ success: true, votes, total, user_vote: body.option_index });
});

// Like a story
stories.post('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith('http') ? storyId : objectApId(baseUrl, storyId);

  const story = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? AND type = ?')
    .bind(apId, 'Story').first<APObject>();

  if (!story) return c.json({ error: 'Story not found' }, 404);

  const existing = await c.env.DB.prepare(
    'SELECT * FROM likes WHERE object_ap_id = ? AND actor_ap_id = ?'
  ).bind(apId, actor.ap_id).first();

  if (existing) {
    return c.json({ success: true, liked: true, like_count: story.like_count });
  }

  const likeId = generateId();
  const likeActivityApId = activityApId(baseUrl, likeId);
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO likes (object_ap_id, actor_ap_id, activity_ap_id)
    VALUES (?, ?, ?)
  `).bind(apId, actor.ap_id, likeActivityApId).run();

  await c.env.DB.prepare('UPDATE objects SET like_count = like_count + 1 WHERE ap_id = ?')
    .bind(apId).run();

  const likeActivityRaw = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: likeActivityApId,
    type: 'Like',
    actor: actor.ap_id,
    object: apId,
  };

  await c.env.DB.prepare(`
    INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, published, local)
    VALUES (?, 'Like', ?, ?, ?, ?, 1)
  `).bind(likeActivityApId, actor.ap_id, apId, JSON.stringify(likeActivityRaw), now).run();

  if (story.attributed_to !== actor.ap_id && isLocal(story.attributed_to, baseUrl)) {
    await c.env.DB.prepare(`
      INSERT INTO inbox (actor_ap_id, activity_ap_id, read, created_at)
      VALUES (?, ?, 0, ?)
    `).bind(story.attributed_to, likeActivityApId, now).run();
  }

  if (!isLocal(apId, baseUrl)) {
    try {
      const postAuthor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?')
        .bind(story.attributed_to).first<any>();
      if (postAuthor?.inbox) {
        const keyId = `${actor.ap_id}#main-key`;
        const headers = await signRequest(actor.private_key_pem, keyId, 'POST', postAuthor.inbox, JSON.stringify(likeActivityRaw));

        await fetch(postAuthor.inbox, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/activity+json' },
          body: JSON.stringify(likeActivityRaw),
        });
      }
    } catch (e) {
      console.error('Failed to send Like activity for story:', e);
    }
  }

  return c.json({ success: true, liked: true, like_count: story.like_count + 1 });
});

// Unlike a story
stories.delete('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith('http') ? storyId : objectApId(baseUrl, storyId);

  const story = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? AND type = ?')
    .bind(apId, 'Story').first<APObject>();

  if (!story) return c.json({ error: 'Story not found' }, 404);

  const like = await c.env.DB.prepare(
    'SELECT * FROM likes WHERE object_ap_id = ? AND actor_ap_id = ?'
  ).bind(apId, actor.ap_id).first<any>();

  if (!like) return c.json({ error: 'Not liked' }, 400);

  await c.env.DB.prepare('DELETE FROM likes WHERE object_ap_id = ? AND actor_ap_id = ?')
    .bind(apId, actor.ap_id).run();

  await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0')
    .bind(apId).run();

  if (!isLocal(apId, baseUrl)) {
    try {
      const postAuthor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?')
        .bind(story.attributed_to).first<any>();
      if (postAuthor?.inbox) {
        const undoObject = like.activity_ap_id
          ? like.activity_ap_id
          : {
            type: 'Like',
            actor: actor.ap_id,
            object: apId,
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

        await c.env.DB.prepare(`
          INSERT INTO activities (ap_id, type, actor_ap_id, object_ap_id, raw_json, direction)
          VALUES (?, 'Undo', ?, ?, ?, 'outbound')
        `).bind(undoLikeActivity.id, actor.ap_id, apId, JSON.stringify(undoLikeActivity)).run();
      }
    } catch (e) {
      console.error('Failed to send Undo Like for story:', e);
    }
  }

  return c.json({ success: true, liked: false, like_count: Math.max(0, story.like_count - 1) });
});

// Share a story (track that user shared it)
stories.post('/:id/share', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith('http') ? storyId : objectApId(baseUrl, storyId);

  const story = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? AND type = ?')
    .bind(apId, 'Story').first<APObject>();

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Check if already shared
  const existing = await c.env.DB.prepare(
    'SELECT * FROM story_shares WHERE story_ap_id = ? AND actor_ap_id = ?'
  ).bind(apId, actor.ap_id).first();

  if (existing) {
    return c.json({ success: true, shared: true, share_count: story.share_count || 0 });
  }

  const shareId = generateId();
  const now = new Date().toISOString();

  await c.env.DB.prepare(`
    INSERT INTO story_shares (id, story_ap_id, actor_ap_id, shared_at)
    VALUES (?, ?, ?, ?)
  `).bind(shareId, apId, actor.ap_id, now).run();

  await c.env.DB.prepare('UPDATE objects SET share_count = COALESCE(share_count, 0) + 1 WHERE ap_id = ?')
    .bind(apId).run();

  return c.json({ success: true, shared: true, share_count: (story.share_count || 0) + 1 });
});

// Get share count for a story
stories.get('/:id/shares', async (c) => {
  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith('http') ? storyId : objectApId(baseUrl, storyId);

  const story = await c.env.DB.prepare('SELECT share_count FROM objects WHERE ap_id = ? AND type = ?')
    .bind(apId, 'Story').first<any>();

  if (!story) return c.json({ error: 'Story not found' }, 404);

  return c.json({ share_count: story.share_count || 0 });
});

// Get votes for a story
stories.get('/:id/votes', async (c) => {
  const storyId = c.req.param('id');
  const actor = c.get('actor');
  const baseUrl = c.env.APP_URL;
  const apId = objectApId(baseUrl, storyId);

  // Check if story exists
  const story = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ? AND type = ?')
    .bind(apId, 'Story').first<APObject>();

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Get vote counts
  const votes = await getVoteCounts(c.env.DB, apId);
  const total = Object.values(votes).reduce((sum, count) => sum + count, 0);

  // Get user's vote if authenticated
  let user_vote: number | undefined;
  if (actor) {
    const userVote = await c.env.DB.prepare(
      'SELECT option_index FROM story_votes WHERE story_ap_id = ? AND actor_ap_id = ?'
    ).bind(apId, actor.ap_id).first<{ option_index: number }>();
    if (userVote) {
      user_vote = userVote.option_index;
    }
  }

  return c.json({ votes, total, user_vote });
});

export default stories;
