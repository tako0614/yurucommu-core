/**
 * UserService Implementation
 *
 * 既存のユーザー管理ロジックをCore Kernel サービスAPIでラップ
 */

import type {
  UserService,
  User,
  UserSearchParams,
  UserPage,
  AppAuthContext,
} from "@takos/platform/app/services";
import { makeData } from "../data";
import {
  releaseStore,
  requireInstanceDomain,
  getActorUri,
  webfingerLookup,
  getOrFetchActor,
  publishFollow,
  publishUndo,
  publishBlock,
} from "@takos/platform/server";

/**
 * ハンドルまたはActor URIからユーザーを解決
 */
async function resolveUser(
  store: ReturnType<typeof makeData>,
  userId: string,
  env: any,
): Promise<any | null> {
  // ローカルユーザーID
  if (!userId.includes("@") && !userId.startsWith("http")) {
    return await store.getUser(userId);
  }

  // Actor URI
  if (userId.startsWith("http://") || userId.startsWith("https://")) {
    const actor = await getOrFetchActor(userId, env, false, fetch).catch(() => null);
    if (!actor) return null;
    return {
      id: (actor as any).id,
      handle: (actor as any).preferredUsername || "unknown",
      display_name: (actor as any).name || null,
      avatar: (actor as any).icon?.url || null,
      bio: (actor as any).summary || null,
    };
  }

  // Handle: @user@domain or user@domain
  const normalized = userId.replace(/^@+/, "");
  const parts = normalized.split("@");
  if (parts.length < 2) {
    // ローカルハンドル
    return await store.getUserByHandle(normalized);
  }

  // リモートユーザー
  const actorUri = await webfingerLookup(normalized, fetch).catch(() => null);
  if (!actorUri) return null;

  const actor = await getOrFetchActor(actorUri, env, false, fetch).catch(() => null);
  if (!actor) return null;

  return {
    id: (actor as any).id,
    handle: (actor as any).preferredUsername || "unknown",
    display_name: (actor as any).name || null,
    avatar: (actor as any).icon?.url || null,
    bio: (actor as any).summary || null,
  };
}

