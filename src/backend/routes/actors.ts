import { Hono } from 'hono';
import type { Context } from 'hono';
import { deleteCookie } from 'hono/cookie';
import type { PrismaClient } from '../../generated/prisma';
import type { Actor, Env, Variables } from '../types';
import { actorApId, getDomain, formatUsername, parseLimit, parseOffset, safeJsonParse } from '../utils';
import { withCache, CacheTTL, CacheTags } from '../middleware/cache';

// Hono context with our app's bindings and variables
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AppContext = Context<{ Bindings: Env; Variables: Variables }, any>;

const actors = new Hono<{ Bindings: Env; Variables: Variables }>();

const MAX_ACTOR_POSTS_LIMIT = 100;
const MAX_PROFILE_NAME_LENGTH = 50;
const MAX_PROFILE_SUMMARY_LENGTH = 500;
const MAX_PROFILE_URL_LENGTH = 2000;

// Shared select shape used by batch-loading helpers (blocked, muted, followers, following)
const ACTOR_INFO_SELECT = {
  apId: true,
  preferredUsername: true,
  name: true,
  iconUrl: true,
  summary: true,
} as const;

// Minimal select for author info on posts
const AUTHOR_INFO_SELECT = {
  apId: true,
  preferredUsername: true,
  name: true,
  iconUrl: true,
} as const;

type ActorInfo = { apId: string; preferredUsername: string | null; name: string | null; iconUrl: string | null; summary?: string | null };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function isPrismaNotFoundError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: string }).code === 'P2025';
}

/**
 * Batch-load actor info from both local and cached tables, returning a
 * single lookup map keyed by apId.  Local actors take precedence.
 */
async function loadActorInfoMap(
  prisma: PrismaClient,
  apIds: string[],
  select: typeof ACTOR_INFO_SELECT | typeof AUTHOR_INFO_SELECT = ACTOR_INFO_SELECT,
): Promise<Map<string, ActorInfo>> {
  if (apIds.length === 0) return new Map();

  const [local, cached] = await Promise.all([
    prisma.actor.findMany({ where: { apId: { in: apIds } }, select }),
    prisma.actorCache.findMany({ where: { apId: { in: apIds } }, select }),
  ]);

  const map = new Map<string, ActorInfo>();
  for (const a of cached) map.set(a.apId, a);
  for (const a of local) map.set(a.apId, a); // local wins
  return map;
}

/**
 * Format a looked-up actor into the common JSON shape used by blocked/muted/followers/following lists.
 */
function formatActorSummary(apId: string, info: ActorInfo | undefined): {
  ap_id: string;
  username: string;
  preferred_username: string | null;
  name: string | null;
  icon_url: string | null;
  summary: string | null;
} {
  return {
    ap_id: apId,
    username: formatUsername(apId),
    preferred_username: info?.preferredUsername || null,
    name: info?.name || null,
    icon_url: info?.iconUrl || null,
    summary: info?.summary ?? null,
  };
}

/**
 * Resolve an identifier (AP ID, @user@domain, or bare username) to an AP ID string.
 * Returns null when the identifier cannot be resolved.
 */
async function resolveActorApId(
  prisma: PrismaClient,
  baseUrl: string,
  identifier: string,
): Promise<string | null> {
  if (identifier.startsWith('http')) return identifier;

  if (!identifier.includes('@')) return actorApId(baseUrl, identifier);

  const stripped = identifier.replace(/^@/, '');
  const parts = stripped.split('@');
  const username = parts[0];
  if (!username) return null;

  if (parts.length === 1) return actorApId(baseUrl, username);

  const domain = parts.slice(1).join('@');
  if (!domain) return null;
  if (domain === getDomain(baseUrl)) return actorApId(baseUrl, username);

  const cached = await prisma.actorCache.findFirst({
    where: { preferredUsername: username, apId: { contains: domain } },
    select: { apId: true },
  });
  return cached?.apId || null;
}

/**
 * Check that an actor exists in either the local or cached table.
 */
async function actorExists(prisma: PrismaClient, apId: string): Promise<boolean> {
  const [local, cached] = await Promise.all([
    prisma.actor.findUnique({ where: { apId }, select: { apId: true } }),
    prisma.actorCache.findUnique({ where: { apId }, select: { apId: true } }),
  ]);
  return !!(local || cached);
}

