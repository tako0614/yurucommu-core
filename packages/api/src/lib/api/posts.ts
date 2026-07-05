import type { Post } from "../../types/index.ts";
import { normalizePost } from "./normalize.ts";
import { apiDelete, apiFetch, apiPatch, apiPost, assertOk } from "./fetch.ts";

type PostListResponse = {
  posts?: Post[];
};

type CreatePostResponse = {
  post: Post;
};

export type TimelinePage = {
  posts: Post[];
  // Opaque composite cursor for the next page (`published\u0000apId`), echoed
  // verbatim back to the server as `before`. Pass this — NOT a post's ap_id —
  // to paginate: a bare ap_id decodes as a published-only cursor whose
  // string comparison against an ISO timestamp matches every row, so the feed
  // re-serves page 1 forever and never advances.
  nextCursor: string | null;
  hasMore: boolean;
};

export async function fetchTimeline(options?: {
  limit?: number;
  before?: string;
  community?: string;
}): Promise<TimelinePage> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  if (options?.community) params.set("community", options.community);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(`/api/timeline${query}`);
  // Throw on a non-OK response (the backend returns a JSON `{ error }` body, so
  // without this res.json() would resolve, posts would be undefined, and the
  // caller would render an empty "welcome" feed instead of an error+retry UI).
  await assertOk(res, "Failed to load timeline");
  const data = (await res.json()) as {
    posts?: Post[];
    next_cursor?: string | null;
    has_more?: boolean;
  };
  return {
    posts: (data.posts || []).map(normalizePost),
    nextCursor: data.next_cursor ?? null,
    hasMore: data.has_more ?? false,
  };
}

export async function fetchPost(apId: string): Promise<Post> {
  const res = await apiFetch(`/api/posts/${encodeURIComponent(apId)}`);
  await assertOk(res, "Post not found");
  const data = (await res.json()) as { post: Post };
  return normalizePost(data.post);
}

export interface RepliesPage {
  replies: Post[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchReplies(
  postApId: string,
  options?: { before?: string },
): Promise<RepliesPage> {
  const params = new URLSearchParams();
  if (options?.before) params.set("before", options.before);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(
    `/api/posts/${encodeURIComponent(postApId)}/replies${query}`,
  );
  const data = (await res.json()) as {
    replies?: Post[];
    next_cursor?: string | null;
    has_more?: boolean;
  };
  return {
    replies: (data.replies || []).map(normalizePost),
    nextCursor: data.next_cursor ?? null,
    hasMore: data.has_more ?? false,
  };
}

export async function createPost(data: {
  content: string;
  summary?: string;
  visibility?: string;
  in_reply_to?: string;
  community_ap_id?: string;
  attachments?: {
    url?: string;
    r2_key: string;
    content_type: string;
    name?: string;
  }[];
}): Promise<Post> {
  const res = await apiPost("/api/posts", data);
  await assertOk(res, "Failed to create post");
  const result = (await res.json()) as CreatePostResponse;
  return normalizePost(result.post);
}

// Edit your own post's text and/or content warning. The server returns only the
// changed fields (it stays the authority on what actually persisted); the caller
// merges them into the post it already holds. `summary: null` clears the CW.
export async function editPost(
  apId: string,
  data: { content?: string; summary?: string | null },
): Promise<{ content: string; summary: string | null }> {
  const res = await apiPatch(`/api/posts/${encodeURIComponent(apId)}`, data);
  await assertOk(res, "Failed to edit post");
  const result = (await res.json()) as {
    post: { content: string; summary: string | null };
  };
  return { content: result.post.content, summary: result.post.summary };
}

export async function deletePost(apId: string): Promise<void> {
  const res = await apiDelete(`/api/posts/${encodeURIComponent(apId)}`);
  await assertOk(res, "Failed to delete post");
}

export async function likePost(apId: string): Promise<void> {
  const res = await apiPost(`/api/posts/${encodeURIComponent(apId)}/like`);
  await assertOk(res, "Failed to like");
}

export async function unlikePost(apId: string): Promise<void> {
  const res = await apiDelete(`/api/posts/${encodeURIComponent(apId)}/like`);
  await assertOk(res, "Failed to unlike");
}

export async function repostPost(apId: string): Promise<void> {
  const res = await apiPost(`/api/posts/${encodeURIComponent(apId)}/repost`);
  await assertOk(res, "Failed to repost");
}

export async function unrepostPost(apId: string): Promise<void> {
  const res = await apiDelete(`/api/posts/${encodeURIComponent(apId)}/repost`);
  await assertOk(res, "Failed to unrepost");
}

export async function bookmarkPost(apId: string): Promise<void> {
  const res = await apiPost(`/api/posts/${encodeURIComponent(apId)}/bookmark`);
  await assertOk(res, "Failed to bookmark");
}

export async function unbookmarkPost(apId: string): Promise<void> {
  const res = await apiDelete(
    `/api/posts/${encodeURIComponent(apId)}/bookmark`,
  );
  await assertOk(res, "Failed to unbookmark");
}

export interface BookmarksPage {
  posts: Post[];
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchBookmarks(options?: {
  limit?: number;
  before?: string;
}): Promise<BookmarksPage> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(`/api/bookmarks${query}`);
  const data = (await res.json()) as PostListResponse & {
    next_cursor?: string | null;
    has_more?: boolean;
  };
  return {
    posts: (data.posts ?? []).map(normalizePost),
    nextCursor: data.next_cursor ?? null,
    hasMore: data.has_more ?? false,
  };
}
