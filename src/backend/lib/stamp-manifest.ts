import { safeUrlJoin } from "./activitypub-helpers.ts";
import { isSafeRemoteUrl } from "../federation-helpers.ts";

export const STAMP_PACK_SCHEMA =
  "https://yurucommu.com/schemas/stamp-pack/v1" as const;
export const MAX_STAMP_PACK_STAMPS = 20;

const PACK_STAMP_KEY = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const REVISION_DIGEST = /^sha256:[a-f0-9]{64}$/;
const ASSET_SHA256 = /^[a-f0-9]{64}$/;
const LOCALE = /^[a-zA-Z0-9-]{1,35}$/;

function normalizedUri(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!isSafeRemoteUrl(url.toString())) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function parsedLocalizedText(
  value: unknown,
  maxLength: number,
): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length < 1 || entries.length > 8) return null;
  const result: Array<[string, string]> = [];
  for (const [locale, raw] of entries) {
    if (!LOCALE.test(locale) || typeof raw !== "string") return null;
    const text = raw.trim();
    if (!text || text.length > maxLength) return null;
    result.push([locale.toLowerCase(), text]);
  }
  result.sort(([left], [right]) => left.localeCompare(right));
  return Object.fromEntries(result);
}

export type StampManifestItem = {
  id: string;
  key: string;
  revision: string;
  alt: Record<string, string>;
  tags: string[];
  asset: {
    url: string;
    mediaType: "image/webp" | "image/png";
    width: number;
    height: number;
    sha256: string;
  };
};

export type ParsedStampPackManifest = {
  id: string;
  release: number;
  name: Record<string, string>;
  description?: Record<string, string>;
  publisher: string;
  visibility: "public" | "unlisted";
  stamps: StampManifestItem[];
};

export function parseRemoteStampPackManifest(
  value: unknown,
  expectedPackId: string,
): ParsedStampPackManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const manifest = value as Record<string, unknown>;
  const id = normalizedUri(manifest.id);
  const expected = normalizedUri(expectedPackId);
  const publisher = normalizedUri(manifest.publisher);
  const name = parsedLocalizedText(manifest.name, 100);
  const description =
    manifest.description === undefined
      ? undefined
      : parsedLocalizedText(manifest.description, 500);
  const release = manifest.release;
  const visibility = manifest.visibility;
  if (
    manifest.schema !== STAMP_PACK_SCHEMA ||
    !id ||
    id !== expected ||
    !publisher ||
    new URL(publisher).origin !== new URL(id).origin ||
    !name ||
    description === null ||
    !Number.isInteger(release) ||
    (release as number) < 1 ||
    (visibility !== "public" && visibility !== "unlisted") ||
    !Array.isArray(manifest.stamps) ||
    manifest.stamps.length < 1 ||
    manifest.stamps.length > MAX_STAMP_PACK_STAMPS
  ) {
    return null;
  }

  const seenIds = new Set<string>();
  const seenKeys = new Set<string>();
  const stamps: StampManifestItem[] = [];
  for (const raw of manifest.stamps) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const stamp = raw as Record<string, unknown>;
    const stampId = normalizedUri(stamp.id);
    const key = typeof stamp.key === "string" ? stamp.key.trim() : "";
    const expectedStampId = `${id.replace(/\/+$/, "")}/stamps/${key}`;
    const revision = stamp.revision;
    const alt = parsedLocalizedText(stamp.alt, 200);
    const tags = stamp.tags;
    const assets = stamp.assets;
    if (
      !stampId ||
      stampId !== expectedStampId ||
      seenIds.has(stampId) ||
      !PACK_STAMP_KEY.test(key) ||
      seenKeys.has(key) ||
      typeof revision !== "string" ||
      !REVISION_DIGEST.test(revision) ||
      !alt ||
      !Array.isArray(tags) ||
      tags.length > 16 ||
      tags.some(
        (tag) => typeof tag !== "string" || !tag.trim() || tag.length > 32,
      ) ||
      !Array.isArray(assets) ||
      assets.length < 1
    ) {
      return null;
    }
    const rawAsset = assets[0];
    if (!rawAsset || typeof rawAsset !== "object" || Array.isArray(rawAsset))
      return null;
    const asset = rawAsset as Record<string, unknown>;
    const url = normalizedUri(asset.url);
    const mediaType = asset.mediaType;
    const width = asset.width;
    const height = asset.height;
    const sha256 = asset.sha256;
    if (
      !url ||
      (mediaType !== "image/webp" && mediaType !== "image/png") ||
      typeof width !== "number" ||
      !Number.isInteger(width) ||
      width < 1 ||
      width > 512 ||
      typeof height !== "number" ||
      !Number.isInteger(height) ||
      height < 1 ||
      height > 512 ||
      typeof sha256 !== "string" ||
      !ASSET_SHA256.test(sha256)
    ) {
      return null;
    }
    seenIds.add(stampId);
    seenKeys.add(key);
    stamps.push({
      id: stampId,
      key,
      revision,
      alt,
      tags: [...new Set((tags as string[]).map((tag) => tag.trim()))],
      asset: { url, mediaType, width, height, sha256 },
    });
  }

  return {
    id,
    release: release as number,
    name,
    ...(description ? { description } : {}),
    publisher,
    visibility,
    stamps,
  };
}

export function buildStampPackManifest(input: {
  baseUrl: string;
  id: string;
  release: number;
  name: Record<string, string>;
  description?: Record<string, string>;
  publisher: string;
  visibility: "public" | "unlisted" | "private" | "community";
  stamps: StampManifestItem[];
}) {
  const stamps = input.stamps.map((stamp) => ({
    id: stamp.id,
    key: stamp.key,
    revision: stamp.revision,
    alt: stamp.alt,
    tags: stamp.tags,
    assets: [
      {
        url: safeUrlJoin(input.baseUrl, stamp.asset.url),
        mediaType: stamp.asset.mediaType,
        width: stamp.asset.width,
        height: stamp.asset.height,
        sha256: stamp.asset.sha256,
      },
    ],
  }));
  const icon = stamps[0]?.assets[0];

  return {
    schema: STAMP_PACK_SCHEMA,
    id: input.id,
    release: input.release,
    name: input.name,
    ...(input.description ? { description: input.description } : {}),
    publisher: input.publisher,
    visibility: input.visibility,
    ...(icon ? { icon } : {}),
    stamps,
  };
}