/**
 * Require the current actor from context.  Returns the actor or a 401 Response.
 */
function requireActor(c: AppContext): Actor | Response {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  return actor;
}

/**
 * Batch-load interaction status (liked, bookmarked, reposted) for the given
 * post AP IDs.  Returns empty sets when the actor is not logged in.
 */
async function loadPostInteractions(
  prisma: PrismaClient,
  actorApIdVal: string | null,
  postApIds: string[],
): Promise<{ likedIds: Set<string>; bookmarkedIds: Set<string>; repostedIds: Set<string> }> {
  if (!actorApIdVal || postApIds.length === 0) {
    return { likedIds: new Set(), bookmarkedIds: new Set(), repostedIds: new Set() };
  }

  const [likes, bookmarks, announces] = await Promise.all([
    prisma.like.findMany({
      where: { actorApId: actorApIdVal, objectApId: { in: postApIds } },
      select: { objectApId: true },
    }),
    prisma.bookmark.findMany({
      where: { actorApId: actorApIdVal, objectApId: { in: postApIds } },
      select: { objectApId: true },
    }),
    prisma.announce.findMany({
      where: { actorApId: actorApIdVal, objectApId: { in: postApIds } },
      select: { objectApId: true },
    }),
  ]);

  return {
    likedIds: new Set(likes.map((l) => l.objectApId)),
    bookmarkedIds: new Set(bookmarks.map((b) => b.objectApId)),
    repostedIds: new Set(announces.map((a) => a.objectApId)),
  };
}

/**
 * Generic list handler for relation lists (blocked, muted).
 * Fetches paginated relations, batch-loads actor info, and returns formatted summaries.
 */
async function listRelation<T extends { [K in ApIdKey]: string }, ApIdKey extends string>(
  c: AppContext,
  findMany: (prisma: PrismaClient, actorApIdVal: string, limit: number, offset: number) => Promise<T[]>,
  apIdKey: ApIdKey,
  responseKey: string,
): Promise<Response> {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const prisma = c.get('prisma');
  const limit = parseLimit(c.req.query('limit'), 100, 500);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);

  const rows = await findMany(prisma, actor.ap_id, limit, offset);
  const targetApIds = rows.map((r) => r[apIdKey]);
  const infoMap = await loadActorInfoMap(prisma, targetApIds);

  return c.json({
    [responseKey]: rows.map((r) => formatActorSummary(r[apIdKey], infoMap.get(r[apIdKey]))),
  });
}

/**
 * Generic create handler for relation upserts (block, mute).
 */
async function createRelation(
  c: AppContext,
  verb: string,
  upsert: (prisma: PrismaClient, actorApIdVal: string, targetApId: string) => Promise<unknown>,
): Promise<Response> {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);
  if (body.ap_id === actor.ap_id) return c.json({ error: `Cannot ${verb} yourself` }, 400);

  const prisma = c.get('prisma');
  await upsert(prisma, actor.ap_id, body.ap_id);

  return c.json({ success: true });
}

/**
 * Generic delete handler for relation removals (unblock, unmute).
 * Silently ignores Prisma not-found errors.
 */
