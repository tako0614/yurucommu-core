import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, formatUsername, isLocal, safeJsonParse } from '../../utils';
import { MAX_POST_CONTENT_LENGTH, MAX_POST_SUMMARY_LENGTH, MAX_POSTS_PAGE_LIMIT, extractMentions, formatPost, normalizeVisibility, parseLimit, PostRow } from './utils';
import { enqueueFanoutToFollowers } from '../../lib/delivery/queue';

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();
const REPLY_TARGET_NOT_FOUND = 'REPLY_TARGET_NOT_FOUND';

type PostAttachment = {
  type?: string;
  mediaType?: string;
  url?: string;
  [key: string]: unknown;
};

type CreatePostBody = {
  content: string;
  summary?: string;
  attachments?: PostAttachment[];
  in_reply_to?: string;
  visibility?: string;
  community_ap_id?: string;
};

type PostDetailRow = PostRow & {
  to_json?: string | null;
  bookmarked?: number;
};

type MentionFailure = {
  mention: string;
  stage: 'resolve' | 'persist_activity' | 'persist_inbox';
  reason: string;
};

type AuthorInfo = {
  preferredUsername: string | null;
  name: string | null;
  iconUrl: string | null;
};

// --- Inline helpers ---

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function parseJsonObject(
  c: { req: { json: () => Promise<unknown> } }
): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    if (!isRecord(body)) return null;
    return body;
  } catch {
    return null;
  }
}

/** Require an authenticated actor or return a 401 response. */
function requireActor(c: { get: (key: 'actor') => Variables['actor'] }): Variables['actor'] {
  const actor = c.get('actor');
  if (!actor) return null;
  return actor;
}

/** Shared Prisma `include` for loading a post's local author info. */
const AUTHOR_INCLUDE = {
  author: {
    select: {
      preferredUsername: true,
      name: true,
      iconUrl: true,
    },
  },
} as const;

/** Build a `where` clause that matches either the full apId or the raw postId. */
function postWhereByIdOrApId(baseUrl: string, postId: string): { OR: [{ apId: string }, { apId: string }] } {
  return {
    OR: [
      { apId: objectApId(baseUrl, postId) },
      { apId: postId },
    ],
  };
}

/**
 * Validate that a raw field is either absent, null, or a string.
 * Returns an error message string if invalid, or null if valid.
 */
function validateOptionalString(raw: Record<string, unknown>, field: string): string | null {
  const value = raw[field];
  if (value !== undefined && value !== null && typeof value !== 'string') {
    return `${field} must be a string`;
  }
  return null;
}

/**
 * Resolve author info from a Prisma post's local author or a cached-author map.
 * Returns { preferredUsername, name, iconUrl } with nulls as fallback.
 */
function resolveAuthor(
  localAuthor: AuthorInfo | null | undefined,
  attributedTo: string,
  cachedAuthorMap?: Map<string, AuthorInfo>,
): AuthorInfo {
  if (localAuthor?.preferredUsername) return localAuthor;
  const cached = cachedAuthorMap?.get(attributedTo);
  if (cached) return cached;
  return { preferredUsername: null, name: null, iconUrl: null };
}

/** Convert a Prisma object row + resolved author into a PostRow for formatPost. */
function toPostRow(
  post: {
    apId: string;
    type: string;
    attributedTo: string;
    content: string;
    summary: string | null;
    attachmentsJson: string | null;
    inReplyTo: string | null;
    visibility: string;
    communityApId: string | null;
    likeCount: number;
    replyCount: number;
    announceCount: number;
    published: string;
    toJson?: string | null;
  },
  author: AuthorInfo,
  flags: { liked: boolean; bookmarked?: boolean },
): PostRow & { to_json?: string | null; bookmarked?: number } {
  return {
    ap_id: post.apId,
    type: post.type,
    attributed_to: post.attributedTo,
    author_username: author.preferredUsername,
    author_name: author.name,
    author_icon_url: author.iconUrl,
    content: post.content,
    summary: post.summary,
    attachments_json: post.attachmentsJson,
    in_reply_to: post.inReplyTo,
    visibility: post.visibility,
    community_ap_id: post.communityApId,
    like_count: post.likeCount,
    reply_count: post.replyCount,
    announce_count: post.announceCount,
    published: post.published,
    liked: flags.liked ? 1 : 0,
    ...(flags.bookmarked !== undefined ? { bookmarked: flags.bookmarked ? 1 : 0 } : {}),
    ...(post.toJson !== undefined ? { to_json: post.toJson } : {}),
  };
}

