import type { IObjectStorage } from "../runtime/types.ts";
import { fetchWithTimeout } from "./federation-fetch.ts";
import { stripImageMetadata } from "./strip-image-metadata.ts";

export const MAX_STAMP_ASSET_BYTES = 2 * 1024 * 1024;

export type StampAssetMediaType = "image/webp" | "image/png";

export type PreparedStampAsset = {
  sha256: string;
  mediaType: StampAssetMediaType;
  width: number;
  height: number;
  r2Key: string;
  url: string;
};

function uint24le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16)
  );
}

function uint32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! * 0x1000000 +
    (bytes[offset + 1]! << 16) +
    (bytes[offset + 2]! << 8) +
    bytes[offset + 3]!
  );
}

function uint32le(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset]! +
    bytes[offset + 1]! * 0x100 +
    bytes[offset + 2]! * 0x10000 +
    bytes[offset + 3]! * 0x1000000
  );
}

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(
    bytes[offset]!,
    bytes[offset + 1]!,
    bytes[offset + 2]!,
    bytes[offset + 3]!,
  );
}

function pngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    bytes.length < 33 ||
    signature.some((value, index) => bytes[index] !== value)
  ) {
    return null;
  }

  let width: number | null = null;
  let height: number | null = null;
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = uint32be(bytes, offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = fourCc(bytes, offset + 4);
    if (type === "acTL") return null;
    if (type === "IHDR") {
      if (length !== 13) return null;
      width = uint32be(bytes, offset + 8);
      height = uint32be(bytes, offset + 12);
    }
    offset = end;
    if (type === "IEND") break;
  }

  return width && height ? { width, height } : null;
}

function webpDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  if (
    bytes.length < 30 ||
    fourCc(bytes, 0) !== "RIFF" ||
    fourCc(bytes, 8) !== "WEBP"
  ) {
    return null;
  }

  let dimensions: { width: number; height: number } | null = null;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const type = fourCc(bytes, offset);
    const length = uint32le(bytes, offset + 4);
    const payload = offset + 8;
    const end = payload + length + (length & 1);
    if (end > bytes.length) return null;
    if (type === "ANIM" || type === "ANMF") return null;

    if (type === "VP8X") {
      if (length < 10 || (bytes[payload]! & 0b00000010) !== 0) return null;
      dimensions = {
        width: uint24le(bytes, payload + 4) + 1,
        height: uint24le(bytes, payload + 7) + 1,
      };
    } else if (type === "VP8L") {
      if (length < 5 || bytes[payload] !== 0x2f) return null;
      dimensions = {
        width: 1 + (bytes[payload + 1]! | ((bytes[payload + 2]! & 0x3f) << 8)),
        height:
          1 +
          ((bytes[payload + 2]! >> 6) |
            (bytes[payload + 3]! << 2) |
            ((bytes[payload + 4]! & 0x0f) << 10)),
      };
    } else if (type === "VP8 ") {
      if (
        length < 10 ||
        bytes[payload + 3] !== 0x9d ||
        bytes[payload + 4] !== 0x01 ||
        bytes[payload + 5] !== 0x2a
      ) {
        return null;
      }
      dimensions = {
        width: (bytes[payload + 6]! | (bytes[payload + 7]! << 8)) & 0x3fff,
        height: (bytes[payload + 8]! | (bytes[payload + 9]! << 8)) & 0x3fff,
      };
    }
    offset = end;
  }
  return dimensions;
}

export function inspectStaticStampImage(
  bytes: Uint8Array,
  mediaType: StampAssetMediaType,
): { width: number; height: number } | null {
  const dimensions =
    mediaType === "image/png" ? pngDimensions(bytes) : webpDimensions(bytes);
  if (
    !dimensions ||
    dimensions.width < 1 ||
    dimensions.width > 512 ||
    dimensions.height < 1 ||
    dimensions.height > 512
  ) {
    return null;
  }
  return dimensions;
}

