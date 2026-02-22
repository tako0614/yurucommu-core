import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, isLocal, safeJsonParse } from '../../utils';
import { findStory, resolveStoryApId, getVoteCounts, sumVotes } from './utils';
import { enqueueDeliveryToActor } from '../../lib/delivery/queue';

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

type StoryOverlay = {
  type?: string;
  oneOf?: unknown[];
};

type StoryData = {
  overlays?: StoryOverlay[];
};

// Mark story as viewed
stories.post('/view', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  const apId = body.ap_id;

  const story = await findStory(prisma, apId);
  if (!story) return c.json({ error: 'Story not found' }, 404);

  const now = new Date().toISOString();

  try {
    await prisma.storyView.upsert({
      where: {
        actorApId_storyApId: { actorApId: actor.ap_id, storyApId: apId },
      },
      update: {},
      create: { actorApId: actor.ap_id, storyApId: apId, viewedAt: now },
    });
  } catch {
    // Ignore duplicate key errors
  }

  return c.json({ success: true });
});

// Vote on a story poll
stories.post('/vote', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ ap_id: string; option_index: number }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  const apId = body.ap_id;

  if (typeof body.option_index !== 'number' || body.option_index < 0) {
    return c.json({ error: 'Invalid option_index' }, 400);
  }

  const story = await findStory(prisma, apId);
  if (!story) return c.json({ error: 'Story not found' }, 404);

  if (story.attributedTo === actor.ap_id) {
    return c.json({ error: 'Cannot vote on your own story' }, 403);
  }

  const now = new Date().toISOString();
  if (story.endTime && story.endTime < now) {
    return c.json({ error: 'Story has expired' }, 410);
  }

  // Validate option_index against the first Question overlay
  const storyData = safeJsonParse<StoryData>(story.attachmentsJson, {});
  const questionOverlays = (storyData.overlays || []).filter((o) => o.type === 'Question');

  if (questionOverlays.length === 0) {
    return c.json({ error: 'Story has no poll' }, 400);
  }

  const maxOptionIndex = questionOverlays[0].oneOf?.length || 0;
  if (body.option_index >= maxOptionIndex) {
    return c.json({ error: `option_index must be 0-${maxOptionIndex - 1}` }, 400);
  }

  // Upsert vote
  const existingVote = await prisma.storyVote.findFirst({
    where: { storyApId: apId, actorApId: actor.ap_id },
  });

  if (existingVote) {
    await prisma.storyVote.update({
      where: { id: existingVote.id },
      data: { optionIndex: body.option_index, createdAt: now },
    });
  } else {
    await prisma.storyVote.create({
      data: {
        id: generateId(),
        storyApId: apId,
        actorApId: actor.ap_id,
        optionIndex: body.option_index,
        createdAt: now,
      },
    });
  }

  const votes = await getVoteCounts(prisma, apId);
  return c.json({ success: true, votes, total: sumVotes(votes), user_vote: body.option_index });
});

// Like a story
stories.post('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = resolveStoryApId(c.req.param('id'), baseUrl);

  const story = await findStory(prisma, apId);
  if (!story) return c.json({ error: 'Story not found' }, 404);

  const existing = await prisma.like.findUnique({
    where: { actorApId_objectApId: { actorApId: actor.ap_id, objectApId: apId } },
  });
  if (existing) {
    return c.json({ success: true, liked: true, like_count: story.likeCount });
  }

  const likeId = generateId();
  const likeActivityApId = activityApId(baseUrl, likeId);
  const now = new Date().toISOString();

  await prisma.like.create({
    data: { actorApId: actor.ap_id, objectApId: apId, activityApId: likeActivityApId, createdAt: now },
  });

  await prisma.object.update({
    where: { apId },
    data: { likeCount: { increment: 1 } },
  });

  const likeActivityRaw = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: likeActivityApId,
    type: 'Like',
    actor: actor.ap_id,
    object: apId,
  };

  await prisma.activity.create({
    data: {
      apId: likeActivityApId,
      type: 'Like',
      actorApId: actor.ap_id,
      objectApId: apId,
      rawJson: JSON.stringify(likeActivityRaw),
      createdAt: now,
    },
  });

  if (story.attributedTo !== actor.ap_id && isLocal(story.attributedTo, baseUrl)) {
    await prisma.inbox.create({
      data: {
        actorApId: story.attributedTo,
        activityApId: likeActivityApId,
        read: 0,
        createdAt: now,
      },
    });
  }

  if (!isLocal(apId, baseUrl)) {
    try {
      await enqueueDeliveryToActor(c.env, likeActivityApId, story.attributedTo);
    } catch (e) {
      console.error('[Stories] Failed to enqueue Like activity for story:', e);
    }
  }

  return c.json({ success: true, liked: true, like_count: story.likeCount + 1 });
});

