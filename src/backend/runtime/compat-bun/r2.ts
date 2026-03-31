// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck - This file is Bun-specific and should be type-checked by Bun's TypeScript
/**
 * Bun Cloudflare Compatibility Layer - R2 Bucket
 */

import { mkdir, unlink, readdir, stat } from './utils.ts';
import { toUint8Array, readMetadata } from './utils.ts';

/**
 * R2Bucket-compatible filesystem implementation for Bun
 */
export class R2CompatBucket {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<R2CompatBucket> {
    await mkdir(basePath, { recursive: true });
    return new R2CompatBucket(basePath);
  }

  private getFilePath(key: string): string {
    return `${this.basePath}/${key}`;
  }

  private getMetaPath(key: string): string {
    return `${this.basePath}/${key}.meta.json`;
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    }
  ): Promise<{ key: string }> {
    const filePath = this.getFilePath(key);
    const dir = filePath.substring(0, filePath.lastIndexOf('/'));
    await mkdir(dir, { recursive: true });

    const content = await toUint8Array(value);
    await Bun.write(filePath, content);

    if (options?.httpMetadata || options?.customMetadata) {
      await Bun.write(
        this.getMetaPath(key),
        JSON.stringify({
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
          size: content.length,
          uploaded: new Date().toISOString(),
        })
      );
    }

    return { key };
  }

  async get(key: string): Promise<R2CompatObject | null> {
    const filePath = this.getFilePath(key);

    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) return null;

      const content = new Uint8Array(await file.arrayBuffer());
      const metadata = await readMetadata(this.getMetaPath(key));
      return new R2CompatObject(key, content, metadata);
    } catch {
      return null;
    }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      try { await unlink(this.getFilePath(k)); } catch { /* ignore */ }
      try { await unlink(this.getMetaPath(k)); } catch { /* ignore */ }
    }
  }

  async head(key: string): Promise<R2CompatObjectHead | null> {
    const filePath = this.getFilePath(key);

    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) return null;

      const metadata = await readMetadata(this.getMetaPath(key));
      return {
        key,
        size: file.size,
        uploaded: new Date(),
        httpMetadata: metadata.httpMetadata,
        customMetadata: metadata.customMetadata,
      };
    } catch {
      return null;
    }
  }

  async list(options?: {
    prefix?: string;
    limit?: number;
    cursor?: string;
    delimiter?: string;
  }): Promise<{
    objects: Array<{ key: string; size: number; uploaded: Date }>;
    truncated: boolean;
    cursor?: string;
    delimitedPrefixes?: string[];
  }> {
    const objects: Array<{ key: string; size: number; uploaded: Date }> = [];

    const readDirRecursive = async (dir: string, prefix: string = '') => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`;
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await readDirRecursive(fullPath, key);
          } else if (!entry.name.endsWith('.meta.json')) {
            if (!options?.prefix || key.startsWith(options.prefix)) {
              const stats = await stat(fullPath);
              objects.push({ key, size: stats.size, uploaded: stats.mtime });
            }
          }
        }
      } catch { /* ignore */ }
    };

    await readDirRecursive(this.basePath);

    const limit = options?.limit ?? 1000;
    const truncated = objects.length > limit;

    return {
      objects: objects.slice(0, limit),
      truncated,
      cursor: truncated ? String(limit) : undefined,
    };
  }
}

/**
 * R2Object-compatible implementation
 */
class R2CompatObject {
  key: string;
  private content: Uint8Array;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  size: number;
  uploaded: Date;
  body: ReadableStream<Uint8Array>;
  bodyUsed = false;

  constructor(
    key: string,
    content: Uint8Array,
    metadata: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
      size?: number;
      uploaded?: string;
    }
  ) {
    this.key = key;
    this.content = content;
    this.httpMetadata = metadata.httpMetadata;
    this.customMetadata = metadata.customMetadata;
    this.size = content.length;
    this.uploaded = metadata.uploaded ? new Date(metadata.uploaded) : new Date();
    this.body = new ReadableStream({
      start: (controller) => {
        controller.enqueue(content);
        controller.close();
      },
    });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.bodyUsed = true;
    return this.content.buffer as ArrayBuffer;
  }

  async text(): Promise<string> {
    this.bodyUsed = true;
    return new TextDecoder().decode(this.content);
  }

  async json<T>(): Promise<T> {
    this.bodyUsed = true;
    return JSON.parse(new TextDecoder().decode(this.content));
  }
}

export interface R2CompatObjectHead {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}
