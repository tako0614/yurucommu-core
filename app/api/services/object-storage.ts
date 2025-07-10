/**
 * オブジェクトストレージインターフェース
 */

// 外部モジュール
import { ensureDir } from "@std/fs";
import { join } from "@std/path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { sdkStreamMixin } from "@aws-sdk/util-stream-node";
import mongoose from "mongoose";
import { GridFSBucket } from "mongodb";
import { once } from "node:events";
import { Buffer } from "node:buffer";

// 内部ユーティリティ
import { env } from "../utils/env.ts";

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
    await ensureDir(this.baseDir);
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
   S3Storage 実装
   ========================== */

export class S3Storage implements ObjectStorage {
  private client: S3Client;
  constructor(
    private bucket: string,
    region: string,
    accessKey: string,
    secretKey: string,
    private endpoint?: string,
    private forcePathStyle = false,
  ) {
    this.client = new S3Client({
      region,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
      endpoint: endpoint || undefined,
      forcePathStyle,
    });
  }

  async put(key: string, data: Uint8Array): Promise<string> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
      }),
    );
    if (this.endpoint) {
      const base = this.endpoint.replace(/\/$/, "");
      const prefix = this.forcePathStyle ? `${base}/${this.bucket}` : base;
      return `${prefix}/${key}`;
    }
    return `https://${this.bucket}.s3.${this.client.config.region}.amazonaws.com/${key}`;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (res.Body) {
      return await sdkStreamMixin(res.Body).transformToByteArray();
    }
    return null;
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}

/* ==========================
   GridFSStorage 実装
   ========================== */

export class GridFSStorage implements ObjectStorage {
  private bucket: GridFSBucket;
  constructor(bucketName: string) {
    if (!mongoose.connection.db) {
      throw new Error("Database is not connected");
    }
    this.bucket = new GridFSBucket(mongoose.connection.db, { bucketName });
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
export function createStorage(): ObjectStorage {
  const provider = env["OBJECT_STORAGE_PROVIDER"] || "local";
  if (provider === "s3" || provider === "r2" || provider === "minio") {
    const bucket = env["S3_BUCKET"] || "";
    const region = env["S3_REGION"] || "us-east-1";
    const accessKey = env["S3_ACCESS_KEY"] || "";
    const secretKey = env["S3_SECRET_KEY"] || "";
    const endpoint = env["S3_ENDPOINT"] || undefined;
    const forcePathStyle = env["S3_FORCE_PATH_STYLE"] === "true";
    return new S3Storage(
      bucket,
      region,
      accessKey,
      secretKey,
      endpoint,
      forcePathStyle,
    );
  }
  if (provider === "gridfs") {
    const bucketName = env["GRIDFS_BUCKET"] || "uploads";
    return new GridFSStorage(bucketName);
  }
  const dir = env["LOCAL_STORAGE_DIR"] || "uploads";
  return new LocalStorage(dir);
}
