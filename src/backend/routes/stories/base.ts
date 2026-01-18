// Story routes for Yurucommu backend
// v2: 1 Story = 1 Media (Instagram style)
import { Hono } from 'hono';
import type { Env, Variables, APObject } from '../../types';
import { generateId, objectApId, actorApId, formatUsername, activityApId, isLocal, signRequest, isSafeRemoteUrl } from '../../utils';
import { sendCreateStoryActivity, sendDeleteStoryActivity } from '../../lib/activitypub-helpers';
import { cleanupExpiredStories, transformStoryData, validateOverlays } from './utils';
import type { PrismaClient } from '../../../generated/prisma';

const stories = new Hono<{ Bindings: Env; Variables: Variables }>();

type VoteResults = Record<number, number>;

type StoryAuthor = {
  ap_id: string;
  username: string;
  preferred_username: string | null;
  name: string | null;
  icon_url: string | null;
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

  const prisma = c.get('prisma');
  const baseUrl = c.env.APP_URL;
  const now = new Date().toISOString();

  // Probabilistic cleanup: 1% chance to run cleanup on each request
  if (Math.random() < 0.01) {
    // Run cleanup in background (don't await)
    cleanupExpiredStories(prisma).catch(() => {});
  }

  // Get followed user IDs
  const follows = await prisma.follow.findMany({
    where: {
      followerApId: actor.ap_id,
      status: 'accepted',
    },
    select: {
      followingApId: true,
    },
  });
  const followedIds = follows.map(f => f.followingApId);
  followedIds.push(actor.ap_id); // Include self

  // Get blocked and muted user IDs
  const blocks = await prisma.block.findMany({
    where: {
      blockerApId: actor.ap_id,
    },
    select: {
      blockedApId: true,
    },
  });
  const blockedIds = blocks.map(b => b.blockedApId);

  const mutes = await prisma.mute.findMany({
    where: {
      muterApId: actor.ap_id,
    },
    select: {
      mutedApId: true,
    },
  });
  const mutedIds = mutes.map(m => m.mutedApId);

  // Get stories from followed users (excluding blocked/muted)
  const storiesData = await prisma.object.findMany({
    where: {
      type: 'Story',
      endTime: { gt: now },
      attributedTo: {
        in: followedIds,
        notIn: [...blockedIds, ...mutedIds],
      },
    },
    include: {
      author: {
        select: {
          apId: true,
          preferredUsername: true,
          name: true,
          iconUrl: true,
        },
      },
      storyViews: {
        where: { actorApId: actor.ap_id },
        select: { actorApId: true },
      },
      likes: {
        where: { actorApId: actor.ap_id },
        select: { actorApId: true },
      },
    },
    orderBy: [
      { endTime: 'desc' },
    ],
  });

  // Get all story ap_ids for batch vote query
  const storyApIds = storiesData.map(s => s.apId);

  // Batch query for all votes
  let allVotes: Record<string, VoteResults> = {};
  let userVotes: Record<string, number> = {};

  if (storyApIds.length > 0) {
    // Get vote counts grouped by story and option
    const votes = await prisma.storyVote.groupBy({
      by: ['storyApId', 'optionIndex'],
      where: {
        storyApId: { in: storyApIds },
      },
      _count: {
        id: true,
      },
    });

    votes.forEach(v => {
      if (!allVotes[v.storyApId]) {
        allVotes[v.storyApId] = {};
      }
      allVotes[v.storyApId][v.optionIndex] = v._count.id;
    });

    // Get user's own votes
    const userVotesData = await prisma.storyVote.findMany({
      where: {
        storyApId: { in: storyApIds },
        actorApId: actor.ap_id,
      },
      select: {
        storyApId: true,
        optionIndex: true,
      },
    });

    userVotesData.forEach(v => {
      userVotes[v.storyApId] = v.optionIndex;
    });
  }

  // Try to get author info from actor_cache for remote authors
  const remoteAuthorIds = [...new Set(storiesData.filter(s => !s.author).map(s => s.attributedTo))];
  let actorCacheMap: Record<string, { preferredUsername: string | null; name: string | null; iconUrl: string | null }> = {};

  if (remoteAuthorIds.length > 0) {
    const cachedActors = await prisma.actorCache.findMany({
      where: { apId: { in: remoteAuthorIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    });
    cachedActors.forEach(a => {
      actorCacheMap[a.apId] = { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl };
    });
  }

  // Group by author
  const grouped: Record<string, { actor: StoryAuthor; stories: StoryResponse[]; has_unviewed: boolean }> = {};
  const authorOrder: string[] = [];

  storiesData.forEach(s => {
    const authorApId = s.attributedTo;
    const authorData = s.author || actorCacheMap[authorApId];
    const authorInfo: StoryAuthor = {
      ap_id: authorApId,
      username: formatUsername(authorApId),
      preferred_username: authorData?.preferredUsername || null,
      name: authorData?.name || null,
      icon_url: authorData?.iconUrl || null,
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

    const isViewed = s.storyViews.length > 0;
    if (!isViewed) {
      grouped[authorApId].has_unviewed = true;
    }

    // Transform to new format
    const storyData = transformStoryData(s.attachmentsJson);

    // Calculate vote totals
    const storyVotes = allVotes[s.apId] || {};
    const total = Object.values(storyVotes).reduce((sum: number, count: number) => sum + count, 0);

    grouped[authorApId].stories.push({
      ap_id: s.apId,
      author: authorInfo,
      attachment: storyData.attachment,
      displayDuration: storyData.displayDuration,
      overlays: storyData.overlays,
      end_time: s.endTime || '',
      published: s.published,
      viewed: isViewed,
      like_count: s.likeCount,
      share_count: s.shareCount || 0,
      liked: s.likes.length > 0,
      votes: storyVotes,
      votes_total: total,
      user_vote: userVotes[s.apId],
    });
  });

  // Sort stories within each group: unviewed first, then by end_time desc
  Object.keys(grouped).forEach(authorApId => {
    grouped[authorApId].stories.sort((a, b) => {
      // Unviewed first
      if (!a.viewed && b.viewed) return -1;
      if (a.viewed && !b.viewed) return 1;
      // Then by end_time desc
      return b.end_time.localeCompare(a.end_time);
    });
  });

  // Sort author groups: those with unviewed stories first
  authorOrder.sort((a, b) => {
    // Self always first
    if (a === actor.ap_id) return -1;
    if (b === actor.ap_id) return 1;
    // Then unviewed first
    if (grouped[a].has_unviewed && !grouped[b].has_unviewed) return -1;
    if (!grouped[a].has_unviewed && grouped[b].has_unviewed) return 1;
    return 0;
  });

  const result = authorOrder.map(apId => grouped[apId]);

  return c.json({ actor_stories: result });
});

// Cleanup expired stories (admin/scheduled endpoint)
// Must be defined before /:actorId to avoid route conflict
stories.post('/cleanup', async (c) => {
  const prisma = c.get('prisma');
  const deleted = await cleanupExpiredStories(prisma);
  return c.json({ deleted });
});

// Get stories for a specific user
stories.get('/:actorId', async (c) => {
  const targetActorId = c.req.param('actorId');
  const actor = c.get('actor');
  const prisma = c.get('prisma');

  const baseUrl = c.env.APP_URL;
  const now = new Date().toISOString();

  // Find the actor by username or full ap_id
  let targetApId = targetActorId;
  if (!targetActorId.startsWith('http')) {
    // It's a username, convert to ap_id
    targetApId = actorApId(baseUrl, targetActorId);
  }

  // Get blocked and muted user IDs (if authenticated)
  let blockedIds: string[] = [];
  let mutedIds: string[] = [];

  if (actor) {
    const blocks = await prisma.block.findMany({
      where: { blockerApId: actor.ap_id },
      select: { blockedApId: true },
    });
    blockedIds = blocks.map(b => b.blockedApId);

    const mutes = await prisma.mute.findMany({
      where: { muterApId: actor.ap_id },
      select: { mutedApId: true },
    });
    mutedIds = mutes.map(m => m.mutedApId);
  }

  // Check if target is blocked/muted
  if (blockedIds.includes(targetApId) || mutedIds.includes(targetApId)) {
    return c.json({ stories: [] });
  }

  // Get stories for the target user
  const userStories = await prisma.object.findMany({
    where: {
      type: 'Story',
      attributedTo: targetApId,
      endTime: { gt: now },
    },
    include: {
      author: {
        select: {
          apId: true,
          preferredUsername: true,
          name: true,
          iconUrl: true,
        },
      },
      storyViews: actor ? {
        where: { actorApId: actor.ap_id },
        select: { actorApId: true },
      } : false,
      likes: actor ? {
        where: { actorApId: actor.ap_id },
        select: { actorApId: true },
      } : false,
    },
    orderBy: { published: 'desc' },
  });

  // Get all story ap_ids for batch vote query
  const storyApIds = userStories.map(s => s.apId);

  // Batch query for all votes
  let allVotes: Record<string, VoteResults> = {};
  let userVotes: Record<string, number> = {};

  if (storyApIds.length > 0) {
    // Get vote counts grouped by story and option
    const votes = await prisma.storyVote.groupBy({
      by: ['storyApId', 'optionIndex'],
      where: {
        storyApId: { in: storyApIds },
      },
      _count: {
        id: true,
      },
    });

    votes.forEach(v => {
      if (!allVotes[v.storyApId]) {
        allVotes[v.storyApId] = {};
      }
      allVotes[v.storyApId][v.optionIndex] = v._count.id;
    });

    // Get user's own votes (if authenticated)
    if (actor) {
      const userVotesData = await prisma.storyVote.findMany({
        where: {
          storyApId: { in: storyApIds },
          actorApId: actor.ap_id,
        },
        select: {
          storyApId: true,
          optionIndex: true,
        },
      });

      userVotesData.forEach(v => {
        userVotes[v.storyApId] = v.optionIndex;
      });
    }
  }

  // Try to get author info from actor_cache for remote authors
  const remoteAuthorIds = [...new Set(userStories.filter(s => !s.author).map(s => s.attributedTo))];
  let actorCacheMap: Record<string, { preferredUsername: string | null; name: string | null; iconUrl: string | null }> = {};

  if (remoteAuthorIds.length > 0) {
    const cachedActors = await prisma.actorCache.findMany({
      where: { apId: { in: remoteAuthorIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    });
    cachedActors.forEach(a => {
      actorCacheMap[a.apId] = { preferredUsername: a.preferredUsername, name: a.name, iconUrl: a.iconUrl };
    });
  }

  const result = userStories.map(s => {
    const storyData = transformStoryData(s.attachmentsJson);
    const authorData = s.author || actorCacheMap[s.attributedTo];

    // Calculate vote totals
    const storyVotes = allVotes[s.apId] || {};
    const total = Object.values(storyVotes).reduce((sum: number, count: number) => sum + count, 0);

    const storyViews = (s.storyViews as { actorApId: string }[] | undefined) || [];
    const likes = (s.likes as { actorApId: string }[] | undefined) || [];

    return {
      ap_id: s.apId,
      author: {
        ap_id: s.attributedTo,
        username: formatUsername(s.attributedTo),
        preferred_username: authorData?.preferredUsername || null,
        name: authorData?.name || null,
        icon_url: authorData?.iconUrl || null,
      },
      attachment: storyData.attachment,
      displayDuration: storyData.displayDuration,
      overlays: storyData.overlays,
      end_time: s.endTime || '',
      published: s.published,
      viewed: storyViews.length > 0,
      like_count: s.likeCount,
      share_count: s.shareCount || 0,
      liked: likes.length > 0,
      votes: storyVotes,
      votes_total: total,
      user_vote: userVotes[s.apId],
    };
  });

  return c.json({ stories: result });
});

// Create story (v2: single attachment format)
stories.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
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

  await prisma.object.create({
    data: {
      apId,
      type: 'Story',
      attributedTo: actor.ap_id,
      content: '',
      attachmentsJson,
      endTime,
      published: now,
      isLocal: 1,
    },
  });

  // Update post count
  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: { postCount: { increment: 1 } },
  });

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
      apId: apId,
      attributedTo: actor.ap_id,
      attachment: responseData.attachment,
      displayDuration: responseData.displayDuration,
      overlays: responseData.overlays,
      endTime: endTime,
      published: now,
    },
    actor,
    c.env,
    prisma
  ).catch(console.error);

  return c.json({ story }, 201);
});

// Delete story
stories.post('/delete', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  const apId = body.ap_id;

  // Verify ownership
  const story = await prisma.object.findUnique({
    where: { apId },
  });

  if (!story) return c.json({ error: 'Story not found' }, 404);
  if (story.attributedTo !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Send Delete(Story) activity to followers before deleting (async, don't block response)
  sendDeleteStoryActivity(apId, actor, c.env, prisma).catch(console.error);

  // Delete story votes first
  await prisma.storyVote.deleteMany({
    where: { storyApId: apId },
  });

  // Delete story likes
  await prisma.like.deleteMany({
    where: { objectApId: apId },
  });

  // Delete story views
  await prisma.storyView.deleteMany({
    where: { storyApId: apId },
  });

  // Delete story shares
  await prisma.storyShare.deleteMany({
    where: { storyApId: apId },
  });

  // Delete story
  await prisma.object.delete({
    where: { apId },
  });

  // Update post count
  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: {
      postCount: { decrement: 1 },
    },
  });

  return c.json({ success: true });
});


export default stories;
