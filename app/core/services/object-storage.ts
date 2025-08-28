/**
 * オブジェクトストレージインターフェース
 */

// 外部モジュール
import { ensureDir } from "@std/fs";
import { dirname, join } from "@std/path";

// 内部ユーティリティ

export interface ObjectStorage {
  put(key: string, data: Uint8Array): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
}

interface R2Bucket {
  put(key: string, data: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

/* ==========================
   LocalStorage 実装
   ========================== */

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

/* ==========================
   R2Storage 実装
   ========================== */

class R2Storage implements ObjectStorage {
  constructor(private bucket: R2Bucket) {}

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

/* ==========================
   ストレージファクトリ関数
   ========================== */
import type { DataStore } from "../db/types.ts";

export async function createStorage(
  e: Record<string, string>,
  db?: DataStore,
): Promise<ObjectStorage> {
  const provider = e["OBJECT_STORAGE_PROVIDER"] || "local";
  if (provider === "r2") {
    const bucketName = e["R2_BUCKET"];
    if (!bucketName) {
      throw new Error("R2_BUCKET is required for R2 storage");
    }
    const bucket = (globalThis as Record<string, unknown>)[bucketName] as
      | R2Bucket
      | undefined;
    if (!bucket) {
      throw new Error(`R2 bucket binding '${bucketName}' not found`);
    }
    return new R2Storage(bucket);
  }
  if (provider === "gridfs") {
    if (!db || !db.raw) {
      throw new Error(
        "DataStore instance with raw() is required for GridFS",
      );
    }
    const bucketName = e["GRIDFS_BUCKET"] || "uploads";
    const native = await db.raw();
    const { GridFSStorage } = await import("./object-storage/gridfs.ts");
    return new GridFSStorage(native, bucketName);
  }
  const dir = e["LOCAL_STORAGE_DIR"] || "uploads";
  return new LocalStorage(dir);
}
