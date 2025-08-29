import type { ActivityPubObject, MicroblogPost } from "./types.ts";
import { apiFetch, getDomain } from "../../utils/config.ts";

/**
 * ActivityPub Object を取得
 */
export const fetchActivityPubObjects = async (
  username: string,
  type?: string,
): Promise<ActivityPubObject[]> => {
  try {
    const url = type
      ? `/users/${encodeURIComponent(username)}/outbox?type=${
        encodeURIComponent(type)
      }`
      : `/users/${encodeURIComponent(username)}/outbox`;
    const response = await apiFetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch ActivityPub objects");
    }
    const data = await response.json();
    if (data && Array.isArray(data.orderedItems)) {
      return data.orderedItems
        // Message を UI に表示しない
        .filter((item: Record<string, unknown>) => item.type !== "Message")
        .map((item: Record<string, unknown>) => ({
          id: item.id,
          type: item.type,
          attributedTo: item.attributedTo,
          content: item.content,
          to: item.to,
          cc: item.cc,
          published: item.published,
          extra: item.extra,
        }));
    }
    return [];
  } catch (error) {
    console.error("Error fetching ActivityPub objects:", error);
    return [];
  }
};

export const fetchPosts = async (
  params?: { limit?: number; before?: string },
): Promise<MicroblogPost[]> => {
  try {
    const search = new URLSearchParams();
    if (params?.limit) search.set("limit", String(params.limit));
    if (params?.before) search.set("before", params.before);
    const query = search.toString();
    const response = await apiFetch(
      `/api/posts${query ? `?${query}` : ""}`,
    );
    if (!response.ok) {
      throw new Error("Failed to fetch posts");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching posts:", error);
    return [];
  }
};

export const fetchPostById = async (
  id: string,
): Promise<MicroblogPost | null> => {
  try {
    const res = await apiFetch(`/api/posts/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("Error fetching post:", error);
    return null;
  }
};

export const fetchPostReplies = async (
  id: string,
): Promise<MicroblogPost[]> => {
  try {
    const res = await apiFetch(
      `/api/posts/${encodeURIComponent(id)}/replies`,
    );
    if (!res.ok) return [];
    return await res.json();
  } catch (error) {
    console.error("Error fetching replies:", error);
    return [];
  }
};

export const fetchFollowingPosts = async (
  username: string,
): Promise<MicroblogPost[]> => {
  try {
    const domain = getDomain();
    const params = new URLSearchParams({
      timeline: "following",
      actor: `https://${domain}/users/${encodeURIComponent(username)}`,
    });
    const response = await apiFetch(`/api/posts?${params.toString()}`);
    if (!response.ok) {
      throw new Error("Failed to fetch following posts");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching following posts:", error);
    return [];
  }
};

export const searchUsers = async (query: string) => {
  try {
    const response = await apiFetch(
      `/api/search?q=${encodeURIComponent(query)}&type=users`,
    );
    if (!response.ok) {
      throw new Error("Failed to search users");
    }
    return await response.json();
  } catch (error) {
    console.error("Error searching users:", error);
    return [];
  }
};

export const followUser = async (
  username: string,
  followerUsername: string,
) => {
  try {
    // username may be either actor URL or handle; prefer sending actor URL
    const target = (() => {
      try {
        new URL(username);
        return username; // already a URL
      } catch {
        // assume it's a handle or local username
        const domain = getDomain();
        return username.includes("@")
          ? `https://${username.split("@")[1]}/users/${username.split("@")[0]}`
          : `https://${domain}/users/${encodeURIComponent(username)}`;
      }
    })();
    const follower = (() => {
      try {
        new URL(followerUsername);
        return followerUsername;
      } catch {
        return `https://${getDomain()}/users/${
          encodeURIComponent(followerUsername)
        }`;
      }
    })();
    const response = await apiFetch("/api/follow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follower, target }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error following user:", error);
    return false;
  }
};

export const unfollowUser = async (
  username: string,
  followerUsername: string,
) => {
  try {
    const target = (() => {
      try {
        new URL(username);
        return username;
      } catch {
        const domain = getDomain();
        return username.includes("@")
          ? `https://${username.split("@")[1]}/users/${username.split("@")[0]}`
          : `https://${domain}/users/${encodeURIComponent(username)}`;
      }
    })();
    const follower = (() => {
      try {
        new URL(followerUsername);
        return followerUsername;
      } catch {
        return `https://${getDomain()}/users/${
          encodeURIComponent(followerUsername)
        }`;
      }
    })();
    const response = await apiFetch("/api/follow", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ follower, target }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error unfollowing user:", error);
    return false;
  }
};

export const createPost = async (
  content: string,
  author: string,
  attachments?: { url: string; type: "image" | "video" | "audio" }[],
  parentId?: string,
  quoteId?: string,
  // faspShare?: boolean,
): Promise<boolean> => {
  try {
    const response = await apiFetch("/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        author,
        content,
        attachments,
        parentId,
        quoteId,
        // faspShare,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error creating post:", error);
    return false;
  }
};

/**
 * 投稿を作成する（to 指定版）
 * to にアクター URI もしくはハンドル ("user@domain") を指定できます。
 * サーバーが to を受け付けない場合でもクライアント側から送信するためのラッパーです。
 */
export const createPostWithTo = async (
  content: string,
  author: string,
  to?: string | string[],
  attachments?: { url: string; type: "image" | "video" | "audio" }[],
  parentId?: string,
  quoteId?: string,
  // faspShare?: boolean,
): Promise<boolean> => {
  try {
    const payload: Record<string, unknown> = {
      author,
      content,
      attachments,
      parentId,
      quoteId,
      // faspShare,
    };
    if (typeof to !== "undefined") payload.to = to;
    const response = await apiFetch("/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    return response.ok;
  } catch (error) {
    console.error("Error creating post with to:", error);
    return false;
  }
};

export const updatePost = async (
  id: string,
  content: string,
): Promise<boolean> => {
  try {
    const response = await apiFetch(
      `/api/posts/${encodeURIComponent(id)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content }),
      },
    );
    return response.ok;
  } catch (error) {
    console.error("Error updating post:", error);
    return false;
  }
};

export const deletePost = async (id: string): Promise<boolean> => {
  try {
    const response = await apiFetch(
      `/api/posts/${encodeURIComponent(id)}`,
      {
        method: "DELETE",
      },
    );
    return response.ok;
  } catch (error) {
    console.error("Error deleting post:", error);
    return false;
  }
};

export const likePost = async (
  id: string,
  username: string,
): Promise<number | null> => {
  try {
    const response = await apiFetch(
      `/api/posts/${encodeURIComponent(id)}/like`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.likes === "number" ? data.likes : null;
  } catch (error) {
    console.error("Error liking post:", error);
    return null;
  }
};

export const retweetPost = async (
  id: string,
  username: string,
): Promise<number | null> => {
  try {
    const response = await apiFetch(
      `/api/posts/${encodeURIComponent(id)}/retweet`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username }),
      },
    );
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.retweets === "number" ? data.retweets : null;
  } catch (error) {
    console.error("Error retweeting post:", error);
    return null;
  }
};

export const _replyToPost = async (
  parentId: string,
  content: string,
): Promise<boolean> => {
  try {
    const response = await apiFetch("/api/posts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ author: "user", content, parentId }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error replying to post:", error);
    return false;
  }
};

// ユーザー情報を取得
export const fetchUserProfile = async (acct: string) => {
  try {
    const response = await apiFetch(
      `/api/users/${encodeURIComponent(acct)}`,
    );
    if (!response.ok) {
      throw new Error("Failed to fetch user profile");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching user profile:", error);
    return null;
  }
};

// ユーザー情報の型定義
export interface UserInfo {
  userName: string;
  displayName: string;
  authorAvatar: string;
  domain: string;
  isLocal: boolean;
}

// ユーザー情報キャッシュ（メモリ）
const userInfoCache = new Map<string, {
  userInfo: UserInfo;
  timestamp: number;
}>();

const CACHE_DURATION = 5 * 60 * 1000; // 5分

export const getCachedUserInfo = (
  acct: string,
  _accountId?: string,
): UserInfo | null => {
  const mem = userInfoCache.get(acct);
  if (mem && Date.now() - mem.timestamp < CACHE_DURATION) {
    return mem.userInfo;
  }
  return null;
};

export const setCachedUserInfo = (
  acct: string,
  userInfo: UserInfo,
  _accountId?: string,
) => {
  userInfoCache.set(acct, {
    userInfo,
    timestamp: Date.now(),
  });
};

// 新しい共通ユーザー情報取得API
export const fetchUserInfo = async (
  acct: string,
  accountId?: string,
): Promise<UserInfo | null> => {
  try {
    // まずキャッシュから確認
    const cached = await getCachedUserInfo(acct, accountId);
    if (cached) {
      return cached;
    }

    const response = await apiFetch(
      `/api/users/${encodeURIComponent(acct)}`,
    );
    if (!response.ok) {
      throw new Error("Failed to fetch user info");
    }

    const userInfo = await response.json();

    // キャッシュに保存
    await setCachedUserInfo(acct, userInfo, accountId);

    return userInfo;
  } catch (error) {
    console.error("Error fetching user info:", error);
    return null;
  }
};

// バッチでユーザー情報を取得
export const fetchUserInfoBatch = async (
  accts: string[],
  accountId?: string,
): Promise<UserInfo[]> => {
  try {
    const cachedMap: Record<string, UserInfo> = {};
    const uncached: string[] = [];

    for (const acct of accts) {
      const cachedInfo = await getCachedUserInfo(acct, accountId);
      if (cachedInfo) {
        cachedMap[acct] = cachedInfo;
      } else {
        uncached.push(acct);
      }
    }

    const fetchedMap: Record<string, UserInfo> = {};
    if (uncached.length > 0) {
      const response = await apiFetch("/api/users/batch", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accts: uncached }),
      });

      if (response.ok) {
        const fetchedInfos: UserInfo[] = await response.json();

        await Promise.all(
          fetchedInfos.map((info, index) =>
            setCachedUserInfo(uncached[index], info, accountId)
          ),
        );

        fetchedInfos.forEach((info, index) => {
          fetchedMap[uncached[index]] = info;
        });
      }
    }

    return accts.map((id) => cachedMap[id] ?? fetchedMap[id]);
  } catch (error) {
    console.error("Error fetching user info batch:", error);
    return [];
  }
};

// 指定ユーザーのフォロワー一覧を取得
export const fetchFollowers = async (username: string) => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(username)}/followers`,
    );
    if (!res.ok) throw new Error("Failed to fetch followers");
    return await res.json();
  } catch (error) {
    console.error("Error fetching followers:", error);
    return [];
  }
};

// 指定ユーザーのフォロー中一覧を取得
export const fetchFollowing = async (username: string) => {
  try {
    const res = await apiFetch(
      `/api/users/${encodeURIComponent(username)}/following`,
    );
    if (!res.ok) throw new Error("Failed to fetch following");
    return await res.json();
  } catch (error) {
    console.error("Error fetching following:", error);
    return [];
  }
};

// トレンドを取得
export const fetchTrends = async (): Promise<
  { tag: string; count: number }[]
> => {
  try {
    const res = await apiFetch("/api/trends");
    if (!res.ok) throw new Error("Failed to fetch trends");
    return await res.json();
  } catch (error) {
    console.error("Error fetching trends:", error);
    return [];
  }
};
