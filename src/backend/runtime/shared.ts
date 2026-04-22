export const DEFAULT_LIST_LIMIT = 1000;
export const META_SUFFIX = ".meta.json";

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
