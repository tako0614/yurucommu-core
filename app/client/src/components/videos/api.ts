import type { Video } from "./types.ts";
import { apiFetch, apiUrl } from "../../utils/config.ts";

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

export const createVideo = (
  data: {
    title: string;
    description?: string;
    hashtags?: string[];
    isShort?: boolean;
    duration?: string;
    file: File;
    thumbnail?: File;
  } & { author: string },
): Promise<Video | null> => {
  return new Promise((resolve) => {
    try {
      const wsUrl = apiUrl("/api/ws").replace(/^http/, "ws");
      const ws = new WebSocket(wsUrl);
      let uploaded = false;

      ws.onmessage = async (evt) => {
        const msg = JSON.parse(evt.data);
        if (msg.status === "ready for metadata") {
          let thumbStr: string | undefined;
          if (data.thumbnail) {
            const buf = await data.thumbnail.arrayBuffer();
            const bin = new Uint8Array(buf);
            const b64 = btoa(String.fromCharCode(...bin));
            thumbStr = `data:${data.thumbnail.type};base64,${b64}`;
          }
          ws.send(
            JSON.stringify({
              type: "metadata",
              payload: {
                author: data.author,
                title: data.title,
                description: data.description ?? "",
                hashtagsStr: data.hashtags?.join(" ") ?? "",
                isShort: data.isShort ?? false,
                duration: data.duration ?? "",
                originalName: data.file.name,
                thumbnail: thumbStr,
              },
            }),
          );
        } else if (msg.status === "ready for binary") {
          const chunkSize = 1024 * 512; // 512KB 程度
          for (let offset = 0; offset < data.file.size; offset += chunkSize) {
            const slice = data.file.slice(offset, offset + chunkSize);
            const buf = await slice.arrayBuffer();
            ws.send(buf);
          }
          ws.close();
          uploaded = true;
        }
      };

      ws.onclose = async () => {
        if (uploaded) {
          const list = await fetchVideos();
          resolve(list[0] ?? null);
        } else {
          resolve(null);
        }
      };

      ws.onerror = () => {
        resolve(null);
      };
    } catch (_err) {
      resolve(null);
    }
  });
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