async function readBoundedBody(
  body: ReadableStream | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!body) throw new Error("Stamp asset body is unavailable");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array)) {
      await reader.cancel();
      throw new Error("Stamp asset stream is invalid");
    }
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Stamp asset is too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const input = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
  return [...digest]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Text(value: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(value));
}

export async function prepareStampAsset(
  media: IObjectStorage,
  sourceR2Key: string,
  mediaType: StampAssetMediaType,
): Promise<PreparedStampAsset> {
  const source = await media.get(sourceR2Key);
  if (!source) throw new Error("Stamp source asset is missing");
  const sourceBytes = await readBoundedBody(source.body, MAX_STAMP_ASSET_BYTES);
  const cleaned = stripImageMetadata(sourceBytes, mediaType);
  const dimensions = inspectStaticStampImage(cleaned, mediaType);
  if (!dimensions) {
    throw new Error("Stamp must be a static PNG or WebP up to 512x512");
  }

  const sha256 = await sha256Hex(cleaned);
  const extension = mediaType === "image/webp" ? "webp" : "png";
  const r2Key = `stamps/sha256/${sha256.slice(0, 2)}/${sha256}.${extension}`;
  const existing = await media.get(r2Key);
  if (existing) {
    const existingBytes = await readBoundedBody(
      existing.body,
      MAX_STAMP_ASSET_BYTES,
    );
    if ((await sha256Hex(existingBytes)) !== sha256) {
      throw new Error("Stored Stamp digest does not match its object key");
    }
  } else {
    const buffer = cleaned.buffer.slice(
      cleaned.byteOffset,
      cleaned.byteOffset + cleaned.byteLength,
    ) as ArrayBuffer;
    await media.put(r2Key, buffer, {
      httpMetadata: {
        contentType: mediaType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: { sha256 },
    });
  }

  return {
    sha256,
    mediaType,
    ...dimensions,
    r2Key,
    url: `/media/stamps/${sha256}.${extension}`,
  };
}

export async function mirrorRemoteStampAsset(
  media: IObjectStorage,
  input: {
    url: string;
    mediaType: StampAssetMediaType;
    width: number;
    height: number;
    sha256: string;
  },
  fetcher: typeof fetchWithTimeout = fetchWithTimeout,
): Promise<PreparedStampAsset> {
  const response = await fetcher(input.url, {
    headers: { Accept: input.mediaType },
    timeout: 15_000,
  });
  if (!response.ok) throw new Error("Remote Stamp asset fetch failed");
  const responseType = response.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (responseType && responseType !== input.mediaType) {
    throw new Error("Remote Stamp asset content type changed");
  }
  const bytes = await readBoundedBody(response.body, MAX_STAMP_ASSET_BYTES);
  if (bytes.byteLength < 1) throw new Error("Remote Stamp asset is empty");
  const dimensions = inspectStaticStampImage(bytes, input.mediaType);
  if (
    !dimensions ||
    dimensions.width !== input.width ||
    dimensions.height !== input.height ||
    (await sha256Hex(bytes)) !== input.sha256
  ) {
    throw new Error("Remote Stamp asset integrity check failed");
  }

  const extension = input.mediaType === "image/webp" ? "webp" : "png";
  const r2Key = `stamps/sha256/${input.sha256.slice(0, 2)}/${input.sha256}.${extension}`;
  const existing = await media.get(r2Key);
  if (existing) {
    const existingBytes = await readBoundedBody(
      existing.body,
      MAX_STAMP_ASSET_BYTES,
    );
    if ((await sha256Hex(existingBytes)) !== input.sha256) {
      throw new Error("Stored Stamp digest does not match its object key");
    }
  } else {
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    await media.put(r2Key, buffer, {
      httpMetadata: {
        contentType: input.mediaType,
        cacheControl: "public, max-age=31536000, immutable",
      },
      customMetadata: { sha256: input.sha256, source: input.url },
    });
  }

  return {
    sha256: input.sha256,
    mediaType: input.mediaType,
    ...dimensions,
    r2Key,
    url: `/media/stamps/${input.sha256}.${extension}`,
  };
}
