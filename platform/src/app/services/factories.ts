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
  type APObject,
  type APVisibility,
} from "./object-service";
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
import type { PostService } from "./post-service";
import type {
  CreateStoryInput,
  Story,
  StoryPage,
  ListStoriesParams,
} from "@takos/platform/app/services/story-service";
import type { StoryService } from "./story-service";
import type { DMService, MarkReadInput } from "./dm-service";
import type { CommunityService } from "./community-service";
import type { UserService } from "./user-service";
import type { MediaService } from "./media-service";
import type { ActorService, ActorProfile } from "./actor-service";
import type { StorageService } from "./storage-service";
import type { NotificationService } from "./notification-service";
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
import { makeData } from "../../server/data-factory";
import { releaseStore } from "../../utils/utils";
import { HttpError } from "../../utils/response-helpers";
import { canonicalizeParticipants, computeParticipantsHash } from "../../activitypub/chat";
import { requireInstanceDomain } from "../../subdomain";
import { signPushPayload } from "../../server/push-signature";
import { createUserSession, getSessionCookieName, getSessionTtlSeconds } from "../../server/session";
import { createUserJWT } from "../../server/jwt";
import type { AuthService } from "./auth-service";

type Store = any;

const DEFAULT_PAGE_SIZE = 20;
const HANDLE_REGEX = /^[a-z0-9_]{3,32}$/;
const DEFAULT_USER_HANDLE = "user";
const ACTIVE_USER_COOKIE_NAME = "activeUserId";
const boolFromEnv = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
  }
  return false;
};

const shouldUseSecureCookies = (env: any): boolean => {
  if (boolFromEnv(env?.ALLOW_INSECURE_COOKIES)) return false;
  const context = typeof env?.TAKOS_CONTEXT === "string" ? env.TAKOS_CONTEXT.trim().toLowerCase() : "";
  if (context === "dev") return false;
  return true;
};

const nowISO = () => new Date().toISOString();

const normalizeHandle = (input: string): string => (input || "").trim().toLowerCase();
const isValidHandle = (handle: string): boolean => HANDLE_REGEX.test(handle);

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

const sanitizeUser = (user: any) => {
  if (!user) return null;
  const { jwt_secret, tenant_id, ...publicProfile } = user;
  return publicProfile;
};

const formatCookie = (
  name: string,
  value: string,
  options: { ttlSeconds?: number; clear?: boolean; secure?: boolean } = {},
): string => {
  const normalizedName = (name || "").trim();
  const encoded = options.clear ? "" : encodeURIComponent(value ?? "");
  const ttl = options.clear ? 0 : Math.max(0, Math.trunc(options.ttlSeconds ?? 0));
  const parts = [`${normalizedName}=${encoded}`];
  parts.push(`Max-Age=${ttl}`);
  parts.push("Path=/");
  parts.push("HttpOnly");
  parts.push("SameSite=Lax");
  if (options.secure) {
    parts.push("Secure");
  }
  return parts.join("; ");
};

const clearCookie = (env: any, name: string): string =>
  formatCookie(name, "", { clear: true, secure: shouldUseSecureCookies(env) });

const formatSessionCookie = (env: any, sessionId: string): string =>
  formatCookie(getSessionCookieName(env as any), sessionId, {
    ttlSeconds: getSessionTtlSeconds(env as any),
    secure: shouldUseSecureCookies(env),
  });

const formatActiveUserCookie = (env: any, userId: string): string =>
  formatCookie(ACTIVE_USER_COOKIE_NAME, userId, {
    ttlSeconds: getSessionTtlSeconds(env as any),
    secure: shouldUseSecureCookies(env),
  });

const encoder = new TextEncoder();

const toHex = (bytes: Uint8Array) =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
  return toHex(new Uint8Array(digest));
}

function subtleTimingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function verifyPasswordValue(password: string, stored: string | null) {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 2) return false;
  const [salt, expected] = parts;
  const computed = await sha256Hex(`${salt}:${password}`);
  return subtleTimingSafeEqual(computed, expected);
}

async function verifyMasterPassword(input: string, expected: string): Promise<boolean> {
  if (!input || !expected) return false;
  if (expected.includes("$")) {
    try {
      if (await verifyPasswordValue(input, expected)) {
        return true;
      }
    } catch {
      // Ignore malformed hash values and fall back to direct comparison.
    }
  }
  return subtleTimingSafeEqual(input, expected);
}

const resolveDefaultHandle = (env: any): string => {
  const configured =
    typeof (env as any).DEFAULT_USER_HANDLE === "string"
      ? normalizeHandle((env as any).DEFAULT_USER_HANDLE)
      : "";
  return configured && isValidHandle(configured) ? configured : DEFAULT_USER_HANDLE;
};