async function deleteRelation(
  c: AppContext,
  label: string,
  remove: (prisma: PrismaClient, actorApIdVal: string, targetApId: string) => Promise<unknown>,
): Promise<Response> {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const body = await c.req.json<{ ap_id: string }>();
  if (!body.ap_id) return c.json({ error: 'ap_id required' }, 400);

  const prisma = c.get('prisma');
  try {
    await remove(prisma, actor.ap_id, body.ap_id);
  } catch (err) {
    if (!isPrismaNotFoundError(err)) {
      console.warn(`[Actors] Failed to delete ${label} relation`, err);
    }
  }

  return c.json({ success: true });
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Get all local actors (cached 5 minutes)
actors.get('/', withCache({
  ttl: CacheTTL.ACTOR_PROFILE,
  cacheTag: CacheTags.ACTOR,
}), async (c) => {
  const prisma = c.get('prisma');
  const limit = parseLimit(c.req.query('limit'), 100, 500);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);

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
    take: limit,
    skip: offset,
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
  return listRelation(c, (prisma, actorId, limit, offset) =>
    prisma.block.findMany({
      where: { blockerApId: actorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }), 'blockedApId', 'blocked');
});

// Block a user
actors.post('/me/blocked', async (c) => {
  return createRelation(c, 'block', (prisma, actorId, targetId) =>
    prisma.block.upsert({
      where: { blockerApId_blockedApId: { blockerApId: actorId, blockedApId: targetId } },
      create: { blockerApId: actorId, blockedApId: targetId },
      update: {},
    }));
});

// Unblock a user
actors.delete('/me/blocked', async (c) => {
  return deleteRelation(c, 'block', (prisma, actorId, targetId) =>
    prisma.block.delete({
      where: { blockerApId_blockedApId: { blockerApId: actorId, blockedApId: targetId } },
    }));
});

// Get muted users for current actor
actors.get('/me/muted', async (c) => {
  return listRelation(c, (prisma, actorId, limit, offset) =>
    prisma.mute.findMany({
      where: { muterApId: actorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }), 'mutedApId', 'muted');
});

// Mute a user
actors.post('/me/muted', async (c) => {
  return createRelation(c, 'mute', (prisma, actorId, targetId) =>
    prisma.mute.upsert({
      where: { muterApId_mutedApId: { muterApId: actorId, mutedApId: targetId } },
      create: { muterApId: actorId, mutedApId: targetId },
      update: {},
    }));
});

// Unmute a user
actors.delete('/me/muted', async (c) => {
  return deleteRelation(c, 'mute', (prisma, actorId, targetId) =>
    prisma.mute.delete({
      where: { muterApId_mutedApId: { muterApId: actorId, mutedApId: targetId } },
    }));
});

// Delete own account (local only)
actors.post('/me/delete', async (c) => {
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

  const actorApIdVal = actor.ap_id;
  const prisma = c.get('prisma');

  try {
    // Phase 1: remove dependent records in a transaction.
    // Actor/object hard delete is executed after this block to avoid D1 batch-order ambiguity
    // with `prevent_actor_hard_delete` trigger checks.
    await prisma.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { memberId: actorApIdVal } });

      await tx.follow.deleteMany({
        where: { OR: [{ followerApId: actorApIdVal }, { followingApId: actorApIdVal }] },
      });

      await tx.block.deleteMany({
        where: { OR: [{ blockerApId: actorApIdVal }, { blockedApId: actorApIdVal }] },
      });
      await tx.mute.deleteMany({
        where: { OR: [{ muterApId: actorApIdVal }, { mutedApId: actorApIdVal }] },
      });

      await tx.like.deleteMany({ where: { actorApId: actorApIdVal } });
      await tx.bookmark.deleteMany({ where: { actorApId: actorApIdVal } });
      await tx.announce.deleteMany({ where: { actorApId: actorApIdVal } });

      await tx.inbox.deleteMany({ where: { actorApId: actorApIdVal } });

      const memberships = await tx.communityMember.findMany({
        where: { actorApId: actorApIdVal },
        select: { communityApId: true },
      });
      const communityApIds = memberships.map((m) => m.communityApId);
      if (communityApIds.length > 0) {
        await tx.community.updateMany({
          where: { apId: { in: communityApIds } },
          data: { memberCount: { decrement: 1 } },
        });
      }
      await tx.communityMember.deleteMany({ where: { actorApId: actorApIdVal } });

      await tx.objectRecipient.deleteMany({ where: { recipientApId: actorApIdVal } });
      await tx.activity.deleteMany({ where: { actorApId: actorApIdVal } });

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
    });

    // Phase 2: explicit ordered hard-delete to satisfy trigger expectations.
    await prisma.object.deleteMany({ where: { attributedTo: actorApIdVal } });
    await prisma.actor.delete({ where: { apId: actorApIdVal } });

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
  const prisma = c.get('prisma');

  const apId = await resolveActorApId(prisma, c.env.APP_URL, identifier);
  if (!apId) return c.json({ error: 'Actor not found' }, 404);

  if (!await actorExists(prisma, apId)) {
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

  const postApIds = posts.map((p) => p.apId);
  const authorApIds = [...new Set(posts.map((p) => p.attributedTo))];

  const [authorMap, interactions] = await Promise.all([
    loadActorInfoMap(prisma, authorApIds, AUTHOR_INFO_SELECT),
    loadPostInteractions(prisma, currentActor?.ap_id ?? null, postApIds),
  ]);

  const resultList = posts.map((p) => {
    const author = authorMap.get(p.attributedTo);
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
      attachments: safeJsonParse(p.attachmentsJson, []),
      in_reply_to: p.inReplyTo,
      visibility: p.visibility,
      community_ap_id: p.communityApId,
      like_count: p.likeCount,
      reply_count: p.replyCount,
      announce_count: p.announceCount,
      published: p.published,
      liked: interactions.likedIds.has(p.apId),
      bookmarked: interactions.bookmarkedIds.has(p.apId),
      reposted: interactions.repostedIds.has(p.apId),
    };
  });

  return c.json({ posts: resultList });
});