/** Compute to/cc fields from visibility for ActivityPub delivery. */
function buildAddressing(visibility: string, followersUrl: string): { to: string[]; cc: string[] } {
  const publicUrl = 'https://www.w3.org/ns/activitystreams#Public';
  switch (visibility) {
    case 'public':
      return { to: [publicUrl], cc: [followersUrl] };
    case 'unlisted':
      return { to: [followersUrl], cc: [publicUrl] };
    case 'followers':
      return { to: [followersUrl], cc: [] };
    default:
      return { to: [], cc: [] };
  }
}

// --- Route handlers ---

// Create post
posts.post('/', async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const rawBody = await parseJsonObject(c);
  if (!rawBody) {
    return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);
  }

  if (typeof rawBody.content !== 'string') {
    return c.json({ error: 'content must be a string', code: 'BAD_REQUEST' }, 400);
  }

  // Validate optional string fields
  for (const field of ['summary', 'visibility', 'in_reply_to', 'community_ap_id'] as const) {
    const error = validateOptionalString(rawBody, field);
    if (error) return c.json({ error, code: 'BAD_REQUEST' }, 400);
  }

  if (rawBody.attachments !== undefined && !Array.isArray(rawBody.attachments)) {
    return c.json({ error: 'attachments must be an array', code: 'BAD_REQUEST' }, 400);
  }
  if (Array.isArray(rawBody.attachments) && rawBody.attachments.some((a) => !isRecord(a))) {
    return c.json({ error: 'attachments must be objects', code: 'BAD_REQUEST' }, 400);
  }

  const body: CreatePostBody = {
    content: rawBody.content,
    summary: typeof rawBody.summary === 'string' ? rawBody.summary : undefined,
    attachments: Array.isArray(rawBody.attachments) ? rawBody.attachments as PostAttachment[] : undefined,
    in_reply_to: typeof rawBody.in_reply_to === 'string' ? rawBody.in_reply_to : undefined,
    visibility: typeof rawBody.visibility === 'string' ? rawBody.visibility : undefined,
    community_ap_id: typeof rawBody.community_ap_id === 'string' ? rawBody.community_ap_id : undefined,
  };

  const content = body.content.trim();
  const summary = body.summary?.trim();

  if (!content) {
    return c.json({ error: 'Content required' }, 400);
  }
  if (content.length > MAX_POST_CONTENT_LENGTH) {
    return c.json({ error: `Content too long (max ${MAX_POST_CONTENT_LENGTH} chars)` }, 400);
  }
  if (summary && summary.length > MAX_POST_SUMMARY_LENGTH) {
    return c.json({ error: `Summary too long (max ${MAX_POST_SUMMARY_LENGTH} chars)` }, 400);
  }

  const prisma = c.get('prisma');
  const visibility = normalizeVisibility(body.visibility);
  let communityId: string | null = null;

  if (body.community_ap_id) {
    const community = await prisma.community.findFirst({
      where: {
        OR: [
          { apId: body.community_ap_id },
          { preferredUsername: body.community_ap_id },
        ],
      },
      select: { apId: true, postPolicy: true },
    });

    if (!community) return c.json({ error: 'Community not found' }, 404);

    communityId = community.apId;

    const membership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id,
        },
      },
      select: { role: true },
    });

    const policy = community.postPolicy || 'members';
    const role = membership?.role as 'owner' | 'moderator' | 'member' | undefined;
    const isManager = role === 'owner' || role === 'moderator';

    if (policy !== 'anyone' && !membership) {
      return c.json({ error: 'Not a community member' }, 403);
    }
    if (policy === 'mods' && !isManager) {
      return c.json({ error: 'Moderator role required' }, 403);
    }
    if (policy === 'owners' && role !== 'owner') {
      return c.json({ error: 'Owner role required' }, 403);
    }
  }

  const baseUrl = c.env.APP_URL;
  const postId = generateId();
  const apId = objectApId(baseUrl, postId);
  const now = new Date().toISOString();
  let parentAuthor: string | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.object.create({
        data: {
          apId,
          type: 'Note',
          attributedTo: actor.ap_id,
          content,
          summary: summary || null,
          attachmentsJson: JSON.stringify(body.attachments || []),
          inReplyTo: body.in_reply_to || null,
          visibility,
          communityApId: communityId,
          published: now,
          isLocal: 1,
        },
      });

      await tx.actor.update({
        where: { apId: actor.ap_id },
        data: { postCount: { increment: 1 } },
      });

      if (!body.in_reply_to) return;

      const parentPost = await tx.object.findUnique({
        where: { apId: body.in_reply_to },
        select: { attributedTo: true },
      });

      if (!parentPost) throw new Error(REPLY_TARGET_NOT_FOUND);

      parentAuthor = parentPost.attributedTo;

      await tx.object.update({
        where: { apId: body.in_reply_to },
        data: { replyCount: { increment: 1 } },
      });

      if (parentPost.attributedTo === actor.ap_id || !isLocal(parentPost.attributedTo, baseUrl)) return;

      const replyActivityId = activityApId(baseUrl, generateId());
      await tx.activity.create({
        data: {
          apId: replyActivityId,
          type: 'Create',
          actorApId: actor.ap_id,
          objectApId: apId,
          rawJson: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: replyActivityId,
            type: 'Create',
            actor: actor.ap_id,
            object: apId,
          }),
          createdAt: now,
        },
      });

      await tx.inbox.create({
        data: {
          actorApId: parentPost.attributedTo,
          activityApId: replyActivityId,
          read: 0,
          createdAt: now,
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === REPLY_TARGET_NOT_FOUND) {
      return c.json({ error: 'Reply target not found' }, 404);
    }
    console.error('[Posts] Failed to create post transaction:', e);
    return c.json({ error: 'Failed to create post' }, 500);
  }

  // Process mentions and create notifications
  const mentions = extractMentions(content);
  const mentionFailures: MentionFailure[] = [];

  if (mentions.length > 0) {
    const localMentions = mentions.filter((m) => !m.includes('@'));
    const remoteMentions = mentions.filter((m) => m.includes('@'));

    const localActors = localMentions.length > 0
      ? await prisma.actor.findMany({
          where: { preferredUsername: { in: localMentions } },
          select: { apId: true, preferredUsername: true },
        })
      : [];
    const localActorMap = new Map(localActors.map((a) => [a.preferredUsername, a.apId]));

    const cachedActors = remoteMentions.length > 0
      ? await prisma.actorCache.findMany({
          where: { preferredUsername: { in: remoteMentions.map((m) => m.split('@')[0]) } },
          select: { apId: true, preferredUsername: true },
        })
      : [];

    const remoteActorMap = new Map<string, string>();
    for (const mention of remoteMentions) {
      const [username, domain] = mention.split('@');
      const matching = cachedActors.find(
        (a) => a.preferredUsername === username && a.apId.includes(domain)
      );
      if (matching) {
        remoteActorMap.set(mention, matching.apId);
      }
    }

    const activitiesToCreate: Array<{
      apId: string;
      type: string;
      actorApId: string;
      objectApId: string;
      rawJson: string;
      createdAt: string;
    }> = [];
    const inboxEntriesToCreate: Array<{
      actorApId: string;
      activityApId: string;
      read: number;
      createdAt: string;
    }> = [];

    for (const mention of mentions) {
      try {
        const mentionedActorApId = mention.includes('@')
          ? remoteActorMap.get(mention) || null
          : localActorMap.get(mention) || null;

        if (!mentionedActorApId || mentionedActorApId === actor.ap_id) continue;
        if (parentAuthor === mentionedActorApId) continue;

        if (!isLocal(mentionedActorApId, baseUrl)) continue;

        const mentionActivityId = activityApId(baseUrl, generateId());
        activitiesToCreate.push({
          apId: mentionActivityId,
          type: 'Create',
          actorApId: actor.ap_id,
          objectApId: apId,
          rawJson: JSON.stringify({
            '@context': 'https://www.w3.org/ns/activitystreams',
            id: mentionActivityId,
            type: 'Create',
            actor: actor.ap_id,
            object: apId,
          }),
          createdAt: now,
        });

        inboxEntriesToCreate.push({
          actorApId: mentionedActorApId,
          activityApId: mentionActivityId,
          read: 0,
          createdAt: now,
        });
      } catch (e) {
        console.error(`Failed to process mention ${mention}:`, e);
        mentionFailures.push({
          mention,
          stage: 'resolve',
          reason: 'mention_processing_failed',
        });
      }
    }

    if (activitiesToCreate.length > 0) {
      try {
        await prisma.activity.createMany({ data: activitiesToCreate });
      } catch (e) {
        console.error('[Posts] Failed to persist mention activities:', e);
        mentionFailures.push({
          mention: '__batch__',
          stage: 'persist_activity',
          reason: 'mention_activity_persist_failed',
        });
      }
    }
    if (inboxEntriesToCreate.length > 0) {
      try {
        await prisma.inbox.createMany({ data: inboxEntriesToCreate });
      } catch (e) {
        console.error('[Posts] Failed to persist mention inbox entries:', e);
        mentionFailures.push({
          mention: '__batch__',
          stage: 'persist_inbox',
          reason: 'mention_inbox_persist_failed',
        });
      }
    }
  }

  // Federate to followers if visibility is not direct
  if (visibility !== 'direct') {
    const followersUrl = `${actor.ap_id}/followers`;
    const { to, cc } = buildAddressing(visibility, followersUrl);

    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityApId(baseUrl, generateId()),
      type: 'Create',
      actor: actor.ap_id,
      published: now,
      to,
      cc,
      object: {
        '@context': 'https://www.w3.org/ns/activitystreams',
        id: apId,
        type: 'Note',
        attributedTo: actor.ap_id,
        content,
        summary: summary || null,
        attachment: body.attachments || [],
        inReplyTo: body.in_reply_to || null,
        published: now,
        to,
        cc,
      },
    };

    await prisma.activity.create({
      data: {
        apId: createActivity.id,
        type: 'Create',
        actorApId: actor.ap_id,
        objectApId: apId,
        rawJson: JSON.stringify(createActivity),
        direction: 'outbound',
      },
    });

    try {
      await enqueueFanoutToFollowers(c.env, createActivity.id, actor.ap_id);
    } catch (err) {
      console.error('[Posts] Failed to enqueue federation fanout:', err);
    }
  }

  return c.json({
    ap_id: apId,
    type: 'Note',
    author: {
      ap_id: actor.ap_id,
      username: formatUsername(actor.ap_id),
      preferred_username: actor.preferred_username,
      name: actor.name,
      icon_url: actor.icon_url,
    },
    content,
    summary: summary || null,
    attachments: body.attachments || [],
    visibility,
    published: now,
    like_count: 0,
    reply_count: 0,
    announce_count: 0,
    liked: false,
    bookmarked: false,
    ...(mentionFailures.length > 0
      ? {
          mention_processing: {
            failed_count: mentionFailures.length,
            failures: mentionFailures,
          },
        }
      : {}),
  });
});

