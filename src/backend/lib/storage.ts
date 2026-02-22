/**
 * Storage Utility Module
 *
 * Provides a unified object storage interface that works across multiple backends:
 * - Cloudflare R2
 * - AWS S3 / S3-compatible (MinIO, etc.)
 * - Local filesystem
 *
 * All backends implement the R2Bucket-like interface for seamless switching.
 */

import type { R2Bucket } from '@cloudflare/workers-types';

// ============================================================
// Shared Helpers
// ============================================================

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * S28: Sanitize parsed JSON to prevent prototype pollution.
 * Removes __proto__, constructor, and prototype properties recursively.
 */
function sanitizeJson<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeJson(item)) as T;
  }

  const record = obj as Record<string, unknown>;
  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(record)) {
    if (!DANGEROUS_KEYS.has(key)) {
      sanitized[key] = sanitizeJson(record[key]);
    }
  }
  return sanitized as T;
}

/** S28: Safe JSON.parse wrapper that sanitizes output to prevent prototype pollution. */
function safeJsonParse<T>(json: string): T {
  return sanitizeJson(JSON.parse(json) as T);
}

/** Drain a ReadableStream into a single Uint8Array. */
async function drainStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Check whether an error matches a given name (for S3/SDK error discrimination). */
function isErrorWithName(error: unknown, name: string): boolean {
  return typeof error === 'object' && error !== null && (error as { name?: string }).name === name;
}

/** Build a StorageObject from raw bytes, key, size, and optional metadata. */
function buildStorageObject(
  key: string,
  bytes: Uint8Array,
  size: number,
  meta?: {
    etag?: string;
    httpMetadata?: StorageObject['httpMetadata'];
    customMetadata?: Record<string, string>;
  },
): StorageObject {
  let bodyUsed = false;
  return {
    key,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    bodyUsed,
    arrayBuffer: async () => {
      bodyUsed = true;
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    },
    text: async () => {
      bodyUsed = true;
      return new TextDecoder().decode(bytes);
    },
    json: async <T>() => {
      bodyUsed = true;
      return safeJsonParse<T>(new TextDecoder().decode(bytes));
    },
    size,
    etag: meta?.etag,
    httpMetadata: meta?.httpMetadata,
    customMetadata: meta?.customMetadata,
  };
}

// ============================================================
// Interfaces
// ============================================================

export interface StorageObject {
  key: string;
  body: ReadableStream<Uint8Array> | null;
  bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
  size: number;
  etag?: string;
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface PutOptions {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
  };
  customMetadata?: Record<string, string>;
}

export interface ObjectInfo {
  key: string;
  size: number;
  uploaded: Date;
  etag?: string;
}

export interface ListResult {
  objects: ObjectInfo[];
  truncated: boolean;
  cursor?: string;
}

export interface Storage {
  put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream, options?: PutOptions): Promise<void>;
  get(key: string): Promise<StorageObject | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<ListResult>;
  head(key: string): Promise<{ size: number; etag?: string; httpMetadata?: PutOptions['httpMetadata'] } | null>;
}

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

export interface FilesystemConfig {
  basePath: string;
}

// ============================================================
// R2 Storage (Cloudflare Workers)
// ============================================================

/**
 * Wrap R2Bucket to conform to our Storage interface
 */
export function getR2Storage(bucket: R2Bucket): Storage {
  return {
    async put(key, value, options) {
      await bucket.put(key, value as Parameters<R2Bucket['put']>[1], {
        httpMetadata: options?.httpMetadata,
        customMetadata: options?.customMetadata,
      });
    },

    async get(key) {
      const obj = await bucket.get(key);
      if (!obj) return null;

      return {
        key,
        body: obj.body as ReadableStream<Uint8Array> | null,
        bodyUsed: obj.bodyUsed,
        arrayBuffer: () => obj.arrayBuffer(),
        text: () => obj.text(),
        json: <T>() => obj.json<T>(),
        size: obj.size,
        etag: obj.etag,
        httpMetadata: obj.httpMetadata,
        customMetadata: obj.customMetadata,
      };
    },

    async delete(key) {
      await bucket.delete(key);
    },

    async list(options) {
      const result = await bucket.list(options);
      const r2Result = result as { objects: typeof result.objects; truncated: boolean; cursor?: string };
      return {
        objects: r2Result.objects.map(obj => ({
          key: obj.key,
          size: obj.size,
          uploaded: obj.uploaded,
          etag: obj.etag,
        })),
        truncated: r2Result.truncated,
        cursor: r2Result.cursor,
      };
    },

    async head(key) {
      const obj = await bucket.head(key);
      if (!obj) return null;

      return {
        size: obj.size,
        etag: obj.etag,
        httpMetadata: obj.httpMetadata,
      };
    },
  };
}

