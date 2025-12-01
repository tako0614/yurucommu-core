import { describe, expect, it } from "vitest";
import { AppStorageError, createAppStorage } from "./storage";

const createR2Mock = () => {
  const stored = new Map<string, any>();
  const putCalls: any[] = [];
  return {
    stored,
    putCalls,
    async put(key: string, value: any, options?: any) {
      putCalls.push({ key, value, options });
      stored.set(key, { value, options });
      return null;
    },
    async get(key: string) {
      const item = stored.get(key);
      if (!item) return null;
      return { key, body: item.value, httpMetadata: item.options?.httpMetadata ?? {} };
    },
    async delete(key: string) {
      stored.delete(key);
    },
    async head() {
      return null;
    },
  } as any;
};

const createKvMock = () => {
  const stored = new Map<string, any>();
  return {
    stored,
    async put(key: string, value: any) {
      stored.set(key, value);
    },
    async get(key: string, options?: { type?: "text" | "arrayBuffer" }) {
      const value = stored.get(key);
      if (value === undefined) return null;
      if (options?.type === "arrayBuffer") {
        if (typeof value === "string") {
          return new TextEncoder().encode(value).buffer;
        }
        return value;
      }
      return typeof value === "string" ? value : value;
    },
    async delete(key: string) {
      stored.delete(key);
    },
    async getWithMetadata(key: string, options?: any) {
      return { value: await (this as any).get(key, options), metadata: null };
    },
  } as any;
};

describe("app storage buckets", () => {
  it("maps a bucket to R2 with templating and validations", async () => {
    const r2 = createR2Mock();
    const storage = createAppStorage({
      buckets: {
        "app:attachments": {
          base_path: "app/{userId}/",
          allowed_mime: ["image/*"],
          max_size_mb: 1,
        },
      },
      bindings: { "app:attachments": { type: "r2", binding: r2 } },
      defaultContext: { userId: "user-1" },
    });

    const bucket = storage.bucket("app:attachments");
    const blob = new Blob(["hi"], { type: "image/png" });
    const result = await bucket.put("hello.png", blob);

    expect(result.key).toBe("app/user-1/hello.png");
    expect(r2.putCalls[0]?.key).toBe("app/user-1/hello.png");
  });

  it("rejects disallowed mime types and oversized payloads", async () => {
    const r2 = createR2Mock();
    const storage = createAppStorage({
      buckets: {
        "app:attachments": {
          base_path: "app/{userId}/",
          allowed_mime: ["image/*"],
          max_size_mb: 0.0001, // ~102 bytes
        },
      },
      bindings: { "app:attachments": r2 },
      defaultContext: { userId: "user-1" },
    });

    const bucket = storage.bucket("app:attachments");
    await expect(bucket.put("note.txt", new Blob(["text"], { type: "text/plain" }))).rejects.toMatchObject({
      code: "invalid_mime",
    });

    const large = new Blob([new Uint8Array(200)], { type: "image/png" });
    await expect(bucket.put("big.png", large)).rejects.toMatchObject({
      code: "max_size_exceeded",
    });
  });

  it("supports KV buckets with base path templating", async () => {
    const kv = createKvMock();
    const storage = createAppStorage({
      buckets: {
        "app:kv": {
          base_path: "kv/{workspace}/",
        },
      },
      bindings: { "app:kv": { type: "kv", binding: kv } },
      defaultContext: { workspace: "ws-1" },
    });

    const bucket = storage.bucket("app:kv");
    const putResult = await bucket.put("note", "hello world");
    expect(putResult.key).toBe("kv/ws-1/note");
    expect(kv.stored.get("kv/ws-1/note")).toBe("hello world");

    const fetched = await bucket.get("note");
    expect(fetched.value).toBe("hello world");

    await bucket.delete("note");
    expect(kv.stored.has("kv/ws-1/note")).toBe(false);
  });

  it("throws when binding is missing", () => {
    const storage = createAppStorage({
      buckets: { "app:missing": { base_path: "missing/{id}/" } },
    });
    expect(() => storage.bucket("app:missing")).toThrow(AppStorageError);
  });
});