// Get single post
posts.get('/:id', async (c) => {
  const currentActor = c.get('actor');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  const post = await prisma.object.findFirst({
    where: postWhereByIdOrApId(baseUrl, postId),
    include: AUTHOR_INCLUDE,
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Resolve author from local actor or cache
  let author = resolveAuthor(post.author, post.attributedTo);
  if (!author.preferredUsername) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: post.attributedTo },
      select: { preferredUsername: true, name: true, iconUrl: true },
    });
    if (cachedActor) author = cachedActor;
  }

  // Check liked and bookmarked status
  let liked = false;
  let bookmarked = false;
  if (currentActor) {
    const [likeExists, bookmarkExists] = await Promise.all([
      prisma.like.findUnique({
        where: {
          actorApId_objectApId: {
            actorApId: currentActor.ap_id,
            objectApId: post.apId,
          },
        },
      }),
      prisma.bookmark.findUnique({
        where: {
          actorApId_objectApId: {
            actorApId: currentActor.ap_id,
            objectApId: post.apId,
          },
        },
      }),
    ]);
    liked = !!likeExists;
    bookmarked = !!bookmarkExists;
  }

  // Check visibility - followers-only
  if (post.visibility === 'followers') {
    if (!currentActor) return c.json({ error: 'Post not found' }, 404);
    if (currentActor.ap_id !== post.attributedTo) {
      const follows = await prisma.follow.findUnique({
        where: {
          followerApId_followingApId: {
            followerApId: currentActor.ap_id,
            followingApId: post.attributedTo,
          },
          status: 'accepted',
        },
      });
      if (!follows) return c.json({ error: 'Post not found' }, 404);
    }
  }

  // Check visibility - direct messages
  if (post.visibility === 'direct') {
    if (!currentActor) return c.json({ error: 'Post not found' }, 404);
    if (currentActor.ap_id !== post.attributedTo) {
      const recipients = safeJsonParse<string[]>(post.toJson, []);
      if (!recipients.includes(currentActor.ap_id)) {
        return c.json({ error: 'Post not found' }, 404);
      }
    }
  }

  const postRow: PostDetailRow = toPostRow(
    post,
    author,
    { liked, bookmarked },
  );

  return c.json({ post: formatPost(postRow, currentActor?.ap_id) });
});

