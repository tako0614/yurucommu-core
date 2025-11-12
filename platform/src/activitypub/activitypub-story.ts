import {
  CANVAS_EXTENSION_TYPE,
  DEFAULT_IMAGE_DURATION_MS,
  DEFAULT_TEXT_DURATION_MS,
  DEFAULT_VIDEO_DURATION_MS,
  StoryItem,
  normalizeStoryItems,
} from "../stories/story-schema";
import { ACTIVITYSTREAMS_CONTEXT, TAKOS_CONTEXT } from "./activitypub";

export type StoryVisibility = "public" | "friends" | "community";

const toBool = (value: unknown, fallback = false) => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const lower = value.toLowerCase();
    return lower === "true" || lower === "1";
  }
  return fallback;
};

const inferMediaType = (url: string, fallback: string) => {
  const lower = url.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".webm")) return "video/webm";
  return fallback;
};

const ensureDuration = (slide: StoryItem, index: number) => {
  const duration = typeof slide.durationMs === "number" ? slide.durationMs : NaN;
  if (Number.isFinite(duration) && duration > 0) {
    return slide.durationMs;
  }
  switch (slide.type) {
    case "video":
      return DEFAULT_VIDEO_DURATION_MS;
    case "text":
      return DEFAULT_TEXT_DURATION_MS;
    default:
      return DEFAULT_IMAGE_DURATION_MS;
  }
};

const ensureOrder = (slide: StoryItem, index: number) =>
  typeof slide.order === "number" ? slide.order : index;

export function deriveStoryVisibility(story: any): StoryVisibility {
  const explicit = typeof story?.visibility === "string"
    ? story.visibility.toLowerCase()
    : null;

  if (explicit === "public" || explicit === "friends" || explicit === "community") {
    return explicit;
  }

  if (story?.community_id) {
    return "community";
  }

  const broadcastAll = toBool(story?.broadcast_all, true);
  const visibleToFriends = toBool(story?.visible_to_friends, true);

  if (!broadcastAll) {
    return "community";
  }
  return visibleToFriends ? "friends" : "public";
}

const mapSlide = (slide: StoryItem, index: number) => {
  const durationMs = ensureDuration(slide, index);
  const order = ensureOrder(slide, index);

  if (slide.type === "image") {
    return {
      type: "StoryImageSlide",
      media: {
        type: "Image",
        mediaType: inferMediaType(slide.url, "image/jpeg"),
        url: slide.url,
        width: slide.width,
        height: slide.height,
        blurhash: slide.blurhash,
      },
      alt: slide.alt,
      durationMs,
      order,
    };
  }

  if (slide.type === "video") {
    return {
      type: "StoryVideoSlide",
      media: {
        type: "Video",
        mediaType: inferMediaType(slide.url, "video/mp4"),
        url: slide.url,
        poster: slide.posterUrl,
      },
      hasAudio: slide.hasAudio ?? undefined,
      durationMs,
      order,
    };
  }

  if (slide.type === "text") {
    return {
      type: "StoryTextSlide",
      content: slide.text,
      format: slide.format ?? "plain",
      align: slide.align ?? "left",
      color: slide.color,
      backgroundColor: slide.backgroundColor,
      fontFamily: slide.fontFamily,
      fontWeight: slide.fontWeight,
      durationMs,
      order,
    };
  }

  return {
    type: "StoryExtensionSlide",
    extensionType: slide.extensionType || CANVAS_EXTENSION_TYPE,
    payload: slide.payload ?? {},
    durationMs,
    order,
  };
};

const parseSlides = (story: any) => {
  if (Array.isArray(story?.items)) {
    return normalizeStoryItems(story.items);
  }
  try {
    return normalizeStoryItems(JSON.parse(story?.items_json || "[]"));
  } catch {
    return [];
  }
};

export function toStoryObject(
  story: any,
  authorHandle: string,
  instanceDomain: string,
  options?: { protocol?: string },
) {
  const protocol = options?.protocol ?? "https";
  const base = `${protocol}://${instanceDomain}`;
  const slides = parseSlides(story);
  const visibility = deriveStoryVisibility(story);

  // Map visibility to ActivityPub audience fields
  const to: string[] = [];
  const cc: string[] = [];

  if (visibility === "public") {
    to.push("https://www.w3.org/ns/activitystreams#Public");
    cc.push(`${base}/ap/users/${authorHandle}/followers`);
  } else if (visibility === "friends") {
    to.push(`${base}/ap/users/${authorHandle}/followers`);
  } else if (visibility === "community" && story.community_id) {
    to.push(`${base}/ap/groups/${story.community_id}/followers`);
    cc.push(`${base}/ap/groups/${story.community_id}`);
  }

  return {
    "@context": [ACTIVITYSTREAMS_CONTEXT, TAKOS_CONTEXT],
    id: `${base}/ap/stories/${story.id}`,
    type: ["Story", "Article"], // Fallback to Article for compatibility
    actor: `${base}/ap/users/${authorHandle}`,
    published: new Date(story.created_at).toISOString(),
    expiresAt: new Date(story.expires_at).toISOString(),
    visibility,
    to,
    cc,
    slides: slides.map((slide, index) => mapSlide(slide, index)),
  };
}
