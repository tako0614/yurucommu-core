/**
 * PostService Implementation
 *
 * 既存の投稿ロジックをCore Kernel サービスAPIでラップ
 */

import type {
  PostService,
  CreatePostInput,
  UpdatePostInput,
  ReactToPostInput,
  TimelineParams,
  Post,
  PostPage,
  SearchPostsParams,
  PostHistoryEntry,
  PollVoteInput,
  RepostInput,
  RepostListParams,
  RepostListResult,
  Reaction,
  BookmarkPage,
  AppAuthContext,
} from "@takos/platform/app/services";
import { makeData } from "../data";
import {
  releaseStore,
  requireInstanceDomain,
  getActorUri,
  getObjectUri,
  getActivityUri,
  enqueueDeliveriesToFollowers,
  queueImmediateDelivery,
  nowISO,
} from "@takos/platform/server";

const escapeHtml = (input: string): string =>
  input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

export function createPostService(env: any): PostService {
  return {
    async createPost(ctx: AppAuthContext, input: CreatePostInput): Promise<Post> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        // 既存のcreatePost実装を利用
        const post = await store.createPost({
          author_id: ctx.userId,
          content: input.content,
          visibility: input.visibility || "public",
          community_id: input.community_id || null,
          in_reply_to_id: input.in_reply_to_id || null,
          media_ids: input.media_ids || [],
          sensitive: input.sensitive || false,
          content_warning: input.content_warning || null,
          poll: input.poll || null,
        });

        return post as Post;
      } finally {
        await releaseStore(store);
      }
    },

    async updatePost(ctx: AppAuthContext, input: UpdatePostInput): Promise<Post> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const existing = await store.getPost(input.id);
        if (!existing) {
          throw new Error("Post not found");
        }
        if (existing.author_id !== ctx.userId) {
          throw new Error("Permission denied");
        }

        const updated = await store.updatePost(input.id, {
          content: input.content,
          sensitive: input.sensitive,
          content_warning: input.content_warning,
          media_ids: input.media_ids,
        });

        return updated as Post;
      } finally {
        await releaseStore(store);
      }
    },

    async deletePost(ctx: AppAuthContext, id: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const existing = await store.getPost(id);
        if (!existing) {
          throw new Error("Post not found");
        }
        if (existing.author_id !== ctx.userId) {
          throw new Error("Permission denied");
        }

        await store.deletePost(id);
      } finally {
        await releaseStore(store);
      }
    },

    async reactToPost(ctx: AppAuthContext, input: ReactToPostInput): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        await store.addReactionToPost({
          post_id: input.post_id,
          user_id: ctx.userId,
          emoji: input.emoji,
        });
      } finally {
        await releaseStore(store);
      }
    },

    async listTimeline(ctx: AppAuthContext, params: TimelineParams): Promise<PostPage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params.limit || 20, 100);
        const offset = params.offset || 0;

        let posts: any[];

        if (params.community_id) {
          // コミュニティタイムライン
          posts = await store.listCommunityPosts(params.community_id, limit, offset);
        } else if (params.list_id) {
          // リストタイムライン
          posts = await store.listTimelineByList?.(params.list_id, limit, offset) || [];
        } else {
          // ホームタイムライン
          posts = await store.listTimeline?.(ctx.userId, limit, offset) || [];
        }

        const nextOffset = posts.length === limit ? offset + limit : null;

        return {
          posts: posts as Post[],
          next_offset: nextOffset,
        };
      } finally {
        await releaseStore(store);
      }
    },

    async getPost(ctx: AppAuthContext, id: string): Promise<Post | null> {
      const store = makeData(env, null as any);
      try {
        const post = await store.getPost(id);
        return post as Post | null;
      } finally {
        await releaseStore(store);
      }
    },

    async searchPosts(ctx: AppAuthContext, params: SearchPostsParams): Promise<PostPage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params.limit || 20, 100);
        const offset = params.offset || 0;
        const posts = await store.searchPublicPosts?.(params.query || "", limit, offset);
        const next = (posts?.length || 0) === limit ? offset + limit : null;
        return { posts: (posts || []) as Post[], next_offset: next, next_cursor: null };
      } finally {
        await releaseStore(store);
      }
    },

    async listPostHistory(ctx: AppAuthContext, postId: string): Promise<PostHistoryEntry[]> {
      const store = makeData(env, null as any);
      try {
        if (!store.listPostEditHistory) return [];
        const history = await store.listPostEditHistory(postId, 50, 0);
        return (history || []) as PostHistoryEntry[];
      } finally {
        await releaseStore(store);
      }
    },

    async getPoll(ctx: AppAuthContext, postId: string): Promise<any> {
      const store = makeData(env, null as any);
      try {
        if (!store.getPollByPost) return null;
        return (await store.getPollByPost(postId)) || null;
      } finally {
        await releaseStore(store);
      }
    },

    async voteOnPoll(ctx: AppAuthContext, input: PollVoteInput): Promise<any> {
      if (!ctx.userId) throw new Error("Authentication required");
      const store = makeData(env, null as any);
      try {
        if (!store.getPollByPost || !store.createPollVotes) {
          throw new Error("polls not available");
        }
        const poll = await store.getPollByPost(input.post_id);
        if (!poll) throw new Error("poll not found");
        const optionIds = Array.isArray(input.option_ids) ? input.option_ids.map((v) => String(v)) : [];
        if (!optionIds.length) throw new Error("option_ids required");
        if (!(poll as any).allows_multiple && optionIds.length > 1) {
          throw new Error("multiple selections not allowed");
        }
        const valid = new Set(((poll as any).options || []).map((o: any) => o.id));
        for (const id of optionIds) {
          if (!valid.has(id)) throw new Error("invalid option");
        }
        const prior = store.listPollVotesByUser
          ? await store.listPollVotesByUser((poll as any).id, ctx.userId)
          : [];
        if (prior && prior.length) throw new Error("already voted");
        await store.createPollVotes((poll as any).id, optionIds, ctx.userId);
        return await store.getPollByPost(input.post_id);
      } finally {
        await releaseStore(store);
      }
    },

    async repost(ctx: AppAuthContext, input: RepostInput): Promise<{ reposted: boolean; id?: string }> {
      if (!ctx.userId) throw new Error("Authentication required");
      const store = makeData(env, null as any);
      try {
        const post = await store.getPost(input.post_id);
        if (!post) throw new Error("post not found");
        if ((post as any).community_id || !(post as any).broadcast_all) {
          throw new Error("only public global posts can be reposted");
        }
        const existing = await store.findRepost?.(input.post_id, ctx.userId);
        if (existing) return { reposted: true, id: (existing as any).id };

        const instanceDomain = requireInstanceDomain(env as any);
        const repostId = crypto.randomUUID();
        const announceId = getActivityUri(ctx.userId, `announce-${repostId}`, instanceDomain);
        const postObjectId =
          (post as any).ap_object_id || getObjectUri((post as any).author_id, input.post_id, instanceDomain);
        const actorUri = getActorUri(ctx.userId, instanceDomain);
        const created_at = nowISO();

        const record = await store.addRepost({
          id: repostId,
          post_id: input.post_id,
          user_id: ctx.userId,
          comment: input.comment || "",
          created_at,
          ap_activity_id: announceId,
        });

        const announce: any = {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Announce",
          id: announceId,
          actor: actorUri,
          object: postObjectId,
          published: new Date(created_at).toISOString(),
        };
        if (input.comment) {
          announce.content = `<p>${escapeHtml(input.comment)}</p>`;
        }

        await store.upsertApOutboxActivity?.({
          id: crypto.randomUUID(),
          local_user_id: ctx.userId,
          activity_id: announceId,
          activity_type: "Announce",
          activity_json: JSON.stringify(announce),
          object_id: postObjectId,
          object_type: "Announce",
          created_at: new Date(),
        });

        if ((post as any).author_id !== ctx.userId) {
          const inbox = `https://${instanceDomain}/ap/users/${(post as any).author_id}/inbox`;
          await queueImmediateDelivery(store, env as any, {
            id: crypto.randomUUID(),
            activity_id: announceId,
            target_inbox_url: inbox,
            status: "pending",
            created_at: new Date(),
          });
        }

        await enqueueDeliveriesToFollowers(store, ctx.userId, announceId, { env });
        return { reposted: true, id: (record as any)?.id ?? repostId };
      } finally {
        await releaseStore(store);
      }
    },

    async undoRepost(ctx: AppAuthContext, postId: string): Promise<void> {
      if (!ctx.userId) throw new Error("Authentication required");
      const store = makeData(env, null as any);
      try {
        const post = await store.getPost(postId);
        if (!post) throw new Error("post not found");
        const existing = await store.findRepost?.(postId, ctx.userId);
        if (!existing) {
          return;
        }
        const instanceDomain = requireInstanceDomain(env as any);
        const actorUri = getActorUri(ctx.userId, instanceDomain);
        const announceId =
          (existing as any).ap_activity_id || getActivityUri(ctx.userId, `announce-${(existing as any).id}`, instanceDomain);
        const postObjectId =
          (post as any).ap_object_id || getObjectUri((post as any).author_id, postId, instanceDomain);
        const undoId = getActivityUri(ctx.userId, `undo-announce-${(existing as any).id}`, instanceDomain);

        const undoActivity = {
          "@context": "https://www.w3.org/ns/activitystreams",
          type: "Undo",
          id: undoId,
          actor: actorUri,
          object: {
            type: "Announce",
            id: announceId,
            actor: actorUri,
            object: postObjectId,
          },
          published: new Date().toISOString(),
        };

        await store.upsertApOutboxActivity?.({
          id: crypto.randomUUID(),
          local_user_id: ctx.userId,
          activity_id: undoId,
          activity_type: "Undo",
          activity_json: JSON.stringify(undoActivity),
          object_id: announceId,
          object_type: "Announce",
          created_at: new Date(),
        });

        await enqueueDeliveriesToFollowers(store, ctx.userId, undoId, { env });
        await store.deleteRepost?.(postId, ctx.userId);
        await store.deleteApAnnouncesByActivityId?.(announceId);
      } finally {
        await releaseStore(store);
      }
    },

    async listReposts(ctx: AppAuthContext, params: RepostListParams): Promise<RepostListResult> {
      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params.limit || 20, 100);
        const offset = params.offset || 0;
        const rows = await store.listRepostsByPost?.(params.post_id, limit, offset);
        const userIds = Array.from(new Set(((rows as any[]) || []).map((r: any) => r.user_id)));
        const users = await Promise.all(userIds.map((id) => store.getUser(id).catch(() => null)));
        const userMap = new Map<string, any>();
        userIds.forEach((id, idx) => userMap.set(id, users[idx]));
        const items = (rows as any[] || []).map((r: any) => ({
          id: r.id,
          user: userMap.get(r.user_id) || { id: r.user_id },
          comment: r.comment || "",
          created_at: r.created_at instanceof Date ? r.created_at.toISOString() : r.created_at,
        }));
        const count = await store.countRepostsByPost?.(params.post_id).catch(() => 0);
        const next = rows && rows.length === limit ? offset + limit : null;
        return { items, count: count ?? 0, next_offset: next };
      } finally {
        await releaseStore(store);
      }
    },

    async listReactions(ctx: AppAuthContext, postId: string): Promise<Reaction[]> {
      const store = makeData(env, null as any);
      try {
        const list = await store.listReactionsByPost?.(postId);
        return (list || []) as Reaction[];
      } finally {
        await releaseStore(store);
      }
    },

    async removeReaction(ctx: AppAuthContext, reactionId: string): Promise<void> {
      if (!ctx.userId) throw new Error("Authentication required");
      const store = makeData(env, null as any);
      try {
        await store.deleteReaction?.(reactionId);
      } finally {
        await releaseStore(store);
      }
    },

    async listComments(ctx: AppAuthContext, postId: string): Promise<Post[]> {
      if (!ctx.userId) throw new Error("Authentication required");
      const store = makeData(env, null as any);
      try {
        const list = await store.listCommentsByPost?.(postId);
        return (list || []) as Post[];
      } finally {
        await releaseStore(store);
      }
    },

    async addBookmark(ctx: AppAuthContext, postId: string): Promise<void> {
      if (!ctx.userId) throw new Error("Authentication required");
      const store = makeData(env, null as any);
      try {
        await store.addBookmark?.({
          id: crypto.randomUUID(),
          post_id: postId,
          user_id: ctx.userId,
          created_at: nowISO(),
        });
      } finally {
        await releaseStore(store);
      }
    },

    async removeBookmark(ctx: AppAuthContext, postId: string): Promise<void> {
      if (!ctx.userId) throw new Error("Authentication required");
      const store = makeData(env, null as any);
      try {
        await store.deleteBookmark?.(postId, ctx.userId);
      } finally {
        await releaseStore(store);
      }
    },

    async listBookmarks(
      ctx: AppAuthContext,
      params?: { limit?: number; offset?: number },
    ): Promise<BookmarkPage> {
      if (!ctx.userId) throw new Error("Authentication required");
      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params?.limit || 20, 100);
        const offset = params?.offset || 0;
        const rows = await store.listBookmarksByUser?.(ctx.userId, limit, offset);
        const posts: any[] = [];
        for (const row of (rows as any[]) || []) {
          const post = await store.getPost((row as any).post_id).catch(() => null);
          if (post) {
            posts.push({
              ...post,
              is_bookmarked: true,
              bookmarked_at:
                (row as any).created_at instanceof Date
                  ? (row as any).created_at.toISOString()
                  : (row as any).created_at,
            });
          }
        }
        const next = rows && rows.length === limit ? offset + limit : null;
        return { items: posts as Post[], next_offset: next };
      } finally {
        await releaseStore(store);
      }
    },

    async listPinnedPosts(
      ctx: AppAuthContext,
      params?: { user_id?: string; limit?: number },
    ): Promise<Post[]> {
      const store = makeData(env, null as any);
      try {
        const userId = params?.user_id || ctx.userId;
        if (!userId) return [];
        if (!store.listPinnedPostsByUser) return [];
        const limit = Math.min(params?.limit || 20, 100);
        const items = await store.listPinnedPostsByUser(userId, limit);
        return (items || []) as Post[];
      } finally {
        await releaseStore(store);
      }
    },
  };
}
