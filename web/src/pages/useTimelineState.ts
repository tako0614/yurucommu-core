import { useEffect, useRef, useCallback } from 'react';
import { useAtom, useAtomValue, useSetAtom } from 'jotai';
import { tAtom } from '../atoms/i18n.ts';
import {
  timelinePostsAtom,
  timelineLoadingAtom,
  timelineLoadingMoreAtom,
  timelineHasMoreAtom,
  timelineErrorAtom,
  postContentAtom,
  postingAtom,
  uploadedMediaAtom,
  uploadingAtom,
  uploadErrorAtom,
  showPostModalAtom,
  actorStoriesAtom,
  storiesLoadingAtom,
  showStoryViewerAtom,
  storyViewerActorIndexAtom,
  showStoryComposerAtom,
  accountsAtom,
  currentApIdAtom,
  accountsLoadingAtom,
  showAccountSwitcherAtom,
  showMenuAtom,
  loadTimelineAtom,
  loadMoreTimelineAtom,
  loadStoriesAtom,
  createPostAtom,
  uploadMediaAtom as uploadMediaActionAtom,
  removeMediaAtom,
  loadAccountsAtom,
  switchAccountAtom,
  closePostModalAtom,
} from '../atoms/timeline.ts';
import { toggleLike, toggleRepost, toggleBookmark } from '../atoms/posts.ts';
import type { ActorStories } from '../types/index.ts';

export function useTimelineState() {
  const t = useAtomValue(tAtom);
  const [error, setError] = useAtom(timelineErrorAtom);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // State atoms
  const [posts, setPosts] = useAtom(timelinePostsAtom);
  const loading = useAtomValue(timelineLoadingAtom);
  const loadingMore = useAtomValue(timelineLoadingMoreAtom);
  const hasMore = useAtomValue(timelineHasMoreAtom);
  const [postContent, setPostContent] = useAtom(postContentAtom);
  const posting = useAtomValue(postingAtom);
  const uploadedMedia = useAtomValue(uploadedMediaAtom);
  const uploadedMediaRef = useRef(uploadedMedia);
  uploadedMediaRef.current = uploadedMedia;
  const uploading = useAtomValue(uploadingAtom);
  const uploadError = useAtomValue(uploadErrorAtom);
  const [showPostModal, setShowPostModal] = useAtom(showPostModalAtom);

  // Story state
  const actorStories = useAtomValue(actorStoriesAtom);
  const storiesLoading = useAtomValue(storiesLoadingAtom);
  const [showStoryViewer, setShowStoryViewer] = useAtom(showStoryViewerAtom);
  const storyViewerActorIndex = useAtomValue(storyViewerActorIndexAtom);
  const [showStoryComposer, setShowStoryComposer] = useAtom(showStoryComposerAtom);
  const setStoryViewerActorIndex = useSetAtom(storyViewerActorIndexAtom);

  // Account state
  const accounts = useAtomValue(accountsAtom);
  const currentApId = useAtomValue(currentApIdAtom);
  const accountsLoading = useAtomValue(accountsLoadingAtom);
  const [showAccountSwitcher, setShowAccountSwitcher] = useAtom(showAccountSwitcherAtom);
  const [showMenu, setShowMenu] = useAtom(showMenuAtom);

  // Actions
  const loadTimeline = useSetAtom(loadTimelineAtom);
  const loadMore = useSetAtom(loadMoreTimelineAtom);
  const loadStories = useSetAtom(loadStoriesAtom);
  const doCreatePost = useSetAtom(createPostAtom);
  const doUploadMedia = useSetAtom(uploadMediaActionAtom);
  const doRemoveMedia = useSetAtom(removeMediaAtom);
  const doLoadAccounts = useSetAtom(loadAccountsAtom);
  const doSwitchAccount = useSetAtom(switchAccountAtom);
  const doClosePostModal = useSetAtom(closePostModalAtom);

  // Initial load
  useEffect(() => {
    loadTimeline();
    loadStories();
  }, [loadTimeline, loadStories]);

  // Cleanup object URLs on unmount
  useEffect(() => {
    return () => {
      uploadedMediaRef.current.forEach((media) => {
        if (media.preview) URL.revokeObjectURL(media.preview);
      });
    };
  }, []);

  // Infinite scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      if (scrollHeight - scrollTop - clientHeight < 200) {
        loadMore();
      }
    };
    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loadMore]);

  // Story handlers
  const handleStoryClick = useCallback((stories: ActorStories, _index: number) => {
    const actualIndex = actorStories.findIndex((as) => as.actor.ap_id === stories.actor.ap_id);
    if (actualIndex >= 0) {
      setStoryViewerActorIndex(actualIndex);
      setShowStoryViewer(true);
    }
  }, [actorStories, setStoryViewerActorIndex, setShowStoryViewer]);

  // Menu handlers
  const handleOpenMenu = useCallback(() => {
    setShowMenu(true);
    doLoadAccounts();
  }, [setShowMenu, doLoadAccounts]);

  const handleCloseMenu = useCallback(() => {
    setShowMenu(false);
    setShowAccountSwitcher(false);
  }, [setShowMenu, setShowAccountSwitcher]);

  // File upload handler
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (const file of Array.from(files)) {
      await doUploadMedia(file);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [doUploadMedia]);

  // Post interactions using shared helpers
  const handleLike = useCallback(async (post: Parameters<typeof toggleLike>[0]) => {
    try {
      await toggleLike(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error('Failed to toggle like:', e);
      setError(t('common.error'));
    }
  }, [setPosts, setError, t]);

  const handleBookmark = useCallback(async (post: Parameters<typeof toggleBookmark>[0]) => {
    try {
      await toggleBookmark(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error('Failed to toggle bookmark:', e);
      setError(t('common.error'));
    }
  }, [setPosts, setError, t]);

  const handleRepost = useCallback(async (post: Parameters<typeof toggleRepost>[0]) => {
    try {
      await toggleRepost(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error('Failed to toggle repost:', e);
      setError(t('common.error'));
    }
  }, [setPosts, setError, t]);

  const handlePost = useCallback(async (): Promise<boolean> => {
    return (await doCreatePost(postContent)) || false;
  }, [doCreatePost, postContent]);

  return {
    t,
    error,
    clearError: useCallback(() => setError(null), [setError]),
    fileInputRef,
    scrollContainerRef,
    posts,
    loading,
    loadingMore,
    hasMore,
    postContent,
    setPostContent,
    posting,
    handlePost,
    uploadedMedia,
    uploading,
    uploadError,
    handleFileSelect,
    removeMedia: doRemoveMedia,
    actorStories,
    storiesLoading,
    showStoryViewer,
    setShowStoryViewer,
    storyViewerActorIndex,
    showStoryComposer,
    setShowStoryComposer,
    handleStoryClick,
    handleAddStory: useCallback(() => setShowStoryComposer(true), [setShowStoryComposer]),
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
    getPlaceholder: useCallback(() => t('posts.placeholder'), [t]),
  };
}
