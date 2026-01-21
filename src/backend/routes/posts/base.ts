import { Hono } from 'hono';
import type { Env, Variables } from '../../types';
import { generateId, objectApId, activityApId, formatUsername, isLocal, safeJsonParse } from '../../utils';
import { MAX_POST_CONTENT_LENGTH, MAX_POST_SUMMARY_LENGTH, MAX_POSTS_PAGE_LIMIT, extractMentions, formatPost, normalizeVisibility, parseLimit, PostRow } from './utils';
import { deliverActivity, deliverActivityToMany } from '../../lib/activitypub-helpers';

const posts = new Hono<{ Bindings: Env; Variables: Variables }>();

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

// Create post
posts.post('/', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);
  const prisma = c.get('prisma');

  const body = await c.req.json<CreatePostBody>();

  const content = body.content?.trim();
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

  const visibility = normalizeVisibility(body.visibility);
  let communityId: string | null = null;
  if (body.community_ap_id) {
    const community = await prisma.community.findFirst({
      where: {
        OR: [
          { apId: body.community_ap_id },
          { preferredUsername: body.community_ap_id }
        ]
      },
      select: { apId: true, postPolicy: true }
    });

    if (!community) {
      return c.json({ error: 'Community not found' }, 404);
    }

    communityId = community.apId;

    const membership = await prisma.communityMember.findUnique({
      where: {
        communityApId_actorApId: {
          communityApId: community.apId,
          actorApId: actor.ap_id
        }
      },
      select: { role: true }
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

  // Insert the post
  try {
    await prisma.object.create({
      data: {
        apId: apId,
        type: 'Note',
        attributedTo: actor.ap_id,
        content: content,
        summary: summary || null,
        attachmentsJson: JSON.stringify(body.attachments || []),
        inReplyTo: body.in_reply_to || null,
        visibility: visibility,
        communityApId: communityId,
        published: now,
        isLocal: 1
      }
    });
  } catch (e) {
    console.error('[Posts] Failed to insert post:', e);
    return c.json({ error: 'Failed to create post' }, 500);
  }

  // Update author's post count
  try {
    await prisma.actor.update({
      where: { apId: actor.ap_id },
      data: { postCount: { increment: 1 } }
    });
  } catch (e) {
    console.error('[Posts] Failed to update post count:', e);
    // Non-critical error, continue
  }

  // If replying to someone, update reply count
  if (body.in_reply_to) {
    try {
      await prisma.object.update({
        where: { apId: body.in_reply_to },
        data: { replyCount: { increment: 1 } }
      });
    } catch (e) {
      console.error('[Posts] Failed to update reply count:', e);
      // Non-critical error, continue
    }

    // Add to inbox of the post author being replied to (AP Native notification)
    try {
      const parentPost = await prisma.object.findUnique({
        where: { apId: body.in_reply_to },
        select: { attributedTo: true }
      });
      if (parentPost && parentPost.attributedTo !== actor.ap_id && isLocal(parentPost.attributedTo, baseUrl)) {
        // Create activity for the inbox
        const replyActivityId = activityApId(baseUrl, generateId());
        await prisma.activity.create({
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
              object: apId
            }),
            createdAt: now
          }
        });

        // Add to recipient's inbox
        await prisma.inbox.create({
          data: {
            actorApId: parentPost.attributedTo,
            activityApId: replyActivityId,
            read: 0,
            createdAt: now
          }
        });
      }
    } catch (e) {
      console.error('[Posts] Failed to create reply notification:', e);
      // Non-critical error, continue
    }
  }

  // Process mentions and create notifications
  const mentions = extractMentions(content);
  if (mentions.length > 0) {
    // Batch lookup for local and remote mentions to avoid N+1 queries
    const localMentions = mentions.filter((m) => !m.includes('@'));
    const remoteMentions = mentions.filter((m) => m.includes('@'));

    // Batch fetch local actors
    const localActors = localMentions.length > 0
      ? await prisma.actor.findMany({
          where: { preferredUsername: { in: localMentions } },
          select: { apId: true, preferredUsername: true },
        })
      : [];
    const localActorMap = new Map(localActors.map((a) => [a.preferredUsername, a.apId]));

    // Batch fetch cached actors for remote mentions
    // Note: We need to check each remote mention individually as they have username@domain format
    // But we can batch fetch all cached actors and filter client-side
    const cachedActors = remoteMentions.length > 0
      ? await prisma.actorCache.findMany({
          where: {
            preferredUsername: { in: remoteMentions.map((m) => m.split('@')[0]) },
          },
          select: { apId: true, preferredUsername: true },
        })
      : [];

    // Build remote actor map (username@domain -> apId)
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

    // Get parent post author if replying (for deduplication)
    let parentAuthor: string | null = null;
    if (body.in_reply_to) {
      const parentPost = await prisma.object.findUnique({
        where: { apId: body.in_reply_to },
        select: { attributedTo: true },
      });
      parentAuthor = parentPost?.attributedTo || null;
    }

    // Collect activities and inbox entries to batch create
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
        let mentionedActorApId: string | null = null;

        if (mention.includes('@')) {
          mentionedActorApId = remoteActorMap.get(mention) || null;
        } else {
          mentionedActorApId = localActorMap.get(mention) || null;
        }

        // Skip if not found, is self, or already notified as reply recipient
        if (!mentionedActorApId || mentionedActorApId === actor.ap_id) continue;
        if (parentAuthor === mentionedActorApId) continue; // Already notified via reply

        // Create mention activity if local
        if (isLocal(mentionedActorApId, baseUrl)) {
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
        }
      } catch (e) {
        console.error(`Failed to process mention ${mention}:`, e);
      }
    }

    // Batch create activities and inbox entries
    if (activitiesToCreate.length > 0) {
      await prisma.activity.createMany({ data: activitiesToCreate });
    }
    if (inboxEntriesToCreate.length > 0) {
      await prisma.inbox.createMany({ data: inboxEntriesToCreate });
    }
  }

  // Federate to followers if visibility is public
  if (visibility !== 'direct') {
    const followers = await prisma.follow.findMany({
      where: {
        followingApId: actor.ap_id,
        status: 'accepted'
      },
      select: { followerApId: true },
      distinct: ['followerApId']
    });

    // Build to/cc fields based on visibility
    const followersUrl = `${actor.ap_id}/followers`;
    const publicUrl = 'https://www.w3.org/ns/activitystreams#Public';
    let toField: string[];
    let ccField: string[];

    if (visibility === 'public') {
      toField = [publicUrl];
      ccField = [followersUrl];
    } else if (visibility === 'unlisted') {
      toField = [followersUrl];
      ccField = [publicUrl];
    } else if (visibility === 'followers') {
      toField = [followersUrl];
      ccField = [];
    } else {
      // direct - would need specific recipients, for now use empty
      toField = [];
      ccField = [];
    }

    const createActivity = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      id: activityApId(baseUrl, generateId()),
      type: 'Create',
      actor: actor.ap_id,
      published: now,
      to: toField,
      cc: ccField,
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
        to: toField,
        cc: ccField,
      },
    };

    // Send to remote followers (non-blocking background delivery)
    const remoteFollowers = followers.filter((f) => !isLocal(f.followerApId, baseUrl));

    // Schedule delivery in background - don't await to avoid blocking the response
    // Use Promise.allSettled to ensure all deliveries are attempted even if some fail
    if (remoteFollowers.length > 0) {
      const senderActor = { apId: actor.ap_id, privateKeyPem: actor.private_key_pem };
      Promise.allSettled(
        remoteFollowers.map((follower) =>
          deliverActivity(prisma, senderActor, follower.followerApId, createActivity)
            .then((success) => {
              if (!success) {
                console.warn(`[Posts] Background delivery failed to ${follower.followerApId}`);
              }
            })
            .catch((err) => {
              console.error(`[Posts] Background delivery error to ${follower.followerApId}:`, err);
            })
        )
      ).catch((err) => {
        console.error('[Posts] Background delivery batch error:', err);
      });
    }

    // Store activity
    await prisma.activity.create({
      data: {
        apId: createActivity.id,
        type: 'Create',
        actorApId: actor.ap_id,
        objectApId: apId,
        rawJson: JSON.stringify(createActivity),
        direction: 'outbound'
      }
    });
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
  });
});

