/**
 * CommunityService Implementation
 *
 * 既存のコミュニティロジックをCore Kernel サービスAPIでラップ
 */

import type {
  CommunityService,
  CreateCommunityInput,
  UpdateCommunityInput,
  Community,
  CommunityListParams,
  CommunityPage,
  AppAuthContext,
} from "@takos/platform/app/services";
import { makeData } from "../data";
import {
  releaseStore,
  requireInstanceDomain,
  getActorUri,
  uuid,
  nowISO,
  publishGroupCreate,
  publishGroupUpdate,
} from "@takos/platform/server";

export function createCommunityService(env: any): CommunityService {
  return {
    async createCommunity(ctx: AppAuthContext, input: CreateCommunityInput): Promise<Community> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const communityId = uuid();
        const instanceDomain = requireInstanceDomain(env as any);

        const community = await store.createCommunity({
          id: communityId,
          name: input.name,
          display_name: input.display_name,
          description: input.description || null,
          icon: input.icon || null,
          visibility: input.visibility || "public",
          owner_id: ctx.userId,
          created_at: nowISO(),
        });

        // Owner自身をメンバーとして追加
        await store.addCommunityMember(communityId, ctx.userId, "owner");

        // general チャンネルを自動作成
        await store.createChannel({
          id: uuid(),
          community_id: communityId,
          name: "general",
          display_name: "General",
          created_at: nowISO(),
        });

        // ActivityPub Group Create を送信
        const groupUri = `https://${instanceDomain}/ap/groups/${communityId}`;
        const actorUri = getActorUri(ctx.userId, instanceDomain);
        await publishGroupCreate(groupUri, actorUri, community, env as any, fetch).catch((err) => {
          console.warn("Failed to publish Group Create:", err);
        });

        return community as Community;
      } finally {
        await releaseStore(store);
      }
    },

    async updateCommunity(ctx: AppAuthContext, input: UpdateCommunityInput): Promise<Community> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const existing = await store.getCommunity(input.id);
        if (!existing) {
          throw new Error("Community not found");
        }

        // Owner または Moderator のみ更新可能
        const membership = await store.getCommunityMembership(input.id, ctx.userId);
        if (!membership || (membership.role !== "owner" && membership.role !== "moderator")) {
          throw new Error("Permission denied");
        }

        const updated = await store.updateCommunity(input.id, {
          display_name: input.display_name,
          description: input.description,
          icon: input.icon,
          visibility: input.visibility,
        });

        // ActivityPub Group Update を送信
        const instanceDomain = requireInstanceDomain(env as any);
        const groupUri = `https://${instanceDomain}/ap/groups/${input.id}`;
        const actorUri = getActorUri(ctx.userId, instanceDomain);
        await publishGroupUpdate(groupUri, actorUri, updated, env as any, fetch).catch((err) => {
          console.warn("Failed to publish Group Update:", err);
        });

        return updated as Community;
      } finally {
        await releaseStore(store);
      }
    },

    async joinCommunity(ctx: AppAuthContext, communityId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const community = await store.getCommunity(communityId);
        if (!community) {
          throw new Error("Community not found");
        }

        // 既にメンバーの場合はスキップ
        const existing = await store.getCommunityMembership(communityId, ctx.userId);
        if (existing) {
          return;
        }

        await store.addCommunityMember(communityId, ctx.userId, "member");

        // ActivityPub Follow を送信（コミュニティが Group Actor の場合）
        const instanceDomain = requireInstanceDomain(env as any);
        const actorUri = getActorUri(ctx.userId, instanceDomain);
        const groupUri = `https://${instanceDomain}/ap/groups/${communityId}`;

        // Note: publishFollow の実装が必要（現在は省略）
        // await publishFollow(actorUri, groupUri, env as any, fetch);
      } finally {
        await releaseStore(store);
      }
    },

    async leaveCommunity(ctx: AppAuthContext, communityId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const membership = await store.getCommunityMembership(communityId, ctx.userId);
        if (!membership) {
          return; // 既にメンバーでない
        }

        // Owner は退出不可
        if (membership.role === "owner") {
          throw new Error("Owner cannot leave the community");
        }

        await store.removeCommunityMember(communityId, ctx.userId);
      } finally {
        await releaseStore(store);
      }
    },

    async listCommunities(ctx: AppAuthContext, params: CommunityListParams): Promise<CommunityPage> {
      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params.limit || 20, 100);
        const offset = params.offset || 0;

        let communities: any[] = [];

        if (params.joined_only && ctx.userId) {
          // 参加中のコミュニティのみ
          communities = await store.getUserCommunities(ctx.userId, limit, offset);
        } else if (params.query) {
          // 検索
          communities = await store.searchCommunities(params.query, limit, offset, params.local_only);
        } else {
          // 全コミュニティ
          communities = await store.listCommunities(limit, offset, params.local_only);
        }

        // メンバー数を付与
        const result = await Promise.all(
          communities.map(async (c) => {
            const membersCount = await store.getCommunityMembersCount(c.id).catch(() => 0);
            const membership = ctx.userId
              ? await store.getCommunityMembership(c.id, ctx.userId).catch(() => null)
              : null;

            return {
              ...c,
              members_count: membersCount,
              is_member: !!membership,
              role: membership?.role || null,
            };
          }),
        );

        return {
          communities: result,
          next_offset: result.length === limit ? offset + limit : null,
          next_cursor: null,
        };
      } finally {
        await releaseStore(store);
      }
    },

    async getCommunity(ctx: AppAuthContext, communityId: string): Promise<Community | null> {
      const store = makeData(env, null as any);
      try {
        const community = await store.getCommunity(communityId);
        if (!community) {
          return null;
        }

        const membersCount = await store.getCommunityMembersCount(communityId).catch(() => 0);
        const membership = ctx.userId
          ? await store.getCommunityMembership(communityId, ctx.userId).catch(() => null)
          : null;

        return {
          ...community,
          members_count: membersCount,
          is_member: !!membership,
          role: membership?.role || null,
        } as Community;
      } finally {
        await releaseStore(store);
      }
    },
  };
}
