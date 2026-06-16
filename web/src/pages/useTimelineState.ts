import { onCleanup, onMount } from "solid-js";
import { useAtom, useAtomValue, useSetAtom } from "solid-jotai";
import { tAtom } from "../atoms/i18n.ts";
import {
  accountsAtom,
  accountsLoadingAtom,
  actorStoriesAtom,
  closePostModalAtom,
  createPostAtom,
  currentApIdAtom,
  loadAccountsAtom,
  loadMoreTimelineAtom,
  loadStoriesAtom,
  loadTimelineAtom,
  postContentAtom,
  postingAtom,
  postSummaryAtom,
  postVisibilityAtom,
  removeMediaAtom,
  setMediaAltAtom,
  showAccountSwitcherAtom,
  showMenuAtom,
  showPostModalAtom,
  showStoryComposerAtom,
  showStoryViewerAtom,
  storiesLoadingAtom,
  storyViewerActorIndexAtom,
  switchAccountAtom,
  timelineErrorAtom,
  timelineHasMoreAtom,
  timelineLoadErrorAtom,
  timelineLoadingAtom,
  timelineLoadingMoreAtom,
  timelinePostsAtom,
  uploadedMediaAtom,
  uploadErrorAtom,
  uploadingAtom,
  uploadMediaAtom as uploadMediaActionAtom,
} from "../atoms/timeline.ts";
import { toggleBookmark, toggleLike, toggleRepost } from "../atoms/posts.ts";
import { deletePost } from "../lib/api/posts.ts";
import { blockUser, muteUser } from "../lib/api/actors.ts";
import type { ActorStories, Post } from "../types/index.ts";

