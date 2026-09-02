import { describe, expect, test } from "bun:test";

import {
  EdgeKeyValueOptionError,
  EdgeKeyValueValueError,
  resolveEdgeKvExpirationTtl,
  wrapEdgeKv,
} from "../../runtime/edge-kv.ts";
import type {
  EdgeKvBinding,
  EdgeKvListOptions,
  EdgeKvListResult,
  EdgeKvPutOptions,
} from "../../runtime/edge-facades.ts";

interface Entry {
  readonly bytes: Uint8Array;
  readonly metadata?: Record<string, string>;
  readonly expirationTtlSeconds?: number;
}

/**
 * A stand-in that answers exactly like the Host: bytes out of `get`, a single
 * `expirationTtlSeconds` on `put`, and a listing whose entries carry the NAME
 * ONLY under a camelCase `listComplete`.
 */
function createFakeEdgeKv(): EdgeKvBinding & {
  readonly store: Map<string, Entry>;
  readonly puts: { key: string; options?: EdgeKvPutOptions }[];
  readonly lists: (EdgeKvListOptions | undefined)[];
} {
  const store = new Map<string, Entry>();
  const puts: { key: string; options?: EdgeKvPutOptions }[] = [];
  const lists: (EdgeKvListOptions | undefined)[] = [];
  const encoder = new TextEncoder();

  const asBytes = (
    value: string | ArrayBuffer | ArrayBufferView,
  ): Uint8Array => {
    if (typeof value === "string") return encoder.encode(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  };

  const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;

  return {
    store,
    puts,
    lists,
    get: async (key) => {
      const entry = store.get(key);
      return entry ? toArrayBuffer(entry.bytes) : null;
    },
    getWithMetadata: async (key) => {
      const entry = store.get(key);
      if (!entry) return null;
      return entry.metadata === undefined
        ? { value: toArrayBuffer(entry.bytes) }
        : { value: toArrayBuffer(entry.bytes), metadata: entry.metadata };
    },
    put: async (key, value, options) => {
      puts.push({ key, options });
      store.set(key, {
        bytes: asBytes(value),
        metadata: options?.metadata,
        expirationTtlSeconds: options?.expirationTtlSeconds,
      });
    },
    delete: async (key) => {
      store.delete(key);
    },
    list: async (options): Promise<EdgeKvListResult> => {
      lists.push(options);
      const names = [...store.keys()]
        .filter((name) => !options?.prefix || name.startsWith(options.prefix))
        .sort();
      const start = options?.cursor ? Number(options.cursor) : 0;
      const limit = options?.limit ?? names.length;
      const page = names.slice(start, start + limit);
      const complete = start + limit >= names.length;
      return {
        keys: page.map((name) => ({ name })),
        listComplete: complete,
        ...(complete ? {} : { cursor: String(start + limit) }),
      };
    },
  };
}

describe("edge.kv expiration mapping", () => {
  const now = () => 1_000_000;

  test("passes a relative TTL through", () => {
    expect(resolveEdgeKvExpirationTtl({ expirationTtl: 600 }, now)).toBe(600);
  });

  test("converts an absolute expiration into the remaining seconds", () => {
    expect(resolveEdgeKvExpirationTtl({ expiration: 1_000_900 }, now)).toBe(
      900,
    );
  });

  test("prefers the relative TTL when both are given, as Cloudflare does", () => {
    expect(
      resolveEdgeKvExpirationTtl(
        { expirationTtl: 120, expiration: 1_000_900 },
        now,
      ),
    ).toBe(120);
  });

  test("is absent when neither is given", () => {
    expect(resolveEdgeKvExpirationTtl(undefined, now)).toBeUndefined();
    expect(resolveEdgeKvExpirationTtl({}, now)).toBeUndefined();
  });

  test("refuses a deadline under the 60s floor both backends enforce", () => {
    expect(() =>
      resolveEdgeKvExpirationTtl({ expirationTtl: 30 }, now),
    ).toThrow(EdgeKeyValueOptionError);
    // An absolute instant that has almost arrived resolves the same way rather
    // than being clamped into a longer life than the caller asked for.
    expect(() =>
      resolveEdgeKvExpirationTtl({ expiration: 1_000_010 }, now),
    ).toThrow(/60s floor/);
  });

  test("refuses a deadline past the ten-year ceiling", () => {
    expect(() =>
      resolveEdgeKvExpirationTtl({ expirationTtl: 315_360_001 }, now),
    ).toThrow(EdgeKeyValueOptionError);
  });
});

describe("edge.kv store adapter", () => {
  test("reads bytes back as text, JSON, and an ArrayBuffer", async () => {
    const facade = createFakeEdgeKv();
    const kv = wrapEdgeKv(facade);

    await kv.put("plain", "hello");
    await kv.put("structured", JSON.stringify({ ok: true, count: 2 }));

    expect(await kv.get("plain")).toBe("hello");
    expect(
      await kv.get<{ ok: boolean; count: number }>("structured", {
        type: "json",
      }),
    ).toEqual({ ok: true, count: 2 });
    const buffer = await kv.get("plain", { type: "arrayBuffer" });
    expect(new TextDecoder().decode(buffer!)).toBe("hello");
  });

  test("answers a missing key with null on every read type", async () => {
    const kv = wrapEdgeKv(createFakeEdgeKv());
    expect(await kv.get("absent")).toBeNull();
    expect(await kv.get("absent", { type: "json" })).toBeNull();
    expect(await kv.get("absent", { type: "arrayBuffer" })).toBeNull();
  });

  test("distinguishes an unparseable entry from a missing one", async () => {
    const facade = createFakeEdgeKv();
    const kv = wrapEdgeKv(facade);
    await kv.put("poisoned", "not json");
    // Reporting this as `null` would be indistinguishable from "no such key".
    await expect(kv.get("poisoned", { type: "json" })).rejects.toThrow(
      EdgeKeyValueValueError,
    );
    expect(await kv.get("absent", { type: "json" })).toBeNull();
  });

  test("writes an ArrayBuffer and a stream body", async () => {
    const facade = createFakeEdgeKv();
    const kv = wrapEdgeKv(facade);

    await kv.put("buffer", new TextEncoder().encode("from-buffer").buffer);
    expect(await kv.get("buffer")).toBe("from-buffer");

    await kv.put(
      "stream",
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("from-"));
          controller.enqueue(new TextEncoder().encode("stream"));
          controller.close();
        },
      }),
    );
    expect(await kv.get("stream")).toBe("from-stream");
  });

  test("sends only the option keys the facade accepts", async () => {
    const facade = createFakeEdgeKv();
    const kv = wrapEdgeKv(facade, () => 1_000_000);

    await kv.put("a", "1", { expirationTtl: 600, metadata: { kind: "state" } });
    expect(facade.puts.at(-1)!.options).toEqual({
      expirationTtlSeconds: 600,
      metadata: { kind: "state" },
    });

    await kv.put("b", "2");
    expect(facade.puts.at(-1)!.options).toEqual({});

    await kv.put("c", "3", { expiration: 1_000_600 });
    expect(facade.puts.at(-1)!.options).toEqual({ expirationTtlSeconds: 600 });
  });

  test("refuses metadata the facade cannot store instead of stringifying it", async () => {
    const kv = wrapEdgeKv(createFakeEdgeKv());
    await expect(
      kv.put("a", "1", { metadata: { attempts: 3 } }),
    ).rejects.toThrow(EdgeKeyValueOptionError);
  });

  test("deletes a key", async () => {
    const facade = createFakeEdgeKv();
    const kv = wrapEdgeKv(facade);
    await kv.put("gone", "x");
    await kv.delete("gone");
    expect(await kv.get("gone")).toBeNull();
  });

  test("lists with prefix, limit, and cursor in the shape the app expects", async () => {
    const facade = createFakeEdgeKv();
    const kv = wrapEdgeKv(facade);
    for (const key of ["s:1", "s:2", "s:3", "other"]) await kv.put(key, "x");

    const first = await kv.list({ prefix: "s:", limit: 2 });
    expect(first.keys.map((key) => key.name)).toEqual(["s:1", "s:2"]);
    expect(first.list_complete).toBe(false);
    expect(first.cursor).toBe("2");
    // The facade's option names went out unchanged.
    expect(facade.lists.at(-1)).toEqual({ prefix: "s:", limit: 2 });

    const second = await kv.list({
      prefix: "s:",
      limit: 2,
      cursor: first.cursor,
    });
    expect(second.keys.map((key) => key.name)).toEqual(["s:3"]);
    expect(second.list_complete).toBe(true);
    expect(second.cursor).toBeUndefined();
  });

  test("reports no expiration or metadata on a listing, because the Host sends none", async () => {
    const facade = createFakeEdgeKv();
    const kv = wrapEdgeKv(facade);
    await kv.put("k", "v", {
      expirationTtl: 600,
      metadata: { kind: "state" },
    });
    const listed = await kv.list();
    expect(listed.keys).toEqual([{ name: "k" }]);
    // The value and its metadata are still there — only the LISTING omits them.
    expect(await facade.getWithMetadata("k")).toMatchObject({
      metadata: { kind: "state" },
    });
  });
});
