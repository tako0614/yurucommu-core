import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import type { Actor, Env, Variables } from '../types';
import { actorApId, getDomain, formatUsername, parseLimit } from '../utils';

const actors = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_ACTOR_POSTS_LIMIT = 100;
const MAX_PROFILE_NAME_LENGTH = 50;
const MAX_PROFILE_SUMMARY_LENGTH = 500;
const MAX_PROFILE_URL_LENGTH = 2000;

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

// Helper to resolve identifier to AP ID
async function resolveActorApId(
  c: { env: Env; get: (key: 'prisma') => ReturnType<typeof import('../lib/db').getPrismaD1> },
  identifier: string
): Promise<string | null> {
  const baseUrl = c.env.APP_URL;

  if (identifier.startsWith('http')) {
    return identifier;
  }

  if (identifier.includes('@')) {
    const stripped = identifier.replace(/^@/, '');
    const parts = stripped.split('@');
    const username = parts[0];
    if (!username) return null;
    if (parts.length === 1) {
      return actorApId(baseUrl, username);
    }
    const domain = parts.slice(1).join('@');
    if (!domain) return null;
    if (domain === getDomain(baseUrl)) {
      return actorApId(baseUrl, username);
    }

    const prisma = c.get('prisma');
    const cached = await prisma.actorCache.findFirst({
      where: {
        preferredUsername: username,
        apId: { contains: domain },
      },
      select: { apId: true },
    });
    return cached?.apId || null;
  }

  return actorApId(baseUrl, identifier);
}

// Get all local actors
actors.get('/', async (c) => {
  const prisma = c.get('prisma');
  const actorsList = await prisma.actor.findMany({
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      summary: true,
      iconUrl: true,
      role: true,
      followerCount: true,
      followingCount: true,
      postCount: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return c.json({
    actors: actorsList.map((a) => ({
      ap_id: a.apId,
      preferred_username: a.preferredUsername,
      name: a.name,
      summary: a.summary,
      icon_url: a.iconUrl,
      role: a.role,
      follower_count: a.followerCount,
      following_count: a.followingCount,
      post_count: a.postCount,
      created_at: a.createdAt,
      username: formatUsername(a.apId),
    })),
  });
});

// Get blocked users for current actor
actors.get('/me/blocked', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const blocks = await prisma.block.findMany({
    where: { blockerApId: actor.ap_id },
    orderBy: { createdAt: 'desc' },
  });

  // Batch load actor info to avoid N+1 queries
  const blockedApIds = blocks.map((b) => b.blockedApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: blockedApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: blockedApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true },
    }),
  ]);

  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));

  const blockedList = blocks.map((b) => {
    const actorInfo = localActorMap.get(b.blockedApId) || cachedActorMap.get(b.blockedApId);
    return {
      ap_id: b.blockedApId,
      username: formatUsername(b.blockedApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      summary: actorInfo?.summary || null,
    };
  });

  return c.json({ blocked: blockedList });
});

// Block a user
actors.post('/me/blocked', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  if (body.ap_id === actor.ap_id) return c.json({ error: 'Cannot block yourself' }, 400);

  const prisma = c.get('prisma');
  await prisma.block.upsert({
    where: {
      blockerApId_blockedApId: { blockerApId: actor.ap_id, blockedApId: body.ap_id },
    },
    create: { blockerApId: actor.ap_id, blockedApId: body.ap_id },
    update: {},
  });

  return c.json({ success: true });
});

// Unblock a user
actors.delete('/me/blocked', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);

  const prisma = c.get('prisma');
  await prisma.block.delete({
    where: {
      blockerApId_blockedApId: { blockerApId: actor.ap_id, blockedApId: body.ap_id },
    },
  }).catch(() => {});

  return c.json({ success: true });
});