// ============================================================
// S3-Compatible Storage (AWS S3, MinIO, etc.)
// ============================================================

/**
 * Create S3-compatible storage client
 */
export async function getS3Storage(config: S3Config): Promise<Storage> {
  const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    ListObjectsV2Command,
    HeadObjectCommand,
  } = await import('@aws-sdk/client-s3');

  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region || 'auto',
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true, // Required for MinIO and some S3-compatible services
  });

  const bucket = config.bucket;

  /** Convert any accepted put() value into a Uint8Array or string for the S3 SDK. */
  async function toS3Body(value: ArrayBuffer | Uint8Array | string | ReadableStream): Promise<Uint8Array | string> {
    if (value instanceof ReadableStream) return drainStream(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    return value; // Uint8Array or string
  }

  /** Extract HTTP metadata from an S3 response into our standard shape. */
  function extractHttpMetadata(response: { ContentType?: string; CacheControl?: string; ContentDisposition?: string }): StorageObject['httpMetadata'] {
    return {
      contentType: response.ContentType,
      cacheControl: response.CacheControl,
      contentDisposition: response.ContentDisposition,
    };
  }

  return {
    async put(key, value, options) {
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: await toS3Body(value),
        ContentType: options?.httpMetadata?.contentType,
        CacheControl: options?.httpMetadata?.cacheControl,
        ContentDisposition: options?.httpMetadata?.contentDisposition,
        Metadata: options?.customMetadata,
      }));
    },

    async get(key) {
      try {
        const response = await client.send(new GetObjectCommand({
          Bucket: bucket,
          Key: key,
        }));
        if (!response.Body) return null;

        const bodyBytes = await response.Body.transformToByteArray();
        return buildStorageObject(key, bodyBytes, response.ContentLength || 0, {
          etag: response.ETag,
          httpMetadata: extractHttpMetadata(response),
          customMetadata: response.Metadata,
        });
      } catch (error: unknown) {
        if (isErrorWithName(error, 'NoSuchKey')) return null;
        throw error;
      }
    },

    async delete(key) {
      const keys = Array.isArray(key) ? key : [key];

      if (keys.length === 1) {
        await client.send(new DeleteObjectCommand({
          Bucket: bucket,
          Key: keys[0],
        }));
      } else {
        await client.send(new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: {
            Objects: keys.map(k => ({ Key: k })),
          },
        }));
      }
    },

    async list(options) {
      const response = await client.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: options?.prefix,
        MaxKeys: options?.limit,
        ContinuationToken: options?.cursor,
      }));

      return {
        objects: (response.Contents || []).map(obj => ({
          key: obj.Key || '',
          size: obj.Size || 0,
          uploaded: obj.LastModified || new Date(),
          etag: obj.ETag,
        })),
        truncated: response.IsTruncated || false,
        cursor: response.NextContinuationToken,
      };
    },

    async head(key) {
      try {
        const response = await client.send(new HeadObjectCommand({
          Bucket: bucket,
          Key: key,
        }));

        return {
          size: response.ContentLength || 0,
          etag: response.ETag,
          httpMetadata: extractHttpMetadata(response),
        };
      } catch (error: unknown) {
        if (isErrorWithName(error, 'NotFound')) return null;
        throw error;
      }
    },
  };
}

// ============================================================
// Local Filesystem Storage
// ============================================================

/**
 * Create local filesystem storage
 */
