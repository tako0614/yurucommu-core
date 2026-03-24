import { atom } from 'jotai';
import type { Post, ActorStories } from '../types';
import {
  fetchTimeline,
  fetchStories,
  createPost,
  uploadMedia,
  fetchAccounts,
  switchAccount,
  type AccountInfo,
} from '../lib/api';
import type { UploadedMedia } from '../components/timeline/types';

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

// --- Post state ---
export const timelinePostsAtom = atom<Post[]>([]);
export const timelineLoadingAtom = atom(true);
export const timelineLoadingMoreAtom = atom(false);
export const timelineHasMoreAtom = atom(true);
export const timelineErrorAtom = atom<string | null>(null);

// --- Post composition ---
export const postContentAtom = atom('');
export const postingAtom = atom(false);
export const uploadedMediaAtom = atom<UploadedMedia[]>([]);
export const uploadingAtom = atom(false);
export const uploadErrorAtom = atom<string | null>(null);
export const showPostModalAtom = atom(false);

// --- Story state ---
export const actorStoriesAtom = atom<ActorStories[]>([]);
export const storiesLoadingAtom = atom(true);
export const showStoryViewerAtom = atom(false);
export const storyViewerActorIndexAtom = atom(0);
export const showStoryComposerAtom = atom(false);

// --- Account state ---
export const accountsAtom = atom<AccountInfo[]>([]);
export const currentApIdAtom = atom('');
export const accountsLoadingAtom = atom(false);
export const showAccountSwitcherAtom = atom(false);

// --- Mobile menu ---
export const showMenuAtom = atom(false);

// --- Actions ---
export const loadTimelineAtom = atom(null, async (get, set) => {
  if (get(timelinePostsAtom).length === 0) set(timelineLoadingAtom, true);
  set(timelineHasMoreAtom, true);
  try {
    const posts = await fetchTimeline({ limit: 20 });
    set(timelinePostsAtom, posts);
    set(timelineHasMoreAtom, posts.length >= 20);
  } catch (e) {
    console.error('Failed to load timeline:', e);
    set(timelineErrorAtom, 'エラーが発生しました');
  } finally {
    set(timelineLoadingAtom, false);
  }
});

export const loadMoreTimelineAtom = atom(null, async (get, set) => {
  const loadingMore = get(timelineLoadingMoreAtom);
  const hasMore = get(timelineHasMoreAtom);
  const posts = get(timelinePostsAtom);
  if (loadingMore || !hasMore || posts.length === 0) return;

  set(timelineLoadingMoreAtom, true);
  try {
    const lastPost = posts[posts.length - 1];
    const newPosts = await fetchTimeline({ limit: 20, before: lastPost.ap_id });
    if (newPosts.length > 0) {
      set(timelinePostsAtom, [...posts, ...newPosts]);
    }
    set(timelineHasMoreAtom, newPosts.length >= 20);
  } catch (e) {
    console.error('Failed to load more:', e);
    set(timelineErrorAtom, 'エラーが発生しました');
  } finally {
    set(timelineLoadingMoreAtom, false);
  }
});

export const loadStoriesAtom = atom(null, async (_get, set) => {
  try {
    const data = await fetchStories();
    set(actorStoriesAtom, data);
  } catch (e) {
    console.error('Failed to load stories:', e);
  } finally {
    set(storiesLoadingAtom, false);
  }
});

export const createPostAtom = atom(null, async (get, set, content: string) => {
  const media = get(uploadedMediaAtom);
  if ((!content.trim() && media.length === 0) || get(postingAtom)) return false;

  set(postingAtom, true);
  try {
    const newPost = await createPost({
      content: content.trim(),
      attachments: media.length > 0 ? media.map((m) => ({ r2_key: m.r2_key, content_type: m.content_type })) : undefined,
    });
    if (newPost) {
      set(timelinePostsAtom, (prev) => [newPost, ...prev]);
      set(postContentAtom, '');
      media.forEach((m) => m.preview && URL.revokeObjectURL(m.preview));
      set(uploadedMediaAtom, []);
      return true;
    }
    return false;
  } catch (e) {
    console.error('Failed to create post:', e);
    set(timelineErrorAtom, 'エラーが発生しました');
    return false;
  } finally {
    set(postingAtom, false);
  }
});

export const uploadMediaAtom = atom(null, async (get, set, file: File) => {
  if (get(uploadedMediaAtom).length >= 4) return;
  if (file.size > MAX_IMAGE_SIZE) {
    set(uploadErrorAtom, `画像サイズが大きすぎます（最大${MAX_IMAGE_SIZE / 1024 / 1024}MB）`);
    return;
  }

  set(uploadingAtom, true);
  set(uploadErrorAtom, null);
  try {
    const result = await uploadMedia(file);
    const preview = URL.createObjectURL(file);
    set(uploadedMediaAtom, (prev) => [...prev, { r2_key: result.r2_key, content_type: result.content_type, preview }]);
  } catch (e) {
    console.error('Failed to upload:', e);
    set(uploadErrorAtom, 'アップロードに失敗しました');
  } finally {
    set(uploadingAtom, false);
  }
});

export const removeMediaAtom = atom(null, (_get, set, index: number) => {
  set(uploadedMediaAtom, (prev) => {
    const media = prev[index];
    if (media?.preview) URL.revokeObjectURL(media.preview);
    return prev.filter((_, i) => i !== index);
  });
});

export const loadAccountsAtom = atom(null, async (_get, set) => {
  set(accountsLoadingAtom, true);
  try {
    const data = await fetchAccounts();
    set(accountsAtom, data.accounts);
    set(currentApIdAtom, data.current_ap_id);
  } catch (e) {
    console.error('Failed to load accounts:', e);
  } finally {
    set(accountsLoadingAtom, false);
  }
});

export const switchAccountAtom = atom(null, async (get, _set, apId: string) => {
  if (apId === get(currentApIdAtom)) return;
  await switchAccount(apId);
  window.location.reload();
});

export const closePostModalAtom = atom(null, (_get, set) => {
  set(showPostModalAtom, false);
  set(postContentAtom, '');
  set(uploadedMediaAtom, (prev) => {
    prev.forEach((m) => m.preview && URL.revokeObjectURL(m.preview));
    return [];
  });
  set(uploadErrorAtom, null);
});
