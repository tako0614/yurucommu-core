import { Hono } from 'hono';
import type { Env, Variables, APObject } from '../../types';
import { generateId, objectApId, activityApId, isLocal, signRequest, isSafeRemoteUrl } from '../../utils';
import { getVoteCounts } from './utils';

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

type StoryOverlay = {
  type?: string;
  oneOf?: unknown[];
};

type StoryData = {
  overlays?: StoryOverlay[];
};

type ActorCacheInboxRow = {
  inbox: string | null;
};

type LikeRow = {
  activity_ap_id: string | null;
};

type StoryShareCountRow = {
  share_count: number | null;
};

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
  const storyData = JSON.parse(story.attachments_json || '{}') as StoryData;
  const questionOverlays = (storyData.overlays || []).filter((o: StoryOverlay) => o.type === 'Question');

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
        .bind(story.attributed_to).first<ActorCacheInboxRow>();
      if (postAuthor?.inbox) {
        if (!isSafeRemoteUrl(postAuthor.inbox)) {
          console.warn(`[Stories] Blocked unsafe inbox URL: ${postAuthor.inbox}`);
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
  ).bind(apId, actor.ap_id).first<LikeRow>();

  if (!like) return c.json({ error: 'Not liked' }, 400);

  await c.env.DB.prepare('DELETE FROM likes WHERE object_ap_id = ? AND actor_ap_id = ?')
    .bind(apId, actor.ap_id).run();

  await c.env.DB.prepare('UPDATE objects SET like_count = like_count - 1 WHERE ap_id = ? AND like_count > 0')
    .bind(apId).run();

  if (!isLocal(apId, baseUrl)) {
    try {
      const postAuthor = await c.env.DB.prepare('SELECT inbox FROM actor_cache WHERE ap_id = ?')
        .bind(story.attributed_to).first<ActorCacheInboxRow>();
      if (postAuthor?.inbox) {
        if (!isSafeRemoteUrl(postAuthor.inbox)) {
          console.warn(`[Stories] Blocked unsafe inbox URL: ${postAuthor.inbox}`);
          return c.json({ success: true, liked: false });
        }
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
    .bind(apId, 'Story').first<StoryShareCountRow>();

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