export function createUserService(env: any): UserService {
  return {
    async getUser(ctx: AppAuthContext, userId: string): Promise<User | null> {
      const store = makeData(env, null as any);
      try {
        const user = await resolveUser(store, userId, env);
        if (!user) {
          return null;
        }

        // フォロー状態を確認
        if (ctx.userId) {
          const instanceDomain = requireInstanceDomain(env as any);
          const myActorUri = getActorUri(ctx.userId, instanceDomain);
          const targetActorUri = user.id.startsWith("http") ? user.id : getActorUri(user.id, instanceDomain);

          const following = await store.findApFollower?.(targetActorUri, myActorUri).catch(() => null);
          const followedBy = await store.findApFollower?.(myActorUri, targetActorUri).catch(() => null);

          user.is_following = following?.status === "accepted";
          user.is_followed_by = followedBy?.status === "accepted";

          // ブロック・ミュート状態
          const blocked = await store.isBlocked?.(ctx.userId, user.id).catch(() => false);
          const muted = await store.isMuted?.(ctx.userId, user.id).catch(() => false);

          user.is_blocked = blocked;
          user.is_muted = muted;
        }

        // カウント取得
        if (!user.id.startsWith("http")) {
          const counts = await store.getUserCounts?.(user.id).catch(() => null);
          if (counts) {
            user.followers_count = counts.followers_count;
            user.following_count = counts.following_count;
            user.posts_count = counts.posts_count;
          }
        }

        return user as User;
      } finally {
        await releaseStore(store);
      }
    },

    async searchUsers(ctx: AppAuthContext, params: UserSearchParams): Promise<UserPage> {
      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params.limit || 20, 100);
        const offset = params.offset || 0;

        let users: any[] = [];

        if (params.query) {
          users = await store.searchUsers(params.query, limit, offset, params.local_only);
        } else {
          users = await store.listUsers(limit, offset);
        }

        // フォロー状態を付与
        const result = await Promise.all(
          users.map(async (u) => {
            if (ctx.userId) {
              const instanceDomain = requireInstanceDomain(env as any);
              const myActorUri = getActorUri(ctx.userId, instanceDomain);
              const targetActorUri = u.id.startsWith("http") ? u.id : getActorUri(u.id, instanceDomain);

              const following = await store.findApFollower?.(targetActorUri, myActorUri).catch(() => null);
              const followedBy = await store.findApFollower?.(myActorUri, targetActorUri).catch(() => null);

              u.is_following = following?.status === "accepted";
              u.is_followed_by = followedBy?.status === "accepted";
            }

            return u;
          }),
        );

        return {
          users: result,
          next_offset: result.length === limit ? offset + limit : null,
          next_cursor: null,
        };
      } finally {
        await releaseStore(store);
      }
    },

    async follow(ctx: AppAuthContext, targetUserId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const instanceDomain = requireInstanceDomain(env as any);
        const myActorUri = getActorUri(ctx.userId, instanceDomain);
        const targetUser = await resolveUser(store, targetUserId, env);

        if (!targetUser) {
          throw new Error("User not found");
        }

        const targetActorUri = targetUser.id.startsWith("http")
          ? targetUser.id
          : getActorUri(targetUser.id, instanceDomain);

        // 既にフォロー中かチェック
        const existing = await store.findApFollower?.(targetActorUri, myActorUri).catch(() => null);
        if (existing && existing.status === "accepted") {
          return; // 既にフォロー中
        }

        // ActivityPub Follow を送信
        await publishFollow(myActorUri, targetActorUri, env as any, fetch);

        // ローカルの場合は即座に承認
        if (!targetUser.id.startsWith("http")) {
          await store.upsertApFollower?.(targetActorUri, myActorUri, "accepted", null);
        } else {
          await store.upsertApFollower?.(targetActorUri, myActorUri, "pending", null);
        }
      } finally {
        await releaseStore(store);
      }
    },

    async unfollow(ctx: AppAuthContext, targetUserId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const instanceDomain = requireInstanceDomain(env as any);
        const myActorUri = getActorUri(ctx.userId, instanceDomain);
        const targetUser = await resolveUser(store, targetUserId, env);

        if (!targetUser) {
          throw new Error("User not found");
        }

        const targetActorUri = targetUser.id.startsWith("http")
          ? targetUser.id
          : getActorUri(targetUser.id, instanceDomain);

        const existing = await store.findApFollower?.(targetActorUri, myActorUri).catch(() => null);
        if (!existing) {
          return; // フォローしていない
        }

        // ActivityPub Undo(Follow) を送信
        await publishUndo(myActorUri, "Follow", { object: targetActorUri }, env as any, fetch).catch((err) => {
          console.warn("Failed to publish Undo(Follow):", err);
        });

        // DB からフォロー情報を削除
        await store.deleteApFollower?.(targetActorUri, myActorUri);
      } finally {
        await releaseStore(store);
      }
    },

    async block(ctx: AppAuthContext, targetUserId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const targetUser = await resolveUser(store, targetUserId, env);
        if (!targetUser) {
          throw new Error("User not found");
        }

        // ブロックを追加
        await store.addBlock?.(ctx.userId, targetUser.id);

        // ActivityPub Block を送信
        const instanceDomain = requireInstanceDomain(env as any);
        const myActorUri = getActorUri(ctx.userId, instanceDomain);
        const targetActorUri = targetUser.id.startsWith("http")
          ? targetUser.id
          : getActorUri(targetUser.id, instanceDomain);

        await publishBlock(myActorUri, targetActorUri, env as any, fetch).catch((err) => {
          console.warn("Failed to publish Block:", err);
        });
      } finally {
        await releaseStore(store);
      }
    },

    async mute(ctx: AppAuthContext, targetUserId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const targetUser = await resolveUser(store, targetUserId, env);
        if (!targetUser) {
          throw new Error("User not found");
        }

        // ミュートを追加
        await store.addMute?.(ctx.userId, targetUser.id);
      } finally {
        await releaseStore(store);
      }
    },

    async listFollowers(
      ctx: AppAuthContext,
      params?: { limit?: number; offset?: number },
    ): Promise<UserPage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params?.limit || 20, 100);
        const offset = params?.offset || 0;

        const instanceDomain = requireInstanceDomain(env as any);
        const myActorUri = getActorUri(ctx.userId, instanceDomain);

        const followers = await store.listApFollowers?.(myActorUri, "accepted", limit, offset).catch(() => []);

        const users = await Promise.all(
          followers.map(async (f: any) => {
            return await resolveUser(store, f.follower_actor_uri, env);
          }),
        );

        return {
          users: users.filter((u) => u !== null) as User[],
          next_offset: users.length === limit ? offset + limit : null,
          next_cursor: null,
        };
      } finally {
        await releaseStore(store);
      }
    },

    async listFollowing(
      ctx: AppAuthContext,
      params?: { limit?: number; offset?: number },
    ): Promise<UserPage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }

      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params?.limit || 20, 100);
        const offset = params?.offset || 0;

        const instanceDomain = requireInstanceDomain(env as any);
        const myActorUri = getActorUri(ctx.userId, instanceDomain);

        const following = await store.listFollowing?.(myActorUri, "accepted", limit, offset).catch(() => []);

        const users = await Promise.all(
          following.map(async (f: any) => {
            return await resolveUser(store, f.target_actor_uri, env);
          }),
        );

        return {
          users: users.filter((u) => u !== null) as User[],
          next_offset: users.length === limit ? offset + limit : null,
          next_cursor: null,
        };
      } finally {
        await releaseStore(store);
      }
    },
  };
}
