// Story routes for Yurucommu backend
import { Hono } from 'hono';
import type { Env, Variables, APObject } from '../types';
import { generateId, objectApId, actorApId, formatUsername } from '../utils';

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

// Helper to transform stored frames to StoryFrame format
function transformFrames(framesJson: string): any[] {
  const frames = JSON.parse(framesJson || '[]');
  return frames.map((f: any) => {
    // If already in proper format, return as-is
    if (f.type === 'StoryFrame' && f.attachment?.url) {
      return f;
    }

    // Transform from stored format { attachment: { r2_key, content_type }, displayDuration, content }
    const r2Key = f.attachment?.r2_key || f.r2_key;
    const contentType = f.attachment?.content_type || f.content_type || 'image/jpeg';

    // Generate URL from r2_key (e.g., "uploads/abc123.jpg" -> "/media/abc123.jpg")
    const url = r2Key ? `/media/${r2Key.replace('uploads/', '')}` : '';

    return {
      type: 'StoryFrame',
      displayDuration: f.displayDuration || 'PT5S',
      attachment: {
        type: 'Document',
        mediaType: contentType,
        url,
        r2_key: r2Key,
      },
      content: f.content || null,
    };
  });
}

// Get active stories from followed users and self (grouped by author)
stories.get('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const baseUrl = c.env.APP_URL;
  const now = new Date().toISOString();

  // Get stories from followed users and self, ordered by end_time (unviewed first)
  const stories_data = await c.env.DB.prepare(`
    SELECT o.*,
           COALESCE(a.preferred_username, ac.preferred_username) as author_username,
           COALESCE(a.name, ac.name) as author_name,
           COALESCE(a.icon_url, ac.icon_url) as author_icon_url,
           CASE WHEN sv.story_ap_id IS NOT NULL THEN 1 ELSE 0 END as viewed
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    LEFT JOIN story_views sv ON o.ap_id = sv.story_ap_id AND sv.actor_ap_id = ?
    WHERE o.type = 'Story'
      AND o.end_time > ?
      AND (o.attributed_to IN (
        SELECT following_ap_id FROM follows WHERE follower_ap_id = ? AND status = 'accepted'
      ) OR o.attributed_to = ?)
    ORDER BY viewed ASC, o.end_time DESC
  `).bind(actor.ap_id, now, actor.ap_id, actor.ap_id).all();

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

    grouped[authorApId].stories.push({
      ap_id: s.ap_id,
      author: authorInfo,
      frames: transformFrames(s.attachments_json),
      end_time: s.end_time,
      published: s.published,
      viewed: isViewed,
    });
  });

  const result = authorOrder.map(apId => grouped[apId]);

  return c.json({ actor_stories: result });
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
           CASE WHEN sv.story_ap_id IS NOT NULL THEN 1 ELSE 0 END as viewed
    FROM objects o
    LEFT JOIN actors a ON o.attributed_to = a.ap_id
    LEFT JOIN actor_cache ac ON o.attributed_to = ac.ap_id
    LEFT JOIN story_views sv ON o.ap_id = sv.story_ap_id AND sv.actor_ap_id = ?
    WHERE o.type = 'Story'
      AND o.attributed_to = ?
      AND o.end_time > ?
    ORDER BY o.published DESC
  `).bind(actor?.ap_id || '', targetApId, now).all();

  const result = (user_stories.results || []).map((s: any) => ({
    ap_id: s.ap_id,
    author: {
      ap_id: s.attributed_to,
      username: formatUsername(s.attributed_to),
      preferred_username: s.author_username,
      name: s.author_name,
      icon_url: s.author_icon_url,
    },
    frames: transformFrames(s.attachments_json),
    end_time: s.end_time,
    published: s.published,
    viewed: !!s.viewed,
  }));

  return c.json({ stories: result });
});

// Create story
stories.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ frames: any[] }>();
  if (!body.frames || !Array.isArray(body.frames)) {
    return c.json({ error: 'frames array required' }, 400);
  }

  const baseUrl = c.env.APP_URL;
  const id = generateId();
  const apId = objectApId(baseUrl, id);
  const now = new Date().toISOString();

  // Set expiration to 24 hours from now
  const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const attachmentsJson = JSON.stringify(body.frames);

  await c.env.DB.prepare(`
    INSERT INTO objects (ap_id, type, attributed_to, content, attachments_json, end_time, published, is_local)
    VALUES (?, 'Story', ?, '', ?, ?, ?, 1)
  `).bind(apId, actor.ap_id, attachmentsJson, endTime, now).run();

  // Update post count
  await c.env.DB.prepare('UPDATE actors SET post_count = post_count + 1 WHERE ap_id = ?')
    .bind(actor.ap_id).run();

  const story = {
    ap_id: apId,
    author: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
      preferred_username: actor.preferred_username,
      name: actor.name,
      icon_url: actor.icon_url,
    },
    frames: transformFrames(attachmentsJson),
    end_time: endTime,
    published: now,
    viewed: false,
  };

  return c.json({ story }, 201);
});

// Delete story
stories.delete('/:id', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = objectApId(baseUrl, storyId);

  // Verify ownership
  const story = await c.env.DB.prepare('SELECT * FROM objects WHERE ap_id = ?')
    .bind(apId).first<APObject>();

  if (!story) return c.json({ error: 'Story not found' }, 404);
  if (story.attributed_to !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Delete story views first
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
stories.post('/:id/view', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = objectApId(baseUrl, storyId);

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

export default stories;
