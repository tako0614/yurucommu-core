import type { Actor } from "../types.ts";

interface StoryData {
  apId: string;
  attributedTo: string;
  attachment: {
    type: string;
    mediaType: string;
    url: string;
    r2_key: string;
  };
  displayDuration: string;
  overlays?: unknown[];
  endTime: string;
  published: string;
}

/**
 * Safely join a base URL and a path segment.
 * Returns the path unchanged if it is already an absolute URL.
 */
function safeUrlJoin(baseUrl: string, path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const cleanBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : "/" + path;

  try {
    const base = new URL(cleanBase);
    return base.origin + base.pathname.replace(/\/+$/, "") + normalizedPath;
  } catch {
    return cleanBase + normalizedPath;
  }
}

/**
 * Convert a Story to ActivityPub format
 */
export function storyToActivityPub(
  story: StoryData,
  actor: Actor,
  baseUrl: string,
): object {
  const attachmentUrl = safeUrlJoin(baseUrl, story.attachment.url);

  return {
    "@context": [
      "https://www.w3.org/ns/activitystreams",
      {
        "story": "https://yurucommu.com/ns/story#",
        "Story": "story:Story",
        "displayDuration": "story:displayDuration",
        "overlays": { "@id": "story:overlays", "@container": "@list" },
        "position": "story:position",
      },
    ],
    "id": story.apId,
    "type": ["Story", "Note"],
    "attributedTo": actor.ap_id,
    "published": story.published,
    "endTime": story.endTime,
    "to": [`${actor.ap_id}/followers`],
    "attachment": [{
      "type": story.attachment.type,
      "mediaType": story.attachment.mediaType,
      "url": attachmentUrl,
    }],
    "displayDuration": story.displayDuration,
    ...(story.overlays && story.overlays.length > 0
      ? { "overlays": story.overlays }
      : {}),
  };
}