// Get actor by AP ID or username
actors.get('/:identifier', async (c) => {
  const currentActor = c.get('actor');
  const identifier = c.req.param('identifier');
  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  // For @user@remote-domain, we may need to return cached data directly
  // (resolveActorApId only returns an apId when the cache has a match)
  const apId = await resolveActorApId(prisma, baseUrl, identifier);
  if (!apId) return c.json({ error: 'Actor not found' }, 404);

  // Try local actor first
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

  // Check follow status if logged in and viewing a different actor
  let is_following = false;
  let is_followed_by = false;

  if (currentActor && currentActor.ap_id !== apId) {
    const [followingStatus, followedByStatus] = await Promise.all([
      prisma.follow.findFirst({
        where: { followerApId: currentActor.ap_id, followingApId: apId, status: 'accepted' },
      }),
      prisma.follow.findFirst({
        where: { followerApId: apId, followingApId: currentActor.ap_id, status: 'accepted' },
      }),
    ]);
    is_following = !!followingStatus;
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
  const result = requireActor(c);
  if (result instanceof Response) return result;
  const actor = result;

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
  for (const [bodyKey, dbKey, label] of [
    ['icon_url', 'iconUrl', 'Icon URL'],
    ['header_url', 'headerUrl', 'Header URL'],
  ] as const) {
    const raw = body[bodyKey];
    if (raw !== undefined) {
      const trimmed = raw.trim();
      if (trimmed.length > MAX_PROFILE_URL_LENGTH) {
        return c.json({ error: `${label} too long (max ${MAX_PROFILE_URL_LENGTH} chars)` }, 400);
      }
      if (trimmed.length > 0 && !isValidHttpUrl(trimmed)) {
        return c.json({ error: `Invalid ${bodyKey}` }, 400);
      }
      updates[dbKey] = trimmed.length > 0 ? trimmed : null;
    }
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

// Shared handler for followers / following lists
async function listFollowRelation(
  c: AppContext,
  direction: 'followers' | 'following',
): Promise<Response> {
  const identifier = c.req.param('identifier');
  const apId = await resolveActorApId(c.get('prisma'), c.env.APP_URL, identifier);
  if (!apId) return c.json({ error: 'Actor not found' }, 404);

  const limit = parseLimit(c.req.query('limit'), 50, 100);
  const offset = parseOffset(c.req.query('offset'), 0, 10000);
  const prisma = c.get('prisma');

  const isFollowers = direction === 'followers';
  const where = isFollowers
    ? { followingApId: apId, status: 'accepted' as const }
    : { followerApId: apId, status: 'accepted' as const };

  const [follows, total] = await Promise.all([
    prisma.follow.findMany({ where, orderBy: { createdAt: 'desc' }, skip: offset, take: limit }),
    prisma.follow.count({ where }),
  ]);

  const extractApId = isFollowers
    ? (f: { followerApId: string }) => f.followerApId
    : (f: { followingApId: string }) => f.followingApId;
  const targetApIds = follows.map(extractApId);
  const infoMap = await loadActorInfoMap(prisma, targetApIds);
  const items = follows.map((f) => {
    const id = extractApId(f);
    return formatActorSummary(id, infoMap.get(id));
  });

  return c.json({
    [direction]: items,
    total,
    limit,
    offset,
    has_more: offset + items.length < total,
  });
}

// Get actor's followers
actors.get('/:identifier/followers', async (c) => listFollowRelation(c, 'followers'));

// Get actor's following
actors.get('/:identifier/following', async (c) => listFollowRelation(c, 'following'));

export default actors;
