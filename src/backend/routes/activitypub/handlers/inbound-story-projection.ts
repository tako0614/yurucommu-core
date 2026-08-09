import { isSafeRemoteUrl } from "../../../federation-helpers.ts";
import { MAX_ATTACHMENTS_JSON_LENGTH } from "../../../lib/attachments.ts";
import type { Activity, ActivityObject } from "../inbox-types.ts";

const DEFAULT_DISPLAY_DURATION = "PT5S";
const MAX_DISPLAY_DURATION_SECONDS = 60;
const MAX_STORY_LIFETIME_MS = 25 * 60 * 60 * 1000;
const MAX_STORY_CAPTION_LENGTH = 500;
const MAX_STORY_OVERLAYS = 20;
const MAX_STORY_URL_LENGTH = 2048;
const MAX_STORY_TEXT_LENGTH = 500;
const MAX_MEDIA_TYPE_LENGTH = 255;
const MAX_MEDIA_DIMENSION = 32_768;
const MAX_STORY_ADDRESSES = 64;

type StoryAttachmentProjection = {
  r2_key: string;
  content_type: string;
  url: string;
  width: number;
  height: number;
};

type StoryOverlayPosition = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type StoryOverlayOption = {
  type: "Note";
  name: string;
};

type StoryOverlayProjection = {
  type: "Question" | "Note" | "Link";
  position: StoryOverlayPosition;
  name?: string;
  href?: string;
  oneOf?: StoryOverlayOption[];
};

export type InboundStoryProjection = {
  attachment: StoryAttachmentProjection;
  displayDuration: string;
  caption?: string;
  overlays?: StoryOverlayProjection[];
};

export type InboundStoryProjectionResult = {
  projection: InboundStoryProjection;
  json: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, max) : undefined;
}

function normalizedDimension(value: unknown, fallback: number): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value <= 0 ||
    value > MAX_MEDIA_DIMENSION
  ) {
    return fallback;
  }
  return Math.max(1, Math.round(value));
}

function normalizedMediaType(value: unknown): string {
  if (typeof value !== "string") return "image/jpeg";
  const mediaType = value.trim().toLowerCase();
  if (
    mediaType.length === 0 ||
    mediaType.length > MAX_MEDIA_TYPE_LENGTH ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType)
  ) {
    return "image/jpeg";
  }
  return mediaType;
}

function normalizedRemoteAttachment(
  raw: unknown,
): StoryAttachmentProjection | null {
  const candidate = Array.isArray(raw) ? raw[0] : raw;
  if (!isRecord(candidate)) return null;

  const url = typeof candidate.url === "string" ? candidate.url.trim() : "";
  if (
    url.length === 0 ||
    url.length > MAX_STORY_URL_LENGTH ||
    !isSafeRemoteUrl(url)
  ) {
    return null;
  }

  return {
    r2_key: "",
    content_type: normalizedMediaType(
      candidate.mediaType ?? candidate.content_type,
    ),
    url,
    width: normalizedDimension(candidate.width, 1080),
    height: normalizedDimension(candidate.height, 1920),
  };
}

function normalizedPosition(raw: unknown): StoryOverlayPosition | null {
  if (!isRecord(raw)) return null;
  const fields = ["x", "y", "width", "height"] as const;
  for (const field of fields) {
    const value = raw[field];
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > 1
    ) {
      return null;
    }
  }
  return {
    x: raw.x as number,
    y: raw.y as number,
    width: raw.width as number,
    height: raw.height as number,
  };
}

function normalizedQuestionOptions(raw: unknown): StoryOverlayOption[] | null {
  if (!Array.isArray(raw) || raw.length < 2 || raw.length > 4) return null;
  const options: StoryOverlayOption[] = [];
  for (const candidate of raw) {
    if (!isRecord(candidate)) return null;
    const name = boundedText(candidate.name, MAX_STORY_TEXT_LENGTH);
    if (!name) return null;
    options.push({ type: "Note", name });
  }
  return options;
}

