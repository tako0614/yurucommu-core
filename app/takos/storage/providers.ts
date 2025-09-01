// オブジェクトストレージ実装（core から分離）
// - R2Storage: Cloudflare R2 バインディング

import type { ObjectStorage } from "../../core/storage/types.ts";

// R2 互換バケット型
interface R2BucketLike {
  put(key: string, data: Uint8Array): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
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

/**
 * ストレージを環境変数から構築する。
 * - provider: r2
 */
export function createObjectStorage(
  env: Record<string, string>,
): ObjectStorage {
  const provider = env["OBJECT_STORAGE_PROVIDER"] || "r2";
  if (provider === "r2") {
    const bucketName = env["R2_BUCKET"];
    if (!bucketName) throw new Error("R2_BUCKET is required for R2 storage");
    const bucket = (globalThis as Record<string, unknown>)[bucketName] as
      | R2BucketLike
      | undefined;
    if (!bucket) throw new Error(`R2 bucket binding '${bucketName}' not found`);
    return new R2Storage(bucket);
  }
  throw new Error(`Unsupported storage provider: ${provider}`);
}

export type { ObjectStorage };

