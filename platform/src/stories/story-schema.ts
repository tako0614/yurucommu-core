export type CanvasSize = {
  width: number;
  height: number;
};

export type TextElement = {
  kind: "text";
  id: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  text: string;
  fontSize: number;
  color: string;
  fontWeight?: number;
  align?: "left" | "center" | "right";
  /** Optional styling additions */
  opacity?: number;
  fontFamily?: string;
};

export type ImageElement = {
  kind: "image";
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  url: string;
  objectFit?: "cover" | "contain";
  opacity?: number;
  /** Rotation in degrees, applied clockwise around the element center. */
  rotation?: number;
};

export type CanvasData = {
  size: CanvasSize;
  /** Backward-compatible background string (color or gradient). */
  background?: string;
  /** Background rendering mode. */
  backgroundMode?: "solid" | "auto-gradient" | "auto-blur";
  /** Solid background color when backgroundMode === "solid". */
  backgroundSolid?: string;
  /** Computed CSS gradient when backgroundMode === "auto-gradient". */
  backgroundGradient?: string;
  /** Source image for blur mode backgrounds. */
  backgroundImageUrl?: string;
  elements: (TextElement | ImageElement)[];
};

export type StorySlideBase = {
  id?: string;
  durationMs?: number;
  order?: number;
};

export type StoryImageSlide = StorySlideBase & {
  type: "image";
  url: string;
  alt?: string;
  width?: number;
  height?: number;
  blurhash?: string;
};

export type StoryVideoSlide = StorySlideBase & {
  type: "video";
  url: string;
  posterUrl?: string;
  hasAudio?: boolean;
};

export type StoryTextSlide = StorySlideBase & {
  type: "text";
  text: string;
  format?: "plain" | "markdown";
  align?: "left" | "center" | "right";
  color?: string;
  backgroundColor?: string;
  fontFamily?: string;
  fontWeight?: number;
};

/**
 * StoryExtensionSlide は Story 内で特殊なコンテンツタイプを表現するためのスライド型です。
 * Canvas（座標配置型エディタ）などの組み込み機能で使用されます。
 * 注: これは DSL/AI による拡張システムとは無関係です。
 */
export type StoryExtensionSlide = StorySlideBase & {
  type: "extension";
  extensionType: string;
  payload: Record<string, unknown>;
};

export type StoryItem =
  | StoryImageSlide
  | StoryVideoSlide
  | StoryTextSlide
  | StoryExtensionSlide;

export type Story = {
  id: string;
  community_id: string | null;
  author_id: string;
  created_at: string;
  expires_at: string;
  items: StoryItem[];
  broadcast_all?: boolean;
  visible_to_friends?: boolean;
  attributed_community_id?: string | null;
};

export const DEFAULT_IMAGE_DURATION_MS = 5000;
export const DEFAULT_VIDEO_DURATION_MS = 8000;
export const DEFAULT_TEXT_DURATION_MS = 5000;
export const MIN_STORY_DURATION_MS = 1500;
export const MAX_STORY_DURATION_MS = 60000;
export const CANVAS_EXTENSION_TYPE = "takos.canvas";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const coerceDuration = (value: unknown, fallback: number) => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  const clamped = Math.round(num);
  return Math.min(
    MAX_STORY_DURATION_MS,
    Math.max(MIN_STORY_DURATION_MS, clamped),
  );
};

const coerceOrder = (value: unknown, fallback: number) => {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.round(num));
};

const coerceString = (value: unknown) =>
  typeof value === "string" ? value : undefined;

const coerceNumber = (value: unknown) => {
  const num = typeof value === "number" ? value : Number(value);
  return Number.isFinite(num) ? Number(num) : undefined;
};

const baseSlide = (raw: any, fallbackOrder: number): StorySlideBase => ({
  id: coerceString(raw?.id),
  durationMs: coerceDuration(
    raw?.durationMs,
    typeof raw?.type === "string" && raw.type === "video"
      ? DEFAULT_VIDEO_DURATION_MS
      : DEFAULT_IMAGE_DURATION_MS,
  ),
  order: coerceOrder(raw?.order, fallbackOrder),
});

export type CanvasExtensionSlide = StoryExtensionSlide & {
  extensionType: typeof CANVAS_EXTENSION_TYPE;
  payload: { canvas: CanvasData };
};

export const isCanvasExtensionSlide = (
  slide: StoryItem | null | undefined,
): slide is CanvasExtensionSlide =>
  !!(
    slide &&
    slide.type === "extension" &&
    slide.extensionType === CANVAS_EXTENSION_TYPE &&
    isRecord(slide.payload) &&
    "canvas" in slide.payload &&
    isRecord((slide.payload as any).canvas)
  );

export function normalizeStorySlide(
  raw: unknown,
  fallbackOrder = 0,
): StoryItem | null {
  if (!isRecord(raw)) return null;
  const type = String(raw.type || "").toLowerCase();

  if (type === "image" && typeof raw.url === "string" && raw.url.trim()) {
    const width = coerceNumber(raw.width);
    const height = coerceNumber(raw.height);
    return {
      ...baseSlide(raw, fallbackOrder),
      type: "image",
      url: raw.url,
      alt: coerceString(raw.alt),
      width: width && width > 0 ? width : undefined,
      height: height && height > 0 ? height : undefined,
      blurhash: coerceString(raw.blurhash),
    };
  }

  if (type === "video" && typeof raw.url === "string" && raw.url.trim()) {
    return {
      ...baseSlide({ ...raw, type: "video", durationMs: raw.durationMs ?? DEFAULT_VIDEO_DURATION_MS }, fallbackOrder),
      type: "video",
      url: raw.url,
      posterUrl: coerceString(raw.posterUrl),
      hasAudio: raw.hasAudio === undefined ? undefined : !!raw.hasAudio,
    };
  }

  if (type === "text" && typeof raw.text === "string" && raw.text.trim()) {
    return {
      ...baseSlide({ ...raw, durationMs: raw.durationMs ?? DEFAULT_TEXT_DURATION_MS }, fallbackOrder),
      type: "text",
      text: raw.text,
      format: raw.format === "markdown" ? "markdown" : "plain",
      align: raw.align === "center" || raw.align === "right" ? raw.align : "left",
      color: coerceString(raw.color),
      backgroundColor: coerceString(raw.backgroundColor),
      fontFamily: coerceString(raw.fontFamily),
      fontWeight: coerceNumber(raw.fontWeight),
    };
  }

  const extensionType =
    type === "extension"
      ? coerceString(raw.extensionType)
      : type === "dom"
      ? CANVAS_EXTENSION_TYPE
      : undefined;

  if (extensionType) {
    const payload =
      type === "dom" && isRecord(raw.canvas)
        ? { canvas: raw.canvas }
        : isRecord(raw.payload)
        ? raw.payload
        : {};

    if (extensionType === CANVAS_EXTENSION_TYPE && !("canvas" in payload)) {
      return null;
    }

    return {
      ...baseSlide(raw, fallbackOrder),
      type: "extension",
      extensionType,
      payload,
    };
  }

  return null;
}

export function normalizeStoryItems(raw: unknown): StoryItem[] {
  const items = Array.isArray(raw) ? raw : [];
  const normalized: StoryItem[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const converted = normalizeStorySlide(items[i], i);
    if (converted) {
      normalized.push(converted);
    }
  }
  return normalized;
}
