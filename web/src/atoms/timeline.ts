import { atom } from "jotai";
import type { ActorStories, Post } from "../types/index.ts";
import { tAtom } from "./i18n.ts";
import {
  type AccountInfo,
  createAccount,
  createPost,
  fetchAccounts,
  fetchStories,
  fetchTimeline,
  switchAccount,
  uploadMedia,
} from "../lib/api.ts";
import type { UploadedMedia } from "../components/timeline/types.ts";
import { ApiError } from "../lib/api/fetch.ts";
import { pushToast, toastWriter } from "./toast.ts";
import { scopeQueryAtom } from "./scope.ts";

const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
// Mirrors the backend MAX_POST_CONTENT_LENGTH (posts/transformers.ts), used to
// surface a specific message when the server rejects an over-length post.
const MAX_POST_CONTENT_LENGTH = 5000;

export type PostVisibility = "public" | "unlisted" | "followers" | "direct";

export type CreatePostOptions = {
  content: string;
  summary?: string;
  visibility?: PostVisibility;
  // When set, the post is bound to this community (audience = its members). It
  // comes from the inhabited scope, not a visibility control: default post
  // visibility stays public. Community-scoped posts only surface in that
  // community's reach, so a created one is not prepended to the personal head.
  community_ap_id?: string;
};

// --- Post state ---
export const timelinePostsAtom = atom<Post[]>([]);
export const timelineLoadingAtom = atom(true);
export const timelineLoadingMoreAtom = atom(false);
export const timelineHasMoreAtom = atom(true);
// Primary-load failure (shown inline with a Retry button).
export const timelineLoadErrorAtom = atom<string | null>(null);

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
// Whether the shell-level ScopeSwitcherSheet is open. It is mounted once (in
// GlobalPostComposer) so the home header pill, the scope rail's "+", and the
// composer's audience re-aim all drive the same single instance rather than
// each page owning a private copy (single-modal shell design).
export const showScopeSwitcherAtom = atom(false);

// --- New-posts indicator ---
// Posts fetched from the timeline head that are newer than what is currently
// displayed. They are staged here (not prepended automatically) so the user
// keeps their scroll position; a pill surfaces the count and prepends on click.
export const pendingNewPostsAtom = atom<Post[]>([]);

// Poll the timeline head and stage any posts newer than the current top one.
// Cheap and idempotent: it only stages posts not already shown or staged, and
// silently no-ops on error (the indicator is non-critical).
export const checkNewPostsAtom = atom(null, async (get, set) => {
  const current = get(timelinePostsAtom);
  // Nothing to compare against yet (or the primary list never loaded).
  if (current.length === 0) return;

  try {
    const scope = get(scopeQueryAtom);
    const head = await fetchTimeline({
      limit: 20,
      community: scope?.community,
    });
    if (head.length === 0) return;

    const knownIds = new Set([
      ...current.map((p) => p.ap_id),
      ...get(pendingNewPostsAtom).map((p) => p.ap_id),
    ]);
    const fresh = head.filter((p) => !knownIds.has(p.ap_id));
    if (fresh.length === 0) return;

    set(pendingNewPostsAtom, (prev) => {
      const prevIds = new Set(prev.map((p) => p.ap_id));
      const merged = [...fresh.filter((p) => !prevIds.has(p.ap_id)), ...prev];
      // Bound the staged buffer so a busy timeline can't grow it unbounded.
      return merged.slice(0, 100);
    });
  } catch (e) {
    console.error("Failed to check for new posts:", e);
  }
});

// Prepend staged posts to the visible timeline and clear the indicator.
export const applyNewPostsAtom = atom(null, (get, set) => {
  const pending = get(pendingNewPostsAtom);
  if (pending.length === 0) return;
  const current = get(timelinePostsAtom);
  const currentIds = new Set(current.map((p) => p.ap_id));
  const deduped = pending.filter((p) => !currentIds.has(p.ap_id));
  set(timelinePostsAtom, [...deduped, ...current]);
  set(pendingNewPostsAtom, []);
});

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

// --- Actions ---

// Monotonic generation guards. Switching the home filter fires a fresh load; a
// slow prior fetch must NOT land its result over a newer view (last-writer-wins
// would let a slow "すべて" response overwrite the community you just picked).
// Each full reload bumps the counter and bails if superseded; loadMore captures
// the counter and bails if a reload happened mid-flight.
let timelineLoadGen = 0;
let storiesLoadGen = 0;

