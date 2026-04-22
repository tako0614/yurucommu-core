import { assertEquals } from "jsr:@std/assert";
import { clearYurucommuFrontendPlugin } from "../plugin.ts";
import type { Post } from "../../types/index.ts";
import { createPost, fetchBookmarks } from "./posts.ts";

function makePost(overrides: Partial<Post> = {}): Post {
  return {
    ap_id: "https://example.com/ap/objects/post-1",
    type: "Note",
    author: {
      ap_id: "https://example.com/ap/users/alice",
      username: "alice@example.com",
      preferred_username: "alice",
      name: "Alice",
      icon_url: null,
    },
    content: "hello",
    summary: null,
    attachments: [],
    in_reply_to: null,
    visibility: "public",
    community_ap_id: null,
    like_count: 0,
    reply_count: 0,
    announce_count: 0,
    published: "2026-01-01T00:00:00.000Z",
    liked: false,
    bookmarked: false,
    reposted: false,
    ...overrides,
  };
}

async function withMockFetch<T>(
  responseBody: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const originalFetch = globalThis.fetch;
  clearYurucommuFrontendPlugin();
  globalThis.fetch = ((_input: RequestInfo | URL, _init?: RequestInit) => {
    return Promise.resolve(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;

  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuFrontendPlugin();
  }
}

Deno.test("createPost accepts legacy raw post response", async () => {
  const post = makePost();

  const result = await withMockFetch(
    post,
    () => createPost({ content: "hello" }),
  );

  assertEquals(result.ap_id, post.ap_id);
});

Deno.test("fetchBookmarks accepts legacy bookmarks response", async () => {
  const post = makePost({ bookmarked: true });

  const result = await withMockFetch(
    { bookmarks: [post] },
    () => fetchBookmarks(),
  );

  assertEquals(result.map((p) => p.ap_id), [post.ap_id]);
});