function normalizedOverlays(raw: unknown): StoryOverlayProjection[] | null {
  if (raw === null) return [];
  if (!Array.isArray(raw)) return null;

  const overlays: StoryOverlayProjection[] = [];
  let hasQuestion = false;
  for (const candidate of raw.slice(0, MAX_STORY_OVERLAYS)) {
    if (!isRecord(candidate)) continue;
    const position = normalizedPosition(candidate.position);
    if (!position) continue;

    if (candidate.type === "Question") {
      if (hasQuestion) continue;
      const oneOf = normalizedQuestionOptions(candidate.oneOf);
      if (!oneOf) continue;
      hasQuestion = true;
      const name = boundedText(candidate.name, MAX_STORY_TEXT_LENGTH);
      overlays.push({
        type: "Question",
        position,
        ...(name ? { name } : {}),
        oneOf,
      });
      continue;
    }

    if (candidate.type === "Link") {
      const href =
        typeof candidate.href === "string" ? candidate.href.trim() : "";
      if (
        href.length === 0 ||
        href.length > MAX_STORY_URL_LENGTH ||
        !isSafeRemoteUrl(href)
      ) {
        continue;
      }
      const name = boundedText(candidate.name, MAX_STORY_TEXT_LENGTH);
      overlays.push({
        type: "Link",
        position,
        ...(name ? { name } : {}),
        href,
      });
      continue;
    }

    if (candidate.type === "Note") {
      const name = boundedText(candidate.name, MAX_STORY_TEXT_LENGTH);
      overlays.push({
        type: "Note",
        position,
        ...(name ? { name } : {}),
      });
    }
  }
  return overlays;
}

function normalizedDisplayDuration(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = raw
    .trim()
    .match(
      /^PT(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/,
    );
  if (!match || (!match[1] && !match[2] && !match[3])) return null;
  const seconds =
    Number(match[1] ?? 0) * 3600 +
    Number(match[2] ?? 0) * 60 +
    Number(match[3] ?? 0);
  if (
    !Number.isFinite(seconds) ||
    seconds < 0.001 ||
    seconds > MAX_DISPLAY_DURATION_SECONDS
  ) {
    return null;
  }
  return `PT${Number(seconds.toFixed(3))}S`;
}

function parseStoredStoryProjection(
  json: string,
): InboundStoryProjection | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const attachment = normalizedRemoteAttachment(raw.attachment);
  const displayDuration = normalizedDisplayDuration(raw.displayDuration);
  if (!attachment || !displayDuration) return null;

  const overlays =
    raw.overlays === undefined ? undefined : normalizedOverlays(raw.overlays);
  if (overlays === null) return null;
  const caption = boundedText(raw.caption, MAX_STORY_CAPTION_LENGTH);
  return {
    attachment,
    displayDuration,
    ...(caption ? { caption } : {}),
    ...(overlays && overlays.length > 0 ? { overlays } : {}),
  };
}

function serializedProjection(
  projection: InboundStoryProjection,
  dropOverlaysWhenOversized: boolean,
): InboundStoryProjectionResult | null {
  let normalized = projection;
  let json = JSON.stringify(normalized);
  if (
    json.length > MAX_ATTACHMENTS_JSON_LENGTH &&
    dropOverlaysWhenOversized &&
    normalized.overlays
  ) {
    const { overlays: _overlays, ...withoutOverlays } = normalized;
    normalized = withoutOverlays;
    json = JSON.stringify(normalized);
  }
  return json.length <= MAX_ATTACHMENTS_JSON_LENGTH
    ? { projection: normalized, json }
    : null;
}

/** Build the canonical stored projection for a newly received Story. */
export function buildInboundStoryCreateProjection(
  object: ActivityObject,
): InboundStoryProjectionResult | null {
  const attachment = normalizedRemoteAttachment(object.attachment);
  if (!attachment) return null;
  const displayDuration =
    object.displayDuration === undefined
      ? DEFAULT_DISPLAY_DURATION
      : normalizedDisplayDuration(object.displayDuration);
  if (!displayDuration) return null;
  const overlays =
    object.overlays === undefined
      ? undefined
      : normalizedOverlays(object.overlays);
  if (overlays === null) return null;
  const caption = boundedText(object.content, MAX_STORY_CAPTION_LENGTH);

  return serializedProjection(
    {
      attachment,
      displayDuration,
      ...(caption ? { caption } : {}),
      ...(overlays && overlays.length > 0 ? { overlays } : {}),
    },
    true,
  );
}