// Unlike a story
stories.delete('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = resolveStoryApId(c.req.param('id'), baseUrl);

  const story = await findStory(prisma, apId);
  if (!story) return c.json({ error: 'Story not found' }, 404);

  const like = await prisma.like.findUnique({
    where: { actorApId_objectApId: { actorApId: actor.ap_id, objectApId: apId } },
  });
  if (!like) return c.json({ error: 'Not liked' }, 400);

  await prisma.like.delete({
    where: { actorApId_objectApId: { actorApId: actor.ap_id, objectApId: apId } },
  });

  await prisma.object.update({
    where: { apId },
    data: { likeCount: { decrement: 1 } },
  });

  if (!isLocal(apId, baseUrl)) {
    const undoObject = like.activityApId
      ? like.activityApId
      : { type: 'Like', actor: actor.ap_id, object: apId };
    const undoLikeActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityApId(baseUrl, generateId()),
      type: 'Undo',
      actor: actor.ap_id,
      object: undoObject,
    };

    // Store activity first (queue consumer loads rawJson by activityId).
    await prisma.activity.upsert({
      where: { apId: undoLikeActivity.id },
      update: {},
      create: {
        apId: undoLikeActivity.id,
        type: 'Undo',
        actorApId: actor.ap_id,
        objectApId: apId,
        rawJson: JSON.stringify(undoLikeActivity),
        direction: 'outbound',
      },
    });

    try {
      await enqueueDeliveryToActor(c.env, undoLikeActivity.id, story.attributedTo);
    } catch (e) {
      console.error('[Stories] Failed to enqueue Undo Like for story:', e);
    }
  }

  return c.json({ success: true, liked: false, like_count: Math.max(0, story.likeCount - 1) });
});

// Share a story (track that user shared it)
stories.post('/:id/share', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = resolveStoryApId(c.req.param('id'), baseUrl);

  const story = await findStory(prisma, apId);
  if (!story) return c.json({ error: 'Story not found' }, 404);

  const existing = await prisma.storyShare.findFirst({
    where: { storyApId: apId, actorApId: actor.ap_id },
  });
  if (existing) {
    return c.json({ success: true, shared: true, share_count: story.shareCount || 0 });
  }

  const now = new Date().toISOString();

  await prisma.storyShare.create({
    data: { id: generateId(), storyApId: apId, actorApId: actor.ap_id, sharedAt: now },
  });

  await prisma.object.update({
    where: { apId },
    data: { shareCount: { increment: 1 } },
  });

  return c.json({ success: true, shared: true, share_count: (story.shareCount || 0) + 1 });
});

// Get share count for a story
stories.get('/:id/shares', async (c) => {
  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const apId = resolveStoryApId(c.req.param('id'), baseUrl);

  const story = await prisma.object.findFirst({
    where: { apId, type: 'Story' },
    select: { shareCount: true },
  });
  if (!story) return c.json({ error: 'Story not found' }, 404);

  return c.json({ share_count: story.shareCount || 0 });
});

// Get votes for a story
stories.get('/:id/votes', async (c) => {
  const prisma = c.get('prisma');
  const actor = c.get('actor');
  const baseUrl = c.env.APP_URL;
  const apId = objectApId(baseUrl, c.req.param('id'));

  const story = await findStory(prisma, apId);
  if (!story) return c.json({ error: 'Story not found' }, 404);

  const votes = await getVoteCounts(prisma, apId);

  let user_vote: number | undefined;
  if (actor) {
    const userVote = await prisma.storyVote.findFirst({
      where: { storyApId: apId, actorApId: actor.ap_id },
      select: { optionIndex: true },
    });
    if (userVote) user_vote = userVote.optionIndex;
  }

  return c.json({ votes, total: sumVotes(votes), user_vote });
});

export default stories;