// Get post replies
posts.get('/:id/replies', async (c) => {
  const currentActor = c.get('actor');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const limit = parseLimit(c.req.query('limit'), 20, MAX_POSTS_PAGE_LIMIT);
  const before = c.req.query('before');
  const prisma = c.get('prisma');

  const parentPost = await prisma.object.findFirst({
    where: postWhereByIdOrApId(baseUrl, postId),
    select: { apId: true },
  });

  if (!parentPost) return c.json({ error: 'Post not found' }, 404);

  const whereClause: {
    inReplyTo: string;
    published?: { lt: string };
  } = { inReplyTo: parentPost.apId };

  if (before) {
    whereClause.published = { lt: before };
  }

  const replies = await prisma.object.findMany({
    where: whereClause,
    include: AUTHOR_INCLUDE,
    orderBy: { published: 'desc' },
    take: limit,
  });

  // Batch load cached authors for replies without a local author
  const remoteAttributedTos = [...new Set(
    replies.filter((r) => !r.author).map((r) => r.attributedTo)
  )];
  const cachedAuthors = remoteAttributedTos.length > 0
    ? await prisma.actorCache.findMany({
        where: { apId: { in: remoteAttributedTos } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
      })
    : [];
  const cachedAuthorMap = new Map(cachedAuthors.map((a) => [a.apId, a]));

  // Batch load likes and bookmarks for the current user
  const replyApIds = replies.map((r) => r.apId);
  let likedIds = new Set<string>();
  let bookmarkedIds = new Set<string>();

  if (currentActor) {
    const [likes, bookmarks] = await Promise.all([
      prisma.like.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: replyApIds } },
        select: { objectApId: true },
      }),
      prisma.bookmark.findMany({
        where: { actorApId: currentActor.ap_id, objectApId: { in: replyApIds } },
        select: { objectApId: true },
      }),
    ]);
    likedIds = new Set(likes.map((l) => l.objectApId));
    bookmarkedIds = new Set(bookmarks.map((b) => b.objectApId));
  }

  const result = replies.map((reply) => {
    const author = resolveAuthor(reply.author, reply.attributedTo, cachedAuthorMap);
    const postRow = toPostRow(reply, author, {
      liked: likedIds.has(reply.apId),
    });
    return formatPost(postRow, currentActor?.ap_id);
  });

  return c.json({ replies: result });
});

