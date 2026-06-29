import path from "node:path";

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

export function hasNulByte(value: string): boolean {
  return value.includes("\0");
}

export function isPathWithinBasePath(
  basePath: string,
  candidatePath: string,
): boolean {
  const relative = path.relative(basePath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function resolvePathWithinBasePath(
  basePath: string,
  key: string,
): string {
  if (hasNulByte(key)) {
    throw new Error("Invalid path");
  }
  const resolvedPath = path.resolve(basePath, key);
  if (!isPathWithinBasePath(basePath, resolvedPath)) {
    throw new Error("Path escapes base directory");
  }
  return resolvedPath;
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

export async function assertPathChainWithinBasePath(
  basePath: string,
  targetPath: string,
  realpath: (path: string) => Promise<string>,
): Promise<void> {
  let currentPath = targetPath;

  while (true) {
    try {
      const realCurrentPath = await realpath(currentPath);
      if (!isPathWithinBasePath(basePath, realCurrentPath)) {
        throw new Error("Path escapes base directory");
      }
      return;
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
      const parentPath = path.dirname(currentPath);
      if (parentPath === currentPath) {
        throw error;
      }
      currentPath = parentPath;
    }
  }
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
