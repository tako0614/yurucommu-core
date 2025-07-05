import type { MicroblogPost, Story } from "./types";

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

export const createPost = async (content: string): Promise<boolean> => {
  try {
    const response = await fetch("/api/microblog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ author: "user", content }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error creating post:", error);
    return false;
  }
};

export const updatePost = async (id: string, content: string): Promise<boolean> => {
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

export const likePost = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/microblog/${id}/like`, {
      method: "POST",
    });
    return response.ok;
  } catch (error) {
    console.error("Error liking post:", error);
    return false;
  }
};

export const retweetPost = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/microblog/${id}/retweet`, {
      method: "POST",
    });
    return response.ok;
  } catch (error) {
    console.error("Error retweeting post:", error);
    return false;
  }
};

export const _replyToPost = async (parentId: string, content: string): Promise<boolean> => {
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

export const createStory = async (content: string, mediaUrl?: string, mediaType?: 'image' | 'video', backgroundColor?: string, textColor?: string): Promise<boolean> => {
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
        textColor 
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
