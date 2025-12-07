/**
 * Core Kernel Services
 *
 * PLAN.md 3.11 に基づくサービスAPI実装
 *
 * 実装は v1.8 actors/objects スキーマを前提とした最小限の機能を提供する。
 */

import {
  createObjectService as createCoreObjectService,
  visibilityToRecipients,
  recipientsToVisibility,
  type ObjectService,
  type PostService,
  type DMService,
  type StoryService,
  type CommunityService,
  type UserService,
  type MediaService,
  type ActorService,
  type StorageService,
  type NotificationService,
  type ActorProfile,
  type APObject,
  type APVisibility,
} from "@takos/platform/app/services";
import type {
  DmMessage,
  DmThread,
  DmThreadPage,
  DmMessagePage,
  OpenThreadInput,
  SendMessageInput,
  ListThreadsParams,
  ListMessagesParams,
} from "@takos/platform/app/services/dm-service";
import type {
  Post,
  PostHistoryEntry,
  Poll,
  Reaction,
  RepostListResult,
} from "@takos/platform/app/services/post-service";
import type {
  CreateStoryInput,
  Story,
  StoryPage,
  ListStoriesParams,
} from "@takos/platform/app/services/story-service";
import type {
  CreateCommunityInput,
  UpdateCommunityInput,
  Community,
  CommunityPage,
  Channel,
  CommunityMember,
  ChannelMessageParams,
  SendChannelMessageInput,
} from "@takos/platform/app/services/community-service";
import type {
  User,
  FollowRequestList,
  UpdateProfileInput,
} from "@takos/platform/app/services/user-service";
import type { MediaObject, MediaListResult, ListMediaParams } from "@takos/platform/app/services/media-service";
import type { AppAuthContext } from "@takos/platform/app/runtime/types";
import { makeData } from "../data";
import { signPushPayload } from "../lib/push-registration";
import {
  releaseStore,
  canonicalizeParticipants,
  computeParticipantsHash,
  requireInstanceDomain,
} from "@takos/platform/server";

type Store = any;

const DEFAULT_PAGE_SIZE = 20;

const withStore = async <T>(env: any, fn: (store: Store) => Promise<T>): Promise<T> => {
  const store = makeData(env as any);
  try {
    return await fn(store);
  } finally {
    await releaseStore(store);
  }
};

const ensureAuth = (ctx: AppAuthContext): string => {
  const userId = (ctx.userId || "").toString().trim();
  if (!userId) throw new Error("Authentication required");
  return userId;
};

const mapActorProfile = (row: any): ActorProfile => ({
  id: row?.id ?? row?.actor_id ?? row?.user_id ?? "",
  handle: row?.handle ?? row?.local_id ?? row?.id ?? "",
  type: row?.type ?? undefined,
  display_name: row?.display_name ?? row?.name ?? null,
  summary: row?.summary ?? null,
  avatar_url: row?.avatar_url ?? row?.avatar ?? null,
  header_url: row?.header_url ?? null,
  followers: row?.followers ?? null,
  following: row?.following ?? null,
  created_at: row?.created_at ?? null,
  updated_at: row?.updated_at ?? null,
});

const visibilityFromObject = (object: APObject): APVisibility => {
  const to = Array.isArray(object.to) ? object.to : [];
  const cc = Array.isArray(object.cc) ? object.cc : [];
  return ((object as any).visibility as APVisibility | undefined) ?? recipientsToVisibility(to, cc);
};

const objectIdFromAp = (object: APObject): string => {
  const localId = (object as any).local_id as string | undefined;
  if (localId) return localId;
  const id = object.id || "";
  const parts = id.split("/");
  return parts.pop() || id;
};

const toPoll = (object: APObject): Poll | null => {
  const poll = object["takos:poll"];
  if (!poll) return null;
  const options = poll.options || [];
  const votes = options.reduce((sum, opt) => sum + (opt.votes || 0), 0);
  return {
    id: `${object.id}#poll`,
    options: options.map((opt, idx) => ({
      id: `${object.id}#opt-${idx}`,
      text: opt.name,
      votes_count: opt.votes ?? 0,
    })),
    multiple: !!poll.multiple,
    expires_at: poll.expiresAt,
    votes_count: votes,
    voted: false,
  };
};

const toPost = (object: APObject): Post => {
  const visibility = visibilityFromObject(object);
  const published = object.published ?? new Date().toISOString();
  const attachments = (object.attachment || []) as any[];
  return {
    id: objectIdFromAp(object),
    author_id: object.actor,
    content: object.content ?? "",
    visibility,
    community_id: object.context ?? null,
    in_reply_to_id: (object.inReplyTo as string | null | undefined) ?? null,
    created_at: published,
    updated_at: object.updated ?? published,
    sensitive: (object as any)["takos:sensitive"] ?? false,
    content_warning: object.summary ?? null,
    media: attachments.map((att) => ({
      id: att.url,
      url: att.url,
      type: att.mediaType || att.type || "Document",
      alt: att.name,
    })),
    poll: toPoll(object),
    reactions_count: undefined,
    comments_count: undefined,
    reposts_count: undefined,
    bookmarked: (object as any).bookmarked ?? false,
    reposted: (object as any).reposted ?? false,
    author: undefined,
  };
};

