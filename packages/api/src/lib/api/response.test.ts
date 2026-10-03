import { expect, test } from "bun:test";
import { assertOk, apiFetch } from "./fetch.ts";
import { readResponseJson, InvalidApiResponseError } from "./response.ts";
import { fetchDMUnreadCount } from "./dm.ts";
import { clearYurucommuApiTransport } from "../transport.ts";

async function mockResponse(run: () => Promise<void>, response: Response) {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => response) as unknown as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
    clearYurucommuApiTransport();
  }
}

test("successful malformed JSON and non-object bodies are invalid read outcomes", async () => {
  for (const body of ["broken", "null", "[]", "42"]) {
    await expect(readResponseJson(new Response(body))).rejects.toBeInstanceOf(
      InvalidApiResponseError,
    );
  }
});

test("error JSON fallback preserves HTTP authority, but reader failures propagate", async () => {
  await expect(
    assertOk(new Response("broken", { status: 503 }), "retry later"),
  ).rejects.toMatchObject({
    name: "ApiError",
    status: 503,
    message: "retry later",
  });
  const failure = new TypeError("connection dropped while reading");
  for (const status of [200, 503]) {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(failure);
        },
      }),
      { status },
    );
    await expect(
      status === 200
        ? readResponseJson(response)
        : assertOk(response, "fallback"),
    ).rejects.toBe(failure);
  }
});

test("error body parsing preserves primitive caller abort reasons", async () => {
  const caller = new AbortController();
  const reason = "view left";
  await mockResponse(
    async () => {
      const response = await apiFetch("/api/test", {
        signal: caller.signal,
        timeoutMs: 20,
      });
      caller.abort(reason);
      await expect(assertOk(response, "fallback")).rejects.toBe(reason);
    },
    Response.json({ error: "server failure" }, { status: 503 }),
  );
});

test("typed reads pass cancellation controls through before any network request", async () => {
  const caller = new AbortController();
  caller.abort("obsolete read");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    return Response.json({ total: 0, dm: 0, community: 0 });
  }) as unknown as typeof fetch;
  try {
    await expect(
      fetchDMUnreadCount({ signal: caller.signal, timeoutMs: 20 }),
    ).rejects.toBe("obsolete read");
    expect(calls).toBe(0);
  } finally {
    globalThis.fetch = original;
    clearYurucommuApiTransport();
  }
});

test("legacy nullable publication timestamps are preserved on valid read pages", async () => {
  const { fetchTimeline } = await import("./posts.ts");
  const post = {
    ap_id: "https://example.com/posts/1",
    author: { ap_id: "https://example.com/users/a" },
    content: "old object",
    published: null,
  };
  await mockResponse(
    async () => {
      expect((await fetchTimeline()).posts[0].published).toBeNull();
    },
    Response.json({ posts: [post] }),
  );
  await mockResponse(
    async () => {
      await expect(fetchTimeline()).rejects.toBeInstanceOf(
        InvalidApiResponseError,
      );
    },
    Response.json({ posts: [{ ...post, published: 42 }] }),
  );
});

test("legacy nullable message timestamps survive DM and community hydration", async () => {
  const { fetchUserDMMessages } = await import("./dm.ts");
  const { fetchCommunityMessages } = await import("./communities.ts");
  const message = {
    id: "m1",
    sender: { ap_id: "https://example.com/users/a" },
    content: "old object",
    created_at: null,
  };
  for (const load of [
    () => fetchUserDMMessages("a"),
    () => fetchCommunityMessages("g"),
  ]) {
    await mockResponse(
      async () => {
        expect((await load()).messages[0].created_at).toBeNull();
      },
      Response.json({ messages: [message] }),
    );
    await mockResponse(
      async () => {
        await expect(load()).rejects.toBeInstanceOf(InvalidApiResponseError);
      },
      Response.json({ messages: [{ ...message, created_at: 42 }] }),
    );
  }
});

test("body-origin SyntaxError remains a transport error rather than JSON fallback", async () => {
  const failure = new SyntaxError("stream decoder failed");
  for (const status of [200, 503]) {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.error(failure);
        },
      }),
      { status },
    );
    await expect(
      status === 200
        ? readResponseJson(response)
        : assertOk(response, "fallback"),
    ).rejects.toBe(failure);
  }
});