/** Apply a presence-sensitive inbound Story patch to its stored projection. */
export function buildInboundStoryUpdateProjection(
  object: ActivityObject,
  existingJson: string,
): InboundStoryProjectionResult | null {
  const existing = parseStoredStoryProjection(existingJson);
  if (!existing) return null;

  const attachment =
    object.attachment === undefined
      ? existing.attachment
      : normalizedRemoteAttachment(object.attachment);
  if (!attachment) return null;
  const displayDuration =
    object.displayDuration === undefined
      ? existing.displayDuration
      : normalizedDisplayDuration(object.displayDuration);
  if (!displayDuration) return null;
  const overlays =
    object.overlays === undefined
      ? existing.overlays
      : normalizedOverlays(object.overlays);
  if (overlays === null) return null;
  const caption =
    object.content === undefined
      ? existing.caption
      : boundedText(object.content, MAX_STORY_CAPTION_LENGTH);

  return serializedProjection(
    {
      attachment,
      displayDuration,
      ...(caption ? { caption } : {}),
      ...(overlays && overlays.length > 0 ? { overlays } : {}),
    },
    false,
  );
}

export function hasStoryProjectionUpdate(object: ActivityObject): boolean {
  return (
    object.attachment !== undefined ||
    object.displayDuration !== undefined ||
    object.content !== undefined ||
    object.overlays !== undefined
  );
}

function appendAddresses(target: Set<string>, value: unknown): boolean {
  const candidates =
    typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string" || candidate.length === 0) continue;
    if (candidate.length > MAX_STORY_URL_LENGTH) return true;
    if (target.has(candidate)) continue;
    if (target.size >= MAX_STORY_ADDRESSES) return true;
    target.add(candidate);
  }
  return false;
}

const STORY_ADDRESS_FIELDS = ["to", "cc", "bto", "bcc", "audience"] as const;

/** Collect both envelope and embedded-object reach, including hidden fields. */
export function storyAddressedCollections(
  activity: Activity,
  object: ActivityObject,
): { addresses: string[]; overflow: boolean } {
  const addresses = new Set<string>();
  for (const source of [activity, object]) {
    for (const field of STORY_ADDRESS_FIELDS) {
      if (appendAddresses(addresses, source[field])) {
        return { addresses: [...addresses], overflow: true };
      }
    }
  }
  return { addresses: [...addresses], overflow: false };
}

export function declaresStoryAddressing(
  activity: Activity,
  object: ActivityObject,
): boolean {
  return [activity, object].some((source) =>
    STORY_ADDRESS_FIELDS.some((field) => source[field] !== undefined),
  );
}

/** Normalize and clamp a Create(Story) expiry; already-expired input is dropped. */
export function normalizeInboundStoryCreateEndTime(
  publishedAt: string,
  requestedEndTime: string | undefined,
  nowIso: string,
): string | null {
  const publishedMs = Date.parse(publishedAt);
  const nowMs = Date.parse(nowIso);
  if (!Number.isFinite(publishedMs) || !Number.isFinite(nowMs)) return null;
  const maxEndMs = publishedMs + MAX_STORY_LIFETIME_MS;
  const requestedMs = requestedEndTime ? Date.parse(requestedEndTime) : NaN;
  const endMs = Number.isFinite(requestedMs)
    ? Math.min(requestedMs, maxEndMs)
    : maxEndMs;
  return endMs > nowMs ? new Date(endMs).toISOString() : null;
}

/** Preserve/shorten an existing Story expiry; never extend or revive it. */
export function normalizeInboundStoryUpdateEndTime(
  publishedAt: string,
  existingEndTime: string | null,
  requestedEndTime: string | undefined,
  nowIso: string,
): string | null {
  const publishedMs = Date.parse(publishedAt);
  const existingMs = existingEndTime ? Date.parse(existingEndTime) : NaN;
  const nowMs = Date.parse(nowIso);
  if (
    !Number.isFinite(publishedMs) ||
    !Number.isFinite(existingMs) ||
    !Number.isFinite(nowMs) ||
    existingMs <= nowMs
  ) {
    return null;
  }
  const requestedMs =
    requestedEndTime === undefined ? existingMs : Date.parse(requestedEndTime);
  if (!Number.isFinite(requestedMs)) return null;
  const endMs = Math.min(
    existingMs,
    requestedMs,
    publishedMs + MAX_STORY_LIFETIME_MS,
  );
  return new Date(endMs).toISOString();
}