// Edit post
posts.patch('/:id', async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const rawBody = await parseJsonObject(c);
  if (!rawBody) {
    return c.json({ error: 'Invalid request body', code: 'BAD_REQUEST' }, 400);
  }

  for (const field of ['content', 'summary'] as const) {
    const error = validateOptionalString(rawBody, field);
    if (error) return c.json({ error, code: 'BAD_REQUEST' }, 400);
  }

  const body: { content?: string; summary?: string } = {
    content: typeof rawBody.content === 'string' ? rawBody.content : undefined,
    summary: typeof rawBody.summary === 'string' ? rawBody.summary : undefined,
  };
  const prisma = c.get('prisma');

  const post = await prisma.object.findFirst({
    where: postWhereByIdOrApId(baseUrl, postId),
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);
  if (post.attributedTo !== actor.ap_id) return c.json({ error: 'Forbidden' }, 403);

  // Validate content
  let trimmedContent: string | undefined;
  if (body.content !== undefined) {
    trimmedContent = body.content.trim();
    if (trimmedContent.length === 0) {
      return c.json({ error: 'Content cannot be empty' }, 400);
    }
    if (trimmedContent.length > MAX_POST_CONTENT_LENGTH) {
      return c.json({ error: `Content too long (max ${MAX_POST_CONTENT_LENGTH} chars)` }, 400);
    }
  }

  let trimmedSummary: string | undefined;
  if (body.summary !== undefined) {
    trimmedSummary = body.summary.trim();
    if (trimmedSummary.length > MAX_POST_SUMMARY_LENGTH) {
      return c.json({ error: `Summary too long (max ${MAX_POST_SUMMARY_LENGTH} chars)` }, 400);
    }
  }

  const nextContent = body.content !== undefined ? (trimmedContent as string) : post.content;
  const nextSummary = body.summary !== undefined ? trimmedSummary || null : post.summary;
  const now = new Date().toISOString();

  const updateData: {
    content?: string;
    summary?: string | null;
    updated: string;
  } = { updated: now };

  if (body.content !== undefined) updateData.content = trimmedContent;
  if (body.summary !== undefined) updateData.summary = trimmedSummary || null;

  if (Object.keys(updateData).length === 1) {
    return c.json({ error: 'No changes provided' }, 400);
  }

  await prisma.object.update({
    where: { apId: post.apId },
    data: updateData,
  });

  const updateActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityApId(baseUrl, generateId()),
    type: 'Update',
    actor: actor.ap_id,
    object: {
      id: post.apId,
      type: 'Note',
      attributedTo: actor.ap_id,
      content: nextContent,
      summary: nextSummary,
      updated: now,
    },
  };

  await prisma.activity.create({
    data: {
      apId: updateActivity.id,
      type: 'Update',
      actorApId: actor.ap_id,
      objectApId: post.apId,
      rawJson: JSON.stringify(updateActivity),
      direction: 'outbound',
    },
  });

  try {
    await enqueueFanoutToFollowers(c.env, updateActivity.id, actor.ap_id);
  } catch (err) {
    console.error('[Posts] Failed to enqueue Update federation fanout:', err);
  }

  return c.json({
    success: true,
    post: {
      ap_id: post.apId,
      content: nextContent,
      summary: nextSummary,
      updated_at: now,
    },
  });
});

