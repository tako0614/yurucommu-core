import { describe, expect, test } from "bun:test";

import {
  EdgeObjectsShapeError,
  wrapEdgeObjects,
} from "../../runtime/edge-objects.ts";
import type { EdgeObjectsBinding } from "../../runtime/edge-facades.ts";

interface StoredObject {
  readonly bytes: Uint8Array;
  readonly contentType?: string;
  readonly uploadedAtMillis: number;
}

/**
 * A stand-in that keeps the facade's fixed arities and its narrow option set:
 * `contentType` and `contentLength` only, one key per `delete`, and a `list`
 * page of `{objects, prefixes, truncated, cursor?}`. `head` and `list` stay on
 * the fake because the Host projects them, even though the provider-neutral
 * ObjectStore the adapter implements no longer carries either.
 */
function createFakeEdgeObjects(): EdgeObjectsBinding & {
  readonly store: Map<string, StoredObject>;
  readonly puts: {
    key: string;
    streamed: boolean;
    options: { contentLength?: number; contentType?: string } | undefined;
  }[];
  readonly deletes: string[];
} {
  const store = new Map<string, StoredObject>();
  const puts: {
    key: string;
    streamed: boolean;
    options: { contentLength?: number; contentType?: string } | undefined;
  }[] = [];
  const deletes: string[] = [];

  const metadata = (key: string) => {
    const found = store.get(key)!;
    return {
      etag: `"${key}-etag"`,
      size: found.bytes.byteLength,
      ...(found.contentType === undefined
        ? {}
        : { contentType: found.contentType }),
      uploadedAtMillis: found.uploadedAtMillis,
    };
  };

  return {
    store,
    puts,
    deletes,
    head: async function (key) {
      // eslint-disable-next-line prefer-rest-params
      expect(arguments.length).toBe(1);
      return store.has(key) ? metadata(key) : null;
    },
    get: async function (key, options) {
      expect(arguments.length).toBe(2);
      expect(options).toBeUndefined();
      const found = store.get(key);
      if (!found) return null;
      return {
        ...metadata(key),
        body: new Response(found.bytes as unknown as BodyInit).body!,
        partial: false,
      };
    },
    put: async function (key, body, options) {
      expect(arguments.length).toBe(3);
      const streamed =
        typeof body !== "string" && !(body instanceof ArrayBuffer);
      if (
        body instanceof ReadableStream &&
        options?.contentLength === undefined
      ) {
        const error = new Error("invalid_body");
        error.name = "invalid_body";
        throw error;
      }
      puts.push({ key, streamed, options });
      const bytes =
        typeof body === "string"
          ? new TextEncoder().encode(body)
          : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : body instanceof ReadableStream
              ? new Uint8Array(await new Response(body).arrayBuffer())
              : new Uint8Array(
                  (body as ArrayBufferView).buffer.slice(
                    (body as ArrayBufferView).byteOffset,
                    (body as ArrayBufferView).byteOffset +
                      (body as ArrayBufferView).byteLength,
                  ),
                );
      store.set(key, {
        bytes,
        contentType: options?.contentType,
        uploadedAtMillis: 1_700_000_000_000,
      });
      return { etag: `"${key}-etag"`, size: bytes.byteLength };
    },
    delete: async function (key) {
      expect(arguments.length).toBe(1);
      deletes.push(key);
      store.delete(key);
    },
    list: async function (options) {
      expect(arguments.length).toBe(1);
      const keys = [...store.keys()]
        .filter((key) => !options?.prefix || key.startsWith(options.prefix))
        .sort();
      const limit = options?.limit ?? keys.length;
      const page = keys.slice(0, limit);
      return {
        objects: page.map((key) => ({ key, ...metadata(key) })),
        prefixes: [],
        truncated: page.length < keys.length,
        ...(page.length < keys.length ? { cursor: String(limit) } : {}),
      };
    },
  };
}

describe("edge.objects storage adapter", () => {
  const textOf = async (object: { body: ReadableStream | null } | null) =>
    await new Response(object!.body).text();

  test("stores bytes with a content type and reads them back", async () => {
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);

    const bytes = new TextEncoder().encode("image-bytes");
    await media.put("uploads/a.png", bytes.buffer as ArrayBuffer, {
      contentType: "image/png",
    });
    expect(facade.puts.at(-1)!.options).toEqual({
      contentLength: bytes.byteLength,
      contentType: "image/png",
    });

    const object = await media.get("uploads/a.png");
    expect(object).not.toBeNull();
    expect(object!.key).toBe("uploads/a.png");
    expect(object!.etag).toBe('"uploads/a.png-etag"');
    expect(object!.contentType).toBe("image/png");
    expect(object!.byteLength).toBe(bytes.byteLength);
    expect(await textOf(object)).toBe("image-bytes");
  });

  test("declares a string body's UTF-8 length rather than its character count", async () => {
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    await media.put("k", "日本語");
    expect(facade.puts.at(-1)!.options).toEqual({ contentLength: 9 });
  });

  test("streams a Blob under its known size instead of buffering it", async () => {
    // This is the media upload path: a video arrives as a `File`, which is a
    // Blob, so its length is known without reading a byte of it.
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    const payload = new TextEncoder().encode("video-bytes");
    const file = new Blob([payload as unknown as BlobPart], {
      type: "video/mp4",
    });

    await media.put("uploads/a.mp4", file, { contentType: "video/mp4" });
    expect(facade.puts.at(-1)).toMatchObject({
      streamed: true,
      options: { contentLength: payload.byteLength, contentType: "video/mp4" },
    });
    expect(await textOf(await media.get("uploads/a.mp4"))).toBe("video-bytes");
  });

  test("buffers a stream that arrives with no knowable length", async () => {
    // The Host will not discover the size, so the adapter has to, and it must
    // then declare it rather than passing the stream on undeclared.
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    await media.put(
      "uploads/b.mp4",
      new Response(new TextEncoder().encode("no-length") as unknown as BodyInit)
        .body!,
    );
    expect(facade.puts.at(-1)!.options).toEqual({ contentLength: 9 });
    expect(facade.puts.at(-1)!.streamed).toBe(true);
    expect(await textOf(await media.get("uploads/b.mp4"))).toBe("no-length");
  });

  test("refuses a partial body for a get that asked for no range", async () => {
    // A truncated body served as a whole object would be a silent corruption,
    // so the adapter refuses it and drops the bytes.
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    await media.put("k", "12345");
    const whole = facade.get;
    let cancelled = false;
    facade.get = async function (key, options) {
      const found = await whole.call(facade, key, options);
      if (!found) return null;
      return {
        ...found,
        partial: true,
        // Left open on purpose: `cancel` only reaches an unfinished stream,
        // and the point of the test is that the bytes are dropped.
        body: new ReadableStream({
          cancel: () => {
            cancelled = true;
          },
        }),
      };
    } as EdgeObjectsBinding["get"];

    await expect(media.get("k")).rejects.toThrow(EdgeObjectsShapeError);
    expect(cancelled).toBe(true);
  });

  test("answers a missing key with null", async () => {
    const media = wrapEdgeObjects(createFakeEdgeObjects());
    expect(await media.get("absent")).toBeNull();
  });

  test("deletes each key of an array, since the facade takes one at a time", async () => {
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    for (const key of ["a", "b", "c"]) await media.put(key, key);
    await media.delete(["a", "c", "a"]);
    // Deduplicated: a repeated key is one call, not two.
    expect(facade.deletes).toEqual(["a", "c"]);
    expect([...facade.store.keys()]).toEqual(["b"]);
  });
});
