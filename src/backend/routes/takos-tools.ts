/**
 * Takos Tools Endpoint
 *
 * Provides tool endpoints for AI agent integration via takopack.
 * POST /.takos/tools/:name - Execute a tool
 */

import { Hono } from 'hono';
import type { Env, Variables } from '../types';
import { activityApId, formatUsername, generateId, objectApId, parseLimit, safeJsonParse } from '../utils';
import { getConversationId } from './dm/utils';

type HonoEnv = { Bindings: Env; Variables: Variables };
type Input = Record<string, unknown>;

const takosTools = new Hono<HonoEnv>();

// Feature flag gate (fail-close).
takosTools.use('*', async (c, next) => {
  if (c.env.ENABLE_TAKOS_TOOLS !== 'true') {
    return c.notFound();
  }
  await next();
});

interface ToolRequest {
  input: Record<string, unknown>;
  context?: {
    user_id?: string;
    session_id?: string;
  };
}

interface ToolResponse {
  success: boolean;
  data?: unknown;
  error?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toolLimit(value: unknown, fallback: number, max: number): number {
  const normalized = value == null ? undefined : String(value);
  return parseLimit(normalized, fallback, max);
}

function requireString(input: Input, key: string): string {
  return String(input[key] || '').trim();
}

function errAuth(): ToolResponse {
  return { success: false, error: 'Authentication required' };
}

function errRequired(field: string): ToolResponse {
  return { success: false, error: `${field} is required` };
}

function errNotFound(entity: string): ToolResponse {
  return { success: false, error: `${entity} not found` };
}

interface ActorSummary {
  apId: string;
  preferredUsername: string;
  name: string | null;
  iconUrl: string | null;
}

function formatActorSummary(a: ActorSummary): Record<string, unknown> {
  return {
    ap_id: a.apId,
    username: formatUsername(a.apId),
    preferred_username: a.preferredUsername,
    name: a.name,
    icon_url: a.iconUrl,
  };
}

const ACTOR_SUMMARY_SELECT = {
  apId: true,
  preferredUsername: true,
  name: true,
  iconUrl: true,
} as const;

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

takosTools.post('/:name', async (c) => {
  const toolName = c.req.param('name');
  const actor = c.get('actor');
  const prisma = c.get('prisma');

  let body: ToolRequest;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Invalid JSON body' } as ToolResponse, 400);
  }

  const input = body.input || {};

  try {
    switch (toolName) {
      // ------ Search tools ------

      case 'yurucommu_search_users': {
        const query = requireString(input, 'query');
        const limit = toolLimit(input.limit, 20, 50);

        if (!query) {
          return c.json({ success: true, data: { actors: [] } });
        }

        const actors = await prisma.actor.findMany({
          where: {
            isPrivate: 0,
            OR: [
              { preferredUsername: { contains: query } },
              { name: { contains: query } },
            ],
          },
          select: {
            ...ACTOR_SUMMARY_SELECT,
            summary: true,
            followerCount: true,
          },
          orderBy: { followerCount: 'desc' },
          take: limit,
        });

        return c.json({
          success: true,
          data: {
            actors: actors.map(a => ({
              ...formatActorSummary(a),
              summary: a.summary,
              follower_count: a.followerCount,
            })),
          },
        });
      }

      case 'yurucommu_search_posts': {
        const query = requireString(input, 'query');
        const limit = toolLimit(input.limit, 20, 50);

        if (!query) {
          return c.json({ success: true, data: { posts: [] } });
        }

        const posts = await prisma.object.findMany({
          where: {
            content: { contains: query },
            visibility: 'public',
          },
          orderBy: { published: 'desc' },
          take: limit,
        });

        return c.json({
          success: true,
          data: {
            posts: posts.map(p => ({
              ap_id: p.apId,
              content: p.content,
              published: p.published,
              like_count: p.likeCount,
            })),
          },
        });
      }

      case 'yurucommu_get_trending': {
        const limit = toolLimit(input.limit, 10, 50);
        const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const posts = await prisma.object.findMany({
          where: {
            visibility: 'public',
            published: { gt: sinceDate },
          },
          select: { content: true },
          orderBy: { published: 'desc' },
          take: 1000,
        });

        const hashtagCounts: Record<string, number> = {};
        const hashtagRegex = /#([a-zA-Z0-9_\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]+)/g;

        for (const post of posts) {
          let match;
          while ((match = hashtagRegex.exec(post.content || '')) !== null) {
            const tagName = match[1].toLowerCase();
            hashtagCounts[tagName] = (hashtagCounts[tagName] || 0) + 1;
          }
        }

        const trending = Object.entries(hashtagCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([tag, count]) => ({ tag, count }));

        return c.json({ success: true, data: { trending } });
      }

      case 'yurucommu_get_user_profile': {
        const username = requireString(input, 'username');
        if (!username) {
          return c.json(errRequired('Username'), 400);
        }

        const actorRecord = await prisma.actor.findFirst({
          where: { preferredUsername: username },
          select: {
            ...ACTOR_SUMMARY_SELECT,
            summary: true,
            followerCount: true,
            followingCount: true,
            postCount: true,
            isPrivate: true,
          },
        });

        if (!actorRecord) {
          return c.json(errNotFound('User'), 404);
        }

        // Fail-close for private accounts (allow self lookup only).
        if (actorRecord.isPrivate && actor?.ap_id !== actorRecord.apId) {
          return c.json(errNotFound('User'), 404);
        }

        return c.json({
          success: true,
          data: {
            ...formatActorSummary(actorRecord),
            summary: actorRecord.summary,
            follower_count: actorRecord.followerCount,
            following_count: actorRecord.followingCount,
            post_count: actorRecord.postCount,
          },
        });
      }

      // ------ Post tools ------

      case 'yurucommu_create_post': {
        if (!actor) return c.json(errAuth(), 401);

        const content = requireString(input, 'content');
        const visibility = String(input.visibility || 'public');
        const inReplyTo = input.in_reply_to ? String(input.in_reply_to) : null;

        if (!content) {
          return c.json(errRequired('Content'), 400);
        }

        const postId = crypto.randomUUID();
        const now = new Date().toISOString();
        const apId = `${c.env.APP_URL}/ap/notes/${postId}`;

        await prisma.object.create({
          data: {
            apId,
            type: 'Note',
            attributedTo: actor.ap_id,
            content,
            summary: null,
            attachmentsJson: '[]',
            inReplyTo,
            visibility,
            likeCount: 0,
            replyCount: 0,
            announceCount: 0,
            shareCount: 0,
            published: now,
            isLocal: 1,
          },
        });

        await prisma.actor.update({
          where: { apId: actor.ap_id },
          data: { postCount: { increment: 1 } },
        });

        return c.json({
          success: true,
          data: { post_id: postId, ap_id: apId },
        });
      }

      case 'yurucommu_delete_post': {
        if (!actor) return c.json(errAuth(), 401);

        const postId = requireString(input, 'post_id');
        if (!postId) {
          return c.json(errRequired('Post ID'), 400);
        }

        const post = await prisma.object.findFirst({
          where: { apId: postId, attributedTo: actor.ap_id },
        });
        if (!post) {
          return c.json({ success: false, error: 'Post not found or not authorized' } as ToolResponse, 404);
        }

        await prisma.object.delete({ where: { apId: postId } });

        await prisma.actor.update({
          where: { apId: actor.ap_id },
          data: { postCount: { decrement: 1 } },
        });

        return c.json({ success: true, data: { deleted: true } });
      }

      case 'yurucommu_like_post': {
        if (!actor) return c.json(errAuth(), 401);

        const postId = requireString(input, 'post_id');
        const like = Boolean(input.like);

        if (!postId) {
          return c.json(errRequired('Post ID'), 400);
        }

        const post = await prisma.object.findFirst({
          where: { apId: postId },
        });
        if (!post) {
          return c.json(errNotFound('Post'), 404);
        }

        const compositeKey = {
          actorApId_objectApId: {
            actorApId: actor.ap_id,
            objectApId: post.apId,
          },
        };

        if (like) {
          await prisma.like.upsert({
            where: compositeKey,
            create: { actorApId: actor.ap_id, objectApId: post.apId },
            update: {},
          });
        } else {
          await prisma.like.deleteMany({
            where: { actorApId: actor.ap_id, objectApId: post.apId },
          });
        }

        const likeCount = await prisma.like.count({
          where: { objectApId: post.apId },
        });

        await prisma.object.update({
          where: { apId: postId },
          data: { likeCount },
        });

        return c.json({ success: true, data: { liked: like, like_count: likeCount } });
      }

      case 'yurucommu_bookmark_post': {
        if (!actor) return c.json(errAuth(), 401);

        const postId = requireString(input, 'post_id');
        const bookmark = Boolean(input.bookmark);

        if (!postId) {
          return c.json(errRequired('Post ID'), 400);
        }

        const post = await prisma.object.findFirst({
          where: { apId: postId },
        });
        if (!post) {
          return c.json(errNotFound('Post'), 404);
        }

        const compositeKey = {
          actorApId_objectApId: {
            actorApId: actor.ap_id,
            objectApId: post.apId,
          },
        };

        if (bookmark) {
          await prisma.bookmark.upsert({
            where: compositeKey,
            create: { actorApId: actor.ap_id, objectApId: post.apId },
            update: {},
          });
        } else {
          await prisma.bookmark.deleteMany({
            where: { actorApId: actor.ap_id, objectApId: post.apId },
          });
        }

        return c.json({ success: true, data: { bookmarked: bookmark } });
      }

      // ------ Follow tools ------

      case 'yurucommu_follow_user': {
        if (!actor) return c.json(errAuth(), 401);

        const username = requireString(input, 'username');
        if (!username) {
          return c.json(errRequired('Username'), 400);
        }

        const target = await prisma.actor.findFirst({
          where: { preferredUsername: username },
        });
        if (!target) {
          return c.json(errNotFound('User'), 404);
        }

        if (target.apId === actor.ap_id) {
          return c.json({ success: false, error: 'Cannot follow yourself' } as ToolResponse, 400);
        }

        const followKey = {
          followerApId_followingApId: {
            followerApId: actor.ap_id,
            followingApId: target.apId,
          },
        };

        const existingFollow = await prisma.follow.findUnique({ where: followKey });

        if (!existingFollow) {
          const status = target.isPrivate ? 'pending' : 'accepted';

          await prisma.follow.create({
            data: {
              followerApId: actor.ap_id,
              followingApId: target.apId,
              status,
            },
          });

          if (status === 'accepted') {
            await prisma.actor.update({
              where: { apId: actor.ap_id },
              data: { followingCount: { increment: 1 } },
            });
            await prisma.actor.update({
              where: { apId: target.apId },
              data: { followerCount: { increment: 1 } },
            });
          }
        }

        return c.json({
          success: true,
          data: { following: true, status: target.isPrivate ? 'pending' : 'accepted' },
        });
      }

      case 'yurucommu_unfollow_user': {
        if (!actor) return c.json(errAuth(), 401);

        const username = requireString(input, 'username');
        if (!username) {
          return c.json(errRequired('Username'), 400);
        }

        const target = await prisma.actor.findFirst({
          where: { preferredUsername: username },
        });
        if (!target) {
          return c.json(errNotFound('User'), 404);
        }

        const followKey = {
          followerApId_followingApId: {
            followerApId: actor.ap_id,
            followingApId: target.apId,
          },
        };

        const follow = await prisma.follow.findUnique({ where: followKey });

        if (follow) {
          await prisma.follow.delete({ where: followKey });

          if (follow.status === 'accepted') {
            await prisma.actor.update({
              where: { apId: actor.ap_id },
              data: { followingCount: { decrement: 1 } },
            });
            await prisma.actor.update({
              where: { apId: target.apId },
              data: { followerCount: { decrement: 1 } },
            });
          }
        }

        return c.json({ success: true, data: { unfollowed: true } });
      }

      case 'yurucommu_get_followers': {
        const username = requireString(input, 'username');
        const limit = toolLimit(input.limit, 20, 50);

        if (!username) {
          return c.json(errRequired('Username'), 400);
        }

        const target = await prisma.actor.findFirst({
          where: { preferredUsername: username },
        });
        if (!target) {
          return c.json(errNotFound('User'), 404);
        }

        const follows = await prisma.follow.findMany({
          where: { followingApId: target.apId, status: 'accepted' },
          take: limit,
        });

        const followers = await prisma.actor.findMany({
          where: { apId: { in: follows.map(f => f.followerApId) } },
          select: ACTOR_SUMMARY_SELECT,
        });

        return c.json({
          success: true,
          data: { followers: followers.map(formatActorSummary) },
        });
      }

      case 'yurucommu_get_following': {
        const username = requireString(input, 'username');
        const limit = toolLimit(input.limit, 20, 50);

        if (!username) {
          return c.json(errRequired('Username'), 400);
        }

        const target = await prisma.actor.findFirst({
          where: { preferredUsername: username },
        });
        if (!target) {
          return c.json(errNotFound('User'), 404);
        }

        const follows = await prisma.follow.findMany({
          where: { followerApId: target.apId, status: 'accepted' },
          take: limit,
        });

        const following = await prisma.actor.findMany({
          where: { apId: { in: follows.map(f => f.followingApId) } },
          select: ACTOR_SUMMARY_SELECT,
        });

        return c.json({
          success: true,
          data: { following: following.map(formatActorSummary) },
        });
      }

      // ------ DM tools ------

      case 'yurucommu_send_dm': {
        if (!actor) return c.json(errAuth(), 401);

        const recipient = requireString(input, 'recipient');
        const content = requireString(input, 'content');

        if (!recipient || !content) {
          return c.json(errRequired('Recipient and content'), 400);
        }

        const target = await prisma.actor.findFirst({
          where: { preferredUsername: recipient },
          select: { apId: true },
        });
        if (!target) {
          return c.json(errNotFound('Recipient'), 404);
        }

        const baseUrl = c.env.APP_URL;
        const now = new Date().toISOString();
        const messageId = generateId();
        const apId = objectApId(baseUrl, messageId);
        const conversationId = getConversationId(baseUrl, actor.ap_id, target.apId);
        const toJson = JSON.stringify([target.apId]);
        const ccJson = JSON.stringify([]);
        const activityId = activityApId(baseUrl, generateId());

        // Keep behavior aligned with the main DM API (create message + recipient tracking + inbox entry).
        await prisma.$transaction(async (tx) => {
          await tx.object.create({
            data: {
              apId,
              type: 'Note',
              attributedTo: actor.ap_id,
              content,
              summary: null,
              attachmentsJson: '[]',
              inReplyTo: null,
              conversation: conversationId,
              visibility: 'direct',
              toJson,
              ccJson,
              published: now,
              isLocal: 1,
            },
          });

          await tx.objectRecipient.upsert({
            where: {
              objectApId_recipientApId: {
                objectApId: apId,
                recipientApId: target.apId,
              },
            },
            create: {
              objectApId: apId,
              recipientApId: target.apId,
              type: 'to',
            },
            update: {},
          });

          await tx.activity.create({
            data: {
              apId: activityId,
              type: 'Create',
              actorApId: actor.ap_id,
              objectApId: apId,
              rawJson: JSON.stringify({ type: 'Create', actor: actor.ap_id, object: apId }),
              direction: 'inbound',
            },
          });

          await tx.inbox.create({
            data: {
              actorApId: target.apId,
              activityApId: activityId,
            },
          });
        });

        return c.json({
          success: true,
          data: { message_id: apId, conversation_id: conversationId },
        });
      }

      case 'yurucommu_get_dm_threads': {
        if (!actor) return c.json(errAuth(), 401);

        const limit = toolLimit(input.limit, 20, 50);

        const dms = await prisma.object.findMany({
          where: {
            visibility: 'direct',
            type: 'Note',
            conversation: { not: null },
            OR: [
              { attributedTo: actor.ap_id },
              { recipients: { some: { recipientApId: actor.ap_id } } },
            ],
          },
          orderBy: { published: 'desc' },
          select: {
            attributedTo: true,
            toJson: true,
            published: true,
            content: true,
          },
          take: 2000,
        });

        // Group by conversation partner
        const threads: Record<string, { partner: string; lastMessage: string; lastDate: string }> = {};

        for (const dm of dms) {
          const toRecipients = safeJsonParse<string[]>(dm.toJson, []);

          let partner: string | null = null;
          if (dm.attributedTo === actor.ap_id) {
            partner = toRecipients[0] || null;
          } else {
            // Defense in depth: verify we're actually a recipient.
            if (!toRecipients.includes(actor.ap_id)) continue;
            partner = dm.attributedTo;
          }

          if (partner && !threads[partner]) {
            threads[partner] = {
              partner,
              lastMessage: dm.content || '',
              lastDate: dm.published,
            };
          }
        }

        return c.json({
          success: true,
          data: { threads: Object.values(threads).slice(0, limit) },
        });
      }

      case 'yurucommu_get_dm_messages': {
        if (!actor) return c.json(errAuth(), 401);

        const threadId = requireString(input, 'thread_id');
        const limit = toolLimit(input.limit, 50, 100);

        if (!threadId) {
          return c.json(errRequired('Thread ID'), 400);
        }

        const baseUrl = c.env.APP_URL;
        const conversationId = getConversationId(baseUrl, actor.ap_id, threadId);

        const messages = await prisma.object.findMany({
          where: {
            visibility: 'direct',
            type: 'Note',
            conversation: conversationId,
            OR: [
              { attributedTo: actor.ap_id },
              { recipients: { some: { recipientApId: actor.ap_id } } },
            ],
          },
          orderBy: { published: 'desc' },
          take: limit,
        });

        const filtered = messages.filter((m) => {
          if (m.attributedTo === actor.ap_id) return true;
          const toRecipients = safeJsonParse<string[]>(m.toJson, []);
          return toRecipients.includes(actor.ap_id);
        });

        return c.json({
          success: true,
          data: {
            messages: filtered.map(m => ({
              ap_id: m.apId,
              content: m.content,
              from: m.attributedTo,
              published: m.published,
            })),
            conversation_id: conversationId,
          },
        });
      }

      // ------ Timeline tools ------

      case 'yurucommu_get_timeline': {
        const limit = toolLimit(input.limit, 20, 50);
        const before = input.before ? String(input.before) : null;

        const posts = await prisma.object.findMany({
          where: {
            visibility: 'public',
            ...(before ? { published: { lt: before } } : {}),
          },
          orderBy: { published: 'desc' },
          take: limit,
        });

        const authorIds = [...new Set(posts.map(p => p.attributedTo))];
        const authors = await prisma.actor.findMany({
          where: { apId: { in: authorIds } },
          select: ACTOR_SUMMARY_SELECT,
        });

        const authorMap = new Map(authors.map(a => [a.apId, a]));

        return c.json({
          success: true,
          data: {
            posts: posts.map(p => {
              const author = authorMap.get(p.attributedTo);
              return {
                ap_id: p.apId,
                content: p.content,
                published: p.published,
                like_count: p.likeCount,
                author: author ? formatActorSummary(author) : null,
              };
            }),
            next_cursor: posts.length > 0 ? posts[posts.length - 1].published : null,
          },
        });
      }

      case 'yurucommu_get_notifications': {
        if (!actor) return c.json(errAuth(), 401);

        const limit = toolLimit(input.limit, 20, 50);
        const unreadOnly = Boolean(input.unread_only);

        const inboxEntries = await prisma.inbox.findMany({
          where: {
            actorApId: actor.ap_id,
            ...(unreadOnly ? { read: 0 } : {}),
            activity: {
              actorApId: { not: actor.ap_id },
              type: { in: ['Follow', 'Like', 'Announce', 'Create'] },
            },
          },
          include: { activity: true },
          orderBy: { createdAt: 'desc' },
          take: limit,
        });

        return c.json({
          success: true,
          data: {
            notifications: inboxEntries.map(entry => ({
              id: entry.activityApId,
              type: entry.activity.type.toLowerCase(),
              from_actor: entry.activity.actorApId,
              object: entry.activity.objectApId,
              read: !!entry.read,
              created_at: entry.createdAt,
            })),
          },
        });
      }

      default:
        return c.json({ success: false, error: `Unknown tool: ${toolName}` }, 404);
    }
  } catch (error) {
    console.error(`Tool ${toolName} error:`, error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Internal error',
    } as ToolResponse, 500);
  }
});

export default takosTools;
