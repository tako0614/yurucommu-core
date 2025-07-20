/**
 * オブジェクトストレージインターフェース
 */

// 外部モジュール
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";
import { type Db, GridFSBucket } from "mongodb";
import { once } from "node:events";
import { Buffer } from "node:buffer";

// 内部ユーティリティ

export interface ObjectStorage {
  put(key: string, data: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

/* ==========================
   LocalStorage 実装
   ========================== */

export class LocalStorage implements ObjectStorage {
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

/* ==========================
   GridFSStorage 実装
   ========================== */

export class GridFSStorage implements ObjectStorage {
  private bucket: GridFSBucket;
  constructor(db: Db, bucketName: string) {
    this.bucket = new GridFSBucket(db, { bucketName });
  }

  async put(key: string, data: Uint8Array): Promise<string> {
    const stream = this.bucket.openUploadStream(key);
    stream.end(Buffer.from(data));
    await once(stream, "finish");
    return key;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const download = this.bucket.openDownloadStreamByName(key);
    const chunks: Uint8Array[] = [];
    try {
      for await (const chunk of download) {
        chunks.push(chunk as Buffer);
      }
      const size = chunks.reduce((s, c) => s + c.length, 0);
      const data = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        data.set(chunk, offset);
        offset += chunk.length;
      }
      return data;
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const files = await this.bucket.find({ filename: key }).toArray();
    for (const file of files) {
      await this.bucket.delete(file._id).catch(() => {});
    }
  }
}

/* ==========================
   ストレージファクトリ関数
   ========================== */
import type { DB } from "../../shared/db.ts";

export async function createStorage(
  e: Record<string, string>,
  db?: DB,
): Promise<ObjectStorage> {
  const provider = e["OBJECT_STORAGE_PROVIDER"] || "local";
  if (provider === "gridfs") {
    if (!db || !db.getDatabase) {
      throw new Error("DB instance with getDatabase is required for GridFS");
    }
    const bucketName = e["GRIDFS_BUCKET"] || "uploads";
    const native = await db.getDatabase();
    return new GridFSStorage(native, bucketName);
  }
  const dir = e["LOCAL_STORAGE_DIR"] || "uploads";
  return new LocalStorage(dir);
}
