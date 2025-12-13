import type { Post } from "../components/PostCard.js";

type FetchFn = typeof fetch;

export interface NormalizedUser {
  id: string;
  handle: string;
  displayName: string;
  bio?: string;
  avatar?: string;
  banner?: string;
  followersCount?: number;
  followingCount?: number;
  postsCount?: number;
  isFollowing?: boolean;
  createdAt?: string;
}

function normalizeUser(raw: any): NormalizedUser {
  const handle = raw?.handle ?? raw?.preferred_username ?? raw?.username ?? "";
  return {
    id: raw?.id ?? raw?.user_id ?? handle,
    handle,
    displayName: raw?.displayName ?? raw?.display_name ?? raw?.name ?? handle,
    bio: raw?.bio ?? raw?.note ?? undefined,
    avatar: raw?.avatar ?? raw?.avatar_url ?? raw?.icon ?? undefined,
    banner: raw?.banner ?? raw?.header ?? raw?.banner_url ?? undefined,
    followersCount: raw?.followersCount ?? raw?.followers_count ?? raw?.followers ?? undefined,
    followingCount: raw?.followingCount ?? raw?.following_count ?? raw?.following ?? undefined,
    postsCount: raw?.postsCount ?? raw?.posts_count ?? undefined,
    isFollowing: raw?.isFollowing ?? raw?.is_following ?? undefined,
    createdAt: raw?.createdAt ?? raw?.created_at ?? raw?.created ?? undefined,
  };
}

function normalizePost(raw: any): Post {
  const authorRaw = raw?.author ?? raw?.actor ?? raw?.attributed_to ?? {};
  const author = normalizeUser(authorRaw);
  const mediaUrls: string[] =
    raw?.media_urls ??
    raw?.mediaUrls ??
    (Array.isArray(raw?.media) ? raw.media.map((m: any) => m?.url).filter(Boolean) : []) ??
    [];
  const media = mediaUrls.map((url) => ({ url, type: "image" as const }));

  return {
    id: raw?.id ?? "",
    content: raw?.content ?? raw?.text ?? "",
    author: {
      id: author.id,
      handle: author.handle,
      displayName: author.displayName,
      avatar: author.avatar,
    },
    createdAt:
      raw?.createdAt ??
      raw?.created_at ??
      raw?.published_at ??
      raw?.published ??
      new Date().toISOString(),
    likeCount: raw?.likeCount ?? raw?.like_count ?? raw?.favorites_count ?? undefined,
    replyCount: raw?.replyCount ?? raw?.reply_count ?? raw?.replies_count ?? undefined,
    liked: raw?.liked ?? raw?.favorited ?? undefined,
    media: media.length ? media : undefined,
  };
}

function normalizePosts(list: any[]): Post[] {
  return (list || []).map(normalizePost);
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

export function createCoreApi(fetchFn: FetchFn) {
  const coreFetch = async (path: string, init?: RequestInit) => {
    const url = path.startsWith("/-/api") ? path : `/-/api${path}`;
    const res = await fetchFn(url, init);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(body || `Request failed: ${res.status}`);
    }
    return res;
  };

  const getJson = async <T>(path: string, init?: RequestInit) => {
    const res = await coreFetch(path, init);
    return readJson<T>(res);
  };

  return {
    listTimeline: async (limit = 50): Promise<Post[]> => {
      const posts = await getJson<any[]>(`/posts?limit=${limit}`);
      return normalizePosts(posts);
    },

    listUserPosts: async (handleOrId: string, limit = 50): Promise<Post[]> => {
      const posts = await getJson<any[]>(`/posts?limit=${limit}`);
      return normalizePosts(posts).filter(
        (p) => p.author.handle === handleOrId || p.author.id === handleOrId,
      );
    },

    deletePost: async (postId: string): Promise<void> => {
      await coreFetch(`/posts/${postId}`, { method: "DELETE" });
    },

    getUser: async (handleOrId: string): Promise<NormalizedUser> => {
      const user = await getJson<any>(`/users/${handleOrId}`);
      return normalizeUser(user);
    },

    updateProfile: async (body: {
      display_name?: string;
      bio?: string;
      avatar_url?: string;
      banner_url?: string;
    }): Promise<NormalizedUser> => {
      const user = await getJson<any>("/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return normalizeUser(user);
    },

    followUser: async (userId: string): Promise<void> => {
      await coreFetch(`/users/${userId}/follow`, { method: "POST" });
    },

    unfollowUser: async (userId: string): Promise<void> => {
      await coreFetch(`/users/${userId}/follow`, { method: "DELETE" });
    },

    listNotifications: async (limit = 50): Promise<any> => {
      return getJson<any>(`/notifications?limit=${limit}`);
    },

    markNotificationRead: async (id: string): Promise<void> => {
      await coreFetch(`/notifications/${id}/read`, { method: "POST" });
    },

    uploadFile: async (file: File): Promise<{ url: string }> => {
      const form = new FormData();
      form.append("file", file);
      return getJson<{ url: string }>("/storage/upload", {
        method: "POST",
        body: form,
      });
    },
  };
}

