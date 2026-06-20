import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { tAtom } from "../atoms/i18n.ts";
import { hydrateScopeAtom, scopeQueryAtom } from "../atoms/scope.ts";
import { pushToast, toastsAtom } from "../atoms/toast.ts";
import {
  actorStoriesAtom,
  applyNewPostsAtom,
  checkNewPostsAtom,
  loadMoreTimelineAtom,
  loadStoriesAtom,
  loadTimelineAtom,
  pendingNewPostsAtom,
  showStoryComposerAtom,
  showStoryViewerAtom,
  storiesLoadingAtom,
  storyViewerActorIndexAtom,
  timelineHasMoreAtom,
  timelineLoadErrorAtom,
  timelineLoadingAtom,
  timelineLoadingMoreAtom,
  timelinePostsAtom,
} from "../atoms/timeline.ts";
import { toggleBookmark, toggleLike, toggleRepost } from "../atoms/posts.ts";
import { deletePost, editPost } from "../lib/api/posts.ts";
import { blockUser, muteUser } from "../lib/api/actors.ts";
import type { ActorStories, Post } from "../types/index.ts";

export function useTimelineState() {
  const t = useAtomValue(tAtom);
  const setToasts = useSetAtom(toastsAtom);
  const toastError = (key: Parameters<ReturnType<typeof t>>[0]) =>
    pushToast(setToasts, t()(key), { kind: "error" });
  let scrollContainerRef!: HTMLDivElement;
  // The sentinel is rendered only after posts load, so it appears (and can be
  // re-created when the list re-mounts) after onMount. Track it as a signal so
  // the IntersectionObserver effect can attach once the element exists.
  const [loadMoreSentinel, setLoadMoreSentinel] =
    createSignal<HTMLDivElement | null>(null);

  // State atoms
  const [posts, setPosts] = useAtom(timelinePostsAtom);
  const setPendingNewPosts = useSetAtom(pendingNewPostsAtom);
  const scopeQuery = useAtomValue(scopeQueryAtom);
  const loading = useAtomValue(timelineLoadingAtom);
  const loadingMore = useAtomValue(timelineLoadingMoreAtom);
  const hasMore = useAtomValue(timelineHasMoreAtom);
  const loadError = useAtomValue(timelineLoadErrorAtom);

  // Story state
  const actorStories = useAtomValue(actorStoriesAtom);
  const setActorStories = useSetAtom(actorStoriesAtom);
  const storiesLoading = useAtomValue(storiesLoadingAtom);
  const setStoriesLoading = useSetAtom(storiesLoadingAtom);
  const [showStoryViewer, setShowStoryViewer] = useAtom(showStoryViewerAtom);
  const storyViewerActorIndex = useAtomValue(storyViewerActorIndexAtom);
  const [showStoryComposer, setShowStoryComposer] = useAtom(
    showStoryComposerAtom,
  );
  const setStoryViewerActorIndex = useSetAtom(storyViewerActorIndexAtom);

  // Actions
  const loadTimeline = useSetAtom(loadTimelineAtom);
  const loadMore = useSetAtom(loadMoreTimelineAtom);
  const loadStories = useSetAtom(loadStoriesAtom);
  const hydrateScope = useSetAtom(hydrateScopeAtom);

  // New-posts indicator
  const pendingNewPosts = useAtomValue(pendingNewPostsAtom);
  const checkNewPosts = useSetAtom(checkNewPostsAtom);
  const applyNewPosts = useSetAtom(applyNewPostsAtom);

  // Initial load. Gate the first timeline/story fetch on scope hydration so a
  // stale stored community scope (one the user has since left) is reconciled to
  // personal first, rather than firing a wasted 403 against a community the
  // backend will reject. hydrateScopeAtom is idempotent, so re-running it here
  // (AppLayout also kicks it on mount) only reconciles the stored scope. The
  // scope-change effect below is deferred, so the reconcile never double-fetches
  // on cold load.
  onMount(() => {
    void hydrateScope().then(() => {
      loadTimeline();
      loadStories();
    });
  });

  // Reactively reload when the inhabited scope changes (personal <-> a
  // community). `defer: true` leaves the initial fetch to onMount above, so the
  // effect only fires on a real scope switch. We key on the community ap_id (or
  // "" for personal) so unrelated re-renders don't retrigger a fetch, and reset
  // the list + hasMore before reloading so stale posts and the bottom sentinel
  // don't survive the switch. loadTimeline() owns the loading/error/staged-head
  // resets and the IntersectionObserver/poll guards stay intact (they read the
  // same atoms loadTimeline mutates).
  createEffect(
    on(
      () => scopeQuery()?.community ?? "",
      () => {
        setPosts([]);
        loadTimeline();
        // The StoryBar is scope-filtered too (loadStoriesAtom reads the same
        // scope): clear the stale group list and show the skeleton while the
        // new scope's stories load so the bar never flashes the prior scope.
        setActorStories([]);
        setStoriesLoading(true);
        loadStories();
      },
      { defer: true },
    ),
  );

  // Infinite scroll — auto-load when the bottom sentinel becomes visible.
  // loadMore() internally guards on loadingMore()/hasMore()/empty list, so
  // repeated intersection callbacks never trigger duplicate fetches. The
  // sentinel only exists once posts have rendered, so observe it reactively
  // (createEffect re-runs and re-attaches whenever the element changes).
  createEffect(() => {
    const sentinel = loadMoreSentinel();
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadMore();
        }
      },
      {
        root: scrollContainerRef ?? null,
        rootMargin: "400px",
      },
    );
    observer.observe(sentinel);
    onCleanup(() => observer.disconnect());
  });

  // New-posts polling — check the timeline head every ~30s. Pauses while the
  // tab is hidden and refreshes immediately on return. checkNewPosts() guards
  // on an empty list internally and de-dupes, so this never disrupts scroll.
  onMount(() => {
    const NEW_POSTS_POLL_MS = 30000;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };
    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        void checkNewPosts();
      }, NEW_POSTS_POLL_MS);
    };
    const handleVisibility = () => {
      if (document.hidden) {
        stop();
      } else {
        void checkNewPosts();
        start();
      }
    };

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", handleVisibility);

    onCleanup(() => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    });
  });

  // Prepend staged new posts and scroll the list back to the top.
  const handleShowNewPosts = () => {
    applyNewPosts();
    if (scrollContainerRef) scrollContainerRef.scrollTop = 0;
  };

  // Story handlers
  const handleStoryClick = (stories: ActorStories, _index: number) => {
    const actualIndex = actorStories().findIndex(
      (as) => as.actor.ap_id === stories.actor.ap_id,
    );
    if (actualIndex >= 0) {
      setStoryViewerActorIndex(actualIndex);
      setShowStoryViewer(true);
    }
  };

  // Post interactions using shared helpers
  const handleLike = async (post: Parameters<typeof toggleLike>[0]) => {
    try {
      await toggleLike(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error("Failed to toggle like:", e);
      toastError("common.error");
    }
  };

  const handleBookmark = async (post: Parameters<typeof toggleBookmark>[0]) => {
    try {
      await toggleBookmark(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error("Failed to toggle bookmark:", e);
      toastError("common.error");
    }
  };

  const handleRepost = async (post: Parameters<typeof toggleRepost>[0]) => {
    try {
      await toggleRepost(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error("Failed to toggle repost:", e);
      toastError("common.error");
    }
  };

  // Remove a single post (after deleting your own) from the timeline.
  const handleDelete = async (post: Post) => {
    try {
      await deletePost(post.ap_id);
      setPosts((prev) => prev.filter((p) => p.ap_id !== post.ap_id));
      pushToast(setToasts, t()("feedback.postDeleted"), { kind: "success" });
    } catch (e) {
      console.error("Failed to delete post:", e);
      toastError("feedback.deleteFailed");
    }
  };

  // Edit your own post. The modal is opened by stashing the target post; saving
  // PATCHes content/summary and merges the server's confirmed fields back into
  // the in-memory feed (also into the staged "new posts" buffer in case the
  // edited post is still queued there) so the change shows without a refetch.
  const [editingPost, setEditingPost] = createSignal<Post | null>(null);
  const [savingEdit, setSavingEdit] = createSignal(false);

  const handleEdit = (post: Post) => setEditingPost(post);

  const handleSaveEdit = async (data: {
    content: string;
    summary: string | null;
  }) => {
    const target = editingPost();
    if (!target || savingEdit()) return;
    setSavingEdit(true);
    try {
      const updated = await editPost(target.ap_id, data);
      const apply = (p: Post) =>
        p.ap_id === target.ap_id
          ? { ...p, content: updated.content, summary: updated.summary }
          : p;
      setPosts((prev) => prev.map(apply));
      setPendingNewPosts((prev) => prev.map(apply));
      setEditingPost(null);
      pushToast(setToasts, t()("feedback.postEdited"), { kind: "success" });
    } catch (e) {
      console.error("Failed to edit post:", e);
      toastError("feedback.editFailed");
    } finally {
      setSavingEdit(false);
    }
  };

  // Mute/block an author and drop all of their posts — from the live timeline AND
  // the staged "new posts" buffer (otherwise a muted author's already-fetched
  // posts re-enter the feed when the user taps "show new posts").
  const dropAuthorPosts = (authorApId: string) => {
    setPosts((prev) => prev.filter((p) => p.author.ap_id !== authorApId));
    setPendingNewPosts((prev) =>
      prev.filter((p) => p.author.ap_id !== authorApId),
    );
  };

  const handleMute = async (post: Post) => {
    try {
      await muteUser(post.author.ap_id);
      dropAuthorPosts(post.author.ap_id);
      pushToast(setToasts, t()("feedback.muted"), { kind: "success" });
    } catch (e) {
      console.error("Failed to mute user:", e);
      toastError("feedback.muteFailed");
    }
  };

  const handleBlock = async (post: Post) => {
    try {
      await blockUser(post.author.ap_id);
      dropAuthorPosts(post.author.ap_id);
      pushToast(setToasts, t()("feedback.blocked"), { kind: "success" });
    } catch (e) {
      console.error("Failed to block user:", e);
      toastError("feedback.blockFailed");
    }
  };

  return {
    t: () => t(),
    get scrollContainerRef() {
      return scrollContainerRef;
    },
    set scrollContainerRef(el: HTMLDivElement) {
      scrollContainerRef = el;
    },
    set loadMoreSentinelRef(el: HTMLDivElement) {
      setLoadMoreSentinel(el ?? null);
    },
    posts,
    loading,
    loadingMore,
    hasMore,
    loadError,
    loadTimeline,
    newPostsCount: () => pendingNewPosts().length,
    handleShowNewPosts,
    actorStories,
    storiesLoading,
    showStoryViewer,
    setShowStoryViewer,
    storyViewerActorIndex,
    showStoryComposer,
    setShowStoryComposer,
    handleStoryClick,
    handleAddStory: () => setShowStoryComposer(true),
    handleStorySuccess: loadStories,
    loadStories,
    handleLike,
    handleBookmark,
    handleRepost,
    handleDelete,
    handleMute,
    handleBlock,
    editingPost,
    setEditingPost,
    savingEdit,
    handleEdit,
    handleSaveEdit,
  };
}
