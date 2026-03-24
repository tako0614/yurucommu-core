import { type WritableAtom } from 'jotai';
import type { Post } from '../types';
import {
  likePost,
  unlikePost,
  repostPost,
  unrepostPost,
  bookmarkPost,
  unbookmarkPost,
} from '../lib/api';

type PostsSetter = WritableAtom<Post[], [Post[] | ((prev: Post[]) => Post[])], void>;

function updatePost(posts: Post[], apId: string, updater: (p: Post) => Post): Post[] {
  return posts.map((p) => (p.ap_id === apId ? updater(p) : p));
}

export async function toggleLike(
  post: Post,
  setPosts: (fn: (prev: Post[]) => Post[]) => void,
) {
  if (post.liked) {
    await unlikePost(post.ap_id);
    setPosts((prev) => updatePost(prev, post.ap_id, (p) => ({ ...p, liked: false, like_count: p.like_count - 1 })));
  } else {
    await likePost(post.ap_id);
    setPosts((prev) => updatePost(prev, post.ap_id, (p) => ({ ...p, liked: true, like_count: p.like_count + 1 })));
  }
}

export async function toggleRepost(
  post: Post,
  setPosts: (fn: (prev: Post[]) => Post[]) => void,
) {
  if (post.reposted) {
    await unrepostPost(post.ap_id);
    setPosts((prev) => updatePost(prev, post.ap_id, (p) => ({ ...p, reposted: false, announce_count: p.announce_count - 1 })));
  } else {
    await repostPost(post.ap_id);
    setPosts((prev) => updatePost(prev, post.ap_id, (p) => ({ ...p, reposted: true, announce_count: p.announce_count + 1 })));
  }
}

export async function toggleBookmark(
  post: Post,
  setPosts: (fn: (prev: Post[]) => Post[]) => void,
) {
  if (post.bookmarked) {
    await unbookmarkPost(post.ap_id);
    setPosts((prev) => updatePost(prev, post.ap_id, (p) => ({ ...p, bookmarked: false })));
  } else {
    await bookmarkPost(post.ap_id);
    setPosts((prev) => updatePost(prev, post.ap_id, (p) => ({ ...p, bookmarked: true })));
  }
}
