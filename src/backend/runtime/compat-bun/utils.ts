// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - This file is Bun-specific and should be type-checked by Bun's TypeScript
/**
 * Bun Cloudflare Compatibility Layer - Shared Utilities
 */

export const { mkdir, unlink, readdir, stat, readFile } = await import('fs/promises');

/**
 * Drain a ReadableStream into a single Uint8Array.
 */
export async function drainStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((acc, c) => acc + c.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/**
 * Convert an arbitrary input value into a Uint8Array.
 * Handles string, ArrayBuffer, ArrayBufferView, Blob, and ReadableStream.
 */
export async function toUint8Array(
  value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob
): Promise<Uint8Array> {
  if (typeof value === 'string') {
    return new TextEncoder().encode(value);
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Blob) {
    return new Uint8Array(await value.arrayBuffer());
  }
  return drainStream(value);
}

/**
 * Read the JSON metadata sidecar for a storage key.
 * Returns an empty object if the sidecar doesn't exist or can't be parsed.
 */
export async function readMetadata(metaPath: string): Promise<{
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  size?: number;
  uploaded?: string;
}> {
  try {
    const metaFile = Bun.file(metaPath);
    if (await metaFile.exists()) {
      return JSON.parse(await metaFile.text());
    }
  } catch {
    // No metadata file or unreadable
  }
  return {};
}

/**
 * Compute the expiration timestamp from KV put options.
 */
export function resolveExpiration(options?: {
  expirationTtl?: number;
  expiration?: number;
}): number | undefined {
  if (options?.expiration) return options.expiration;
  if (options?.expirationTtl) return Math.floor(Date.now() / 1000) + options.expirationTtl;
  return undefined;
}