// Get muted users for current actor
actors.get('/me/muted', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const prisma = c.get('prisma');
  const mutes = await prisma.mute.findMany({
    where: { muterApId: actor.ap_id },
    orderBy: { createdAt: 'desc' },
  });

  // Batch load actor info to avoid N+1 queries
  const mutedApIds = mutes.map((m) => m.mutedApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: mutedApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: mutedApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true },
    }),
  ]);

  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));

  const mutedList = mutes.map((m) => {
    const actorInfo = localActorMap.get(m.mutedApId) || cachedActorMap.get(m.mutedApId);
    return {
      ap_id: m.mutedApId,
      username: formatUsername(m.mutedApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      summary: actorInfo?.summary || null,
    };
  });

  return c.json({ muted: mutedList });
});

// Mute a user
actors.post('/me/muted', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  if (body.ap_id === actor.ap_id) return c.json({ error: 'Cannot mute yourself' }, 400);

  const prisma = c.get('prisma');
  await prisma.mute.upsert({
    where: {
      muterApId_mutedApId: { muterApId: actor.ap_id, mutedApId: body.ap_id },
    },
    create: { muterApId: actor.ap_id, mutedApId: body.ap_id },
    update: {},
  });

  return c.json({ success: true });
});

// Unmute a user
actors.delete('/me/muted', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);

  const prisma = c.get('prisma');
  await prisma.mute.delete({
    where: {
      muterApId_mutedApId: { muterApId: actor.ap_id, mutedApId: body.ap_id },
    },
  }).catch(() => {});

  return c.json({ success: true });
});

// Delete own account (local only)
actors.post('/me/delete', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const actorApIdVal = actor.ap_id;
  const prisma = c.get('prisma');

  try {
    // Use transaction to ensure all deletions succeed or none do
    await prisma.$transaction(async (tx) => {
      // Remove sessions
      await tx.session.deleteMany({ where: { memberId: actorApIdVal } });

      // Remove follow relationships
      await tx.follow.deleteMany({
        where: { OR: [{ followerApId: actorApIdVal }, { followingApId: actorApIdVal }] },
      });

      // Remove blocks/mutes
      await tx.block.deleteMany({
        where: { OR: [{ blockerApId: actorApIdVal }, { blockedApId: actorApIdVal }] },
      });
      await tx.mute.deleteMany({
        where: { OR: [{ muterApId: actorApIdVal }, { mutedApId: actorApIdVal }] },
      });

      // Remove likes/bookmarks/announces
      await tx.like.deleteMany({ where: { actorApId: actorApIdVal } });
      await tx.bookmark.deleteMany({ where: { actorApId: actorApIdVal } });
      await tx.announce.deleteMany({ where: { actorApId: actorApIdVal } });

      // Remove inbox entries
      await tx.inbox.deleteMany({ where: { actorApId: actorApIdVal } });

      // Remove community memberships
      const memberships = await tx.communityMember.findMany({
        where: { actorApId: actorApIdVal },
        select: { communityApId: true },
      });
      for (const m of memberships) {
        await tx.community.update({
          where: { apId: m.communityApId },
          data: { memberCount: { decrement: 1 } },
        }).catch(() => {});
      }
      await tx.communityMember.deleteMany({ where: { actorApId: actorApIdVal } });

      // Remove object recipients and activities
      await tx.objectRecipient.deleteMany({ where: { recipientApId: actorApIdVal } });
      await tx.activity.deleteMany({ where: { actorApId: actorApIdVal } });

      // Get objects authored by the actor
      const authoredObjects = await tx.object.findMany({
        where: { attributedTo: actorApIdVal },
        select: { apId: true },
      });
      const objectIds = authoredObjects.map((o) => o.apId);

      if (objectIds.length > 0) {
        await tx.like.deleteMany({ where: { objectApId: { in: objectIds } } });
        await tx.announce.deleteMany({ where: { objectApId: { in: objectIds } } });
        await tx.bookmark.deleteMany({ where: { objectApId: { in: objectIds } } });
        await tx.storyVote.deleteMany({ where: { storyApId: { in: objectIds } } });
        await tx.storyView.deleteMany({ where: { storyApId: { in: objectIds } } });
      }
      await tx.object.deleteMany({ where: { attributedTo: actorApIdVal } });

      // Finally remove actor
      await tx.actor.delete({ where: { apId: actorApIdVal } });
    });

    // Clear session cookie after successful deletion
    deleteCookie(c, 'session');

    return c.json({ success: true });
  } catch (error) {
    console.error('Account deletion failed:', error instanceof Error ? error.message : 'Unknown error');
    return c.json({ error: 'Account deletion failed' }, 500);
  }
});

