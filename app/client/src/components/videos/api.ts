import type { Video } from "./types.ts";
import { apiFetch } from "../../utils/config.ts";

export const fetchVideos = async (): Promise<Video[]> => {
  try {
    const res = await apiFetch("/api/videos");
    if (!res.ok) throw new Error("Failed to fetch videos");
    return await res.json();
  } catch (err) {
    console.error("Error fetching videos:", err);
    return [];
  }
};

export const createVideo = async (
  data: {
    title: string;
    description?: string;
    hashtags?: string[];
    isShort?: boolean;
    duration?: string;
  } & { author: string },
): Promise<Video | null> => {
  try {
    const res = await apiFetch("/api/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    console.error("Error creating video:", err);
    return null;
  }
};

export const likeVideo = async (id: string): Promise<number | null> => {
  try {
    const res = await apiFetch(`/api/videos/${id}/like`, { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.likes === "number" ? data.likes : null;
  } catch (err) {
    console.error("Error liking video:", err);
    return null;
  }
};

export const addView = async (id: string): Promise<number | null> => {
  try {
    const res = await apiFetch(`/api/videos/${id}/view`, { method: "POST" });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.views === "number" ? data.views : null;
  } catch (err) {
    console.error("Error incrementing view:", err);
    return null;
  }
};
