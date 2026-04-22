/**
 * Bun Cloudflare Compatibility Layer - R2 Bucket
 */

import { mkdir, readdir, realpath, stat, unlink } from "./utils.ts";
import { readMetadata, toUint8Array } from "./utils.ts";
import type { BunRuntime } from "./types.ts";
import {
  assertPathChainWithinBasePath,
  isPathWithinBasePath,
  resolvePathWithinBasePath,
} from "../shared.ts";
import path from "node:path";

declare const Bun: BunRuntime;

/**
 * R2Bucket-compatible filesystem implementation for Bun
 */
export class R2CompatBucket {
  private basePath: string;
  private realBasePath: string | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<R2CompatBucket> {
    await mkdir(basePath, { recursive: true });
    return new R2CompatBucket(basePath);
  }

  private getFilePath(key: string): string {
    return resolvePathWithinBasePath(this.getResolvedBasePath(), key);
  }

  private getMetaPath(key: string): string {
    return resolvePathWithinBasePath(
      this.getResolvedBasePath(),
      `${key}.meta.json`,
    );
  }

  private getResolvedBasePath(): string {
    return path.resolve(this.basePath);
  }

  private async getRealBasePath(): Promise<string> {
    if (this.realBasePath) return this.realBasePath;
    try {
      this.realBasePath = await realpath(this.getResolvedBasePath());
    } catch {
      this.realBasePath = this.getResolvedBasePath();
    }
    return this.realBasePath;
  }

  private async resolveExistingPath(filePath: string): Promise<string | null> {
    try {
      const realPath = await realpath(filePath);
      const realBasePath = await this.getRealBasePath();
      if (!isPathWithinBasePath(realBasePath, realPath)) {
        throw new Error("Path escapes base directory");
      }
      return realPath;
    } catch {
      return null;
    }
  }

  async put(
    key: string,
    value: ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob,
    options?: {
      httpMetadata?: { contentType?: string };
      customMetadata?: Record<string, string>;
    },
  ): Promise<{ key: string }> {
    const filePath = this.getFilePath(key);
    const dir = path.dirname(filePath);
    await assertPathChainWithinBasePath(
      await this.getRealBasePath(),
      filePath,
      realpath,
    );
    await mkdir(dir, { recursive: true });

    const realBasePath = await this.getRealBasePath();
    let realFilePath: string | null = null;
    try {
      realFilePath = await realpath(filePath);
    } catch {
      realFilePath = null;
    }
    if (realFilePath) {
      if (!isPathWithinBasePath(realBasePath, realFilePath)) {
        throw new Error("Path escapes base directory");
      }
    } else {
      const realDirPath = await realpath(dir);
      if (!isPathWithinBasePath(realBasePath, realDirPath)) {
        throw new Error("Path escapes base directory");
      }
    }

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
        }),
      );
    }

    return { key };
  }

  async get(key: string): Promise<R2CompatObject | null> {
    const filePath = this.getFilePath(key);

    try {
      const resolvedFilePath = await this.resolveExistingPath(filePath);
      if (!resolvedFilePath) return null;
      const file = Bun.file(resolvedFilePath);
      if (!(await file.exists())) return null;

      const content = new Uint8Array(await file.arrayBuffer());
      const resolvedMetaPath = await this.resolveExistingPath(
        this.getMetaPath(key),
      );
      const metadata = resolvedMetaPath
        ? await readMetadata(resolvedMetaPath)
        : {};
      return new R2CompatObject(key, content, metadata);
    } catch {
      return null;
    }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = Array.isArray(key) ? key : [key];
    for (const k of keys) {
      try {
        const filePath = await this.resolveExistingPath(this.getFilePath(k));
        if (filePath) await unlink(filePath);
      } catch { /* ignore */ }
      try {
        const metaPath = await this.resolveExistingPath(this.getMetaPath(k));
        if (metaPath) await unlink(metaPath);
      } catch { /* ignore */ }
    }
  }

  async head(key: string): Promise<R2CompatObjectHead | null> {
    const filePath = this.getFilePath(key);

    try {
      const resolvedFilePath = await this.resolveExistingPath(filePath);
      if (!resolvedFilePath) return null;
      const file = Bun.file(resolvedFilePath);
      if (!(await file.exists())) return null;

      const resolvedMetaPath = await this.resolveExistingPath(
        this.getMetaPath(key),
      );
      const metadata = resolvedMetaPath
        ? await readMetadata(resolvedMetaPath)
        : {};
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
    const realBasePath = await this.getRealBasePath();

    const readDirRecursive = async (dir: string, prefix: string = "") => {
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = `${dir}/${entry.name}`;
          const realFullPath = await realpath(fullPath);
          if (!isPathWithinBasePath(realBasePath, realFullPath)) continue;
          const key = prefix ? `${prefix}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            await readDirRecursive(fullPath, key);
          } else if (!entry.name.endsWith(".meta.json")) {
            if (!options?.prefix || key.startsWith(options.prefix)) {
              const stats = await stat(fullPath);
              objects.push({ key, size: stats.size, uploaded: stats.mtime });
            }
          }
        }
      } catch { /* ignore */ }
    };

    await readDirRecursive(realBasePath);

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
    },
  ) {
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
