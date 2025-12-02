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
  AppAuthContext,
} from "@takos/platform/app/services";
import { makeData } from "../data";
import { releaseStore } from "@takos/platform/server";

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
  };
}