const toStory = (object: APObject): Story => {
  const story = object["takos:story"] || {};
  const published = object.published ?? new Date().toISOString();
  return {
    id: objectIdFromAp(object),
    author_id: object.actor,
    community_id: object.context ?? null,
    created_at: published,
    expires_at: (story as any).expiresAt ?? (story as any).expires_at ?? null,
    items: (story as any).items ?? [],
    broadcast_all: visibilityFromObject(object) === "public" || visibilityFromObject(object) === "unlisted",
    visible_to_friends: visibilityFromObject(object) !== "direct",
  };
};

function nextOffset(itemsLength: number, limit: number | undefined, offset: number): number | null {
  if (!limit) return null;
  return itemsLength < limit ? null : offset + itemsLength;
}

const createActorService = (env: any): ActorService => {
  const follow = async (follower: string, target: string): Promise<void> =>
    withStore(env, async (store) => {
      if (typeof store.executeRaw === "function") {
        await store.executeRaw(
          `INSERT OR REPLACE INTO follows (id, follower_id, following_id, status, created_at) VALUES (?, ?, ?, 'accepted', CURRENT_TIMESTAMP)`,
          crypto.randomUUID(),
          follower,
          target,
        );
        return;
      }
      if (store.createFollow) {
        await store.createFollow(follower, target);
        return;
      }
      throw new Error("follow not supported");
    });

  const unfollow = async (follower: string, target: string): Promise<void> =>
    withStore(env, async (store) => {
      if (typeof store.executeRaw === "function") {
        await store.executeRaw(`DELETE FROM follows WHERE follower_id = ? AND following_id = ?`, follower, target);
        return;
      }
      throw new Error("unfollow not supported");
    });

  const listFollow = async (
    column: "follower_id" | "following_id",
    actorId: string,
    params?: { limit?: number; offset?: number },
  ): Promise<ActorProfile[]> =>
    withStore(env, async (store) => {
      if (typeof store.queryRaw !== "function") return [];
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params?.offset ?? 0;
      const rows = await store.queryRaw(
        `SELECT a.* FROM follows f JOIN actors a ON f.${column === "follower_id" ? "following_id" : "follower_id"} = a.id WHERE f.${column} = ? AND (f.status IS NULL OR f.status != 'rejected') ORDER BY f.created_at DESC LIMIT ? OFFSET ?`,
        actorId,
        limit,
        offset,
      );
      return (rows as any[]).map(mapActorProfile);
    });

  return {
    async get(_ctx, actorId) {
      return withStore(env, async (store) => {
        const row = await store.getUser(actorId).catch(() => null);
        return row ? mapActorProfile(row) : null;
      });
    },
    async getByHandle(_ctx, handle) {
      return withStore(env, async (store) => {
        const row = await store.getUser(handle).catch(() => null);
        return row ? mapActorProfile(row) : null;
      });
    },
    async search(_ctx, query, params) {
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params?.offset ?? 0;
      const actors = await withStore(env, async (store) => {
        if (store.searchUsers) {
          const rows = await store.searchUsers(query, limit);
          return (rows as any[]).slice(offset, offset + limit).map(mapActorProfile);
        }
        if (typeof store.queryRaw === "function") {
          const like = `%${query}%`;
          const rows = await store.queryRaw(
            `SELECT * FROM actors WHERE handle LIKE ? OR display_name LIKE ? LIMIT ? OFFSET ?`,
            like,
            like,
            limit,
            offset,
          );
          return (rows as any[]).map(mapActorProfile);
        }
        return [];
      });
      return { actors, next_offset: nextOffset(actors.length, limit, offset) };
    },
    async follow(ctx, targetId) {
      const follower = ensureAuth(ctx);
      if (follower === targetId) return;
      await follow(follower, targetId);
    },
    async unfollow(ctx, targetId) {
      const follower = ensureAuth(ctx);
      await unfollow(follower, targetId);
    },
    async block(ctx, targetId) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => {
        if (store.blockUser) return store.blockUser(userId, targetId);
        if (typeof store.executeRaw === "function") {
          await store.executeRaw(
            `INSERT OR REPLACE INTO blocks (blocker_id, blocked_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            userId,
            targetId,
          );
        }
      });
    },
    async unblock(ctx, targetId) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => {
        if (store.unblockUser) return store.unblockUser(userId, targetId);
        if (typeof store.executeRaw === "function") {
          await store.executeRaw(`DELETE FROM blocks WHERE blocker_id = ? AND blocked_id = ?`, userId, targetId);
        }
      });
    },
    async mute(ctx, targetId) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => {
        if (store.muteUser) return store.muteUser(userId, targetId);
        if (typeof store.executeRaw === "function") {
          await store.executeRaw(
            `INSERT OR REPLACE INTO mutes (muter_id, muted_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)`,
            userId,
            targetId,
          );
        }
      });
    },
    async unmute(ctx, targetId) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => {
        if (store.unmuteUser) return store.unmuteUser(userId, targetId);
        if (typeof store.executeRaw === "function") {
          await store.executeRaw(`DELETE FROM mutes WHERE muter_id = ? AND muted_id = ?`, userId, targetId);
        }
      });
    },
    async listFollowers(ctx, params) {
      const actorId = params?.actorId ?? ensureAuth(ctx);
      const actors = await listFollow("following_id", actorId, params);
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params?.offset ?? 0;
      return { actors, next_offset: nextOffset(actors.length, limit, offset) };
    },
    async listFollowing(ctx, params) {
      const actorId = params?.actorId ?? ensureAuth(ctx);
      const actors = await listFollow("follower_id", actorId, params);
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params?.offset ?? 0;
      return { actors, next_offset: nextOffset(actors.length, limit, offset) };
    },
  };
};

const dispatchFcmDirect = async (
  env: any,
  store: any,
  userId: string,
  notification: any,
): Promise<void> => {
  const serverKey = env.FCM_SERVER_KEY;
  if (!serverKey || !store?.listPushDevicesByUser) return;
  const devices = await store.listPushDevicesByUser(userId);
  if (!devices || devices.length === 0) return;
  const tokens = Array.from(
    new Set(
      devices
        .map((device: any) => device.token)
        .filter((token: string) => token?.trim()),
    ),
  );
  if (!tokens.length) return;
  const title = env.PUSH_NOTIFICATION_TITLE?.trim() || "通知";
  const data: Record<string, string> = {
    notification_id: notification.id,
    type: notification.type,
    ref_type: notification.ref_type ?? "",
    ref_id: notification.ref_id ?? "",
    actor_id: notification.actor_id ?? "",
  };
  const endpoint = "https://fcm.googleapis.com/fcm/send";
  await Promise.all(
    tokens.map(async (token) => {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `key=${serverKey}`,
          },
          body: JSON.stringify({
            to: token,
            notification: {
              title,
              body: notification.message || "",
            },
            data,
          }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          console.error("FCM send failed", res.status, text);
        }
      } catch (error) {
        console.error("FCM send error", error);
      }
    }),
  );
};

const sendPushNotification = async (env: any, store: any, record: any): Promise<void> => {
  let instanceDomain = "localhost";
  try {
    instanceDomain = requireInstanceDomain(env);
  } catch {
    // ignore
  }
  try {
    if (env.FCM_SERVER_KEY) {
      await dispatchFcmDirect(env, store, record.user_id, record);
      return;
    }
  } catch (error) {
    console.error("FCM direct dispatch failed", error);
  }

  const payload = {
    instance: instanceDomain,
    userId: record.user_id,
    notification: record,
  };
  let payloadSignature: string | null = null;
  try {
    payloadSignature = await signPushPayload(env, payload);
  } catch (error) {
    console.error("failed to sign push notification payload", error);
  }

  const gateway = env.PUSH_GATEWAY_URL;
  const secret = env.PUSH_WEBHOOK_SECRET;
  if (gateway) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (secret) headers["X-Push-Secret"] = secret;
      if (payloadSignature) headers["X-Push-Signature"] = payloadSignature;
      await fetch(`${gateway}/internal/push/events`, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      return;
    } catch (error) {
      console.error("push gateway dispatch failed", error);
    }
  }

  try {
    const pushServiceUrl =
      env.DEFAULT_PUSH_SERVICE_URL || "https://yurucommu.com/internal/push/events";
    const defaultSecret = env.DEFAULT_PUSH_SERVICE_SECRET || "";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (defaultSecret) headers["X-Push-Secret"] = defaultSecret;
    if (payloadSignature) headers["X-Push-Signature"] = payloadSignature;
    await fetch(pushServiceUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch (error) {
    console.error("default push service dispatch failed", error);
  }
};

const createNotificationService = (env: any): NotificationService => ({
  async list(ctx, params) {
    const userId = ensureAuth(ctx);
    return withStore(env, async (store) => {
      if (params?.since && store.listNotificationsSince) {
        return store.listNotificationsSince(userId, params.since);
      }
      if (store.listNotifications) {
        return store.listNotifications(userId);
      }
      return [];
    });
  },

  async markRead(ctx, id) {
    const userId = ensureAuth(ctx);
    return withStore(env, async (store) => {
      if (store.markNotificationRead) {
        await store.markNotificationRead(id);
      }
      const unread = store.countUnreadNotifications ? await store.countUnreadNotifications(userId) : undefined;
      return { id, unread_count: unread ?? undefined };
    });
  },

  async send(ctx, input) {
    const actorId = (ctx.userId ?? null) as string | null;
    const payload = {
      id: crypto.randomUUID(),
      user_id: input.recipientId,
      type: input.type,
      actor_id: input.actorId ?? actorId,
      ref_type: input.refType ?? null,
      ref_id: input.refId ?? null,
      message: input.message ?? "",
      data_json: input.data ?? null,
      created_at: new Date(),
      read: 0,
    };
    await withStore(env, async (store) => {
      if (store.addNotification) {
        await store.addNotification(payload as any);
      }
      await sendPushNotification(env as any, store as any, payload);
    });
  },
});

const createStorageService = (env: any): StorageService => ({
  async list(ctx, params) {
    const userId = ensureAuth(ctx);
    const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
    const cursor = params?.cursor;
    const prefix = params?.prefix ?? `user-uploads/${userId}`;
    if (env.MEDIA?.list) {
      const res = await env.MEDIA.list({ prefix, limit, cursor });
      return {
        objects: (res.objects || []).map((obj: any) => ({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded,
          httpEtag: obj.httpEtag,
        })),
        cursor: res.truncated ? res.cursor : undefined,
        truncated: !!res.truncated,
      };
    }
    const files = await withStore(env, async (store) => {
      if (store.listMediaByUser) {
        return store.listMediaByUser(userId);
      }
      return [];
    });
    return {
      objects: (files as any[]).map((f) => ({
        key: f.key ?? f.url ?? "",
        size: 0,
        uploaded: f.created_at ?? new Date(),
        httpEtag: undefined,
      })),
      cursor: null,
      truncated: false,
    };
  },

  async deleteObject(ctx, key) {
    const userId = ensureAuth(ctx);
    if (env.MEDIA?.delete) {
      await env.MEDIA.delete(key);
    }
    await withStore(env, async (store) => {
      if (store.getMedia) {
        const media = await store.getMedia(key);
        if (media && media.user_id !== userId) {
          throw new Error("forbidden");
        }
      }
      if (store.deleteMedia) {
        await store.deleteMedia(key);
      }
    });
    return { deleted: true };
  },

  getPublicUrl(key) {
    return `/media/${encodeURI(key)}`;
  },
});

const createObjectService = (env: any): ObjectService => createCoreObjectService(env);

const createPostService = (env: any): PostService => {
  const objects = createObjectService(env);

  const fetchObject = async (id: string): Promise<APObject | null> => {
    const direct = await objects.get({ userId: null }, id);
    if (direct) return direct;
    return objects.getByLocalId({ userId: null }, id);
  };

  return {
    async createPost(ctx, input) {
      const author = ensureAuth(ctx);
      const visibilityMap: Record<string, APVisibility> = {
        public: "public",
        unlisted: "unlisted",
        private: "followers",
        direct: "direct",
      };
      const visibility = visibilityMap[input.visibility ?? "public"] ?? "public";
      const attachments =
        input.media_ids?.map((id) => ({
          type: "Document",
          url: id.startsWith("/media/") ? id : `/media/${id}`,
        })) ?? undefined;
      const created = await objects.create(
        { userId: author },
        {
          type: "Note",
          content: input.content,
          summary: input.content_warning ?? undefined,
          visibility,
          context: input.community_id ?? null,
          inReplyTo: input.in_reply_to_id ?? null,
          attachment: attachments as any,
          "takos:poll": input.poll
            ? {
                options: input.poll.options.map((name) => ({ name, votes: 0 })),
                multiple: input.poll.multiple ?? false,
                expiresAt: input.poll.expires_in
                  ? new Date(Date.now() + input.poll.expires_in * 1000).toISOString()
                  : undefined,
              }
            : undefined,
        },
      );
      return toPost(created);
    },

    async updatePost(ctx, input) {
      ensureAuth(ctx);
      const existing = await fetchObject(input.id);
      if (!existing) throw new Error("post not found");
      const attachments =
        input.media_ids?.map((id) => ({
          type: "Document",
          url: id.startsWith("/media/") ? id : `/media/${id}`,
        })) ?? undefined;
      const updated = await objects.update(ctx, existing.id, {
        content: input.content ?? existing.content,
        tag: existing.tag,
        attachment: attachments ?? (existing.attachment as any),
        summary: input.content_warning ?? existing.summary,
      });
      return toPost(updated);
    },

    async deletePost(ctx, id) {
      ensureAuth(ctx);
      const target = await fetchObject(id);
      if (target) {
        await objects.delete(ctx, target.id);
      }
    },

    async reactToPost(ctx, input) {
      const userId = ensureAuth(ctx);
      await objects.create(ctx, {
        type: "Like",
        content: undefined,
        visibility: "public",
        to: [],
        cc: [],
        tag: [],
        context: null,
        inReplyTo: null,
        object: input.post_id,
        // stored in content.object
      } as any);
      // No return body required
    },

    async listTimeline(ctx, params) {
      const page = await objects.getTimeline(ctx, {
        type: ["Note", "Article", "Question"],
        visibility: params.visibility as any,
        limit: params.limit ?? DEFAULT_PAGE_SIZE,
        cursor: params.offset ? String(params.offset) : undefined,
        communityId: params.community_id,
        listId: params.list_id,
        onlyMedia: params.only_media,
      });
      const posts = page.items.map(toPost);
      return {
        posts,
        next_cursor: page.nextCursor ?? null,
        next_offset: page.hasMore ? (params.offset ?? 0) + posts.length : null,
      };
    },

    async searchPosts(ctx, params) {
      if (!params.query?.trim()) {
        return { posts: [], next_offset: null, next_cursor: null };
      }
      const page = await objects.query(ctx, {
        type: ["Note", "Article", "Question"],
        limit: params.limit ?? DEFAULT_PAGE_SIZE,
        cursor: params.offset ? String(params.offset) : undefined,
        includeDeleted: false,
      });
      const filtered = page.items.filter((item) =>
        (item.content || "").toLowerCase().includes(params.query.toLowerCase()),
      );
      return {
        posts: filtered.map(toPost),
        next_offset: nextOffset(filtered.length, params.limit ?? DEFAULT_PAGE_SIZE, params.offset ?? 0),
        next_cursor: page.nextCursor ?? null,
      };
    },

    async getPost(ctx, id) {
      const object = await fetchObject(id);
      return object ? toPost(object) : null;
    },

    async listPostHistory(_ctx, _id) {
      const history: PostHistoryEntry[] = [];
      return history;
    },

    async getPoll(ctx, id) {
      const object = await fetchObject(id);
      if (!object) return null;
      return toPoll(object);
    },

    async voteOnPoll(ctx, input) {
      ensureAuth(ctx);
      const object = await fetchObject(input.post_id);
      if (!object) throw new Error("poll not found");
      return toPoll(object);
    },

    async repost(ctx, input) {
      const userId = ensureAuth(ctx);
      const visibility: APVisibility = "public";
      const created = await objects.create(ctx, {
        type: "Announce",
        visibility,
        content: undefined,
        to: visibilityToRecipients(visibility, userId, `${userId}/followers`).to,
        cc: visibilityToRecipients(visibility, userId, `${userId}/followers`).cc,
        tag: [],
        context: null,
        inReplyTo: null,
        object: input.post_id,
      } as any);
      return { reposted: true, id: objectIdFromAp(created) };
    },

    async undoRepost(ctx, id) {
      ensureAuth(ctx);
      await objects.delete(ctx, id);
    },

    async listReposts(ctx, params) {
      const page = await objects.query(ctx, {
        type: "Announce",
        limit: params.limit ?? DEFAULT_PAGE_SIZE,
        cursor: params.offset ? String(params.offset) : undefined,
        includeDeleted: false,
      });
      const items = page.items.filter((o) => (o as any).object === params.post_id);
      const reposts = items.map((o) => ({
        id: objectIdFromAp(o),
        user: { id: o.actor },
        comment: (o as any).comment ?? null,
        created_at: o.published ?? new Date().toISOString(),
      }));
      return {
        items: reposts,
        count: reposts.length,
        next_offset: page.hasMore ? (params.offset ?? 0) + reposts.length : null,
      };
    },

    async listReactions(ctx, id) {
      const page = await objects.query(ctx, {
        type: "Like",
        limit: DEFAULT_PAGE_SIZE,
        includeDeleted: false,
      });
      const items = page.items.filter((o) => (o as any).object === id);
      const reactions: Reaction[] = items.map((o) => ({
        id: objectIdFromAp(o),
        post_id: id,
        user_id: o.actor,
        emoji: "👍",
        created_at: o.published ?? new Date().toISOString(),
      }));
      return reactions;
    },

    async removeReaction(ctx, id) {
      ensureAuth(ctx);
      await objects.delete(ctx, id);
    },

    async listComments(ctx, id) {
      const page = await objects.query(ctx, {
        type: "Note",
        inReplyTo: id,
        includeDeleted: false,
        limit: DEFAULT_PAGE_SIZE,
      });
      return page.items.map(toPost);
    },

    async addBookmark(ctx, id) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => {
        if (store.addObjectBookmark) {
          await store.addObjectBookmark({ object_id: id, actor_id: userId });
        }
      });
    },

    async removeBookmark(ctx, id) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => {
        if (store.removeObjectBookmark) {
          await store.removeObjectBookmark(id, userId);
        } else if (store.deleteBookmark) {
          await store.deleteBookmark(id, userId);
        }
      });
    },

    async listBookmarks(ctx, params) {
      const userId = ensureAuth(ctx);
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params?.offset ?? 0;
      const objectsForUser = await withStore(env, async (store) => {
        if (store.listObjectBookmarksByActor) {
          const objs = await store.listObjectBookmarksByActor(userId, limit, offset);
          return objs as any[];
        }
        const rows = await store.listBookmarksByUser(userId, limit, offset);
        if (!rows?.length || !store.getObject) return [];
        const ids = rows.map((r: any) => r.object_id);
        const fetched = await Promise.all(ids.map((oid: string) => store.getObject(oid)));
        return fetched.filter(Boolean);
      });
      const posts = (objectsForUser as any[]).map((o) => toPost((o as any) as APObject));
      const next = objectsForUser.length < limit ? null : offset + objectsForUser.length;
      return { items: posts, next_offset: next };
    },

    async listPinnedPosts(ctx, params?: { user_id?: string; limit?: number }) {
      const userId = params?.user_id ?? ensureAuth(ctx);
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const posts = await withStore(env, async (store) => {
        if (store.listPinnedPostsByUser) {
          const rows = await store.listPinnedPostsByUser(userId, limit);
          return rows as any[];
        }
        return [];
      });
      return posts.map((p: any) => toPost((p as any) as APObject));
    },
  };
};

const createDMService = (env: any): DMService => {
  const objects = createObjectService(env);
  const threadFromObject = (obj: APObject): { participants: string[] } => {
    const participants = canonicalizeParticipants([
      obj.actor,
      ...(obj.to || []),
      ...(obj.cc || []),
      ...(obj.bto || []),
      ...(obj.bcc || []),
    ]);
    return { participants };
  };

  const toDmMessage = (obj: APObject, threadId: string): DmMessage => ({
    id: objectIdFromAp(obj),
    thread_id: threadId,
    sender_actor_uri: obj.actor,
    content: obj.content ?? "",
    created_at: obj.published ?? new Date().toISOString(),
    media: (obj.attachment || []).map((att: any) => ({
      id: att.url,
      url: att.url,
      type: att.type || "Document",
    })),
  });

  const fetchThreadMessages = async (threadId: string, limit?: number, offset?: number): Promise<APObject[]> => {
    const all = await objects.getThread({ userId: null }, threadId);
    const start = offset ?? 0;
    const end = limit ? start + limit : undefined;
    return all.slice(start, end);
  };

  return {
    async openThread(ctx, input: OpenThreadInput) {
      const sender = ensureAuth(ctx);
      const participants = canonicalizeParticipants([sender, ...(input.participants || [])]);
      const threadId = computeParticipantsHash(participants);
      const page = await objects.getThread(ctx, threadId).catch(() => []);
      const messages = page.map((obj) => toDmMessage(obj, threadId));
      return { threadId, messages };
    },

    async sendMessage(ctx, input: SendMessageInput) {
      const sender = ensureAuth(ctx);
      const participants = canonicalizeParticipants([
        sender,
        ...((input.participants as string[]) || []),
      ]);
      const threadId = input.thread_id || computeParticipantsHash(participants);
      const { to, cc } = visibilityToRecipients("direct", sender);
      const targetRecipients = participants.filter((p) => p !== sender);
      const apObject = await objects.create(ctx, {
        type: "Note",
        content: input.content,
        visibility: "direct",
        to: targetRecipients.length ? targetRecipients : to,
        cc,
        context: threadId,
      });
      return toDmMessage(apObject, threadId);
    },

    async listThreads(ctx, params?: ListThreadsParams): Promise<DmThreadPage> {
      const userId = ensureAuth(ctx);
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params?.offset ?? 0;
      const threads = await withStore(env, async (store) => {
        if (typeof store.queryRaw !== "function") return [];
        return store.queryRaw(
          `SELECT context, MAX(published) as latest FROM objects WHERE visibility = 'direct' AND context IS NOT NULL AND deleted_at IS NULL AND (
            actor = ? OR EXISTS (SELECT 1 FROM json_each(coalesce(to,'[]')) WHERE value = ?) OR EXISTS (SELECT 1 FROM json_each(coalesce(cc,'[]')) WHERE value = ?) OR EXISTS (SELECT 1 FROM json_each(coalesce(bto,'[]')) WHERE value = ?) OR EXISTS (SELECT 1 FROM json_each(coalesce(bcc,'[]')) WHERE value = ?)
          )
          GROUP BY context ORDER BY latest DESC LIMIT ? OFFSET ?`,
          userId,
          userId,
          userId,
          userId,
          userId,
          limit,
          offset,
        );
      });
      const items: DmThread[] = [];
      for (const row of threads as any[]) {
        const context = row.context as string;
        const messages = await objects.getThread(ctx, context);
        const latest = messages[messages.length - 1] ?? messages[0];
        const participants = latest ? threadFromObject(latest).participants : [];
        items.push({
          id: context,
          participants,
          created_at: (latest?.published as string) ?? new Date().toISOString(),
          latest_message: latest ? toDmMessage(latest, context) : null,
        });
      }
      return {
        threads: items,
        next_offset: nextOffset(items.length, limit, offset),
        next_cursor: null,
      };
    },

    async listMessages(ctx, params: ListMessagesParams): Promise<DmMessagePage> {
      ensureAuth(ctx);
      const limit = params.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params.offset ?? 0;
      const objectsInThread = await fetchThreadMessages(params.thread_id, limit, offset);
      const messages = objectsInThread.map((obj) => toDmMessage(obj, params.thread_id));
      return {
        messages,
        next_offset: nextOffset(messages.length, limit, offset),
        next_cursor: null,
      };
    },
  };
};

const createStoryService = (env: any): StoryService => {
  const objects = createObjectService(env);
  return {
    async createStory(ctx, input: CreateStoryInput) {
      const author = ensureAuth(ctx);
      const visibility: APVisibility = input.visible_to_friends ? "followers" : "public";
      const created = await objects.create(ctx, {
        type: "Note",
        content: "",
        visibility,
        context: input.community_id ?? null,
        "takos:story": {
          items: input.items,
          expiresAt: input.expires_at ?? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        },
      } as any);
      return toStory(created);
    },

    async listStories(ctx, params?: ListStoriesParams) {
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params?.offset ?? 0;
      const page = await objects.getTimeline(ctx, {
        type: "Note",
        visibility: ["public", "followers", "community"],
        limit,
        cursor: offset ? String(offset) : undefined,
        communityId: params?.community_id,
      });
      const stories = page.items
        .filter((o) => !!o["takos:story"])
        .map(toStory);
      return { stories, next_offset: page.hasMore ? offset + stories.length : null };
    },

    async getStory(ctx, id: string) {
      const object = await objects.get(ctx, id);
      if (!object || !object["takos:story"]) return null;
      return toStory(object);
    },

    async updateStory(ctx, input: { id: string; items?: any; audience?: "all" | "community"; visible_to_friends?: boolean }) {
      const existing = await objects.get(ctx, input.id);
      if (!existing) throw new Error("story not found");
      const story = existing["takos:story"] || {};
      const updated = await objects.update(ctx, existing.id, {
        content: existing.content,
        attachment: existing.attachment as any,
        summary: existing.summary,
        tag: existing.tag,
        "takos:story": {
          ...story,
          items: input.items ?? (story as any).items,
        },
      } as any);
      return toStory(updated);
    },

    async deleteStory(ctx, id) {
      ensureAuth(ctx);
      await objects.delete(ctx, id);
    },
  };
};

const createMediaService = (env: any, storage?: StorageService): MediaService => {
  const storageService = storage ?? createStorageService(env);
  return {
    async listStorage(ctx, params?: ListMediaParams): Promise<MediaListResult> {
      const list = await storageService.list(ctx, {
        limit: params?.limit,
        cursor: params?.offset ? String(params.offset) : undefined,
      });
      const files: MediaObject[] = list.objects.map((obj) => ({
        id: obj.key,
        url: storageService.getPublicUrl(obj.key),
        created_at: obj.uploaded?.toString?.() ?? undefined,
        size: obj.size,
      }));
      return { files, next_offset: list.cursor ? Number(list.cursor) : null };
    },

    async deleteStorageObject(ctx, key: string) {
      await storageService.deleteObject(ctx, key);
      return { deleted: true };
    },
  };
};

const createCommunityService = (env: any): CommunityService => {
  const mapCommunity = (row: any): Community => ({
    id: row.id,
    name: row.handle ?? row.name ?? row.id,
    display_name: row.display_name ?? row.name ?? row.handle ?? row.id,
    description: row.summary ?? row.description ?? "",
    icon: (row.metadata_json && JSON.parse(row.metadata_json || "{}").icon_url) || row.icon || undefined,
    visibility: row.visibility ?? "public",
    owner_id: row.owner_id ?? "",
    members_count: row.members_count ?? undefined,
    posts_count: row.posts_count ?? undefined,
    created_at: row.created_at ?? new Date().toISOString(),
    is_member: row.is_member ?? undefined,
    role: row.role ?? null,
  });

  return {
    async createCommunity(ctx, input: CreateCommunityInput) {
      const owner = ensureAuth(ctx);
      const created = await withStore(env, async (store) => {
        if (!store.createCommunity) throw new Error("community not supported");
        return store.createCommunity({
          id: input.name,
          name: input.display_name,
          description: input.description ?? "",
          icon_url: input.icon ?? "",
          visibility: input.visibility ?? "public",
          created_by: owner,
        });
      });
      return mapCommunity(created);
    },

    async updateCommunity(ctx, input: UpdateCommunityInput) {
      ensureAuth(ctx);
      const updated = await withStore(env, async (store) => {
        if (!store.updateCommunity) throw new Error("community not supported");
        return store.updateCommunity(input.id, {
          display_name: input.display_name,
          description: input.description,
          icon: input.icon,
          visibility: input.visibility,
        });
      });
      return mapCommunity(updated);
    },

    async joinCommunity(ctx, communityId: string) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => store.setMembership?.(communityId, userId, { role: "member", status: "active" }));
    },

    async leaveCommunity(ctx, communityId: string) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => store.removeMembership?.(communityId, userId));
    },

    async listCommunities(ctx, params) {
      const limit = params.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params.offset ?? 0;
      const communities = await withStore(env, async (store) => {
        if (store.searchCommunities) {
          const rows = await store.searchCommunities(params.query ?? "", (ctx.userId as any) ?? undefined);
          return (rows as any[]).slice(offset, offset + limit);
        }
        if (typeof store.queryRaw === "function") {
          const rows = await store.queryRaw(
            `SELECT * FROM actors WHERE type = 'Group' ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            limit,
            offset,
          );
          return rows as any[];
        }
        return [];
      });
      return {
        communities: communities.map(mapCommunity),
        next_offset: nextOffset(communities.length, limit, offset),
        next_cursor: null,
      } as CommunityPage;
    },

    async getCommunity(_ctx, communityId: string) {
      const community = await withStore(env, async (store) => store.getCommunity?.(communityId));
      return community ? mapCommunity(community) : null;
    },

    async listChannels(ctx, communityId: string) {
      const channels = await withStore(env, async (store) => store.listChannelsByCommunity?.(communityId) ?? []);
      return channels as Channel[];
    },

    async createChannel(ctx, input: any) {
      ensureAuth(ctx);
      const channel = await withStore(env, async (store) => store.createChannel?.(input.community_id, input));
      return channel as Channel;
    },

    async updateChannel(ctx, input: any) {
      ensureAuth(ctx);
      const channel = await withStore(env, async (store) =>
        store.updateChannel?.(input.community_id, input.channel_id, { name: input.name, description: input.description }),
      );
      return channel as Channel;
    },

    async deleteChannel(ctx, communityId, channelId) {
      ensureAuth(ctx);
      await withStore(env, async (store) => store.deleteChannel?.(communityId, channelId));
    },

    async listMembers(ctx, communityId) {
      const members = await withStore(env, async (store) => store.listCommunityMembersWithUsers?.(communityId) ?? []);
      return (members as any[]).map((m) => ({
        user_id: m.id ?? m.user_id ?? "",
        role: m.role ?? "member",
        nickname: m.display_name ?? m.name ?? null,
        joined_at: m.joined_at ?? m.created_at ?? null,
        user: {
          id: m.id ?? "",
          display_name: m.display_name ?? m.name ?? "",
          avatar_url: m.avatar_url ?? undefined,
          handle: m.handle ?? m.local_id ?? "",
        },
      })) as CommunityMember[];
    },

    async sendDirectInvite(_ctx, input: { community_id: string; user_ids: string[] }) {
      return input.user_ids.map((id) => ({ id, status: "sent" }));
    },

    async getReactionSummary() {
      return {};
    },

    async listChannelMessages(ctx, params: ChannelMessageParams) {
      return withStore(env, async (store) => store.listChannelMessages?.(params.community_id, params.channel_id, params.limit ?? DEFAULT_PAGE_SIZE) ?? []);
    },

    async sendChannelMessage(ctx, input: SendChannelMessageInput) {
      const userId = ensureAuth(ctx);
      const activity = await withStore(env, async (store) => {
        if (store.createChannelMessageRecord) {
          return store.createChannelMessageRecord(
            input.community_id,
            input.channel_id,
            userId,
            input.content,
            { content: input.content },
          );
        }
        return null;
      });
      return { activity };
    },
  };
};