export function useTimelineState() {
  const t = useAtomValue(tAtom);
  const [error, setError] = useAtom(timelineErrorAtom);
  let fileInputRef!: HTMLInputElement;
  let scrollContainerRef!: HTMLDivElement;
  let loadMoreSentinelRef!: HTMLDivElement;

  // State atoms
  const [posts, setPosts] = useAtom(timelinePostsAtom);
  const loading = useAtomValue(timelineLoadingAtom);
  const loadingMore = useAtomValue(timelineLoadingMoreAtom);
  const hasMore = useAtomValue(timelineHasMoreAtom);
  const loadError = useAtomValue(timelineLoadErrorAtom);
  const [postContent, setPostContent] = useAtom(postContentAtom);
  const [postSummary, setPostSummary] = useAtom(postSummaryAtom);
  const [postVisibility, setPostVisibility] = useAtom(postVisibilityAtom);
  const posting = useAtomValue(postingAtom);
  const uploadedMedia = useAtomValue(uploadedMediaAtom);
  const uploading = useAtomValue(uploadingAtom);
  const uploadError = useAtomValue(uploadErrorAtom);
  const [showPostModal, setShowPostModal] = useAtom(showPostModalAtom);

  // Story state
  const actorStories = useAtomValue(actorStoriesAtom);
  const storiesLoading = useAtomValue(storiesLoadingAtom);
  const [showStoryViewer, setShowStoryViewer] = useAtom(showStoryViewerAtom);
  const storyViewerActorIndex = useAtomValue(storyViewerActorIndexAtom);
  const [showStoryComposer, setShowStoryComposer] = useAtom(
    showStoryComposerAtom,
  );
  const setStoryViewerActorIndex = useSetAtom(storyViewerActorIndexAtom);

  // Account state
  const accounts = useAtomValue(accountsAtom);
  const currentApId = useAtomValue(currentApIdAtom);
  const accountsLoading = useAtomValue(accountsLoadingAtom);
  const [showAccountSwitcher, setShowAccountSwitcher] = useAtom(
    showAccountSwitcherAtom,
  );
  const [showMenu, setShowMenu] = useAtom(showMenuAtom);

  // Actions
  const loadTimeline = useSetAtom(loadTimelineAtom);
  const loadMore = useSetAtom(loadMoreTimelineAtom);
  const loadStories = useSetAtom(loadStoriesAtom);
  const doCreatePost = useSetAtom(createPostAtom);
  const doUploadMedia = useSetAtom(uploadMediaActionAtom);
  const doRemoveMedia = useSetAtom(removeMediaAtom);
  const doSetMediaAlt = useSetAtom(setMediaAltAtom);
  const doLoadAccounts = useSetAtom(loadAccountsAtom);
  const doSwitchAccount = useSetAtom(switchAccountAtom);
  const doClosePostModal = useSetAtom(closePostModalAtom);

  // Initial load
  onMount(() => {
    loadTimeline();
    loadStories();
  });

  // Cleanup object URLs on unmount
  onCleanup(() => {
    uploadedMedia().forEach((media) => {
      if (media.preview) URL.revokeObjectURL(media.preview);
    });
  });

  // Infinite scroll — auto-load when the bottom sentinel becomes visible.
  // loadMore() internally guards on loadingMore()/hasMore()/empty list, so
  // repeated intersection callbacks never trigger duplicate fetches.
  onMount(() => {
    if (!loadMoreSentinelRef) return;
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
    observer.observe(loadMoreSentinelRef);
    onCleanup(() => observer.disconnect());
  });

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

  // Menu handlers
  const handleOpenMenu = () => {
    setShowMenu(true);
    doLoadAccounts();
  };

  const handleCloseMenu = () => {
    setShowMenu(false);
    setShowAccountSwitcher(false);
  };

  // File upload handler
  const handleFileSelect = async (
    e: Event & { currentTarget: HTMLInputElement },
  ) => {
    const files = e.currentTarget.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      await doUploadMedia(file);
    }
    if (fileInputRef) fileInputRef.value = "";
  };

  // Post interactions using shared helpers
  const handleLike = async (post: Parameters<typeof toggleLike>[0]) => {
    try {
      await toggleLike(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error("Failed to toggle like:", e);
      setError(t()("common.error"));
    }
  };

  const handleBookmark = async (post: Parameters<typeof toggleBookmark>[0]) => {
    try {
      await toggleBookmark(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error("Failed to toggle bookmark:", e);
      setError(t()("common.error"));
    }
  };

  const handleRepost = async (post: Parameters<typeof toggleRepost>[0]) => {
    try {
      await toggleRepost(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error("Failed to toggle repost:", e);
      setError(t()("common.error"));
    }
  };

  const handlePost = async (): Promise<boolean> => {
    return (
      (await doCreatePost({
        content: postContent(),
        summary: postSummary(),
        visibility: postVisibility(),
      })) || false
    );
  };

  // Remove a single post (after deleting your own) from the timeline.
  const handleDelete = async (post: Post) => {
    try {
      await deletePost(post.ap_id);
      setPosts((prev) => prev.filter((p) => p.ap_id !== post.ap_id));
    } catch (e) {
      console.error("Failed to delete post:", e);
      setError(t()("common.error"));
    }
  };

  // Mute/block an author and drop all of their posts from the timeline.
  const dropAuthorPosts = (authorApId: string) =>
    setPosts((prev) => prev.filter((p) => p.author.ap_id !== authorApId));

  const handleMute = async (post: Post) => {
    try {
      await muteUser(post.author.ap_id);
      dropAuthorPosts(post.author.ap_id);
    } catch (e) {
      console.error("Failed to mute user:", e);
      setError(t()("common.error"));
    }
  };

  const handleBlock = async (post: Post) => {
    try {
      await blockUser(post.author.ap_id);
      dropAuthorPosts(post.author.ap_id);
    } catch (e) {
      console.error("Failed to block user:", e);
      setError(t()("common.error"));
    }
  };

  return {
    t: () => t(),
    error,
    clearError: () => setError(null),
    get fileInputRef() {
      return fileInputRef;
    },
    set fileInputRef(el: HTMLInputElement) {
      fileInputRef = el;
    },
    get scrollContainerRef() {
      return scrollContainerRef;
    },
    set scrollContainerRef(el: HTMLDivElement) {
      scrollContainerRef = el;
    },
    get loadMoreSentinelRef() {
      return loadMoreSentinelRef;
    },
    set loadMoreSentinelRef(el: HTMLDivElement) {
      loadMoreSentinelRef = el;
    },
    posts,
    loading,
    loadingMore,
    hasMore,
    loadError,
    loadTimeline,
    postContent,
    setPostContent,
    postSummary,
    setPostSummary,
    postVisibility,
    setPostVisibility,
    posting,
    handlePost,
    uploadedMedia,
    uploading,
    uploadError,
    handleFileSelect,
    removeMedia: doRemoveMedia,
    setMediaAlt: (index: number, alt: string) => doSetMediaAlt({ index, alt }),
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
    showMenu,
    showAccountSwitcher,
    setShowAccountSwitcher,
    handleOpenMenu,
    handleCloseMenu,
    showPostModal,
    setShowPostModal,
    handleClosePostModal: doClosePostModal,
    accounts,
    accountsLoading,
    currentApId,
    handleSwitchAccount: doSwitchAccount,
    handleLike,
    handleBookmark,
    handleRepost,
    handleDelete,
    handleMute,
    handleBlock,
    getPlaceholder: () => t()("posts.placeholder"),
  };
}