export async function getFilesystemStorage(config: FilesystemConfig): Promise<Storage> {
  const fs = await import('fs/promises');
  const path = await import('path');

  const basePath = config.basePath;

  await fs.mkdir(basePath, { recursive: true });

  function getFilePath(key: string): string { return path.join(basePath, key); }
  function getMetaPath(key: string): string { return path.join(basePath, `${key}.meta.json`); }

  /** Convert any accepted put() value into a Buffer for fs.writeFile. */
  async function toBuffer(value: ArrayBuffer | Uint8Array | string | ReadableStream): Promise<Buffer> {
    if (typeof value === 'string') return Buffer.from(value, 'utf-8');
    if (value instanceof ReadableStream) return Buffer.from(await drainStream(value));
    if (value instanceof ArrayBuffer) return Buffer.from(new Uint8Array(value));
    return Buffer.from(value); // Uint8Array
  }

  /** Read and parse a .meta.json sidecar, returning {} if the file does not exist. */
  async function readMetadata(metaPath: string): Promise<{
    httpMetadata?: PutOptions['httpMetadata'];
    customMetadata?: Record<string, string>;
  }> {
    try {
      const raw = await fs.readFile(metaPath, 'utf-8');
      return safeJsonParse(raw);
    } catch {
      return {};
    }
  }

  /** Silently unlink a file, ignoring "not found" errors. */
  async function silentUnlink(filePath: string): Promise<void> {
    try { await fs.unlink(filePath); } catch { /* ignore */ }
  }

  return {
    async put(key, value, options) {
      const filePath = getFilePath(key);
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      const content = await toBuffer(value);
      await fs.writeFile(filePath, content);

      if (options?.httpMetadata || options?.customMetadata) {
        await fs.writeFile(getMetaPath(key), JSON.stringify({
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
          size: content.length,
          uploaded: new Date().toISOString(),
        }));
      }
    },

    async get(key) {
      try {
        const content = await fs.readFile(getFilePath(key));
        const metadata = await readMetadata(getMetaPath(key));
        const bytes = new Uint8Array(content);

        return buildStorageObject(key, bytes, content.length, {
          httpMetadata: metadata.httpMetadata,
          customMetadata: metadata.customMetadata,
        });
      } catch {
        return null;
      }
    },

    async delete(key) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        await silentUnlink(getFilePath(k));
        await silentUnlink(getMetaPath(k));
      }
    },

    async list(options) {
      const objects: ObjectInfo[] = [];

      async function readDirRecursive(dir: string, prefix: string = ''): Promise<void> {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const key = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
              await readDirRecursive(fullPath, key);
              continue;
            }
            if (entry.name.endsWith('.meta.json')) continue;
            if (options?.prefix && !key.startsWith(options.prefix)) continue;

            const stats = await fs.stat(fullPath);
            objects.push({ key, size: stats.size, uploaded: stats.mtime });
          }
        } catch {
          // Directory doesn't exist
        }
      }

      await readDirRecursive(basePath);

      const limit = options?.limit ?? 1000;
      const truncated = objects.length > limit;

      return {
        objects: objects.slice(0, limit),
        truncated,
        cursor: truncated ? String(limit) : undefined,
      };
    },

    async head(key) {
      try {
        const stats = await fs.stat(getFilePath(key));
        const metadata = await readMetadata(getMetaPath(key));

        return {
          size: stats.size,
          httpMetadata: metadata.httpMetadata,
        };
      } catch {
        return null;
      }
    },
  };
}

// ============================================================
// Factory Function
// ============================================================

export type StorageConfig =
  | { type: 'r2'; bucket: R2Bucket }
  | { type: 's3'; config: S3Config }
  | { type: 'filesystem'; config: FilesystemConfig };

/**
 * Create storage based on configuration
 */
export async function createStorage(config: StorageConfig): Promise<Storage> {
  switch (config.type) {
    case 'r2':
      return getR2Storage(config.bucket);
    case 's3':
      return getS3Storage(config.config);
    case 'filesystem':
      return getFilesystemStorage(config.config);
  }
}

// Re-export types
export type { R2Bucket };