// Delete post
posts.delete('/:id', async (c) => {
  const actor = requireActor(c);
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  const post = await prisma.object.findFirst({
    where: postWhereByIdOrApId(baseUrl, postId),
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);
  if (post.attributedTo !== actor.ap_id) return c.json({ error: 'Forbidden' }, 403);

  const parentUpdated = await prisma.$transaction(async (tx) => {
    await tx.object.delete({ where: { apId: post.apId } });

    await tx.actor.update({
      where: { apId: actor.ap_id },
      data: { postCount: { decrement: 1 } },
    });

    if (!post.inReplyTo) return true;

    const updateResult = await tx.object.updateMany({
      where: { apId: post.inReplyTo },
      data: { replyCount: { decrement: 1 } },
    });
    return updateResult.count > 0;
  });

  if (post.inReplyTo && !parentUpdated) {
    console.warn('[Posts] Failed to decrement parent reply count (parent may not exist)');
  }

  const deleteActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityApId(baseUrl, generateId()),
    type: 'Delete',
    actor: actor.ap_id,
    object: post.apId,
  };

  await prisma.activity.create({
    data: {
      apId: deleteActivity.id,
      type: 'Delete',
      actorApId: actor.ap_id,
      objectApId: post.apId,
      rawJson: JSON.stringify(deleteActivity),
      direction: 'outbound',
    },
  });

  try {
    await enqueueFanoutToFollowers(c.env, deleteActivity.id, actor.ap_id);
  } catch (err) {
    console.error('[Posts] Failed to enqueue Delete federation fanout:', err);
  }

  return c.json({ success: true });
});

export default posts;
