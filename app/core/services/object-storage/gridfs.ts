import { Buffer } from "node:buffer";
import { once } from "node:events";
import { type Db, GridFSBucket } from "mongodb";
import type { ObjectStorage } from "../object-storage.ts";

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
