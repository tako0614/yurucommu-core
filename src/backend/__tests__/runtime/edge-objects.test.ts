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
 * `contentType` and `contentLength` only, no `customMetadata`, one key per
 * `delete`, and a `list` page of `{objects, prefixes, truncated, cursor?}`.
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
  test("stores bytes with a content type and reads them back", async () => {
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);

    const bytes = new TextEncoder().encode("image-bytes");
    await media.put("uploads/a.png", bytes.buffer as ArrayBuffer, {
      httpMetadata: { contentType: "image/png" },
    });
    expect(facade.puts.at(-1)!.options).toEqual({ contentType: "image/png" });

    const object = await media.get("uploads/a.png");
    expect(object).not.toBeNull();
    expect(object!.httpEtag).toBe('"uploads/a.png-etag"');
    expect(object!.httpMetadata?.contentType).toBe("image/png");
    expect(await object!.text()).toBe("image-bytes");
  });

  test("forwards a declared contentLength so a stream is not buffered", async () => {
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    const payload = new TextEncoder().encode("video-bytes");

    await media.put(
      "uploads/a.mp4",
      new Response(payload as unknown as BodyInit).body!,
      {
        httpMetadata: { contentType: "video/mp4" },
        contentLength: payload.byteLength,
      },
    );
    expect(facade.puts.at(-1)).toMatchObject({
      streamed: true,
      options: { contentLength: payload.byteLength, contentType: "video/mp4" },
    });
    expect(await (await media.get("uploads/a.mp4"))!.text()).toBe(
      "video-bytes",
    );
  });

  test("buffers a stream that arrives with no declared length", async () => {
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
    expect(await (await media.get("uploads/b.mp4"))!.text()).toBe("no-length");
  });

  test("refuses customMetadata instead of dropping it", async () => {
    const media = wrapEdgeObjects(createFakeEdgeObjects());
    await expect(
      media.put("k", "v", { customMetadata: { owner: "a1" } }),
    ).rejects.toThrow(EdgeObjectsShapeError);
    // An empty record is not a request to store anything.
    await expect(media.put("k", "v", { customMetadata: {} })).resolves.toBe(
      undefined,
    );
  });

  test("answers a missing key with null on get and head", async () => {
    const media = wrapEdgeObjects(createFakeEdgeObjects());
    expect(await media.get("absent")).toBeNull();
    expect(await media.head("absent")).toBeNull();
  });

  test("reports head metadata in the port's shape", async () => {
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    await media.put("k", "12345", {
      httpMetadata: { contentType: "text/plain" },
    });
    expect(await media.head("k")).toEqual({
      contentType: "text/plain",
      contentLength: 5,
      etag: '"k-etag"',
      httpMetadata: { contentType: "text/plain" },
    });
  });

  test("deletes each key of an array, since the facade takes one at a time", async () => {
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    for (const key of ["a", "b", "c"]) await media.put(key, key);
    await media.delete(["a", "c"]);
    expect(facade.deletes).toEqual(["a", "c"]);
    expect([...facade.store.keys()]).toEqual(["b"]);
  });

  test("lists with prefix and limit and reports truncation", async () => {
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    for (const key of ["u/1", "u/2", "u/3", "other"]) await media.put(key, key);

    const page = await media.list({ prefix: "u/", limit: 2 });
    expect(page.objects.map((object) => object.key)).toEqual(["u/1", "u/2"]);
    expect(page.truncated).toBe(true);
    expect(page.cursor).toBe("2");
    expect(page.objects[0]!.uploaded).toEqual(new Date(1_700_000_000_000));

    const rest = await media.list({ prefix: "u/" });
    expect(rest.truncated).toBe(false);
    expect(rest.cursor).toBeUndefined();
  });
});