// Get posts for a specific actor
actors.get('/:identifier/posts', async (c) => {
  const currentActor = c.get('actor');
  const identifier = c.req.param('identifier');
  const apId = await resolveActorApId(c, identifier);
  if (!apId) return c.json({ error: 'Actor not found' }, 404);

  const prisma = c.get('prisma');

  // Ensure actor exists (local or cached)
  const actorExists = await prisma.actor.findUnique({
    where: { apId },
    select: { apId: true },
  });
  const cachedExists = actorExists
    ? null
    : await prisma.actorCache.findUnique({
        where: { apId },
        select: { apId: true },
      });
  if (!actorExists && !cachedExists) {
    return c.json({ error: 'Actor not found' }, 404);
  }

  const limit = parseLimit(c.req.query('limit'), 20, MAX_ACTOR_POSTS_LIMIT);
  const before = c.req.query('before');

  const isOwnProfile = currentActor && currentActor.ap_id === apId;

  const posts = await prisma.object.findMany({
    where: {
      type: 'Note',
      inReplyTo: null,
      visibility: isOwnProfile ? { not: 'direct' } : 'public',
      attributedTo: apId,
      ...(before ? { published: { lt: before } } : {}),
    },
    orderBy: { published: 'desc' },
    take: limit,
  });

  // Batch load author info to avoid N+1 queries
  const authorApIds = [...new Set(posts.map((p) => p.attributedTo))];
  const [localAuthors, cachedAuthors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: authorApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
    }),
  ]);

  const localAuthorMap = new Map(localAuthors.map((a) => [a.apId, a]));
  const cachedAuthorMap = new Map(cachedAuthors.map((a) => [a.apId, a]));

  // Batch load interaction status if user is logged in
  const postApIds = posts.map((p) => p.apId);
  const likedPostIds = new Set<string>();
  const bookmarkedPostIds = new Set<string>();
  const repostedPostIds = new Set<string>();

  if (currentActor) {
    const [likes, bookmarks, announces] = await Promise.all([
      prisma.like.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: postApIds } },
        select: { objectApId: true },
      }),
      prisma.bookmark.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: postApIds } },
        select: { objectApId: true },
      }),
      prisma.announce.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: postApIds } },
        select: { objectApId: true },
      }),
    ]);

    likes.forEach((l) => likedPostIds.add(l.objectApId));
    bookmarks.forEach((b) => bookmarkedPostIds.add(b.objectApId));
    announces.forEach((a) => repostedPostIds.add(a.objectApId));
  }

  // Map posts to result format
  const result = posts.map((p) => {
    const author = localAuthorMap.get(p.attributedTo) || cachedAuthorMap.get(p.attributedTo);

    return {
      ap_id: p.apId,
      type: p.type,
      author: {
        ap_id: p.attributedTo,
        username: formatUsername(p.attributedTo),
        preferred_username: author?.preferredUsername || null,
        name: author?.name || null,
        icon_url: author?.iconUrl || null,
      },
      content: p.content,
      summary: p.summary,
      attachments: JSON.parse(p.attachmentsJson || '[]'),
      in_reply_to: p.inReplyTo,
      visibility: p.visibility,
      community_ap_id: p.communityApId,
      like_count: p.likeCount,
      reply_count: p.replyCount,
      announce_count: p.announceCount,
      published: p.published,
      liked: likedPostIds.has(p.apId),
      bookmarked: bookmarkedPostIds.has(p.apId),
      reposted: repostedPostIds.has(p.apId),
    };
  });

  return c.json({ posts: result });
});

