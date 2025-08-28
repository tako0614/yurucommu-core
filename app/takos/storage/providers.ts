// オブジェクトストレージ実装（core から分離）
// - LocalStorage: ローカルファイル
// - R2Storage: Cloudflare R2 バインディング
// - GridFSStorage: MongoDB GridFS

import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import type { ObjectStorage } from "../../core/storage/types.ts";

// R2 互換バケット型
interface R2BucketLike {
  put(key: string, data: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

class LocalStorage implements ObjectStorage {
  constructor(private baseDir: string) {}
  async put(key: string, data: Uint8Array): Promise<string> {
    const filePath = join(this.baseDir, key);
    await ensureDir(dirname(filePath));
    await Deno.writeFile(filePath, data);
    return filePath;
  }
  async get(key: string): Promise<Uint8Array | null> {
    const filePath = join(this.baseDir, key);
    try {
      return await Deno.readFile(filePath);
    } catch {
      return null;
    }
  }
  async delete(key: string): Promise<void> {
    const filePath = join(this.baseDir, key);
    await Deno.remove(filePath).catch(() => {});
  }
}

class R2Storage implements ObjectStorage {
  constructor(private bucket: R2BucketLike) {}
  async put(key: string, data: Uint8Array): Promise<string> {
    await this.bucket.put(key, data);
    return key;
  }
  async get(key: string): Promise<Uint8Array | null> {
    const obj = await this.bucket.get(key);
    if (!obj) return null;
    const buf = await obj.arrayBuffer();
    return new Uint8Array(buf);
  }
  async delete(key: string): Promise<void> {
    await this.bucket.delete(key);
  }
}

// GridFS 実装（MongoDB 依存）
import { Buffer } from "node:buffer";
import { once } from "node:events";
import type { Db } from "mongodb";

class GridFSStorage implements ObjectStorage {
  #bucket: unknown | null = null;
  constructor(private getDb: () => Promise<Db>, private bucketName: string) {}
  private async bucket() {
    if (this.#bucket) return this.#bucket as unknown;
    const db = await this.getDb();
    const { GridFSBucket } = await import("mongodb");
    this.#bucket = new GridFSBucket(db, { bucketName: this.bucketName });
    return this.#bucket as unknown;
  }
  async put(key: string, data: Uint8Array): Promise<string> {
    const bucket = await this.bucket() as { openUploadStream(n: string): any };
    const stream = bucket.openUploadStream(key);
    stream.end(Buffer.from(data));
    await once(stream, "finish");
    return key;
  }
  async get(key: string): Promise<Uint8Array | null> {
    const bucket = await this.bucket() as { openDownloadStreamByName(n: string): AsyncIterable<Uint8Array> };
    const download = (bucket as any).openDownloadStreamByName(key);
    const chunks: Uint8Array[] = [];
    try {
      for await (const chunk of download) chunks.push(chunk as Uint8Array);
      const size = chunks.reduce((s, c) => s + c.length, 0);
      const out = new Uint8Array(size);
      let off = 0;
      for (const ch of chunks) { out.set(ch, off); off += ch.length; }
      return out;
    } catch {
      return null;
    }
  }
  async delete(key: string): Promise<void> {
    const bucket = await this.bucket() as { find(q: unknown): { toArray(): Promise<any[]> }, delete(id: unknown): Promise<void> };
    const files = await (bucket as any).find({ filename: key }).toArray();
    for (const f of files) await (bucket as any).delete(f._id).catch(() => {});
  }
}

/**
 * ストレージを環境変数から構築する。
 * - provider: local | r2 | gridfs
 * - gridfs は getDb を使用
 */
export function createObjectStorage(
  env: Record<string, string>,
  opts?: { getDb?: () => Promise<Db> },
): ObjectStorage {
  const provider = env["OBJECT_STORAGE_PROVIDER"] || "local";
  if (provider === "r2") {
    const bucketName = env["R2_BUCKET"];
    if (!bucketName) throw new Error("R2_BUCKET is required for R2 storage");
    const bucket = (globalThis as Record<string, unknown>)[bucketName] as
      | R2BucketLike
      | undefined;
    if (!bucket) throw new Error(`R2 bucket binding '${bucketName}' not found`);
    return new R2Storage(bucket);
  }
  if (provider === "gridfs") {
    if (!opts?.getDb) throw new Error("getDb() is required for GridFS storage");
    const bucketName = env["GRIDFS_BUCKET"] || "uploads";
    return new GridFSStorage(opts.getDb, bucketName);
  }
  const dir = env["LOCAL_STORAGE_DIR"] || "uploads";
  return new LocalStorage(dir);
}

export type { ObjectStorage };

