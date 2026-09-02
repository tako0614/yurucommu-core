/**
 * Runtime helpers shared by EVERY lane, including the portable Worker.
 *
 * `edge-kv.ts` and `edge-objects.ts` import this module, so it is part of the
 * bundle a wrapper host loads with no `nodejs_compat` flag. It must therefore
 * stay free of `node:` specifiers; the filesystem path helpers that need
 * `node:path` live in `node-paths.ts`, which only the Bun/Node runtime
 * imports.
 */

export const DEFAULT_LIST_LIMIT = 1000;

const FALLBACK_MIME = "application/octet-stream";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export function getMimeType(ext: string): string {
  return MIME_TYPES[ext] || FALLBACK_MIME;
}

export function nowSeconds(): number {
  return Date.now() / 1000;
}

/**
 * One backend etag in the spelling an `ETag` header may actually carry.
 *
 * RFC 9110 §8.8.3 defines an entity-tag as an optional `W/` marker followed by
 * a QUOTED opaque-tag, so a bare digest is not a valid field value and no cache
 * can match one. Backends do not agree on the spelling they hand over: R2 keeps
 * `etag` bare and `httpEtag` quoted, the `edge.objects` self-host wrapper sends
 * the raw hex digest, and S3 and the managed gateway forward an already-quoted
 * one. Every object seam therefore carries the derived, header-safe form beside
 * the verbatim one, and it is the derived form that reaches a response.
 *
 * A value that is already an entity-tag — quoted, weak or strong — is returned
 * unchanged; anything else is quoted.
 */
export function httpEtagOf(etag: string): string {
  const bare = etag.startsWith("W/") ? etag.slice(2) : etag;
  if (bare.length >= 2 && bare.startsWith('"') && bare.endsWith('"')) {
    return etag;
  }
  return `"${etag}"`;
}

export function hasNulByte(value: string): boolean {
  return value.includes("\0");
}

export async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }
  return combined;
}

export function resolveExpiration(options?: {
  expiration?: number;
  expirationTtl?: number;
}): number | undefined {
  if (options?.expiration) return options.expiration;
  if (options?.expirationTtl) {
    return Math.floor(nowSeconds()) + options.expirationTtl;
  }
  return undefined;
}

export function paginateList<T>(
  items: T[],
  limit: number,
): { items: T[]; complete: boolean; cursor?: string } {
  const complete = items.length <= limit;
  return {
    items: items.slice(0, limit),
    complete,
    cursor: complete ? undefined : String(limit),
  };
}
