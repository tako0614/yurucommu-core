/**
 * R2Bucket-compatible filesystem implementation
 *
 * Implements the runtime `IObjectStorage` contract on top of the local
 * filesystem. The nominal Cloudflare `R2Bucket` is reached through
 * `runtime/cloudflare-binding.ts#toCloudflareBindings`.
 */

import { Buffer } from "node:buffer";
import {
  getFs,
  getPath,
  loadNodeModules,
  readMetaFile,
  toBuffer,
} from "./node-modules.ts";
import {
  assertPathChainWithinBasePath,
  isPathWithinBasePath,
  resolvePathWithinBasePath,
} from "../shared.ts";
import type {
  IObjectStorage,
  ListObjectsResult,
  ObjectMetadata,
  StorageObject,
} from "../types.ts";

export interface R2MetaFile {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
  size?: number;
  uploaded?: string;
}

/**
 * R2ObjectHead-compatible implementation
 */
export interface R2CompatObjectHead extends ObjectMetadata {
  key: string;
  size: number;
  uploaded: Date;
}

export class R2CompatBucket implements IObjectStorage {
  private basePath: string;
  private realBasePath: string | null = null;

  constructor(basePath: string) {
    this.basePath = basePath;
  }

  static async create(basePath: string): Promise<R2CompatBucket> {
    await loadNodeModules();
    await getFs().mkdir(basePath, { recursive: true });
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
    return getPath().resolve(this.basePath);
  }

  private async getRealBasePath(): Promise<string> {
    if (this.realBasePath) return this.realBasePath;
    try {
      this.realBasePath = await getFs().realpath(this.getResolvedBasePath());
    } catch {
      this.realBasePath = this.getResolvedBasePath();
    }
    return this.realBasePath;
  }

  private async resolveExistingPath(filePath: string): Promise<string | null> {
    try {
      const realPath = await getFs().realpath(filePath);
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
    value: ReadableStream | ArrayBuffer | string,
    options?: {
      httpMetadata?: ObjectMetadata["httpMetadata"];
      customMetadata?: Record<string, string>;
    },
  ): Promise<void> {
    const fs = getFs();
    const path = getPath();
    const filePath = this.getFilePath(key);
    await assertPathChainWithinBasePath(
      await this.getRealBasePath(),
      filePath,
      fs.realpath.bind(fs),
    );
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    const realBasePath = await this.getRealBasePath();
    let realFilePath: string | null = null;
    try {
      realFilePath = await fs.realpath(filePath);
    } catch {
      realFilePath = null;
    }
    if (realFilePath) {
      if (!isPathWithinBasePath(realBasePath, realFilePath)) {
        throw new Error("Path escapes base directory");
      }
    } else {
      const realDirPath = await fs.realpath(path.dirname(filePath));
      if (!isPathWithinBasePath(realBasePath, realDirPath)) {
        throw new Error("Path escapes base directory");
      }
    }

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
  }

  async get(key: string): Promise<R2CompatObject | null> {
    try {
      const filePath = await this.resolveExistingPath(this.getFilePath(key));
      if (!filePath) return null;
      const content = await getFs().readFile(filePath);
      const metaPath = await this.resolveExistingPath(this.getMetaPath(key));
      const metadata = metaPath ? await readMetaFile<R2MetaFile>(metaPath) : {};
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
        const filePath = await this.resolveExistingPath(this.getFilePath(k));
        if (filePath) await fs.unlink(filePath);
      } catch { /* ignore */ }
      try {
        const metaPath = await this.resolveExistingPath(this.getMetaPath(k));
        if (metaPath) await fs.unlink(metaPath);
      } catch { /* ignore */ }
    }
  }

  async head(key: string): Promise<R2CompatObjectHead | null> {
    try {
      const fs = getFs();
      const filePath = await this.resolveExistingPath(this.getFilePath(key));
      if (!filePath) return null;
      const stats = await fs.stat(filePath);
      const metaPath = await this.resolveExistingPath(this.getMetaPath(key));
      const metadata = metaPath ? await readMetaFile<R2MetaFile>(metaPath) : {};

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
    const realBasePath = await this.getRealBasePath();

    const readDir = async (dir: string, prefix: string = ""): Promise<void> => {
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const realFullPath = await fs.realpath(fullPath);
          if (!isPathWithinBasePath(realBasePath, realFullPath)) continue;
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

    await readDir(realBasePath);

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
