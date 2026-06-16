import { atom } from "jotai";
import type { ActorStories, Post } from "../types/index.ts";
import { tAtom } from "./i18n.ts";
import {
  type AccountInfo,
  createPost,
  fetchAccounts,
  fetchStories,
  fetchTimeline,
  switchAccount,
  uploadMedia,
} from "../lib/api.ts";
import type { UploadedMedia } from "../components/timeline/types.ts";

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;

export type PostVisibility = "public" | "unlisted" | "followers" | "direct";

export type CreatePostOptions = {
  content: string;
  summary?: string;
  visibility?: PostVisibility;
};

// --- Post state ---
export const timelinePostsAtom = atom<Post[]>([]);
export const timelineLoadingAtom = atom(true);
export const timelineLoadingMoreAtom = atom(false);
export const timelineHasMoreAtom = atom(true);
export const timelineErrorAtom = atom<string | null>(null);

// --- Post composition ---
export const postContentAtom = atom("");
export const postSummaryAtom = atom("");
// Default visibility is public and is never changed implicitly.
export const postVisibilityAtom = atom<PostVisibility>("public");
export const postingAtom = atom(false);
export const uploadedMediaAtom = atom<UploadedMedia[]>([]);
export const uploadingAtom = atom(false);
export const uploadErrorAtom = atom<string | null>(null);
export const showPostModalAtom = atom(false);

// --- Story state ---
export const actorStoriesAtom = atom<ActorStories[]>([]);
export const storiesLoadingAtom = atom(true);
export const storiesErrorAtom = atom<string | null>(null);
export const showStoryViewerAtom = atom(false);
export const storyViewerActorIndexAtom = atom(0);
export const showStoryComposerAtom = atom(false);

// --- Account state ---
export const accountsAtom = atom<AccountInfo[]>([]);
export const currentApIdAtom = atom("");
export const accountsLoadingAtom = atom(false);
export const accountsErrorAtom = atom<string | null>(null);
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
    console.error("Failed to load timeline:", e);
    set(timelineErrorAtom, get(tAtom)("common.error"));
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
    console.error("Failed to load more:", e);
    set(timelineErrorAtom, get(tAtom)("common.error"));
  } finally {
    set(timelineLoadingMoreAtom, false);
  }
});

export const loadStoriesAtom = atom(null, async (get, set) => {
  set(storiesErrorAtom, null);
  try {
    const data = await fetchStories();
    set(actorStoriesAtom, data);
  } catch (e) {
    console.error("Failed to load stories:", e);
    set(storiesErrorAtom, get(tAtom)("story.loadFailed"));
  } finally {
    set(storiesLoadingAtom, false);
  }
});

export const createPostAtom = atom(
  null,
  async (get, set, options: CreatePostOptions) => {
    const { content } = options;
    const media = get(uploadedMediaAtom);
    if ((!content.trim() && media.length === 0) || get(postingAtom)) {
      return false;
    }

    set(postingAtom, true);
    try {
      const summary = options.summary?.trim();
      const newPost = await createPost({
        content: content.trim(),
        summary: summary ? summary : undefined,
        // Default visibility stays public; only forward an explicit choice.
        visibility:
          options.visibility && options.visibility !== "public"
            ? options.visibility
            : undefined,
        attachments:
          media.length > 0
            ? media.map((m) => ({
                url: m.url,
                r2_key: m.r2_key,
                content_type: m.content_type,
                name: m.name?.trim() ? m.name.trim() : undefined,
              }))
            : undefined,
      });
      if (newPost) {
        set(timelinePostsAtom, (prev) => [newPost, ...prev]);
        set(postContentAtom, "");
        media.forEach((m) => m.preview && URL.revokeObjectURL(m.preview));
        set(uploadedMediaAtom, []);
        return true;
      }
      return false;
    } catch (e) {
      console.error("Failed to create post:", e);
      set(timelineErrorAtom, get(tAtom)("common.error"));
      return false;
    } finally {
      set(postingAtom, false);
    }
  },
);

export const uploadMediaAtom = atom(null, async (get, set, file: File) => {
  if (get(uploadedMediaAtom).length >= 4) return;
  if (file.size > MAX_IMAGE_SIZE) {
    set(
      uploadErrorAtom,
      get(tAtom)("story.imageTooLarge").replace(
        "{size}",
        String(MAX_IMAGE_SIZE / 1024 / 1024),
      ),
    );
    return;
  }

  set(uploadingAtom, true);
  set(uploadErrorAtom, null);
  try {
    const result = await uploadMedia(file);
    const preview = URL.createObjectURL(file);
    set(uploadedMediaAtom, (prev) => [
      ...prev,
      {
        url: result.url,
        r2_key: result.r2_key,
        content_type: result.content_type,
        preview,
      },
    ]);
  } catch (e) {
    console.error("Failed to upload:", e);
    set(uploadErrorAtom, get(tAtom)("common.uploadFailed"));
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

// Update the alt text (`name`) of an uploaded attachment. Client-only.
export const setMediaAltAtom = atom(
  null,
  (_get, set, payload: { index: number; alt: string }) => {
    set(uploadedMediaAtom, (prev) =>
      prev.map((m, i) =>
        i === payload.index ? { ...m, name: payload.alt } : m,
      ),
    );
  },
);

export const loadAccountsAtom = atom(null, async (get, set) => {
  set(accountsLoadingAtom, true);
  set(accountsErrorAtom, null);
  try {
    const data = await fetchAccounts();
    set(accountsAtom, data.accounts);
    set(currentApIdAtom, data.current_ap_id);
  } catch (e) {
    console.error("Failed to load accounts:", e);
    set(accountsErrorAtom, get(tAtom)("settings.accountsLoadFailed"));
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
  set(postContentAtom, "");
  set(postSummaryAtom, "");
  // Reset to the default reach (public).
  set(postVisibilityAtom, "public");
  set(uploadedMediaAtom, (prev) => {
    prev.forEach((m) => m.preview && URL.revokeObjectURL(m.preview));
    return [];
  });
  set(uploadErrorAtom, null);
});
