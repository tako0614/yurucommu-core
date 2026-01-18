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

/**
 * S28: Sanitize parsed JSON to prevent prototype pollution
 * Removes __proto__ and constructor properties recursively
 */
function sanitizeJson<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => sanitizeJson(item)) as T;
  }

  const sanitized: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    // S28: Skip dangerous prototype pollution keys
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      continue;
    }
    sanitized[key] = sanitizeJson((obj as Record<string, unknown>)[key]);
  }
  return sanitized as T;
}

/**
 * S28: Safe JSON.parse wrapper that sanitizes output to prevent prototype pollution
 */
function safeJsonParse<T>(json: string): T {
  const parsed = JSON.parse(json) as T;
  return sanitizeJson(parsed);
}

/**
 * Storage object returned from get()
 */
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

/**
 * Options for put()
 */
export interface PutOptions {
  httpMetadata?: {
    contentType?: string;
    cacheControl?: string;
    contentDisposition?: string;
  };
  customMetadata?: Record<string, string>;
}

/**
 * Object info returned from list()
 */
export interface ObjectInfo {
  key: string;
  size: number;
  uploaded: Date;
  etag?: string;
}

/**
 * Result from list()
 */
export interface ListResult {
  objects: ObjectInfo[];
  truncated: boolean;
  cursor?: string;
}

/**
 * Unified storage interface (R2Bucket-compatible)
 */
export interface Storage {
  put(key: string, value: ArrayBuffer | Uint8Array | string | ReadableStream, options?: PutOptions): Promise<void>;
  get(key: string): Promise<StorageObject | null>;
  delete(key: string | string[]): Promise<void>;
  list(options?: { prefix?: string; limit?: number; cursor?: string }): Promise<ListResult>;
  head(key: string): Promise<{ size: number; etag?: string; httpMetadata?: PutOptions['httpMetadata'] } | null>;
}

/**
 * Configuration for S3-compatible storage
 */
export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
}

/**
 * Configuration for local filesystem storage
 */
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

  return {
    async put(key, value, options) {
      let body: Uint8Array | string;
      if (value instanceof ReadableStream) {
        const reader = value.getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          chunks.push(chunk);
        }
        const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        body = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of chunks) {
          body.set(chunk, offset);
          offset += chunk.length;
        }
      } else if (value instanceof ArrayBuffer) {
        body = new Uint8Array(value);
      } else if (value instanceof Uint8Array) {
        body = value;
      } else {
        body = value;
      }

      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
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

        // Convert to ArrayBuffer for consistent interface
        const bodyBytes = await response.Body.transformToByteArray();
        let bodyUsed = false;

        return {
          key,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(bodyBytes);
              controller.close();
            },
          }),
          bodyUsed,
          arrayBuffer: async () => {
            bodyUsed = true;
            return bodyBytes.buffer as ArrayBuffer;
          },
          text: async () => {
            bodyUsed = true;
            return new TextDecoder().decode(bodyBytes);
          },
          json: async <T>() => {
            bodyUsed = true;
            // S28: Use safeJsonParse to prevent prototype pollution
            return safeJsonParse<T>(new TextDecoder().decode(bodyBytes));
          },
          size: response.ContentLength || 0,
          etag: response.ETag,
          httpMetadata: {
            contentType: response.ContentType,
            cacheControl: response.CacheControl,
            contentDisposition: response.ContentDisposition,
          },
          customMetadata: response.Metadata,
        };
      } catch (error: unknown) {
        if ((error as { name?: string }).name === 'NoSuchKey') {
          return null;
        }
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
          httpMetadata: {
            contentType: response.ContentType,
            cacheControl: response.CacheControl,
            contentDisposition: response.ContentDisposition,
          },
        };
      } catch (error: unknown) {
        if ((error as { name?: string }).name === 'NotFound') {
          return null;
        }
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

  // Ensure base directory exists
  await fs.mkdir(basePath, { recursive: true });

  const getFilePath = (key: string) => path.join(basePath, key);
  const getMetaPath = (key: string) => path.join(basePath, `${key}.meta.json`);

  return {
    async put(key, value, options) {
      const filePath = getFilePath(key);
      const metaPath = getMetaPath(key);

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Convert value to Buffer
      let content: Buffer;
      if (typeof value === 'string') {
        content = Buffer.from(value, 'utf-8');
      } else if (value instanceof ArrayBuffer) {
        content = Buffer.from(value);
      } else if (value instanceof Uint8Array) {
        content = Buffer.from(value);
      } else {
        // ReadableStream
        const chunks: Uint8Array[] = [];
        const reader = value.getReader();
        while (true) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          chunks.push(chunk);
        }
        content = Buffer.concat(chunks);
      }

      await fs.writeFile(filePath, content);

      // Write metadata
      if (options?.httpMetadata || options?.customMetadata) {
        await fs.writeFile(metaPath, JSON.stringify({
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
          size: content.length,
          uploaded: new Date().toISOString(),
        }));
      }
    },

    async get(key) {
      const filePath = getFilePath(key);
      const metaPath = getMetaPath(key);

      try {
        const content = await fs.readFile(filePath);
        let metadata: {
          httpMetadata?: PutOptions['httpMetadata'];
          customMetadata?: Record<string, string>;
        } = {};

        try {
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          // S28: Use safeJsonParse to prevent prototype pollution
          metadata = safeJsonParse(metaContent);
        } catch {
          // No metadata file
        }

        let bodyUsed = false;
        const arrayBuffer = content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength
        ) as ArrayBuffer;

        return {
          key,
          body: new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(content));
              controller.close();
            },
          }),
          bodyUsed,
          arrayBuffer: async () => {
            bodyUsed = true;
            return arrayBuffer;
          },
          text: async () => {
            bodyUsed = true;
            return content.toString('utf-8');
          },
          json: async <T>() => {
            bodyUsed = true;
            // S28: Use safeJsonParse to prevent prototype pollution
            return safeJsonParse<T>(content.toString('utf-8'));
          },
          size: content.length,
          httpMetadata: metadata.httpMetadata,
          customMetadata: metadata.customMetadata,
        };
      } catch {
        return null;
      }
    },

    async delete(key) {
      const keys = Array.isArray(key) ? key : [key];
      for (const k of keys) {
        try {
          await fs.unlink(getFilePath(k));
        } catch {
          // Ignore if not exists
        }
        try {
          await fs.unlink(getMetaPath(k));
        } catch {
          // Ignore if not exists
        }
      }
    },

    async list(options) {
      const objects: ObjectInfo[] = [];

      const readDirRecursive = async (dir: string, prefix: string = '') => {
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            const key = prefix ? `${prefix}/${entry.name}` : entry.name;

            if (entry.isDirectory()) {
              await readDirRecursive(fullPath, key);
            } else if (!entry.name.endsWith('.meta.json')) {
              if (!options?.prefix || key.startsWith(options.prefix)) {
                const stats = await fs.stat(fullPath);
                objects.push({
                  key,
                  size: stats.size,
                  uploaded: stats.mtime,
                });
              }
            }
          }
        } catch {
          // Directory doesn't exist
        }
      };

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
      const filePath = getFilePath(key);
      const metaPath = getMetaPath(key);

      try {
        const stats = await fs.stat(filePath);
        let metadata: {
          httpMetadata?: PutOptions['httpMetadata'];
        } = {};

        try {
          const metaContent = await fs.readFile(metaPath, 'utf-8');
          // S28: Use safeJsonParse to prevent prototype pollution
          metadata = safeJsonParse(metaContent);
        } catch {
          // No metadata file
        }

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