// Get single post
posts.get('/:id', async (c) => {
  const currentActor = c.get('actor');
  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  // Try to find the post with author info
  const postApId = objectApId(baseUrl, postId);
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: postApId },
        { apId: postId }
      ]
    },
    include: {
      author: {
        select: {
          preferredUsername: true,
          name: true,
          iconUrl: true
        }
      }
    }
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Try to get cached actor info if author is remote
  let authorUsername: string | null | undefined = post.author?.preferredUsername;
  let authorName: string | null | undefined = post.author?.name;
  let authorIconUrl: string | null | undefined = post.author?.iconUrl;

  if (!authorUsername) {
    const cachedActor = await prisma.actorCache.findUnique({
      where: { apId: post.attributedTo },
      select: { preferredUsername: true, name: true, iconUrl: true }
    });
    if (cachedActor) {
      authorUsername = cachedActor.preferredUsername;
      authorName = cachedActor.name;
      authorIconUrl = cachedActor.iconUrl;
    }
  }

  // Check liked and bookmarked status
  let liked = false;
  let bookmarked = false;
  if (currentActor) {
    const likeExists = await prisma.like.findUnique({
      where: {
        actorApId_objectApId: {
          actorApId: currentActor.ap_id,
          objectApId: post.apId
        }
      }
    });
    liked = !!likeExists;

    const bookmarkExists = await prisma.bookmark.findUnique({
      where: {
        actorApId_objectApId: {
          actorApId: currentActor.ap_id,
          objectApId: post.apId
        }
      }
    });
    bookmarked = !!bookmarkExists;
  }

  // Check visibility
  if (post.visibility === 'followers') {
    if (!currentActor) {
      return c.json({ error: 'Post not found' }, 404);
    }
    if (currentActor.ap_id !== post.attributedTo) {
      const follows = await prisma.follow.findUnique({
        where: {
          followerApId_followingApId: {
            followerApId: currentActor.ap_id,
            followingApId: post.attributedTo
          },
          status: 'accepted'
        }
      });
      if (!follows) {
        return c.json({ error: 'Post not found' }, 404);
      }
    }
  }

  if (post.visibility === 'direct') {
    if (!currentActor) {
      return c.json({ error: 'Post not found' }, 404);
    }
    if (currentActor.ap_id !== post.attributedTo) {
      const recipients = safeJsonParse<string[]>(post.toJson, []);
      if (!recipients.includes(currentActor.ap_id)) {
        return c.json({ error: 'Post not found' }, 404);
      }
    }
  }

  // Build PostRow-compatible object for formatPost
  const postRow: PostDetailRow = {
    ap_id: post.apId,
    type: post.type,
    attributed_to: post.attributedTo,
    author_username: authorUsername || null,
    author_name: authorName || null,
    author_icon_url: authorIconUrl || null,
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
    liked: liked ? 1 : 0,
    bookmarked: bookmarked ? 1 : 0,
    to_json: post.toJson
  };

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

  // Verify post exists
  const postApId = objectApId(baseUrl, postId);
  const parentPost = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: postApId },
        { apId: postId }
      ]
    },
    select: { apId: true }
  });

  if (!parentPost) return c.json({ error: 'Post not found' }, 404);

  // Build where clause
  const whereClause: {
    inReplyTo: string;
    published?: { lt: string };
  } = {
    inReplyTo: parentPost.apId
  };

  if (before) {
    whereClause.published = { lt: before };
  }

  // Get replies
  const replies = await prisma.object.findMany({
    where: whereClause,
    include: {
      author: {
        select: {
          preferredUsername: true,
          name: true,
          iconUrl: true
        }
      }
    },
    orderBy: { published: 'desc' },
    take: limit
  });

  // Batch load cached authors for replies without local author
  const repliesWithoutAuthor = replies.filter((r) => !r.author);
  const cachedAuthorApIds = [...new Set(repliesWithoutAuthor.map((r) => r.attributedTo))];
  const cachedAuthors = cachedAuthorApIds.length > 0
    ? await prisma.actorCache.findMany({
        where: { apId: { in: cachedAuthorApIds } },
        select: { apId: true, preferredUsername: true, name: true, iconUrl: true },
      })
    : [];
  const cachedAuthorMap = new Map(cachedAuthors.map((a) => [a.apId, a]));

  // Batch load likes and bookmarks if user is logged in
  const replyApIds = replies.map((r) => r.apId);
  const likedReplyIds = new Set<string>();
  const bookmarkedReplyIds = new Set<string>();

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
    likes.forEach((l) => likedReplyIds.add(l.objectApId));
    bookmarks.forEach((b) => bookmarkedReplyIds.add(b.objectApId));
  }

  // Process replies to match PostRow format
  const result = replies.map((reply) => {
    // Get author info (from local actor or cache)
    let authorUsername: string | null | undefined = reply.author?.preferredUsername;
    let authorName: string | null | undefined = reply.author?.name;
    let authorIconUrl: string | null | undefined = reply.author?.iconUrl;

    if (!authorUsername) {
      const cachedActor = cachedAuthorMap.get(reply.attributedTo);
      if (cachedActor) {
        authorUsername = cachedActor.preferredUsername;
        authorName = cachedActor.name;
        authorIconUrl = cachedActor.iconUrl;
      }
    }

    const liked = likedReplyIds.has(reply.apId);
    const bookmarked = bookmarkedReplyIds.has(reply.apId);

    const postRow: PostRow = {
      ap_id: reply.apId,
      type: reply.type,
      attributed_to: reply.attributedTo,
      author_username: authorUsername || null,
      author_name: authorName || null,
      author_icon_url: authorIconUrl || null,
      content: reply.content,
      summary: reply.summary,
      attachments_json: reply.attachmentsJson,
      in_reply_to: reply.inReplyTo,
      visibility: reply.visibility,
      community_ap_id: reply.communityApId,
      like_count: reply.likeCount,
      reply_count: reply.replyCount,
      announce_count: reply.announceCount,
      published: reply.published,
      liked: liked ? 1 : 0
    };

    return formatPost(postRow, currentActor?.ap_id);
  });

  return c.json({ replies: result });
});

