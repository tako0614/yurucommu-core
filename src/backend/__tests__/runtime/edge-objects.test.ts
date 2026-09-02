import { describe, expect, test } from "bun:test";

import type {
  Blob as CfBlob,
  Headers as CfHeaders,
  ReadableStream as CfReadableStream,
  R2ObjectBody,
} from "@cloudflare/workers-types";

import {
  EdgeObjectsShapeError,
  wrapEdgeObjects,
  wrapEdgeObjectsAsBucket,
} from "../../runtime/edge-objects.ts";
import type { EdgeR2ObjectBody } from "../../runtime/edge-objects.ts";
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
      const found = store.get(key);
      if (!found) return null;
      // The wire's `get` answer carries NO `uploadedAtMillis`: both Takoserver
      // wrapper backends build it from `{etag, size, contentType?}` and stop
      // (`selfhost-worker-wrapper.ts` `portable.get`,
      // `cloudflare-managed-worker-wrapper.ts` `copyObjectGetMetadata`). Only
      // `head` and `list` carry the upload time.
      const { uploadedAtMillis: _dropped, ...whole } = metadata(key);
      const requested = options?.range;
      if (!requested) {
        return {
          ...whole,
          body: new Response(found.bytes as unknown as BodyInit).body!,
          partial: false,
        };
      }
      const offset = requested.offset;
      const length = Math.min(
        requested.length ?? found.bytes.byteLength,
        found.bytes.byteLength - offset,
      );
      return {
        ...whole,
        body: new Response(
          found.bytes.subarray(offset, offset + length) as unknown as BodyInit,
        ).body!,
        partial: true,
        range: { offset, length },
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
        objects: page.map((key) => {
          // The wire's `list` entry is `{key, etag, size, uploadedAtMillis?}`:
          // the wrapper's `projected` record never copies a content type.
          const { contentType: _dropped, ...entry } = metadata(key);
          return { key, ...entry };
        }),
        prefixes: options?.delimiter ? ["uploads/"] : [],
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
    expect(object!.httpEtag).toBe('"uploads/a.png-etag"');
    expect(object!.contentType).toBe("image/png");
    expect(object!.byteLength).toBe(bytes.byteLength);
    expect(await textOf(object)).toBe("image-bytes");
  });

  test("carries the header-safe etag beside the Host's verbatim one", async () => {
    // The self-host wrapper sends a BARE hex digest. `etag` keeps it, because
    // it is the Host's own identity for those bytes; `httpEtag` is the quoted
    // entity-tag a response may actually emit (RFC 9110 §8.8.3). Serving the
    // bare one is defect O-8.
    const facade = createFakeEdgeObjects();
    const media = wrapEdgeObjects(facade);
    await media.put("uploads/a.png", "v");
    const verbatim = facade.get;
    facade.get = async function (key, options) {
      const found = await verbatim.call(facade, key, options);
      return found === null ? null : { ...found, etag: "ebf4f635" };
    } as EdgeObjectsBinding["get"];

    const object = (await media.get("uploads/a.png"))!;
    expect(object.etag).toBe("ebf4f635");
    expect(object.httpEtag).toBe('"ebf4f635"');
    await object.body?.cancel();
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

// --- R2 parity -------------------------------------------------------------
// The Interface's promise is that an app written against R2 ports over
// unchanged. The CALLS always matched; the RESULTS did not, and a self-host
// end-to-end run caught it: `o.text is not a function` on an object the Host
// had just served. These tests pin the members and the semantics that close it.

/**
 * Application code written against R2, expressed once and applied to both.
 *
 * The three platform classes are type parameters because this repo type-checks
 * against the DOM lib while `@cloudflare/workers-types` declares its own copies
 * of `ReadableStream`, `Headers` and `Blob`. Inside a Worker they are the same
 * classes; the split is an artefact of building for Bun as well.
 */
interface R2ReadParity<TStream, THeaders, TBlob> {
  readonly key: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly uploaded: Date | undefined;
  readonly httpMetadata?: { readonly contentType?: string };
  readonly body: TStream;
  readonly bodyUsed: boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<TBlob>;
  writeHttpMetadata(headers: THeaders): void;
}

/** Fails to compile unless `T` satisfies `U`. */
type AssertSatisfies<T extends U, U> = T;

// A native `R2ObjectBody` satisfies it...
type _NativeR2Satisfies = AssertSatisfies<
  R2ObjectBody,
  R2ReadParity<CfReadableStream, CfHeaders, CfBlob>
>;
// ...and so does what the facade answers with. Same members, same types: the
// function below is written once and type-checks for either host.
type _FacadeSatisfies = AssertSatisfies<
  EdgeR2ObjectBody,
  R2ReadParity<ReadableStream<Uint8Array>, Headers, Blob>
>;

/** The R2-shaped app code itself, which now runs against the facade. */
async function serveObject(
  object: R2ReadParity<ReadableStream<Uint8Array>, Headers, Blob>,
): Promise<{ headers: Record<string, string>; body: string; etag: string }> {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("content-length", String(object.size));
  if (object.uploaded)
    headers.set("last-modified", object.uploaded.toUTCString());
  return {
    headers: Object.fromEntries(headers.entries()),
    body: await object.text(),
    etag: object.etag,
  };
}

describe("edge.objects as an R2-shaped bucket", () => {
  test("round-trips bytes through every R2 body helper", async () => {
    const facade = createFakeEdgeObjects();
    const bucket = wrapEdgeObjectsAsBucket(facade);
    const payload = { hello: "世界", n: 7 };
    await bucket.put("uploads/a.json", JSON.stringify(payload), {
      contentType: "application/json",
    });

    expect(await (await bucket.get("uploads/a.json"))!.text()).toBe(
      JSON.stringify(payload),
    );
    expect(
      await (await bucket.get("uploads/a.json"))!.json<typeof payload>(),
    ).toEqual(payload);
    const buffer = await (await bucket.get("uploads/a.json"))!.arrayBuffer();
    expect(new TextDecoder().decode(buffer)).toBe(JSON.stringify(payload));
    const blob = await (await bucket.get("uploads/a.json"))!.blob();
    expect(await blob.text()).toBe(JSON.stringify(payload));
    // `bytes()` is declared on `R2ObjectBody` in the workers-types this repo
    // installs, so parity owes it too.
    const bytes = await (await bucket.get("uploads/a.json"))!.bytes();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(new TextDecoder().decode(bytes)).toBe(JSON.stringify(payload));
    // And the stream is still there for a caller that wants to pipe it.
    const streamed = await bucket.get("uploads/a.json");
    expect(await new Response(streamed!.body).text()).toBe(
      JSON.stringify(payload),
    );
  });

  test("carries R2's metadata members on a get", async () => {
    const facade = createFakeEdgeObjects();
    const bucket = wrapEdgeObjectsAsBucket(facade);
    await bucket.put("uploads/a.png", "image-bytes", {
      contentType: "image/png",
    });

    const object = (await bucket.get("uploads/a.png"))!;
    expect(object.key).toBe("uploads/a.png");
    expect(object.size).toBe("image-bytes".length);
    expect(object.etag).toBe('"uploads/a.png-etag"');
    expect(object.httpMetadata).toEqual({ contentType: "image/png" });
    // ADR 0005 gives the Interface no custom metadata at all, so the honest
    // answer is a present member that is always absent.
    expect(object.customMetadata).toBeUndefined();
    expect(object.range).toBeUndefined();
  });

  test("quotes the httpEtag, and leaves an already-quoted one alone", async () => {
    // The value is opaque and its quoting differs by backend: the self-host
    // wrapper sends a bare hex digest, the managed one forwards R2's quoted
    // httpEtag. `etag` stays verbatim because that is what a conditional
    // request has to echo; `httpEtag` is always the header-safe spelling.
    const facade = createFakeEdgeObjects();
    const bucket = wrapEdgeObjectsAsBucket(facade);
    await bucket.put("k", "v");
    const quoted = (await bucket.get("k"))!;
    expect(quoted.etag).toBe('"k-etag"');
    expect(quoted.httpEtag).toBe('"k-etag"');

    const bare = facade.get;
    facade.get = async function (key, options) {
      const found = await bare.call(facade, key, options);
      return found === null ? null : { ...found, etag: "9a0f2c" };
    } as EdgeObjectsBinding["get"];
    const unquoted = (await bucket.get("k"))!;
    expect(unquoted.etag).toBe("9a0f2c");
    expect(unquoted.httpEtag).toBe('"9a0f2c"');
  });

  test("consumes the body exactly once, the way R2 does", async () => {
    const facade = createFakeEdgeObjects();
    const bucket = wrapEdgeObjectsAsBucket(facade);
    await bucket.put("k", "once");

    const object = (await bucket.get("k"))!;
    expect(object.bodyUsed).toBe(false);
    expect(await object.text()).toBe("once");
    expect(object.bodyUsed).toBe(true);
    // R2 REJECTS a second read rather than replaying a cached value, so this
    // facade must too — an app that relied on either behaviour would otherwise
    // work on one host and not the other.
    await expect(object.text()).rejects.toThrow(TypeError);
    await expect(object.arrayBuffer()).rejects.toThrow(TypeError);
    await expect(object.bytes()).rejects.toThrow(TypeError);

    // Reading the stream directly marks the object used as well.
    const streamed = (await bucket.get("k"))!;
    expect(streamed.bodyUsed).toBe(false);
    await new Response(streamed.body).text();
    expect(streamed.bodyUsed).toBe(true);
    await expect(streamed.text()).rejects.toThrow(TypeError);
  });

  test("writeHttpMetadata writes what the object carries and nothing else", async () => {
    const facade = createFakeEdgeObjects();
    const bucket = wrapEdgeObjectsAsBucket(facade);
    await bucket.put("typed", "v", { contentType: "image/webp" });
    await bucket.put("untyped", "v");

    const typed = new Headers({ "cache-control": "public" });
    (await bucket.get("typed"))!.writeHttpMetadata(typed);
    expect(typed.get("content-type")).toBe("image/webp");
    expect(typed.get("cache-control")).toBe("public");

    // An object stored without a content type leaves the caller's headers
    // alone, exactly as R2 does with an empty httpMetadata.
    const untyped = new Headers({ "content-type": "text/plain" });
    (await bucket.get("untyped"))!.writeHttpMetadata(untyped);
    expect(untyped.get("content-type")).toBe("text/plain");
  });

  test("reports the upload time where the wire carries one, and never invents it", async () => {
    const facade = createFakeEdgeObjects();
    const bucket = wrapEdgeObjectsAsBucket(facade);
    const stored = await bucket.put("uploads/a.png", "v", {
      contentType: "image/png",
    });

    // `head` and `list` carry `uploadedAtMillis`; `get` and `put` do not,
    // because both wrapper backends drop it building their answer.
    const head = (await bucket.head("uploads/a.png"))!;
    expect(head.uploaded).toEqual(new Date(1_700_000_000_000));
    expect(head.httpMetadata).toEqual({ contentType: "image/png" });
    expect(head.key).toBe("uploads/a.png");
    const [listed] = (await bucket.list({ prefix: "uploads/" })).objects;
    expect(listed!.uploaded).toEqual(new Date(1_700_000_000_000));

    expect((await bucket.get("uploads/a.png"))!.uploaded).toBeUndefined();
    expect(stored.uploaded).toBeUndefined();
    // `put` still answers with the identity the Host minted.
    expect(stored.key).toBe("uploads/a.png");
    expect(stored.etag).toBe('"uploads/a.png-etag"');
    expect(stored.size).toBe(1);
  });

  test("answers a missing key with null on both head and get", async () => {
    const bucket = wrapEdgeObjectsAsBucket(createFakeEdgeObjects());
    expect(await bucket.head("absent")).toBeNull();
    expect(await bucket.get("absent")).toBeNull();
  });

  test("keeps the range the Host served, and refuses a partial one nobody asked for", async () => {
    const facade = createFakeEdgeObjects();
    const bucket = wrapEdgeObjectsAsBucket(facade);
    await bucket.put("k", "0123456789");

    const ranged = (await bucket.get("k", {
      range: { offset: 2, length: 3 },
    }))!;
    expect(ranged.range).toEqual({ offset: 2, length: 3 });
    expect(await ranged.text()).toBe("234");

    // Unranged, a partial body would be a truncated object served as a whole
    // one, so the bytes are dropped instead.
    await expect(bucket.get("k")).resolves.not.toBeNull();
    const whole = facade.get;
    facade.get = async function (key, options) {
      const found = await whole.call(facade, key, options);
      return found === null ? null : { ...found, partial: true };
    } as EdgeObjectsBinding["get"];
    await expect(bucket.get("k")).rejects.toThrow(EdgeObjectsShapeError);
  });

  test("lists under R2's names", async () => {
    const facade = createFakeEdgeObjects();
    const bucket = wrapEdgeObjectsAsBucket(facade);
    for (const key of ["uploads/a", "uploads/b"]) await bucket.put(key, key);

    const page = await bucket.list({ prefix: "uploads/", limit: 1 });
    expect(page.objects.map((entry) => entry.key)).toEqual(["uploads/a"]);
    expect(page.truncated).toBe(true);
    expect(page.cursor).toBe("1");
    // The facade calls them `prefixes`; R2 calls them `delimitedPrefixes`.
    expect((await bucket.list({ delimiter: "/" })).delimitedPrefixes).toEqual([
      "uploads/",
    ]);
  });

  test("R2-shaped application code runs against the facade unchanged", async () => {
    const facade = createFakeEdgeObjects();
    const bucket = wrapEdgeObjectsAsBucket(facade);
    await bucket.put("uploads/a.png", "image-bytes", {
      contentType: "image/png",
    });

    // `serveObject` is typed against the R2 contract a native `R2ObjectBody`
    // also satisfies (see `_NativeR2Satisfies` above) and was not adapted.
    const served = await serveObject((await bucket.get("uploads/a.png"))!);
    expect(served.body).toBe("image-bytes");
    expect(served.etag).toBe('"uploads/a.png-etag"');
    expect(served.headers["content-type"]).toBe("image/png");
    expect(served.headers["content-length"]).toBe("11");
    // No `last-modified`: a `get` answer has no upload time to name.
    expect(served.headers["last-modified"]).toBeUndefined();
  });
});
