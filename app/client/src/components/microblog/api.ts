import type { ActivityPubObject, MicroblogPost, Story } from "./types.ts";

/**
 * ActivityPub Object（Note, Story, etc.）を取得
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
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error("Failed to fetch ActivityPub objects");
    }
    const data = await response.json();
    if (data && Array.isArray(data.orderedItems)) {
      return data.orderedItems.map((item: Record<string, unknown>) => ({
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

export const fetchPosts = async (): Promise<MicroblogPost[]> => {
  try {
    const response = await fetch("/api/microblog");
    if (!response.ok) {
      throw new Error("Failed to fetch posts");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching posts:", error);
    return [];
  }
};

export const fetchFollowingPosts = async (username: string): Promise<MicroblogPost[]> => {
  try {
    const response = await fetch(`/api/users/${username}/timeline`);
    if (!response.ok) {
      throw new Error("Failed to fetch following posts");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching following posts:", error);
    return [];
  }
};

export const fetchCommunities = async () => {
  try {
    const response = await fetch("/api/communities");
    if (!response.ok) {
      throw new Error("Failed to fetch communities");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching communities:", error);
    return [];
  }
};

export const createCommunity = async (data: {
  name: string;
  description: string;
  isPrivate?: boolean;
  tags?: string[];
  avatar?: string;
  banner?: string;
}) => {
  try {
    const response = await fetch("/api/communities", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });
    return response.ok;
  } catch (error) {
    console.error("Error creating community:", error);
    return false;
  }
};

export const joinCommunity = async (communityId: string, username: string) => {
  try {
    const response = await fetch(`/api/communities/${communityId}/join`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error joining community:", error);
    return false;
  }
};

export const leaveCommunity = async (communityId: string, username: string) => {
  try {
    const response = await fetch(`/api/communities/${communityId}/leave`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error leaving community:", error);
    return false;
  }
};

export const fetchCommunityPosts = async (communityId: string) => {
  try {
    const response = await fetch(`/api/communities/${communityId}/posts`);
    if (!response.ok) {
      throw new Error("Failed to fetch community posts");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching community posts:", error);
    return [];
  }
};

export const createCommunityPost = async (communityId: string, content: string, author: string) => {
  try {
    const response = await fetch(`/api/communities/${communityId}/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ author, content }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error creating community post:", error);
    return false;
  }
};

export const likeCommunityPost = async (communityId: string, postId: string) => {
  try {
    const response = await fetch(`/api/communities/${communityId}/posts/${postId}/like`, {
      method: "POST",
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.likes === "number" ? data.likes : null;
  } catch (error) {
    console.error("Error liking community post:", error);
    return null;
  }
};

export const searchUsers = async (query: string) => {
  try {
    const response = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error("Failed to search users");
    }
    return await response.json();
  } catch (error) {
    console.error("Error searching users:", error);
    return [];
  }
};

export const followUser = async (username: string, followerUsername: string) => {
  try {
    const response = await fetch(`/api/users/${username}/follow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ followerUsername }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error following user:", error);
    return false;
  }
};

export const unfollowUser = async (username: string, followerUsername: string) => {
  try {
    const response = await fetch(`/api/users/${username}/unfollow`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ followerUsername }),
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
): Promise<boolean> => {
  try {
    const response = await fetch("/api/microblog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ author, content }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error creating post:", error);
    return false;
  }
};

export const updatePost = async (
  id: string,
  content: string,
): Promise<boolean> => {
  try {
    const response = await fetch(`/api/microblog/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error updating post:", error);
    return false;
  }
};

export const deletePost = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/microblog/${id}`, {
      method: "DELETE",
    });
    return response.ok;
  } catch (error) {
    console.error("Error deleting post:", error);
    return false;
  }
};

export const likePost = async (id: string): Promise<number | null> => {
  try {
    const response = await fetch(`/api/microblog/${id}/like`, {
      method: "POST",
    });
    if (!response.ok) return null;
    const data = await response.json();
    return typeof data.likes === "number" ? data.likes : null;
  } catch (error) {
    console.error("Error liking post:", error);
    return null;
  }
};

export const retweetPost = async (id: string): Promise<number | null> => {
  try {
    const response = await fetch(`/api/microblog/${id}/retweet`, {
      method: "POST",
    });
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
    const response = await fetch("/api/microblog", {
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

export const fetchStories = async (): Promise<Story[]> => {
  try {
    const response = await fetch("/api/stories");
    if (!response.ok) {
      throw new Error("Failed to fetch stories");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching stories:", error);
    return [];
  }
};

export const createStory = async (
  content: string,
  mediaUrl?: string,
  mediaType?: "image" | "video",
  backgroundColor?: string,
  textColor?: string,
): Promise<boolean> => {
  try {
    const response = await fetch("/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        author: "user",
        content,
        mediaUrl,
        mediaType,
        backgroundColor,
        textColor,
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error creating story:", error);
    return false;
  }
};

export const viewStory = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/stories/${id}/view`, {
      method: "POST",
    });
    return response.ok;
  } catch (error) {
    console.error("Error viewing story:", error);
    return false;
  }
};

export const deleteStory = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/stories/${id}`, {
      method: "DELETE",
    });
    return response.ok;
  } catch (error) {
    console.error("Error deleting story:", error);
    return false;
  }
};
