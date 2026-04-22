/**
 * R2Bucket-compatible filesystem implementation
 *
 * Provides R2CompatBucket and R2CompatObject classes that implement
 * the same interface as Cloudflare R2.
 */

import { Buffer } from "node:buffer";
import {
  getFs,
  getPath,
  loadNodeModules,
  readMetaFile,
  toBuffer,
} from "./node-modules.ts";

export interface R2MetaFile {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  size?: number;
  uploaded?: string;
}

/**
 * R2ObjectHead-compatible implementation
 */
export interface R2CompatObjectHead {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

/**
 * R2Bucket-compatible filesystem implementation
 */
export class R2CompatBucket {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<R2CompatBucket> {
    await loadNodeModules();
    await getFs().mkdir(basePath, { recursive: true });
    return new R2CompatBucket(basePath);
  }

  private getFilePath(key: string): string {
    return getPath().join(this.basePath, key);
  }

  private getMetaPath(key: string): string {
    return getPath().join(this.basePath, `${key}.meta.json`);
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<{ key: string }> {
    const fs = getFs();
    const path = getPath();
    const filePath = this.getFilePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const content = await toBuffer(value);
    await fs.writeFile(filePath, content);

    if (options?.httpMetadata || options?.customMetadata) {
      await fs.writeFile(
        this.getMetaPath(key),
        JSON.stringify({
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
          size: content.length,
          uploaded: new Date().toISOString(),
        }),
      );
    }

    return { key };
  }

  async get(key: string): Promise<R2CompatObject | null> {
    try {
      const content = await getFs().readFile(this.getFilePath(key));
      const metadata = await readMetaFile<R2MetaFile>(this.getMetaPath(key));
      return new R2CompatObject(key, content, metadata);
    } catch {
      return null;
    }
  }

  async delete(key: string | string[]): Promise<void> {
    const fs = getFs();
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      try {
        await fs.unlink(this.getFilePath(k));
      } catch { /* ignore */ }
      try {
        await fs.unlink(this.getMetaPath(k));
      } catch { /* ignore */ }
    }
  }

  async head(key: string): Promise<R2CompatObjectHead | null> {
    try {
      const fs = getFs();
      const stats = await fs.stat(this.getFilePath(key));
      const metadata = await readMetaFile<R2MetaFile>(this.getMetaPath(key));

      return {
        key,
        size: stats.size,
        uploaded: stats.mtime,
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
    const fs = getFs();
    const path = getPath();
    const objects: Array<{ key: string; size: number; uploaded: Date }> = [];

    const readDir = async (dir: string, prefix: string = ""): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await readDir(fullPath, key);
          } else if (!entry.name.endsWith(".meta.json")) {
            if (!options?.prefix || key.startsWith(options.prefix)) {
              const stats = await fs.stat(fullPath);
              objects.push({ key, size: stats.size, uploaded: stats.mtime });
            }
          }
        }
      } catch { /* ignore */ }
    };

    await readDir(this.basePath);

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
export class R2CompatObject {
  key: string;
  private content: Buffer;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  size: number;
  uploaded: Date;
  body: ReadableStream<Uint8Array>;
  bodyUsed = false;

  constructor(key: string, content: Buffer, metadata: R2MetaFile) {
    this.key = key;
    this.content = content;
    this.httpMetadata = metadata.httpMetadata;
    this.customMetadata = metadata.customMetadata;
    this.size = content.length;
    this.uploaded = metadata.uploaded
      ? new Date(metadata.uploaded)
      : new Date();
    this.body = new ReadableStream({
      start: (controller) => {
        controller.enqueue(new Uint8Array(content));
        controller.close();
      },
    });
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    this.bodyUsed = true;
    return this.content.buffer.slice(
      this.content.byteOffset,
      this.content.byteOffset + this.content.byteLength,
    ) as ArrayBuffer;
  }

  async text(): Promise<string> {
    this.bodyUsed = true;
    return this.content.toString("utf-8");
  }

  async json<T>(): Promise<T> {
    this.bodyUsed = true;
    return JSON.parse(this.content.toString("utf-8"));
  }
}