export const loadTimelineAtom = atom(null, async (get, set) => {
  const gen = ++timelineLoadGen;
  if (get(timelinePostsAtom).length === 0) set(timelineLoadingAtom, true);
  set(timelineLoadErrorAtom, null);
  set(timelineHasMoreAtom, true);
  try {
    const scope = get(scopeQueryAtom);
    const posts = await fetchTimeline({
      limit: 20,
      community: scope?.community,
    });
    if (gen !== timelineLoadGen) return; // a newer load superseded this one
    set(timelinePostsAtom, posts);
    set(timelineHasMoreAtom, posts.length >= 20);
    // A full reload already shows the freshest head; drop any staged posts.
    set(pendingNewPostsAtom, []);
  } catch (e) {
    if (gen !== timelineLoadGen) return;
    console.error("Failed to load timeline:", e);
    set(timelineLoadErrorAtom, get(tAtom)("common.loadFailed"));
  } finally {
    if (gen === timelineLoadGen) set(timelineLoadingAtom, false);
  }
});

export const loadMoreTimelineAtom = atom(null, async (get, set) => {
  const loadingMore = get(timelineLoadingMoreAtom);
  const hasMore = get(timelineHasMoreAtom);
  const posts = get(timelinePostsAtom);
  if (loadingMore || !hasMore || posts.length === 0) return;

  set(timelineLoadingMoreAtom, true);
  const gen = timelineLoadGen;
  try {
    const lastPost = posts[posts.length - 1];
    const scope = get(scopeQueryAtom);
    const newPosts = await fetchTimeline({
      limit: 20,
      before: lastPost.ap_id,
      community: scope?.community,
    });
    // A full reload (e.g. filter switch) happened mid-flight → these are the
    // previous scope's next page; do not append them onto the new feed.
    if (gen !== timelineLoadGen) return;
    if (newPosts.length > 0) {
      set(timelinePostsAtom, [...get(timelinePostsAtom), ...newPosts]);
    }
    set(timelineHasMoreAtom, newPosts.length >= 20);
  } catch (e) {
    console.error("Failed to load more:", e);
    pushToast(toastWriter(set), get(tAtom)("common.loadFailed"), {
      kind: "error",
    });
  } finally {
    set(timelineLoadingMoreAtom, false);
  }
});

export const loadStoriesAtom = atom(null, async (get, set) => {
  const gen = ++storiesLoadGen;
  set(storiesErrorAtom, null);
  try {
    // Filter the StoryBar by the inhabited scope: personal observes self +
    // followed (no community param); a community scope passes its ap_id so the
    // backend returns only that community's members' stories (member-gated).
    const scope = get(scopeQueryAtom);
    const data = await fetchStories(scope?.community);
    if (gen !== storiesLoadGen) return; // superseded by a newer scope load
    set(actorStoriesAtom, data);
  } catch (e) {
    if (gen !== storiesLoadGen) return;
    console.error("Failed to load stories:", e);
    set(storiesErrorAtom, get(tAtom)("story.loadFailed"));
  } finally {
    if (gen === storiesLoadGen) set(storiesLoadingAtom, false);
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
        // Bind the post to the inhabited community scope (audience = members).
        community_ap_id: options.community_ap_id,
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
        // Optimistically prepend when the post lands in the scope the timeline
        // is currently observing: a personal post (no community) always belongs
        // to the personal feed, and a community post belongs to the head only
        // when that community is the inhabited scope. Posting never changes the
        // inhabited scope, so the visible list is not reloaded out from under us.
        if (
          !options.community_ap_id ||
          get(scopeQueryAtom)?.community === options.community_ap_id
        ) {
          set(timelinePostsAtom, (prev) => [newPost, ...prev]);
        }
        set(postContentAtom, "");
        media.forEach((m) => m.preview && URL.revokeObjectURL(m.preview));
        set(uploadedMediaAtom, []);
        pushToast(toastWriter(set), get(tAtom)("feedback.postCreated"), {
          kind: "success",
        });
        return true;
      }
      return false;
    } catch (e) {
      console.error("Failed to create post:", e);
      // Map a server-side length rejection to a specific message so an
      // over-length post is explained rather than a generic failure. A summary
      // (content warning) overflow is mapped to its own message so it is never
      // mislabelled as a body-too-long error.
      const isLengthRejection =
        e instanceof ApiError &&
        e.status === 400 &&
        /too long/i.test(e.message);
      const isSummaryRejection =
        isLengthRejection && /summary|content warning/i.test(e.message);
      let message: string;
      if (isSummaryRejection) {
        message = get(tAtom)("compose.cwTooLong");
      } else if (isLengthRejection) {
        message = get(tAtom)("posts.tooLong").replace(
          "{max}",
          String(MAX_POST_CONTENT_LENGTH),
        );
      } else {
        message = get(tAtom)("feedback.postFailed");
      }
      pushToast(toastWriter(set), message, {
        kind: "error",
      });
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

// Create a new account and push it into the shared account list so the
// switcher (AppMenu / Settings) stays current without a refetch. The newly
// created account is not made current here; the caller decides whether to
// switch to it.
export const createAccountAtom = atom(
  null,
  async (_get, set, payload: { username: string; name?: string }) => {
    const account = await createAccount(payload.username, payload.name);
    set(accountsAtom, (prev) => [...prev, account]);
    return account;
  },
);

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
