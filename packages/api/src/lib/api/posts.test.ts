import { expect, test } from "bun:test";
import { clearYurucommuApiTransport } from "../transport.ts";
import type { Post } from "../../types/index.ts";
import { createPost, fetchBookmarks, fetchTimeline } from "./posts.ts";
import { withMockJsonFetch } from "./test-helpers.ts";

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

test("createPost reads the current wrapped post response", async () => {
  const post = makePost();

  const result = await withMockJsonFetch({ post }, () =>
    createPost({ content: "hello" }),
  );

  expect(result.ap_id).toBe(post.ap_id);
});

test("fetchBookmarks reads the posts + pagination fields", async () => {
  const post = makePost({ bookmarked: true });

  const result = await withMockJsonFetch(
    { posts: [post], has_more: true, next_cursor: "c1" },
    () => fetchBookmarks(),
  );

  expect(result.posts.map((p) => p.ap_id)).toEqual([post.ap_id]);
  expect(result.hasMore).toBe(true);
  expect(result.nextCursor).toBe("c1");
});

test("fetchBookmarks surfaces authentication and server failures", async () => {
  const originalFetch = globalThis.fetch;
  clearYurucommuApiTransport();
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({ error: "session expired" }, { status: 401 }),
    )) as unknown as typeof fetch;

  try {
    expect(fetchBookmarks()).rejects.toMatchObject({
      name: "ApiError",
      status: 401,
      message: "session expired",
    });
  } finally {
    globalThis.fetch = originalFetch;
    clearYurucommuApiTransport();
  }
});

// Regression: the timeline client must SURFACE the server's composite cursor (so
// loadMore can echo it back as `before`). It was discarding `next_cursor` and
// paginating with a post's ap_id instead, which the server decodes as a
// published-only cursor whose string compare matches every row → the feed
// re-serves page 1 forever and never advances.
test("fetchTimeline surfaces the server next_cursor and has_more", async () => {
  const post = makePost();
  const result = await withMockJsonFetch(
    {
      posts: [post],
      has_more: true,
      next_cursor: "2026-01-01T00:00:00.000Z\u0000" + post.ap_id,
    },
    () => fetchTimeline({ limit: 20 }),
  );

  expect(result.posts.map((p) => p.ap_id)).toEqual([post.ap_id]);
  expect(result.hasMore).toBe(true);
  expect(result.nextCursor).toBe("2026-01-01T00:00:00.000Z\u0000" + post.ap_id);
});

test("fetchTimeline defaults to no cursor / hasMore=false when the server omits them", async () => {
  const result = await withMockJsonFetch({ posts: [] }, () =>
    fetchTimeline({ limit: 20 }),
  );

  expect(result.posts).toEqual([]);
  expect(result.hasMore).toBe(false);
  expect(result.nextCursor).toBe(null);
});
