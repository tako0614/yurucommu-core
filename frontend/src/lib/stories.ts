import type {
  CanvasData,
  CanvasSize,
  ImageElement,
  Story,
  StoryItem,
  TextElement,
} from "@takos/platform";
import {
  listStories,
  listGlobalStories,
  createStory,
  getStory,
  updateStory,
  deleteStory,
} from "./api";

export type {
  CanvasData,
  CanvasSize,
  ImageElement,
  Story,
  StoryItem,
  TextElement,
};

// --- Viewed (既読) tracking ---
// We track the latest viewed timestamp per author locally.
export type StoryViewedMap = Record<string, string>; // authorId -> ISO created_at (latest viewed)
const STORY_VIEWED_KEY = "storyViewed";

export function getStoryViewedMap(): StoryViewedMap {
  try {
    const raw = localStorage.getItem(STORY_VIEWED_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (obj && typeof obj === "object") return obj as StoryViewedMap;
  } catch {}
  return {};
}

export function markStoriesViewed(authorId: string, latestCreatedAt: string) {
  try {
    const map = getStoryViewedMap();
    const cur = map[authorId];
    if (!cur || cur < latestCreatedAt) {
      map[authorId] = latestCreatedAt;
      localStorage.setItem(STORY_VIEWED_KEY, JSON.stringify(map));
    }
  } catch {}
}

// Re-export Story API functions from api.ts (they come from api-client.ts)
export { listStories, listGlobalStories, createStory, getStory, updateStory, deleteStory };

export async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
