import { assertEquals } from "#test/assert";
import { test } from "bun:test";
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
    edited_at: null,
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

test("createPost reads the current wrapped post response", async () => {
  const post = makePost();

  const result = await withMockFetch({ post }, () =>
    createPost({ content: "hello" }),
  );

  assertEquals(result.ap_id, post.ap_id);
});

test("fetchBookmarks reads the current posts response", async () => {
  const post = makePost({ bookmarked: true });

  const result = await withMockFetch({ posts: [post] }, () => fetchBookmarks());

  assertEquals(
    result.map((p) => p.ap_id),
    [post.ap_id],
  );
});