// Get actor by AP ID or username
actors.get('/:identifier', async (c) => {
  const currentActor = c.get('actor');
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  // Check if identifier is a full AP ID or just username
  let apId: string;
  if (identifier.startsWith('http')) {
    apId = identifier;
  } else if (identifier.includes('@')) {
    // Handle @username@domain format
    const stripped = identifier.replace(/^@/, '');
    const parts = stripped.split('@');
    const username = parts[0];
    if (!username) {
      return c.json({ error: 'Actor not found' }, 404);
    }
    if (parts.length === 1) {
      apId = actorApId(baseUrl, username);
    } else {
      const domain = parts.slice(1).join('@');
      if (!domain) {
        return c.json({ error: 'Actor not found' }, 404);
      }
      if (domain === getDomain(baseUrl)) {
        apId = actorApId(baseUrl, username);
      } else {
        // Remote actor - check cache
        const cached = await prisma.actorCache.findFirst({
          where: {
            preferredUsername: username,
            apId: { contains: domain },
          },
        });
        if (cached) {
          return c.json({
            actor: {
              ap_id: cached.apId,
              preferred_username: cached.preferredUsername,
              name: cached.name,
              summary: cached.summary,
              icon_url: cached.iconUrl,
              username: formatUsername(cached.apId),
            },
          });
        }
        return c.json({ error: 'Actor not found' }, 404);
      }
    }
  } else {
    apId = actorApId(baseUrl, identifier);
  }

  // Try local actors first
  const localActor = await prisma.actor.findUnique({
    where: { apId },
    select: {
      apId: true,
      preferredUsername: true,
      name: true,
      summary: true,
      iconUrl: true,
      headerUrl: true,
      role: true,
      followerCount: true,
      followingCount: true,
      postCount: true,
      isPrivate: true,
      createdAt: true,
    },
  });

  if (!localActor) {
    // Try actor cache (remote)
    const cachedActor = await prisma.actorCache.findUnique({ where: { apId } });
    if (!cachedActor) return c.json({ error: 'Actor not found' }, 404);

    return c.json({
      actor: {
        ap_id: cachedActor.apId,
        preferred_username: cachedActor.preferredUsername,
        name: cachedActor.name,
        summary: cachedActor.summary,
        icon_url: cachedActor.iconUrl,
        username: formatUsername(cachedActor.apId),
        is_following: false,
        is_followed_by: false,
      },
    });
  }

  // Check follow status if logged in
  let is_following = false;
  let is_followed_by = false;

  if (currentActor && currentActor.ap_id !== apId) {
    const followingStatus = await prisma.follow.findFirst({
      where: { followerApId: currentActor.ap_id, followingApId: apId, status: 'accepted' },
    });
    is_following = !!followingStatus;

    const followedByStatus = await prisma.follow.findFirst({
      where: { followerApId: apId, followingApId: currentActor.ap_id, status: 'accepted' },
    });
    is_followed_by = !!followedByStatus;
  }

  return c.json({
    actor: {
      ap_id: localActor.apId,
      preferred_username: localActor.preferredUsername,
      name: localActor.name,
      summary: localActor.summary,
      icon_url: localActor.iconUrl,
      header_url: localActor.headerUrl,
      role: localActor.role,
      follower_count: localActor.followerCount,
      following_count: localActor.followingCount,
      post_count: localActor.postCount,
      is_private: localActor.isPrivate,
      created_at: localActor.createdAt,
      username: formatUsername(localActor.apId),
      is_following,
      is_followed_by,
    },
  });
});

