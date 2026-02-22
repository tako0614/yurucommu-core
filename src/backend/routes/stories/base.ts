// Story routes for Yurucommu backend
// v2: 1 Story = 1 Media (Instagram style)
import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, actorApId, formatUsername, activityApId } from '../../utils';
import { storyToActivityPub } from '../../lib/activitypub-helpers';
import {
  cleanupExpiredStories,
  transformStoryData,
  validateOverlays,
  fetchBlockedAndMutedIds,
  fetchBatchVotes,
  fetchActorCache,
  sumVotes,
} from './utils';
import { enqueueFanoutToFollowers } from '../../lib/delivery/queue';

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

/** Build a StoryAuthor from available data sources. */
function buildAuthor(
  apId: string,
  data: { preferredUsername?: string | null; name?: string | null; iconUrl?: string | null } | null | undefined,
): StoryAuthor {
  return {
    ap_id: apId,
    username: formatUsername(apId),
    preferred_username: data?.preferredUsername || null,
    name: data?.name || null,
    icon_url: data?.iconUrl || null,
  };
}

/** Build a StoryResponse from a story object row and pre-fetched data. */
function buildStoryResponse(
  s: {
    apId: string;
    attributedTo: string;
    attachmentsJson: string;
    endTime: string | null;
    published: string;
    likeCount: number;
    shareCount: number | null;
    storyViews?: { actorApId: string }[];
    likes?: { actorApId: string }[];
  },
  author: StoryAuthor,
  allVotes: Record<string, VoteResults>,
  userVotes: Record<string, number>,
): StoryResponse {
  const storyData = transformStoryData(s.attachmentsJson);
  const storyVotes = allVotes[s.apId] || {};

  return {
    ap_id: s.apId,
    author,
    attachment: storyData.attachment,
    displayDuration: storyData.displayDuration,
    overlays: storyData.overlays,
    end_time: s.endTime || '',
    published: s.published,
    viewed: (s.storyViews?.length ?? 0) > 0,
    like_count: s.likeCount,
    share_count: s.shareCount || 0,
    liked: (s.likes?.length ?? 0) > 0,
    votes: storyVotes,
    votes_total: sumVotes(storyVotes),
    user_vote: userVotes[s.apId],
  };
}

