import type { Post } from "../../types/index.ts";
import { normalizePost } from "./normalize.ts";
import { apiDelete, apiFetch, apiPost, assertOk } from "./fetch.ts";

type PostListResponse = {
  posts?: Post[];
};

type CreatePostResponse = {
  post: Post;
};

export async function fetchTimeline(options?: {
  limit?: number;
  before?: string;
  community?: string;
}): Promise<Post[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  if (options?.community) params.set("community", options.community);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(`/api/timeline${query}`);
  const data = (await res.json()) as { posts?: Post[] };
  return (data.posts || []).map(normalizePost);
}

export async function fetchFollowingTimeline(options?: {
  limit?: number;
  before?: string;
}): Promise<Post[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(`/api/timeline/following${query}`);
  const data = (await res.json()) as { posts?: Post[] };
  return (data.posts || []).map(normalizePost);
}

export async function fetchPost(apId: string): Promise<Post> {
  const res = await apiFetch(`/api/posts/${encodeURIComponent(apId)}`);
  await assertOk(res, "Post not found");
  const data = (await res.json()) as { post: Post };
  return normalizePost(data.post);
}

export async function fetchReplies(postApId: string): Promise<Post[]> {
  const res = await apiFetch(
    `/api/posts/${encodeURIComponent(postApId)}/replies`,
  );
  const data = (await res.json()) as { replies?: Post[] };
  return (data.replies || []).map(normalizePost);
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

export async function fetchBookmarks(options?: {
  limit?: number;
  before?: string;
}): Promise<Post[]> {
  const params = new URLSearchParams();
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.before) params.set("before", options.before);
  const query = params.toString() ? `?${params}` : "";
  const res = await apiFetch(`/api/bookmarks${query}`);
  const data = (await res.json()) as PostListResponse;
  return (data.posts ?? []).map(normalizePost);
}