// Update own profile
actors.put('/me', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{
    name?: string;
    summary?: string;
    icon_url?: string;
    header_url?: string;
    is_private?: boolean;
  }>();

  const updates: Record<string, string | number | null> = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (name.length > MAX_PROFILE_NAME_LENGTH) {
      return c.json({ error: `Name too long (max ${MAX_PROFILE_NAME_LENGTH} chars)` }, 400);
    }
    updates.name = name;
  }
  if (body.summary !== undefined) {
    const summary = body.summary.trim();
    if (summary.length > MAX_PROFILE_SUMMARY_LENGTH) {
      return c.json({ error: `Summary too long (max ${MAX_PROFILE_SUMMARY_LENGTH} chars)` }, 400);
    }
    updates.summary = summary.length > 0 ? summary : null;
  }
  if (body.icon_url !== undefined) {
    const iconUrl = body.icon_url.trim();
    if (iconUrl.length > MAX_PROFILE_URL_LENGTH) {
      return c.json({ error: `Icon URL too long (max ${MAX_PROFILE_URL_LENGTH} chars)` }, 400);
    }
    if (iconUrl.length > 0 && !isValidHttpUrl(iconUrl)) {
      return c.json({ error: 'Invalid icon_url' }, 400);
    }
    updates.iconUrl = iconUrl.length > 0 ? iconUrl : null;
  }
  if (body.header_url !== undefined) {
    const headerUrl = body.header_url.trim();
    if (headerUrl.length > MAX_PROFILE_URL_LENGTH) {
      return c.json({ error: `Header URL too long (max ${MAX_PROFILE_URL_LENGTH} chars)` }, 400);
    }
    if (headerUrl.length > 0 && !isValidHttpUrl(headerUrl)) {
      return c.json({ error: 'Invalid header_url' }, 400);
    }
    updates.headerUrl = headerUrl.length > 0 ? headerUrl : null;
  }
  if (body.is_private !== undefined) {
    updates.isPrivate = body.is_private ? 1 : 0;
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ error: 'No fields to update' }, 400);
  }

  const prisma = c.get('prisma');
  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: updates,
  });

  return c.json({ success: true });
});

// Get actor's followers
actors.get('/:identifier/followers', async (c) => {
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : actorApId(baseUrl, identifier);
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const prisma = c.get('prisma');

  const follows = await prisma.follow.findMany({
    where: { followingApId: apId, status: 'accepted' },
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit,
  });

  const total = await prisma.follow.count({
    where: { followingApId: apId, status: 'accepted' },
  });

  // Batch load actor info to avoid N+1 queries
  const followerApIds = follows.map((f) => f.followerApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: followerApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: followerApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true },
    }),
  ]);

  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));

  const followers = follows.map((f) => {
    const actorInfo = localActorMap.get(f.followerApId) || cachedActorMap.get(f.followerApId);
    return {
      ap_id: f.followerApId,
      username: formatUsername(f.followerApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      summary: actorInfo?.summary || null,
    };
  });

  return c.json({
    followers,
    total,
    limit,
    offset,
    has_more: offset + followers.length < total,
  });
});

// Get actor's following
actors.get('/:identifier/following', async (c) => {
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const apId = identifier.startsWith('http') ? identifier : actorApId(baseUrl, identifier);
  const limit = Math.min(parseInt(c.req.query('limit') || '50'), 100);
  const offset = parseInt(c.req.query('offset') || '0');

  const prisma = c.get('prisma');

  const follows = await prisma.follow.findMany({
    where: { followerApId: apId, status: 'accepted' },
    orderBy: { createdAt: 'desc' },
    skip: offset,
    take: limit,
  });

  const total = await prisma.follow.count({
    where: { followerApId: apId, status: 'accepted' },
  });

  // Batch load actor info to avoid N+1 queries
  const followingApIds = follows.map((f) => f.followingApId);
  const [localActors, cachedActors] = await Promise.all([
    prisma.actor.findMany({
      where: { apId: { in: followingApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true },
    }),
    prisma.actorCache.findMany({
      where: { apId: { in: followingApIds } },
      select: { apId: true, preferredUsername: true, name: true, iconUrl: true, summary: true },
    }),
  ]);

  const localActorMap = new Map(localActors.map((a) => [a.apId, a]));
  const cachedActorMap = new Map(cachedActors.map((a) => [a.apId, a]));

  const following = follows.map((f) => {
    const actorInfo = localActorMap.get(f.followingApId) || cachedActorMap.get(f.followingApId);
    return {
      ap_id: f.followingApId,
      username: formatUsername(f.followingApId),
      preferred_username: actorInfo?.preferredUsername || null,
      name: actorInfo?.name || null,
      icon_url: actorInfo?.iconUrl || null,
      summary: actorInfo?.summary || null,
    };
  });

  return c.json({
    following,
    total,
    limit,
    offset,
    has_more: offset + following.length < total,
  });
});

export default actors;
