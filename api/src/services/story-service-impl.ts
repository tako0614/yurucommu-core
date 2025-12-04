/**
 * StoryService Implementation
 *
 * 既存のストーリーロジックをCore Kernel サービスAPIでラップ
 */

import type {
  StoryService,
  CreateStoryInput,
  ListStoriesParams,
  Story,
  StoryPage,
  StoryItem,
  AppAuthContext,
} from "@takos/platform/app/services";
import { makeData } from "../data";
import {
  releaseStore,
  requireInstanceDomain,
  getActorUri,
  nowISO,
  uuid,
  addHours,
  publishStoryCreate,
} from "@takos/platform/server";
import {
  DEFAULT_IMAGE_DURATION_MS,
  DEFAULT_TEXT_DURATION_MS,
  DEFAULT_VIDEO_DURATION_MS,
  normalizeStoryItems,
} from "@takos/platform";
import type { AppAuthContext as RuntimeAuthContext } from "@takos/platform/app/services";

const defaultDurationForItem = (item: StoryItem) => {
  switch (item.type) {
    case "video":
      return DEFAULT_VIDEO_DURATION_MS;
    case "text":
      return DEFAULT_TEXT_DURATION_MS;
    default:
      return DEFAULT_IMAGE_DURATION_MS;
  }
};

const sanitizeStoryItems = (rawItems: unknown): StoryItem[] => {
  const normalized = normalizeStoryItems(rawItems);
  if (!normalized.length) {
    throw new Error("items is required");
  }
  return normalized.map((item, index) => ({
    ...item,
    id: item.id || crypto.randomUUID(),
    durationMs: item.durationMs ?? defaultDurationForItem(item),
    order: typeof item.order === "number" ? item.order : index,
  }));
};

/**
 * コミュニティメンバーシップを確認
 */
async function requireMember(
  store: ReturnType<typeof makeData>,
  communityId: string | null | undefined,
  userId: string,
  env: any,
): Promise<boolean> {
  if (!communityId) return true;
  const localMember = await store.hasMembership(communityId, userId);
  if (localMember) return true;
  const instanceDomain = requireInstanceDomain(env as any);
  const actorUri = getActorUri(userId, instanceDomain);
  const follower = await store.findApFollower?.(`group:${communityId}`, actorUri).catch(() => null);
  return follower?.status === "accepted";
}

export function createStoryService(env: any): StoryService {
  return {
    async createStory(ctx: AppAuthContext, input: CreateStoryInput): Promise<Story> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const targetCommunityId = input.community_id || null;

        // コミュニティが指定されている場合、メンバーシップを確認
        if (targetCommunityId) {
          const community = await store.getCommunity(targetCommunityId);
          if (!community) {
            throw new Error("Community not found");
          }
          if (!(await requireMember(store, targetCommunityId, ctx.userId, env))) {
            throw new Error("Forbidden: not a member");
          }
        }

        const items = sanitizeStoryItems(input.items);

        const audienceInput = String(input.audience || "all");
        const audience =
          audienceInput === "community" && targetCommunityId ? "community" : "all";
        const broadcastAll = audience === "all";
        const visibleToFriends = broadcastAll
          ? input.visible_to_friends === undefined
            ? true
            : !!input.visible_to_friends
          : false;

        const id = uuid();
        const created_at = nowISO();
        const expires_at = addHours(new Date(), 24).toISOString();

        const storyPayload = {
          id,
          community_id: targetCommunityId,
          author_id: ctx.userId,
          created_at,
          expires_at,
          items,
          broadcast_all: broadcastAll,
          visible_to_friends: visibleToFriends,
          attributed_community_id: targetCommunityId,
        };

        // データベースに保存
        const story = await store.createStory(storyPayload);

        // ActivityPub 配信
        await publishStoryCreate(env, story, fetch).catch((err) => {
          console.error("Failed to publish story create", err);
        });

        return story as Story;
      } finally {
        await releaseStore(store);
      }
    },

    async listStories(ctx: AppAuthContext, params: ListStoriesParams): Promise<StoryPage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params.limit || 20, 100);
        const offset = params.offset || 0;

        let stories: any[];

        if (params.community_id) {
          // コミュニティストーリー
          const isMember = await requireMember(store, params.community_id, ctx.userId, env);
          if (!isMember) {
            throw new Error("Forbidden: not a member");
          }
          stories = await store.listStoriesByCommunity?.(params.community_id, limit, offset) || [];
        } else {
          // 全体のストーリー（フレンド + 自分）
          stories = await store.listStories?.(ctx.userId, limit, offset) || [];
        }

        const nextOffset = stories.length === limit ? offset + limit : null;

        return {
          stories: stories as Story[],
          next_offset: nextOffset,
        };
      } finally {
        await releaseStore(store);
      }
    },

    async getStory(ctx: AppAuthContext, id: string): Promise<Story | null> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const story = await store.getStory?.(id);
        if (!story) {
          return null;
        }

        // 閲覧権限チェック
        if (story.author_id === ctx.userId) {
          // 自分のストーリー
          return story as Story;
        }

        if (story.community_id) {
          // コミュニティストーリー
          const isMember = await requireMember(store, story.community_id, ctx.userId, env);
          if (!isMember) {
            throw new Error("Forbidden: not a member");
          }
        } else if (!story.broadcast_all) {
          // 全体公開でない場合
          throw new Error("Forbidden: not visible");
        }

        return story as Story;
      } finally {
        await releaseStore(store);
      }
    },

    async deleteStory(ctx: AppAuthContext, id: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const story = await store.getStory?.(id);
        if (!story) {
          throw new Error("Story not found");
        }

        // 作成者のみ削除可能
        if (story.author_id !== ctx.userId) {
          throw new Error("Forbidden: not the author");
        }

        await store.deleteStory?.(id);
      } finally {
        await releaseStore(store);
      }
    },

    async updateStory(
      ctx: RuntimeAuthContext,
      input: { id: string; items?: StoryItem[]; audience?: "all" | "community"; visible_to_friends?: boolean },
    ): Promise<Story> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const story = await store.getStory?.(input.id);
        if (!story) {
          throw new Error("Story not found");
        }
        if (story.author_id !== ctx.userId) {
          throw new Error("Forbidden: not the author");
        }

        const items = input.items ? sanitizeStoryItems(input.items) : story.items;
        const audienceInput = String(input.audience || (story.broadcast_all ? "all" : "community"));
        const audience =
          audienceInput === "community" && story.community_id ? "community" : "all";
        const broadcast_all = audience === "all";
        const visible_to_friends =
          broadcast_all && input.visible_to_friends !== undefined
            ? !!input.visible_to_friends
            : story.visible_to_friends;

        const updated = await store.updateStory?.(input.id, {
          items,
          broadcast_all,
          visible_to_friends,
        });

        if (!updated) {
          throw new Error("Update failed");
        }
        return updated as Story;
      } finally {
        await releaseStore(store);
      }
    },
  };
}