// Get active stories from followed users and self (grouped by author)
stories.get('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const now = new Date().toISOString();

  // Probabilistic cleanup: 1% chance per request
  if (Math.random() < 0.01) {
    cleanupExpiredStories(prisma).catch((err) => {
      console.warn('[Stories] Failed to cleanup expired stories', err);
    });
  }

  // Get followed user IDs
  const follows = await prisma.follow.findMany({
    where: { followerApId: actor.ap_id, status: 'accepted' },
    select: { followingApId: true },
  });
  const followedIds = follows.map((f) => f.followingApId);
  followedIds.push(actor.ap_id); // Include self

  const { blockedIds, mutedIds } = await fetchBlockedAndMutedIds(prisma, actor.ap_id);

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
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
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
    orderBy: [{ endTime: 'desc' }],
  });

  const storyApIds = storiesData.map((s) => s.apId);
  const { allVotes, userVotes } = await fetchBatchVotes(prisma, storyApIds, actor.ap_id);

  // Resolve remote author info from cache
  const remoteAuthorIds = [...new Set(storiesData.filter((s) => !s.author).map((s) => s.attributedTo))];
  const actorCacheMap = await fetchActorCache(prisma, remoteAuthorIds);

  // Group by author
  const grouped: Record<string, { actor: StoryAuthor; stories: StoryResponse[]; has_unviewed: boolean }> = {};
  const authorOrder: string[] = [];

  for (const s of storiesData) {
    const authorApId = s.attributedTo;
    const authorData = s.author || actorCacheMap[authorApId];
    const authorInfo = buildAuthor(authorApId, authorData);

    if (!grouped[authorApId]) {
      grouped[authorApId] = { actor: authorInfo, stories: [], has_unviewed: false };
      if (authorApId === actor.ap_id) {
        authorOrder.unshift(authorApId);
      } else {
        authorOrder.push(authorApId);
      }
    }

    const response = buildStoryResponse(s, authorInfo, allVotes, userVotes);
    if (!response.viewed) grouped[authorApId].has_unviewed = true;
    grouped[authorApId].stories.push(response);
  }

  // Sort stories within each group: unviewed first, then by end_time desc
  for (const group of Object.values(grouped)) {
    group.stories.sort((a, b) => {
      if (!a.viewed && b.viewed) return -1;
      if (a.viewed && !b.viewed) return 1;
      return b.end_time.localeCompare(a.end_time);
    });
  }

  // Sort author groups: self first, then those with unviewed stories
  authorOrder.sort((a, b) => {
    if (a === actor.ap_id) return -1;
    if (b === actor.ap_id) return 1;
    if (grouped[a].has_unviewed && !grouped[b].has_unviewed) return -1;
    if (!grouped[a].has_unviewed && grouped[b].has_unviewed) return 1;
    return 0;
  });

  return c.json({ actor_stories: authorOrder.map((apId) => grouped[apId]) });
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
  const targetApId = targetActorId.startsWith('http')
    ? targetActorId
    : actorApId(baseUrl, targetActorId);

  // Check blocked/muted (if authenticated)
  if (actor) {
    const { blockedIds, mutedIds } = await fetchBlockedAndMutedIds(prisma, actor.ap_id);
    if (blockedIds.includes(targetApId) || mutedIds.includes(targetApId)) {
      return c.json({ stories: [] });
    }
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
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
      },
      storyViews: actor
        ? { where: { actorApId: actor.ap_id }, select: { actorApId: true } }
        : false,
      likes: actor
        ? { where: { actorApId: actor.ap_id }, select: { actorApId: true } }
        : false,
    },
    orderBy: { published: 'desc' },
  });

  const storyApIds = userStories.map((s) => s.apId);
  const { allVotes, userVotes } = await fetchBatchVotes(
    prisma,
    storyApIds,
    actor?.ap_id,
  );

  // Resolve remote author info from cache
  const remoteAuthorIds = [...new Set(userStories.filter((s) => !s.author).map((s) => s.attributedTo))];
  const actorCacheMap = await fetchActorCache(prisma, remoteAuthorIds);

  const result = userStories.map((s) => {
    const authorData = s.author || actorCacheMap[s.attributedTo];
    const author = buildAuthor(s.attributedTo, authorData);
    const storyViews = (s.storyViews as { actorApId: string }[] | undefined) || [];
    const likes = (s.likes as { actorApId: string }[] | undefined) || [];

    return buildStoryResponse(
      { ...s, storyViews, likes },
      author,
      allVotes,
      userVotes,
    );
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
  const endTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

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

  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: { postCount: { increment: 1 } },
  });

  const responseData = transformStoryData(attachmentsJson);

  const story = {
    ap_id: apId,
    author: buildAuthor(actor.ap_id, {
      preferredUsername: actor.preferred_username,
      name: actor.name,
      iconUrl: actor.icon_url,
    }),
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
  const createActivityId = activityApId(baseUrl, generateId());
  const storyObject = storyToActivityPub(
    {
      apId,
      attributedTo: actor.ap_id,
      attachment: responseData.attachment,
      displayDuration: responseData.displayDuration,
      overlays: responseData.overlays,
      endTime,
      published: now,
    },
    actor,
    baseUrl,
  );
  const createActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: createActivityId,
    type: 'Create',
    actor: actor.ap_id,
    published: now,
    to: [`${actor.ap_id}/followers`],
    object: storyObject,
  };

  await prisma.activity.create({
    data: {
      apId: createActivityId,
      type: 'Create',
      actorApId: actor.ap_id,
      objectApId: apId,
      rawJson: JSON.stringify(createActivity),
      direction: 'outbound',
    },
  });
  await enqueueFanoutToFollowers(c.env, createActivityId, actor.ap_id);

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
  const story = await prisma.object.findUnique({ where: { apId } });
  if (!story) return c.json({ error: 'Story not found' }, 404);
  if (story.attributedTo !== actor.ap_id) return c.json({ error: 'Forbidden' }, 403);

  // Enqueue Delete(Story) activity to followers before deleting.
  // Outbound delivery MUST NOT run in request path; enqueue is the sync boundary.
  const baseUrl = c.env.APP_URL;
  const deleteActivityId = activityApId(baseUrl, generateId());
  const deleteActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: deleteActivityId,
    type: 'Delete',
    actor: actor.ap_id,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    object: apId,
  };
  await prisma.activity.create({
    data: {
      apId: deleteActivityId,
      type: 'Delete',
      actorApId: actor.ap_id,
      objectApId: apId,
      rawJson: JSON.stringify(deleteActivity),
      direction: 'outbound',
    },
  });
  await enqueueFanoutToFollowers(c.env, deleteActivityId, actor.ap_id);

  // Delete related data, then the story itself
  await prisma.storyVote.deleteMany({ where: { storyApId: apId } });
  await prisma.like.deleteMany({ where: { objectApId: apId } });
  await prisma.storyView.deleteMany({ where: { storyApId: apId } });
  await prisma.storyShare.deleteMany({ where: { storyApId: apId } });
  await prisma.object.delete({ where: { apId } });

  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: { postCount: { decrement: 1 } },
  });

  return c.json({ success: true });
});

export default stories;
