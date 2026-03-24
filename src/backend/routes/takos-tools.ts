/**
 * Takos Tools Endpoint
 *
 * Provides tool endpoints for AI agent integration.
 * POST /.takos/tools/:name - Execute a tool
 */

import { Hono } from 'hono';
import { eq, and, or, desc, lt, like, inArray, isNotNull, count } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { actors, objects, follows, likes, bookmarks, inbox, activities, objectRecipients } from '../../db';
import type { Env, Variables } from '../types';
import { activityApId, generateId, objectApId, safeJsonParse } from '../utils';
import { getConversationId } from './dm/utils';
import {
  toolLimit,
  requireString,
  errAuth,
  errRequired,
  errNotFound,
  ok,
  formatActorSummary,
  ACTOR_SUMMARY_COLUMNS,
  resolveDmPartner,
  togglePostRelation,
  fetchFollowList,
  type ToolResponse,
  type Input,
} from './takos-tools-utils';

type HonoEnv = { Bindings: Env; Variables: Variables };

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

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

takosTools.post('/:name', async (c) => {
  const toolName = c.req.param('name');
  const actor = c.get('actor');
  const db = c.get('prisma');

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

        if (!query) return c.json(ok({ actors: [] }));

        const results = await db.select({
          ...ACTOR_SUMMARY_COLUMNS,
          summary: actors.summary,
          followerCount: actors.followerCount,
        })
          .from(actors)
          .where(and(
            eq(actors.isPrivate, 0),
            or(
              like(actors.preferredUsername, `%${query}%`),
              like(actors.name, `%${query}%`),
            ),
          ))
          .orderBy(desc(actors.followerCount))
          .limit(limit);

        return c.json(ok({
          actors: results.map(a => ({
            ...formatActorSummary(a),
            summary: a.summary,
            follower_count: a.followerCount,
          })),
        }));
      }

      case 'yurucommu_search_posts': {
        const query = requireString(input, 'query');
        const limit = toolLimit(input.limit, 20, 50);

        if (!query) return c.json(ok({ posts: [] }));

        const posts = await db.select()
          .from(objects)
          .where(and(
            like(objects.content, `%${query}%`),
            eq(objects.visibility, 'public'),
          ))
          .orderBy(desc(objects.published))
          .limit(limit);

        return c.json(ok({
          posts: posts.map(p => ({
            ap_id: p.apId,
            content: p.content,
            published: p.published,
            like_count: p.likeCount,
          })),
        }));
      }

      case 'yurucommu_get_trending': {
        const limit = toolLimit(input.limit, 10, 50);
        const sinceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

        const posts = await db.select({ content: objects.content })
          .from(objects)
          .where(and(
            eq(objects.visibility, 'public'),
            sql`${objects.published} > ${sinceDate}`,
          ))
          .orderBy(desc(objects.published))
          .limit(1000);

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

        return c.json(ok({ trending }));
      }

      case 'yurucommu_get_user_profile': {
        const username = requireString(input, 'username');
        if (!username) return c.json(errRequired('Username'), 400);

        const actorRecord = await db.select({
          ...ACTOR_SUMMARY_COLUMNS,
          summary: actors.summary,
          followerCount: actors.followerCount,
          followingCount: actors.followingCount,
          postCount: actors.postCount,
          isPrivate: actors.isPrivate,
        })
          .from(actors)
          .where(eq(actors.preferredUsername, username))
          .get();

        if (!actorRecord) return c.json(errNotFound('User'), 404);

        // Fail-close for private accounts (allow self lookup only).
        if (actorRecord.isPrivate && actor?.ap_id !== actorRecord.apId) {
          return c.json(errNotFound('User'), 404);
        }

        return c.json(ok({
          ...formatActorSummary(actorRecord),
          summary: actorRecord.summary,
          follower_count: actorRecord.followerCount,
          following_count: actorRecord.followingCount,
          post_count: actorRecord.postCount,
        }));
      }

      // ------ Post tools ------

      case 'yurucommu_create_post': {
        if (!actor) return c.json(errAuth(), 401);

        const content = requireString(input, 'content');
        const visibility = String(input.visibility || 'public');
        const inReplyTo = input.in_reply_to ? String(input.in_reply_to) : null;

        if (!content) return c.json(errRequired('Content'), 400);

        const postId = crypto.randomUUID();
        const now = new Date().toISOString();
        const apId = `${c.env.APP_URL}/ap/notes/${postId}`;

        await db.insert(objects).values({
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
        });

        await db.update(actors)
          .set({ postCount: sql`${actors.postCount} + 1` })
          .where(eq(actors.apId, actor.ap_id));

        return c.json(ok({ post_id: postId, ap_id: apId }));
      }

      case 'yurucommu_delete_post': {
        if (!actor) return c.json(errAuth(), 401);

        const postId = requireString(input, 'post_id');
        if (!postId) return c.json(errRequired('Post ID'), 400);

        const post = await db.select()
          .from(objects)
          .where(and(eq(objects.apId, postId), eq(objects.attributedTo, actor.ap_id)))
          .get();
        if (!post) {
          return c.json({ success: false, error: 'Post not found or not authorized' } as ToolResponse, 404);
        }

        await db.delete(objects).where(eq(objects.apId, postId));
        await db.update(actors)
          .set({ postCount: sql`${actors.postCount} - 1` })
          .where(eq(actors.apId, actor.ap_id));

        return c.json(ok({ deleted: true }));
      }

      case 'yurucommu_like_post': {
        if (!actor) return c.json(errAuth(), 401);

        const postId = requireString(input, 'post_id');
        const likeActive = Boolean(input.like);

        if (!postId) return c.json(errRequired('Post ID'), 400);

        const post = await db.select()
          .from(objects)
          .where(eq(objects.apId, postId))
          .get();
        if (!post) return c.json(errNotFound('Post'), 404);

        await togglePostRelation(db, likes, actor.ap_id, post.apId, likeActive);

        const likeCountResult = await db.select({ count: count() })
          .from(likes)
          .where(eq(likes.objectApId, post.apId))
          .get();
        const likeCount = likeCountResult?.count ?? 0;
        await db.update(objects)
          .set({ likeCount })
          .where(eq(objects.apId, postId));

        return c.json(ok({ liked: likeActive, like_count: likeCount }));
      }

      case 'yurucommu_bookmark_post': {
        if (!actor) return c.json(errAuth(), 401);

        const postId = requireString(input, 'post_id');
        const bookmark = Boolean(input.bookmark);

        if (!postId) return c.json(errRequired('Post ID'), 400);

        const post = await db.select()
          .from(objects)
          .where(eq(objects.apId, postId))
          .get();
        if (!post) return c.json(errNotFound('Post'), 404);

        await togglePostRelation(db, bookmarks, actor.ap_id, post.apId, bookmark);

        return c.json(ok({ bookmarked: bookmark }));
      }

      // ------ Follow tools ------

      case 'yurucommu_follow_user': {
        if (!actor) return c.json(errAuth(), 401);

        const username = requireString(input, 'username');
        if (!username) return c.json(errRequired('Username'), 400);

        const target = await db.select()
          .from(actors)
          .where(eq(actors.preferredUsername, username))
          .get();
        if (!target) return c.json(errNotFound('User'), 404);

        if (target.apId === actor.ap_id) {
          return c.json({ success: false, error: 'Cannot follow yourself' } as ToolResponse, 400);
        }

        const existingFollow = await db.select()
          .from(follows)
          .where(and(eq(follows.followerApId, actor.ap_id), eq(follows.followingApId, target.apId)))
          .get();

        if (!existingFollow) {
          const status = target.isPrivate ? 'pending' : 'accepted';

          await db.insert(follows)
            .values({ followerApId: actor.ap_id, followingApId: target.apId, status });

          if (status === 'accepted') {
            await db.update(actors)
              .set({ followingCount: sql`${actors.followingCount} + 1` })
              .where(eq(actors.apId, actor.ap_id));
            await db.update(actors)
              .set({ followerCount: sql`${actors.followerCount} + 1` })
              .where(eq(actors.apId, target.apId));
          }
        }

        return c.json(ok({
          following: true,
          status: target.isPrivate ? 'pending' : 'accepted',
        }));
      }

      case 'yurucommu_unfollow_user': {
        if (!actor) return c.json(errAuth(), 401);

        const username = requireString(input, 'username');
        if (!username) return c.json(errRequired('Username'), 400);

        const target = await db.select()
          .from(actors)
          .where(eq(actors.preferredUsername, username))
          .get();
        if (!target) return c.json(errNotFound('User'), 404);

        const follow = await db.select()
          .from(follows)
          .where(and(eq(follows.followerApId, actor.ap_id), eq(follows.followingApId, target.apId)))
          .get();

        if (follow) {
          await db.delete(follows)
            .where(and(eq(follows.followerApId, actor.ap_id), eq(follows.followingApId, target.apId)));

          if (follow.status === 'accepted') {
            await db.update(actors)
              .set({ followingCount: sql`${actors.followingCount} - 1` })
              .where(eq(actors.apId, actor.ap_id));
            await db.update(actors)
              .set({ followerCount: sql`${actors.followerCount} - 1` })
              .where(eq(actors.apId, target.apId));
          }
        }

        return c.json(ok({ unfollowed: true }));
      }

      case 'yurucommu_get_followers':
      case 'yurucommu_get_following': {
        const username = requireString(input, 'username');
        const limit = toolLimit(input.limit, 20, 50);

        if (!username) return c.json(errRequired('Username'), 400);

        const target = await db.select()
          .from(actors)
          .where(eq(actors.preferredUsername, username))
          .get();
        if (!target) return c.json(errNotFound('User'), 404);

        const direction = toolName === 'yurucommu_get_followers' ? 'followers' : 'following';
        const actorList = await fetchFollowList(db, target.apId, direction, limit);

        return c.json(ok({ [direction]: actorList.map(formatActorSummary) }));
      }

      // ------ DM tools ------

      case 'yurucommu_send_dm': {
        if (!actor) return c.json(errAuth(), 401);

        const recipient = requireString(input, 'recipient');
        const content = requireString(input, 'content');
        if (!recipient || !content) return c.json(errRequired('Recipient and content'), 400);

        const target = await db.select({ apId: actors.apId })
          .from(actors)
          .where(eq(actors.preferredUsername, recipient))
          .get();
        if (!target) return c.json(errNotFound('Recipient'), 404);

        const baseUrl = c.env.APP_URL;
        const now = new Date().toISOString();
        const messageId = generateId();
        const apId = objectApId(baseUrl, messageId);
        const conversationId = getConversationId(baseUrl, actor.ap_id, target.apId);
        const toJson = JSON.stringify([target.apId]);
        const ccJson = JSON.stringify([]);
        const activityId = activityApId(baseUrl, generateId());

        // Sequential operations (D1 doesn't support interactive transactions)
        await db.insert(objects).values({
          apId, type: 'Note', attributedTo: actor.ap_id, content,
          summary: null, attachmentsJson: '[]', inReplyTo: null,
          conversation: conversationId, visibility: 'direct',
          toJson, ccJson, published: now, isLocal: 1,
        });

        await db.insert(objectRecipients)
          .values({ objectApId: apId, recipientApId: target.apId, type: 'to' })
          .onConflictDoNothing();

        await db.insert(activities).values({
          apId: activityId, type: 'Create', actorApId: actor.ap_id,
          objectApId: apId,
          rawJson: JSON.stringify({ type: 'Create', actor: actor.ap_id, object: apId }),
          direction: 'inbound',
        });

        await db.insert(inbox).values({
          actorApId: target.apId, activityApId: activityId,
        });

        return c.json(ok({ message_id: apId, conversation_id: conversationId }));
      }

      case 'yurucommu_get_dm_threads': {
        if (!actor) return c.json(errAuth(), 401);

        const limit = toolLimit(input.limit, 20, 50);

        const dms = await db.select({
          attributedTo: objects.attributedTo,
          toJson: objects.toJson,
          published: objects.published,
          content: objects.content,
        })
          .from(objects)
          .where(and(
            eq(objects.visibility, 'direct'),
            eq(objects.type, 'Note'),
            isNotNull(objects.conversation),
          ))
          .orderBy(desc(objects.published))
          .limit(2000);

        // Filter to only messages where actor is sender or recipient, then group by partner
        const threads: Record<string, { partner: string; lastMessage: string; lastDate: string }> = {};

        for (const dm of dms) {
          const partner = resolveDmPartner(dm, actor.ap_id);
          if (partner && !threads[partner]) {
            threads[partner] = {
              partner,
              lastMessage: dm.content || '',
              lastDate: dm.published,
            };
          }
        }

        return c.json(ok({ threads: Object.values(threads).slice(0, limit) }));
      }

      case 'yurucommu_get_dm_messages': {
        if (!actor) return c.json(errAuth(), 401);

        const threadId = requireString(input, 'thread_id');
        const limit = toolLimit(input.limit, 50, 100);
        if (!threadId) return c.json(errRequired('Thread ID'), 400);

        const baseUrl = c.env.APP_URL;
        const conversationId = getConversationId(baseUrl, actor.ap_id, threadId);

        const messages = await db.select()
          .from(objects)
          .where(and(
            eq(objects.visibility, 'direct'),
            eq(objects.type, 'Note'),
            eq(objects.conversation, conversationId),
          ))
          .orderBy(desc(objects.published))
          .limit(limit);

        const filtered = messages.filter((m) => {
          if (m.attributedTo === actor.ap_id) return true;
          return safeJsonParse<string[]>(m.toJson, []).includes(actor.ap_id);
        });

        return c.json(ok({
          messages: filtered.map((m) => ({
            ap_id: m.apId,
            content: m.content,
            from: m.attributedTo,
            published: m.published,
          })),
          conversation_id: conversationId,
        }));
      }

      // ------ Timeline tools ------

      case 'yurucommu_get_timeline': {
        const limit = toolLimit(input.limit, 20, 50);
        const before = input.before ? String(input.before) : null;

        const whereConditions = [eq(objects.visibility, 'public')];
        if (before) {
          whereConditions.push(lt(objects.published, before));
        }

        const posts = await db.select()
          .from(objects)
          .where(and(...whereConditions))
          .orderBy(desc(objects.published))
          .limit(limit);

        const authorIds = [...new Set(posts.map(p => p.attributedTo))];
        const authorRows = authorIds.length > 0
          ? await db.select(ACTOR_SUMMARY_COLUMNS)
              .from(actors)
              .where(inArray(actors.apId, authorIds))
          : [];

        const authorMap = new Map(authorRows.map(a => [a.apId, a]));

        return c.json(ok({
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
        }));
      }

      case 'yurucommu_get_notifications': {
        if (!actor) return c.json(errAuth(), 401);

        const limit = toolLimit(input.limit, 20, 50);
        const unreadOnly = Boolean(input.unread_only);

        // Use query API with relations for inbox + activity join
        const inboxEntries = await db.query.inbox.findMany({
          where: and(
            eq(inbox.actorApId, actor.ap_id),
            ...(unreadOnly ? [eq(inbox.read, 0)] : []),
          ),
          with: {
            activity: true,
          },
          orderBy: desc(inbox.createdAt),
          limit,
        });

        // Filter: activity must not be from self and must be one of the expected types
        const allowedTypes = new Set(['Follow', 'Like', 'Announce', 'Create']);
        const filtered = inboxEntries.filter(entry =>
          entry.activity &&
          entry.activity.actorApId !== actor.ap_id &&
          allowedTypes.has(entry.activity.type)
        );

        return c.json(ok({
          notifications: filtered.map(entry => ({
            id: entry.activityApId,
            type: entry.activity.type.toLowerCase(),
            from_actor: entry.activity.actorApId,
            object: entry.activity.objectApId,
            read: !!entry.read,
            created_at: entry.createdAt,
          })),
        }));
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
