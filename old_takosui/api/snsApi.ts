import { TakosFetch } from "../utils/TakosFetch";

const SnsApi = {
  BASE_URL: "/api/v2/sns",

  async fetchTimeline() {
    const response = await TakosFetch(`${this.BASE_URL}/timeline`);
    if (!response.ok) {
      throw new Error("タイムラインの取得に失敗しました");
    }
    return response.json();
  },

  async createPost(text: string, media: string[] = []) {
    const response = await TakosFetch(`${this.BASE_URL}/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text, media }),
    });

    if (!response.ok) {
      throw new Error("投稿の作成に失敗しました");
    }

    return response.json();
  },

  async likePost(userId: string, postId: string) {
    const response = await TakosFetch(
      `${this.BASE_URL}/posts/${userId}/${postId}/like`,
      {
        method: "POST",
      },
    );

    if (!response.ok) {
      throw new Error("いいねに失敗しました");
    }

    return response.json();
  },

  async unlikePost(userId: string, postId: string) {
    const response = await TakosFetch(
      `${this.BASE_URL}/posts/${userId}/${postId}/like`,
      {
        method: "DELETE",
      },
    );

    if (!response.ok) {
      throw new Error("いいねの解除に失敗しました");
    }

    return response.json();
  },

  async createStory(media: string) {
    const response = await TakosFetch(`${this.BASE_URL}/stories`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ media }),
    });

    if (!response.ok) {
      throw new Error("ストーリーの作成に失敗しました");
    }

    return response.json();
  },
};

export default SnsApi;