// Edit post
posts.patch('/:id', async (c) => {
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const body = await c.req.json<{ content?: string; summary?: string }>();
  const prisma = c.get('prisma');

  // Get the post
  const postApId = objectApId(baseUrl, postId);
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: postApId },
        { apId: postId }
      ]
    }
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Only author can edit
  if (post.attributedTo !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

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

  // Build update data
  const updateData: {
    content?: string;
    summary?: string | null;
    updated: string;
  } = {
    updated: now
  };

  if (body.content !== undefined) {
    updateData.content = trimmedContent;
  }
  if (body.summary !== undefined) {
    updateData.summary = trimmedSummary || null;
  }

  if (Object.keys(updateData).length === 1) {
    // Only updated timestamp, no real changes
    return c.json({ error: 'No changes provided' }, 400);
  }

  await prisma.object.update({
    where: { apId: post.apId },
    data: updateData
  });

  // Send Update activity to followers
  const followers = await prisma.follow.findMany({
    where: {
      followingApId: actor.ap_id,
      status: 'accepted'
    },
    select: { followerApId: true },
    distinct: ['followerApId']
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

  // P07: Send to remote followers in parallel with concurrency limit
  const remoteFollowers = followers.filter((f) => !isLocal(f.followerApId, baseUrl));
  const senderActor = { apId: actor.ap_id, privateKeyPem: actor.private_key_pem };
  await deliverActivityToMany(prisma, senderActor, remoteFollowers.map(f => f.followerApId), updateActivity);

  // Store activity
  await prisma.activity.create({
    data: {
      apId: updateActivity.id,
      type: 'Update',
      actorApId: actor.ap_id,
      objectApId: post.apId,
      rawJson: JSON.stringify(updateActivity),
      direction: 'outbound'
    }
  });

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
  const actor = c.get('actor');
  if (!actor) return c.json({ error: 'Unauthorized' }, 401);

  const postId = c.req.param('id');
  const baseUrl = c.env.APP_URL;
  const prisma = c.get('prisma');

  // Get the post
  const postApId = objectApId(baseUrl, postId);
  const post = await prisma.object.findFirst({
    where: {
      OR: [
        { apId: postApId },
        { apId: postId }
      ]
    }
  });

  if (!post) return c.json({ error: 'Post not found' }, 404);

  // Only author can delete
  if (post.attributedTo !== actor.ap_id) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Delete the post
  await prisma.object.delete({
    where: { apId: post.apId }
  });

  // Update author's post count
  await prisma.actor.update({
    where: { apId: actor.ap_id },
    data: {
      postCount: { decrement: 1 }
    }
  });

  // If this was a reply, update parent's reply count
  if (post.inReplyTo) {
    try {
      await prisma.object.update({
        where: { apId: post.inReplyTo },
        data: {
          replyCount: { decrement: 1 }
        }
      });
    } catch (err) {
      // HIGH FIX: Log the error - parent post may not exist, but we should still log for debugging
      console.warn('[Posts] Failed to decrement parent reply count (parent may not exist):', err);
    }
  }

  // Send Delete activity to followers
  const followers = await prisma.follow.findMany({
    where: {
      followingApId: actor.ap_id,
      status: 'accepted'
    },
    select: { followerApId: true },
    distinct: ['followerApId']
  });

  const deleteActivity = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    id: activityApId(baseUrl, generateId()),
    type: 'Delete',
    actor: actor.ap_id,
    object: post.apId,
  };

  // P07: Send to remote followers in parallel with concurrency limit
  const remoteFollowers = followers.filter((f) => !isLocal(f.followerApId, baseUrl));
  const senderActorDelete = { apId: actor.ap_id, privateKeyPem: actor.private_key_pem };
  await deliverActivityToMany(prisma, senderActorDelete, remoteFollowers.map(f => f.followerApId), deleteActivity);

  return c.json({ success: true });
});


export default posts;
