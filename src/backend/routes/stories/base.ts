// Story routes for Yurucommu backend
// v2: 1 Story = 1 Media (Instagram style)
import { Hono } from 'hono';
import type { Env, Variables, APObject } from '../../types';
import { generateId, objectApId, actorApId, formatUsername, activityApId, isLocal, signRequest, isSafeRemoteUrl } from '../../utils';
import { sendCreateStoryActivity, sendDeleteStoryActivity } from '../../lib/activitypub-helpers';
import { cleanupExpiredStories, transformStoryData, validateOverlays } from './utils';

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

type VoteResults = Record<number, number>;

type StoryAuthor = {
  ap_id: string;
  username: string;
  preferred_username: string | null;
  name: string | null;
  icon_url: string | null;
};

type StoryRow = {
  ap_id: string;
  attributed_to: string;
  attachments_json: string;
  end_time: string;
  published: string;
  like_count: number;
  share_count?: number | null;
  author_username: string | null;
  author_name: string | null;
  author_icon_url: string | null;
  viewed: number;
  liked: number;
};

type VoteRow = {
  story_ap_id: string;
  option_index: number;
  count: number;
};

type UserVoteRow = {
  story_ap_id: string;
  option_index: number;
};

type StoryResponse = {
  ap_id: string;
  author: StoryAuthor;
  attachment: ReturnType<typeof transformStoryData>['attachment'];
  displayDuration: string;
  overlays?: ReturnType<typeof transformStoryData>['overlays'];
  end_time: string;
  published: string;
  viewed: boolean;
  like_count: number;
  share_count: number;
  liked: boolean;
  votes?: VoteResults;
  votes_total?: number;
  user_vote?: number;
};

type StoryCreateBody = {
  attachment: {
    r2_key: string;
    content_type: string;
    width?: number;
    height?: number;
  };
  displayDuration: string;
  overlays?: unknown[];
};

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
    ).all<StoryRow>();

  // Get all story ap_ids for batch vote query
  const storyApIds = (stories_data.results || []).map((s: StoryRow) => s.ap_id);

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
    `).bind(...storyApIds).all<VoteRow>();

    (votesQuery.results || []).forEach((v: VoteRow) => {
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
    `).bind(...storyApIds, actor.ap_id).all<UserVoteRow>();

    (userVotesQuery.results || []).forEach((v: UserVoteRow) => {
      userVotes[v.story_ap_id] = v.option_index;
    });
  }

  // Group by author
  const grouped: Record<string, { actor: StoryAuthor; stories: StoryResponse[]; has_unviewed: boolean }> = {};
  const authorOrder: string[] = [];

  (stories_data.results || []).forEach((s: StoryRow) => {
    const authorApId = s.attributed_to;
    const authorInfo: StoryAuthor = {
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
    ).all<StoryRow>();

  // Get all story ap_ids for batch vote query
  const storyApIds = (user_stories.results || []).map((s: StoryRow) => s.ap_id);

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
    `).bind(...storyApIds).all<VoteRow>();

    (votesQuery.results || []).forEach((v: VoteRow) => {
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
      `).bind(...storyApIds, actor.ap_id).all<UserVoteRow>();

      (userVotesQuery.results || []).forEach((v: UserVoteRow) => {
        userVotes[v.story_ap_id] = v.option_index;
      });
    }
  }

  const result = (user_stories.results || []).map((s: StoryRow) => {
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

  const body = await c.req.json<StoryCreateBody>();

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


export default stories;
