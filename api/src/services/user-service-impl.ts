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
  getActivityUri,
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

function parseActorToUserId(actorUri: string, instanceDomain: string): string {
  try {
    const urlObj = new URL(actorUri);
    const host = urlObj.host.toLowerCase();
    const isLocal =
      host === instanceDomain.toLowerCase() || urlObj.hostname.toLowerCase() === instanceDomain.toLowerCase();
    if (isLocal) {
      const match = urlObj.pathname.match(/\/ap\/users\/([a-z0-9_]{3,20})\/?$/);
      if (match) return match[1];
    }
    const segments = urlObj.pathname.split("/").filter(Boolean);
    const handle = segments[segments.length - 1] || actorUri.split("/").pop() || "unknown";
    return `@${handle}@${urlObj.host || urlObj.hostname}`;
  } catch {
    return actorUri;
  }
}

function sanitizeUser(user: any): any {
  if (!user) return null;
  const { jwt_secret, tenant_id, ...rest } = user;
  return rest;
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

    async updateProfile(ctx: AppAuthContext, input: any): Promise<User> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        const payload: Record<string, unknown> = {};
        if (typeof input.display_name === "string") payload.display_name = input.display_name;
        if (typeof input.avatar === "string") payload.avatar_url = input.avatar;
        if (typeof input.is_private === "boolean") payload.is_private = input.is_private;
        if (typeof input.bio === "string") payload.bio = input.bio;
        await store.updateUser(ctx.userId, payload);
        const updated = await resolveUser(store, ctx.userId, env);
        if (!updated) {
          throw new Error("User not found");
        }
        return updated as User;
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

    async listFollowRequests(
      ctx: AppAuthContext,
      params?: { direction?: "incoming" | "outgoing" | "all" },
    ): Promise<any> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        const direction = params?.direction ?? "all";
        const instanceDomain = requireInstanceDomain(env as any);
        const incoming: any[] = [];
        const outgoing: any[] = [];

        if (direction === "incoming" || direction === "all") {
          const followers = await store.listApFollowers?.(ctx.userId, "pending", 100).catch(() => []) ?? [];
          for (const f of followers as any[]) {
            const requesterId = parseActorToUserId((f as any).remote_actor_id, instanceDomain);
            const requester = await resolveUser(store, requesterId, env).catch(() => null);
            incoming.push({
              requester_id: requesterId,
              addressee_id: ctx.userId,
              status: "pending",
              created_at: new Date().toISOString(),
              requester: requester || { id: requesterId },
              addressee: { id: ctx.userId },
            });
          }
        }

        if (direction === "outgoing" || direction === "all") {
          const following = await store.listApFollows?.(ctx.userId, "pending", 100).catch(() => []) ?? [];
          for (const f of following as any[]) {
            const addresseeId = parseActorToUserId((f as any).remote_actor_id, instanceDomain);
            const addressee = await resolveUser(store, addresseeId, env).catch(() => null);
            outgoing.push({
              requester_id: ctx.userId,
              addressee_id: addresseeId,
              status: "pending",
              created_at: new Date().toISOString(),
              requester: { id: ctx.userId },
              addressee: addressee || { id: addresseeId },
            });
          }
        }

        return { incoming, outgoing };
      } finally {
        await releaseStore(store);
      }
    },

    async acceptFollowRequest(ctx: AppAuthContext, requesterId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        const instanceDomain = requireInstanceDomain(env as any);
        const myActorUri = getActorUri(ctx.userId, instanceDomain);
        const requester = await resolveUser(store, requesterId, env);
        if (!requester) {
          throw new Error("User not found");
        }
        const requesterUri = requester.id.startsWith("http")
          ? requester.id
          : getActorUri(requester.id, instanceDomain);
        const followRecord = await store.findApFollower?.(ctx.userId, requesterUri);
        if (!followRecord || followRecord.status !== "pending") {
          throw new Error("no pending request");
        }
        await store.updateApFollowersStatus?.(ctx.userId, requesterUri, "accepted", new Date());
        await store.upsertApFollow?.({
          local_user_id: ctx.userId,
          remote_actor_id: requesterUri,
          activity_id: followRecord.activity_id || `${requesterUri}/follows/${ctx.userId}`,
          status: "accepted",
          created_at: new Date(),
          accepted_at: new Date(),
        });
        await store.upsertApOutboxActivity?.({
          id: crypto.randomUUID(),
          local_user_id: ctx.userId,
          activity_id: getActivityUri(
            ctx.userId,
            `accept-follow-${requesterId.replace(/@/g, "_")}-${Date.now()}`,
            instanceDomain,
          ),
          activity_type: "Accept",
          activity_json: JSON.stringify({
            type: "Accept",
            actor: myActorUri,
            object: {
              type: "Follow",
              actor: requesterUri,
              object: myActorUri,
            },
          }),
          object_id: requesterUri,
          object_type: "Follow",
          created_at: new Date(),
        });
      } finally {
        await releaseStore(store);
      }
    },

    async rejectFollowRequest(ctx: AppAuthContext, requesterId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        const instanceDomain = requireInstanceDomain(env as any);
        const requester = await resolveUser(store, requesterId, env);
        if (!requester) {
          throw new Error("User not found");
        }
        const requesterUri = requester.id.startsWith("http")
          ? requester.id
          : getActorUri(requester.id, instanceDomain);
        const followRecord = await store.findApFollower?.(ctx.userId, requesterUri);
        if (!followRecord || followRecord.status !== "pending") {
          throw new Error("no pending request");
        }
        await store.updateApFollowersStatus?.(ctx.userId, requesterUri, "rejected", new Date());
        await store.upsertApOutboxActivity?.({
          id: crypto.randomUUID(),
          local_user_id: ctx.userId,
          activity_id: getActivityUri(
            ctx.userId,
            `reject-follow-${requesterId.replace(/@/g, "_")}-${Date.now()}`,
            instanceDomain,
          ),
          activity_type: "Reject",
          activity_json: JSON.stringify({
            type: "Reject",
            actor: getActorUri(ctx.userId, instanceDomain),
            object: {
              type: "Follow",
              actor: requesterUri,
              object: getActorUri(ctx.userId, instanceDomain),
            },
          }),
          object_id: requesterUri,
          object_type: "Follow",
          created_at: new Date(),
        });
      } finally {
        await releaseStore(store);
      }
    },

    async unblock(ctx: AppAuthContext, targetUserId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        await store.unblockUser?.(ctx.userId, targetUserId);
      } finally {
        await releaseStore(store);
      }
    },

    async unmute(ctx: AppAuthContext, targetUserId: string): Promise<void> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        await store.unmuteUser?.(ctx.userId, targetUserId);
      } finally {
        await releaseStore(store);
      }
    },

    async listBlocks(
      ctx: AppAuthContext,
      params?: { limit?: number; offset?: number },
    ): Promise<UserPage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params?.limit || 50, 200);
        const offset = params?.offset || 0;
        const list = await store.listBlockedUsers?.(ctx.userId).catch(() => []) ?? [];
        const paged = (list as any[]).slice(offset, offset + limit);
        const users = await Promise.all(
          paged.map(async (entry: any) => {
            if (entry.user) return sanitizeUser(entry.user);
            return await resolveUser(store, entry.blocked_id, env).catch(() => ({ id: entry.blocked_id }));
          }),
        );
        const next = list.length > offset + paged.length ? offset + paged.length : null;
        return { users: users as User[], next_offset: next, next_cursor: null };
      } finally {
        await releaseStore(store);
      }
    },

    async listMutes(
      ctx: AppAuthContext,
      params?: { limit?: number; offset?: number },
    ): Promise<UserPage> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        const limit = Math.min(params?.limit || 50, 200);
        const offset = params?.offset || 0;
        const list = await store.listMutedUsers?.(ctx.userId).catch(() => []) ?? [];
        const paged = (list as any[]).slice(offset, offset + limit);
        const users = await Promise.all(
          paged.map(async (entry: any) => {
            if (entry.user) return sanitizeUser(entry.user);
            return await resolveUser(store, entry.muted_id, env).catch(() => ({ id: entry.muted_id }));
          }),
        );
        const next = list.length > offset + paged.length ? offset + paged.length : null;
        return { users: users as User[], next_offset: next, next_cursor: null };
      } finally {
        await releaseStore(store);
      }
    },

    async listNotifications(
      ctx: AppAuthContext,
      params?: { since?: string },
    ): Promise<any[]> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        if (params?.since && store.listNotificationsSince) {
          return await store.listNotificationsSince(ctx.userId, new Date(params.since));
        }
        return await store.listNotifications(ctx.userId);
      } finally {
        await releaseStore(store);
      }
    },

    async markNotificationRead(
      ctx: AppAuthContext,
      notificationId: string,
    ): Promise<{ id: string; unread_count?: number }> {
      if (!ctx.userId) {
        throw new Error("Authentication required");
      }
      const store = makeData(env, null as any);
      try {
        await store.markNotificationRead(notificationId);
        const count = await store.countUnreadNotifications?.(ctx.userId).catch(() => 0);
        return { id: notificationId, unread_count: count ?? undefined };
      } finally {
        await releaseStore(store);
      }
    },
  };
}
