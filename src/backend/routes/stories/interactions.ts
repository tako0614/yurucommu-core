import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
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

// Mark story as viewed
stories.post('/view', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  const apId = body.ap_id;

  // Check if story exists
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: 'Story',
    },
  });

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Check if already viewed - use upsert to handle race conditions
  const now = new Date().toISOString();

  try {
    await prisma.storyView.upsert({
      where: {
        actorApId_storyApId: {
          actorApId: actor.ap_id,
          storyApId: apId,
        },
      },
      update: {}, // No update needed if it already exists
      create: {
        actorApId: actor.ap_id,
        storyApId: apId,
        viewedAt: now,
      },
    });
  } catch (e) {
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

  // Check if story exists
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: 'Story',
    },
  });

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Check if user is trying to vote on their own story
  if (story.attributedTo === actor.ap_id) {
    return c.json({ error: 'Cannot vote on your own story' }, 403);
  }

  // Check if story is still active (not expired)
  const now = new Date().toISOString();
  if (story.endTime && story.endTime < now) {
    return c.json({ error: 'Story has expired' }, 410); // 410 Gone
  }

  // Get story data and validate option_index range
  const storyData = JSON.parse(story.attachmentsJson || '{}') as StoryData;
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
  const existingVote = await prisma.storyVote.findFirst({
    where: {
      storyApId: apId,
      actorApId: actor.ap_id,
    },
  });

  if (existingVote) {
    // Update existing vote
    await prisma.storyVote.update({
      where: { id: existingVote.id },
      data: {
        optionIndex: body.option_index,
        createdAt: now,
      },
    });
  } else {
    // Insert new vote
    const voteId = generateId();
    await prisma.storyVote.create({
      data: {
        id: voteId,
        storyApId: apId,
        actorApId: actor.ap_id,
        optionIndex: body.option_index,
        createdAt: now,
      },
    });
  }

  // Get updated vote counts
  const votes = await getVoteCounts(prisma, apId);
  const total = Object.values(votes).reduce((sum: number, count: number) => sum + count, 0);

  return c.json({ success: true, votes, total, user_vote: body.option_index });
});

// Like a story
stories.post('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith('http') ? storyId : objectApId(baseUrl, storyId);

  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: 'Story',
    },
  });

  if (!story) return c.json({ error: 'Story not found' }, 404);

  const existing = await prisma.like.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: apId,
      },
    },
  });

  if (existing) {
    return c.json({ success: true, liked: true, like_count: story.likeCount });
  }

  const likeId = generateId();
  const likeActivityApId = activityApId(baseUrl, likeId);
  const now = new Date().toISOString();

  await prisma.like.create({
    data: {
      actorApId: actor.ap_id,
      objectApId: apId,
      activityApId: likeActivityApId,
      createdAt: now,
    },
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
      const postAuthor = await prisma.actorCache.findUnique({
        where: { apId: story.attributedTo },
        select: { inbox: true },
      });
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

  return c.json({ success: true, liked: true, like_count: story.likeCount + 1 });
});

// Unlike a story
stories.delete('/:id/like', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith('http') ? storyId : objectApId(baseUrl, storyId);

  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: 'Story',
    },
  });

  if (!story) return c.json({ error: 'Story not found' }, 404);

  const like = await prisma.like.findUnique({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: apId,
      },
    },
  });

  if (!like) return c.json({ error: 'Not liked' }, 400);

  await prisma.like.delete({
    where: {
      actorApId_objectApId: {
        actorApId: actor.ap_id,
        objectApId: apId,
      },
    },
  });

  await prisma.object.update({
    where: { apId },
    data: {
      likeCount: { decrement: 1 },
    },
  });

  if (!isLocal(apId, baseUrl)) {
    try {
      const postAuthor = await prisma.actorCache.findUnique({
        where: { apId: story.attributedTo },
        select: { inbox: true },
      });
      if (postAuthor?.inbox) {
        if (!isSafeRemoteUrl(postAuthor.inbox)) {
          console.warn(`[Stories] Blocked unsafe inbox URL: ${postAuthor.inbox}`);
          return c.json({ success: true, liked: false });
        }
        const undoObject = like.activityApId
          ? like.activityApId
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

        await prisma.activity.create({
          data: {
            apId: undoLikeActivity.id,
            type: 'Undo',
            actorApId: actor.ap_id,
            objectApId: apId,
            rawJson: JSON.stringify(undoLikeActivity),
            direction: 'outbound',
          },
        });
      }
    } catch (e) {
      console.error('Failed to send Undo Like for story:', e);
    }
  }

  return c.json({ success: true, liked: false, like_count: Math.max(0, story.likeCount - 1) });
});

// Share a story (track that user shared it)
stories.post('/:id/share', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith('http') ? storyId : objectApId(baseUrl, storyId);

  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: 'Story',
    },
  });

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Check if already shared
  const existing = await prisma.storyShare.findFirst({
    where: {
      storyApId: apId,
      actorApId: actor.ap_id,
    },
  });

  if (existing) {
    return c.json({ success: true, shared: true, share_count: story.shareCount || 0 });
  }

  const shareId = generateId();
  const now = new Date().toISOString();

  await prisma.storyShare.create({
    data: {
      id: shareId,
      storyApId: apId,
      actorApId: actor.ap_id,
      sharedAt: now,
    },
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
  const storyId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const apId = storyId.startsWith('http') ? storyId : objectApId(baseUrl, storyId);

  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: 'Story',
    },
    select: {
      shareCount: true,
    },
  });

  if (!story) return c.json({ error: 'Story not found' }, 404);

  return c.json({ share_count: story.shareCount || 0 });
});

// Get votes for a story
stories.get('/:id/votes', async (c) => {
  const prisma = c.get('prisma');
  const storyId = c.req.param('id');
  const actor = c.get('actor');
  const baseUrl = c.env.APP_URL;
  const apId = objectApId(baseUrl, storyId);

  // Check if story exists
  const story = await prisma.object.findFirst({
    where: {
      apId,
      type: 'Story',
    },
  });

  if (!story) return c.json({ error: 'Story not found' }, 404);

  // Get vote counts
  const votes = await getVoteCounts(prisma, apId);
  const total = Object.values(votes).reduce((sum, count) => sum + count, 0);

  // Get user's vote if authenticated
  let user_vote: number | undefined;
  if (actor) {
    const userVote = await prisma.storyVote.findFirst({
      where: {
        storyApId: apId,
        actorApId: actor.ap_id,
      },
      select: {
        optionIndex: true,
      },
    });
    if (userVote) {
      user_vote = userVote.optionIndex;
    }
  }

  return c.json({ votes, total, user_vote });
});

export default stories;