const createUserService = (env: any, actorService?: ActorService, notificationService?: NotificationService): UserService => {
  const actors = actorService ?? createActorService(env);
  const notifications = notificationService ?? createNotificationService(env);

  const mapUser = (profile: ActorProfile): User => ({
    id: profile.id,
    handle: profile.handle,
    display_name: profile.display_name ?? undefined,
    avatar: profile.avatar_url ?? undefined,
    bio: profile.summary ?? undefined,
    created_at: profile.created_at ?? undefined,
  });

  return {
    async getUser(ctx, userId) {
      const actor = await actors.get(ctx, userId);
      return actor ? mapUser(actor) : null;
    },

    async updateProfile(ctx, input: UpdateProfileInput) {
      const userId = ensureAuth(ctx);
      const updated = await withStore(env, async (store) => {
        if (!store.updateUser) throw new Error("updateProfile not supported");
        return store.updateUser(userId, {
          display_name: input.display_name,
          avatar_url: input.avatar ?? undefined,
          bio: input.bio ?? undefined,
        });
      });
      return mapUser(mapActorProfile(updated));
    },

    async searchUsers(ctx, params) {
      const list = await actors.search(ctx, params.query ?? "", params);
      return {
        users: list.actors.map(mapUser),
        next_offset: list.next_offset ?? null,
        next_cursor: list.next_cursor ?? null,
      };
    },

    follow: (ctx, targetUserId) => actors.follow(ctx, targetUserId),
    unfollow: (ctx, targetUserId) => actors.unfollow(ctx, targetUserId),
    block: (ctx, targetUserId) => actors.block(ctx, targetUserId),
    mute: (ctx, targetUserId) => actors.mute(ctx, targetUserId),
    unblock: (ctx, targetUserId) => actors.unblock(ctx, targetUserId),
    unmute: (ctx, targetUserId) => actors.unmute(ctx, targetUserId),

    async listFollowers(ctx, params) {
      const list = await actors.listFollowers(ctx, params);
      return { users: list.actors.map(mapUser), next_offset: list.next_offset ?? null, next_cursor: list.next_cursor ?? null };
    },

    async listFollowing(ctx, params) {
      const list = await actors.listFollowing(ctx, params);
      return { users: list.actors.map(mapUser), next_offset: list.next_offset ?? null, next_cursor: list.next_cursor ?? null };
    },

    async listFollowRequests() {
      return { incoming: [], outgoing: [] } as FollowRequestList;
    },

    async acceptFollowRequest() {},
    async rejectFollowRequest() {},

    async listBlocks(ctx, params) {
      const userId = ensureAuth(ctx);
      const blocks = await withStore(env, async (store) => store.listBlockedUsers?.(userId) ?? []);
      const users = blocks.map((b: any) => mapUser(mapActorProfile({ id: b.blocked_id ?? b.id ?? b })));
      return { users, next_offset: null, next_cursor: null };
    },

    async listMutes(ctx, params) {
      const userId = ensureAuth(ctx);
      const mutes = await withStore(env, async (store) => store.listMutedUsers?.(userId) ?? []);
      const users = mutes.map((m: any) => mapUser(mapActorProfile({ id: m.muted_id ?? m.id ?? m })));
      return { users, next_offset: null, next_cursor: null };
    },

    listNotifications: (ctx, params) => notifications.list(ctx, params),
    markNotificationRead: (ctx, id) => notifications.markRead(ctx, id),
  };
};

export {
  createPostService,
  createDMService,
  createStoryService,
  createMediaService,
  createCommunityService,
  createUserService,
  createObjectService,
  createActorService,
  createStorageService,
  createNotificationService,
};

export type {
  PostService,
  DMService,
  StoryService,
  CommunityService,
  UserService,
  MediaService,
  ObjectService,
  ActorService,
  StorageService,
  NotificationService,
};