const ensureDefaultUser = async (store: Store, handle: string) => {
  const existing = await store.getUser(handle).catch(() => null);
  if (existing) return existing;
  return store.createUser({
    id: handle,
    display_name: handle,
    is_private: 0,
    created_at: nowISO(),
  });
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
      if (store.createFollow) {
        await store.createFollow(follower, target);
        return;
      }
      throw new Error("follow not supported");
    });

  const unfollow = async (follower: string, target: string): Promise<void> =>
    withStore(env, async (store) => {
      if (store.deleteFollow) {
        await store.deleteFollow(follower, target);
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
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params?.offset ?? 0;
      if (column === "following_id" && store.listFollowers) {
        const rows = await store.listFollowers(actorId, limit, offset);
        return (rows as any[]).map(mapActorProfile);
      }
      if (column === "follower_id" && store.listFollowing) {
        const rows = await store.listFollowing(actorId, limit, offset);
        return (rows as any[]).map(mapActorProfile);
      }
      return [];
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
        throw new Error("block not supported");
      });
    },
    async unblock(ctx, targetId) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => {
        if (store.unblockUser) return store.unblockUser(userId, targetId);
        throw new Error("unblock not supported");
      });
    },
    async mute(ctx, targetId) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => {
        if (store.muteUser) return store.muteUser(userId, targetId);
        throw new Error("mute not supported");
      });
    },
    async unmute(ctx, targetId) {
      const userId = ensureAuth(ctx);
      await withStore(env, async (store) => {
        if (store.unmuteUser) return store.unmuteUser(userId, targetId);
        throw new Error("unmute not supported");
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

const createAuthService = (env: any): AuthService => ({
  async loginWithPassword(input) {
    const password = typeof input?.password === "string" ? input.password : "";
    const masterPassword = typeof env.AUTH_PASSWORD === "string" ? env.AUTH_PASSWORD.trim() : "";
    if (!password || !masterPassword) {
      throw new Error("invalid credentials");
    }

    const verified = await verifyMasterPassword(password, masterPassword);
    if (!verified) {
      throw new Error("invalid credentials");
    }

    return withStore(env, async (store) => {
      const handleInput =
        typeof input?.handle === "string" && input.handle.trim()
          ? input.handle
          : resolveDefaultHandle(env);
      const handle = normalizeHandle(handleInput);
      const user = await ensureDefaultUser(store, handle || resolveDefaultHandle(env));
      const { id: sessionId, expiresAt } = await createUserSession(store as any, env as any, user.id);
      const sessionCookie = formatSessionCookie(env, sessionId);
      const { token } = await createUserJWT({ env } as any, store as any, user.id);
      return {
        user: sanitizeUser(user),
        token,
        session: {
          id: sessionId,
          expires_at: expiresAt instanceof Date ? expiresAt.toISOString() : null,
        },
        setCookies: [sessionCookie],
      };
    });
  },

  async issueSessionToken(ctx) {
    const userId = ensureAuth(ctx);
    return withStore(env, async (store) => {
      const user = await store.getUser(userId).catch(() => null);
      if (!user) throw new Error("user not found");
      const { token } = await createUserJWT({ env } as any, store as any, userId);
      return { token, user: sanitizeUser(user) };
    });
  },

  async createOrActivateActor(ctx, input) {
    ensureAuth(ctx);
    return withStore(env, async (store) => {
      const rawHandle =
        (typeof input?.handle === "string" && input.handle.trim()) ||
        (typeof input?.user_id === "string" && input.user_id.trim()) ||
        (typeof input?.userId === "string" && input.userId.trim()) ||
        ctx.userId ||
        resolveDefaultHandle(env);
      const handle = normalizeHandle(rawHandle ?? "");
      if (!handle || !isValidHandle(handle)) {
        throw new Error("invalid handle");
      }
      const displayName =
        typeof input?.display_name === "string" && input.display_name.trim()
          ? input.display_name
          : rawHandle || handle;
      const create =
        input?.create_if_missing !== undefined
          ? !!input.create_if_missing
          : input?.create !== undefined
            ? !!input.create
            : true;
      const activate =
        input?.activate !== undefined
          ? !!input.activate
          : input?.set_active !== undefined
            ? !!input.set_active
            : true;
      const issueToken = input?.issue_token === true || input?.issueToken === true;

      let user = await store.getUser(handle).catch(() => null);
      let created = false;
      if (!user) {
        if (!create) {
          throw new Error("user not found");
        }
        user = await store.createUser({
          id: handle,
          display_name: displayName || handle,
          is_private: 0,
          created_at: nowISO(),
        });
        created = true;
      }

      const cookies: string[] = [];
      if (activate) {
        cookies.push(formatActiveUserCookie(env, (user as any).id));
      }

      const result = {
        user: sanitizeUser(user),
        active_user_id: activate ? (user as any).id : null,
        created,
      } as any;

      if (issueToken) {
        const { token } = await createUserJWT({ env } as any, store as any, (user as any).id);
        result.token = token;
      }
      if (cookies.length) {
        result.setCookies = cookies;
      }
      return result;
    });
  },

  async logout() {
    return {
      success: true,
      setCookies: [
        clearCookie(env, getSessionCookieName(env as any)),
        clearCookie(env, ACTIVE_USER_COOKIE_NAME),
      ],
    };
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
  const PUBLIC_AUDIENCE = "https://www.w3.org/ns/activitystreams#Public";

  const toList = (value: unknown): string[] => {
    if (Array.isArray(value)) return value.map((v) => v?.toString?.() ?? "").filter(Boolean);
    if (typeof value === "string") return [value];
    if (value === null || value === undefined) return [];
    return [String(value)];
  };

  const ensureAuthCtx = (ctx: AppAuthContext): string => {
    const userId = (ctx.userId || "").toString().trim();
    if (!userId) throw new HttpError(401, "UNAUTHORIZED", "Authentication required");
    return userId;
  };

  const normalizeDmParticipants = (raw: string[], sender: string): string[] => {
    const input = canonicalizeParticipants(raw.filter(Boolean).map((p) => p.trim()));
    const merged = canonicalizeParticipants([...input, sender].filter((p) => p !== PUBLIC_AUDIENCE));
    if (merged.length < 2) {
      throw new HttpError(400, "INVALID_PARTICIPANTS", "At least one other participant is required");
    }
    if (merged.length > 20) {
      throw new HttpError(400, "TOO_MANY_PARTICIPANTS", "DM threads support up to 20 participants");
    }
    return merged;
  };

  const participantsFromObject = (obj: APObject): string[] => {
    const declared = toList((obj as any)["takos:participants"]);
    const all = [
      obj.actor,
      ...toList(obj.to),
      ...toList(obj.cc),
      ...toList((obj as any).bto),
      ...toList((obj as any).bcc),
      ...declared,
    ]
      .filter(Boolean)
      .filter((p) => p !== PUBLIC_AUDIENCE);
    return canonicalizeParticipants(all);
  };

  const threadFromObject = (obj: APObject): { participants: string[]; threadId: string } => {
    const participants = participantsFromObject(obj);
    const threadId = (obj.context as string | undefined) || computeParticipantsHash(participants);
    return { participants, threadId };
  };

  const filterMessagesForUser = (objectsInThread: APObject[], userId: string): APObject[] => {
    return objectsInThread.filter((obj) => {
      const participants = participantsFromObject(obj);
      if (!participants.includes(userId)) return false;
      const draft = Boolean((obj as any)["takos:draft"] ?? (obj as any).draft);
      if (draft && obj.actor !== userId) return false;
      const recipients = new Set([
        ...toList(obj.to),
        ...toList((obj as any).bto),
        ...toList((obj as any).bcc),
        obj.actor,
      ]);
      return recipients.has(userId) || obj.actor === userId;
    });
  };

  const toDmMessage = (obj: APObject): DmMessage => {
    const { threadId } = threadFromObject(obj);
    return {
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
      in_reply_to: (obj as any).inReplyTo ?? (obj as any).in_reply_to ?? null,
      draft: Boolean((obj as any)["takos:draft"] ?? (obj as any).draft ?? false),
    };
  };

  const resolveThreadMessages = async (
    ctx: AppAuthContext,
    threadId: string,
  ): Promise<{ participants: string[]; messages: APObject[] }> => {
    const all = await objects.getThread(ctx, threadId).catch(() => []);
    const participants = all.length ? threadFromObject(all[0]).participants : [];
    return { participants, messages: all };
  };

  const ensureThreadMembership = (userId: string, participants: string[]) => {
    if (!participants.length) {
      throw new HttpError(404, "THREAD_NOT_FOUND", "DM thread not found");
    }
    if (!participants.includes(userId)) {
      throw new HttpError(403, "FORBIDDEN", "Not a participant of this thread");
    }
  };

  return {
    async openThread(ctx, input: OpenThreadInput) {
      const sender = ensureAuthCtx(ctx);
      const participants = normalizeDmParticipants(input.participants || [], sender);
      const threadId = computeParticipantsHash(participants);
      const page = await objects.getThread(ctx, threadId).catch(() => []);
      const visible = filterMessagesForUser(page, sender);
      const messages = visible.map((obj) => toDmMessage(obj));
      return { threadId, messages };
    },

    async sendMessage(ctx, input: SendMessageInput) {
      const sender = ensureAuthCtx(ctx);
      const content = (input.content ?? "").toString();
      if (!content.trim()) {
        throw new HttpError(400, "INVALID_INPUT", "content is required");
      }

      let participants: string[] = [];
      if (input.participants?.length) {
        participants = normalizeDmParticipants(input.participants as string[], sender);
      } else if (input.thread_id) {
        const existing = await resolveThreadMessages(ctx, input.thread_id);
        if (!existing.participants.length) {
          throw new HttpError(404, "THREAD_NOT_FOUND", "DM thread not found");
        }
        participants = existing.participants;
      }
      if (!participants.length) {
        throw new HttpError(400, "INVALID_INPUT", "participants or thread_id is required");
      }

      if (!participants.includes(sender)) {
        participants = normalizeDmParticipants(participants, sender);
      }

      const threadId = input.thread_id || computeParticipantsHash(participants);
      const recipients = input.draft ? [sender] : participants.filter((p) => p !== sender);
      if (!recipients.length) {
        throw new HttpError(400, "INVALID_PARTICIPANTS", "Cannot create DM thread with only yourself");
      }

      const apObject = await objects.create(ctx, {
        type: "Note",
        content,
        visibility: "direct",
        to: recipients,
        cc: [],
        bto: [],
        bcc: [],
        inReplyTo: input.in_reply_to ?? null,
        context: threadId,
        "takos:participants": participants,
        "takos:draft": Boolean(input.draft),
      } as any);
      return toDmMessage(apObject);
    },

    async listThreads(ctx, params?: ListThreadsParams): Promise<DmThreadPage> {
      const userId = ensureAuthCtx(ctx);
      const limit = params?.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params?.offset ?? 0;
      const page = await objects.query(ctx, {
        visibility: "direct",
        includeDirect: true,
        participant: userId,
        limit: limit * 5,
        cursor: "0",
        order: "desc",
      });
      const contexts = new Map<string, APObject>();
      for (const item of page.items) {
        const { threadId } = threadFromObject(item);
        if (!threadId) continue;
        const draft = Boolean((item as any)["takos:draft"] ?? (item as any).draft);
        if (draft && item.actor !== userId) continue;
        const existing = contexts.get(threadId);
        if (!existing || (existing.published || "").localeCompare(item.published || "") < 0) {
          contexts.set(threadId, item);
        }
        if (contexts.size >= limit + offset) break;
      }

      const slice = Array.from(contexts.values())
        .sort((a, b) => (b.published || "").localeCompare(a.published || ""))
        .slice(offset, offset + limit);

      const items: DmThread[] = [];
      for (const obj of slice) {
        const { threadId } = threadFromObject(obj);
        const { participants, messages } = await resolveThreadMessages(ctx, threadId);
        const visibleMessages = filterMessagesForUser(messages, userId);
        const latest = visibleMessages[visibleMessages.length - 1] ?? null;
        items.push({
          id: threadId,
          participants,
          created_at: (latest?.published as string) ?? (obj.published as string) ?? new Date().toISOString(),
          latest_message: latest ? toDmMessage(latest) : null,
        });
      }

      return {
        threads: items,
        next_offset: nextOffset(items.length, limit, offset),
        next_cursor: null,
      };
    },

    async listMessages(ctx, params: ListMessagesParams): Promise<DmMessagePage> {
      const userId = ensureAuthCtx(ctx);
      const limit = params.limit ?? DEFAULT_PAGE_SIZE;
      const offset = params.offset ?? 0;
      const { participants, messages } = await resolveThreadMessages(ctx, params.thread_id);
      ensureThreadMembership(userId, participants);
      const filtered = filterMessagesForUser(messages, userId);
      const sliced = filtered.slice(offset, limit ? offset + limit : undefined);
      const mapped = sliced.map((obj) => toDmMessage(obj));
      return {
        messages: mapped,
        next_offset: nextOffset(mapped.length, limit, offset),
        next_cursor: null,
      };
    },

    async markRead(ctx, input: MarkReadInput) {
      const userId = ensureAuthCtx(ctx);
      const { participants } = await resolveThreadMessages(ctx, input.thread_id);
      ensureThreadMembership(userId, participants);
      return { thread_id: input.thread_id, message_id: input.message_id, read_at: new Date().toISOString() };
    },

    async deleteMessage(ctx, messageId: string) {
      const userId = ensureAuthCtx(ctx);
      const existing = await objects.get(ctx, messageId);
      if (!existing) {
        throw new HttpError(404, "MESSAGE_NOT_FOUND", "Message not found");
      }
      if (existing.actor !== userId) {
        throw new HttpError(403, "FORBIDDEN", "Only the sender can delete this message");
      }
      await objects.delete(ctx, messageId);
    },

    async saveDraft(ctx, input: SendMessageInput) {
      return this.sendMessage(ctx, { ...input, draft: true });
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
  createAuthService,
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
  AuthService,
};
