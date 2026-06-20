import { type WritableAtom } from "jotai";
import type { Post } from "../types/index.ts";
import {
  bookmarkPost,
  likePost,
  repostPost,
  unbookmarkPost,
  unlikePost,
  unrepostPost,
} from "../lib/api.ts";

type PostsSetter = WritableAtom<
  Post[],
  [Post[] | ((prev: Post[]) => Post[])],
  void
>;

function updatePost(
  posts: Post[],
  apId: string,
  updater: (p: Post) => Post,
): Post[] {
  return posts.map((p) => (p.ap_id === apId ? updater(p) : p));
}

// Tracks in-flight "action:apId" toggles. A rapid double-tap would otherwise read
// the same pre-toggle snapshot twice and apply the optimistic delta twice (e.g.
// like_count +2) while the server records it once — a permanent local count drift
// until refetch. While a toggle for a key is outstanding, further taps no-op.
const inFlightToggles = new Set<string>();

// Optimistic toggle: apply the UI change immediately, call the API, and roll
// back if it fails. Keeps the like/repost/bookmark buttons snappy instead of
// waiting a network round-trip before reflecting the tap. Re-throws on failure
// so the caller can surface a toast (the revert alone is silent).
async function optimisticToggle(
  key: string,
  apId: string,
  setPosts: (fn: (prev: Post[]) => Post[]) => void,
  apply: (p: Post) => Post,
  revert: (p: Post) => Post,
  call: () => Promise<unknown>,
) {
  if (inFlightToggles.has(key)) return;
  inFlightToggles.add(key);
  setPosts((prev) => updatePost(prev, apId, apply));
  try {
    await call();
  } catch (e) {
    console.error("Interaction failed, rolling back:", e);
    setPosts((prev) => updatePost(prev, apId, revert));
    throw e;
  } finally {
    inFlightToggles.delete(key);
  }
}

export async function toggleLike(
  post: Post,
  setPosts: (fn: (prev: Post[]) => Post[]) => void,
) {
  const liked = post.liked;
  await optimisticToggle(
    `like:${post.ap_id}`,
    post.ap_id,
    setPosts,
    (p) => ({
      ...p,
      liked: !liked,
      like_count: p.like_count + (liked ? -1 : 1),
    }),
    (p) => ({ ...p, liked, like_count: p.like_count + (liked ? 1 : -1) }),
    () => (liked ? unlikePost(post.ap_id) : likePost(post.ap_id)),
  );
}

export async function toggleRepost(
  post: Post,
  setPosts: (fn: (prev: Post[]) => Post[]) => void,
) {
  const reposted = post.reposted;
  await optimisticToggle(
    `repost:${post.ap_id}`,
    post.ap_id,
    setPosts,
    (p) => ({
      ...p,
      reposted: !reposted,
      announce_count: p.announce_count + (reposted ? -1 : 1),
    }),
    (p) => ({
      ...p,
      reposted,
      announce_count: p.announce_count + (reposted ? 1 : -1),
    }),
    () => (reposted ? unrepostPost(post.ap_id) : repostPost(post.ap_id)),
  );
}

export async function toggleBookmark(
  post: Post,
  setPosts: (fn: (prev: Post[]) => Post[]) => void,
) {
  const bookmarked = post.bookmarked;
  await optimisticToggle(
    `bookmark:${post.ap_id}`,
    post.ap_id,
    setPosts,
    (p) => ({ ...p, bookmarked: !bookmarked }),
    (p) => ({ ...p, bookmarked }),
    () => (bookmarked ? unbookmarkPost(post.ap_id) : bookmarkPost(post.ap_id)),
  );
}
