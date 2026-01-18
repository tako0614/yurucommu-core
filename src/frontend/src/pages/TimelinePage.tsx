import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Post, Actor, ActorStories } from '../types';
import {
  fetchTimeline,
  fetchFollowingTimeline,
  fetchCommunities,
  fetchStories,
  createPost,
  likePost,
  unlikePost,
  repostPost,
  unrepostPost,
  bookmarkPost,
  unbookmarkPost,
  uploadMedia,
  fetchAccounts,
  switchAccount,
  AccountInfo,
  CommunityDetail,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { StoryBar, StoryViewer, StoryComposer } from '../components/story';
import { InlineErrorBanner } from '../components/InlineErrorBanner';
import { useInlineError } from '../hooks/useInlineError';
import { TimelineHeader } from '../components/timeline/TimelineHeader';
import { TimelineMobileMenu } from '../components/timeline/TimelineMobileMenu';
import { TimelinePostItem } from '../components/timeline/TimelinePostItem';
import { TimelinePostModal } from '../components/timeline/TimelinePostModal';
import type { UploadedMedia } from '../components/timeline/types';

interface TimelinePageProps {
  actor: Actor;
}

// File size limits
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

type TabType = 'following' | string;

export function TimelinePage({ actor }: TimelinePageProps) {
  const { t } = useI18n();
  const { error, setError, clearError } = useInlineError();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [communities, setCommunities] = useState<CommunityDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [postContent, setPostContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('following');
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Story state
  const [actorStories, setActorStories] = useState<ActorStories[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [showStoryViewer, setShowStoryViewer] = useState(false);
  const [storyViewerActorIndex, setStoryViewerActorIndex] = useState(0);
  const [showStoryComposer, setShowStoryComposer] = useState(false);

  // Mobile menu state
  const [showMenu, setShowMenu] = useState(false);
  const [showAccountSwitcher, setShowAccountSwitcher] = useState(false);
  const [showPostModal, setShowPostModal] = useState(false);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [currentApId, setCurrentApId] = useState<string>('');
  const [accountsLoading, setAccountsLoading] = useState(false);

  const loadAccounts = async () => {
    setAccountsLoading(true);
    try {
      const data = await fetchAccounts();
      setAccounts(data.accounts);
      setCurrentApId(data.current_ap_id);
    } catch (e) {
      console.error('Failed to load accounts:', e);
      setError(t('common.error'));
    } finally {
      setAccountsLoading(false);
    }
  };

  const handleSwitchAccount = async (apId: string) => {
    if (apId === currentApId) return;
    try {
      await switchAccount(apId);
      window.location.reload();
    } catch (e) {
      console.error('Failed to switch account:', e);
      setError(t('common.error'));
    }
  };

  const handleOpenMenu = () => {
    setShowMenu(true);
    loadAccounts();
  };

  const handleCloseMenu = () => {
    setShowMenu(false);
    setShowAccountSwitcher(false);
  };

  const handleClosePostModal = () => {
    setShowPostModal(false);
    setPostContent('');
    // Revoke all object URLs before clearing media to prevent memory leaks
    uploadedMedia.forEach(media => {
      if (media.preview) {
        URL.revokeObjectURL(media.preview);
      }
    });
    setUploadedMedia([]);
    setUploadError(null);
  };

  useEffect(() => {
    fetchCommunities()
      .then(setCommunities)
      .catch((err) => {
        console.error('Failed to load communities:', err);
        setError(t('common.error'));
      });
    loadStories();
  }, []);

  // Cleanup object URLs on unmount to prevent memory leaks
  useEffect(() => {
    return () => {
      uploadedMedia.forEach(media => {
        if (media.preview) {
          URL.revokeObjectURL(media.preview);
        }
      });
    };
  }, [uploadedMedia]);

  const loadStories = async () => {
    try {
      const data = await fetchStories();
      setActorStories(data);
    } catch (e) {
      console.error('Failed to load stories:', e);
      setError(t('common.error'));
    } finally {
      setStoriesLoading(false);
    }
  };

  const handleStoryClick = (stories: ActorStories, index: number) => {
    // Find the actual index in the actorStories array
    const actualIndex = actorStories.findIndex(as => as.actor.ap_id === stories.actor.ap_id);
    if (actualIndex >= 0) {
      setStoryViewerActorIndex(actualIndex);
      setShowStoryViewer(true);
    }
  };

  const handleAddStory = () => {
    setShowStoryComposer(true);
  };

  const handleStorySuccess = () => {
    loadStories();
  };

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setHasMore(true);
    try {
      let loadedPosts: Post[];
      if (activeTab === 'following') {
        loadedPosts = await fetchFollowingTimeline({ limit: 20 });
      } else {
        loadedPosts = await fetchTimeline({ limit: 20, community: activeTab });
      }
      setPosts(loadedPosts);
      setHasMore(loadedPosts.length >= 20);
    } catch (e) {
      console.error('Failed to load timeline:', e);
      setError(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || posts.length === 0) return;
    setLoadingMore(true);
    try {
      const lastPost = posts[posts.length - 1];
      let newPosts: Post[];
      if (activeTab === 'following') {
        newPosts = await fetchFollowingTimeline({ limit: 20, before: lastPost.ap_id });
      } else {
        newPosts = await fetchTimeline({ limit: 20, community: activeTab, before: lastPost.ap_id });
      }
      if (newPosts.length > 0) {
        setPosts(prev => [...prev, ...newPosts]);
      }
      setHasMore(newPosts.length >= 20);
    } catch (e) {
      console.error('Failed to load more:', e);
      setError(t('common.error'));
    } finally {
      setLoadingMore(false);
    }
  }, [activeTab, loadingMore, hasMore, posts]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

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

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploadError(null);
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (uploadedMedia.length >= 4) break;

        // Size check
        if (file.size > MAX_IMAGE_SIZE) {
          setUploadError(`画像サイズが大きすぎます（最大${MAX_IMAGE_SIZE / 1024 / 1024}MB）`);
          continue;
        }

        const result = await uploadMedia(file);
        const preview = URL.createObjectURL(file);
        setUploadedMedia(prev => [...prev, {
          r2_key: result.r2_key,
          content_type: result.content_type,
          preview,
        }]);
      }
    } catch (err) {
      console.error('Failed to upload:', err);
      setError(t('common.error'));
      setUploadError('アップロードに失敗しました');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeMedia = (index: number) => {
    setUploadedMedia(prev => {
      // Revoke the object URL to prevent memory leak
      const media = prev[index];
      if (media?.preview) {
        URL.revokeObjectURL(media.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handlePost = async (): Promise<boolean> => {
    if ((!postContent.trim() && uploadedMedia.length === 0) || posting) return false;
    setPosting(true);
    try {
      const newPost = await createPost({
        content: postContent.trim(),
        community_ap_id: activeTab !== 'following' ? activeTab : undefined,
        attachments: uploadedMedia.length > 0 ? uploadedMedia.map(m => ({ r2_key: m.r2_key, content_type: m.content_type })) : undefined,
      });
      if (newPost) {
        setPosts(prev => [newPost, ...prev]);
        setPostContent('');
        // Revoke all object URLs after successful post to prevent memory leaks
        uploadedMedia.forEach(media => {
          if (media.preview) {
            URL.revokeObjectURL(media.preview);
          }
        });
        setUploadedMedia([]);
        return true;
      }
      return false;
    } catch (e) {
      console.error('Failed to create post:', e);
      setError(t('common.error'));
      return false;
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.ap_id);
        setPosts(prev => prev.map(p =>
          p.ap_id === post.ap_id ? { ...p, liked: false, like_count: p.like_count - 1 } : p
        ));
      } else {
        await likePost(post.ap_id);
        setPosts(prev => prev.map(p =>
          p.ap_id === post.ap_id ? { ...p, liked: true, like_count: p.like_count + 1 } : p
        ));
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
      setError(t('common.error'));
    }
  };

  const handleBookmark = async (post: Post) => {
    try {
      if (post.bookmarked) {
        await unbookmarkPost(post.ap_id);
        setPosts(prev => prev.map(p =>
          p.ap_id === post.ap_id ? { ...p, bookmarked: false } : p
        ));
      } else {
        await bookmarkPost(post.ap_id);
        setPosts(prev => prev.map(p =>
          p.ap_id === post.ap_id ? { ...p, bookmarked: true } : p
        ));
      }
    } catch (e) {
      console.error('Failed to toggle bookmark:', e);
      setError(t('common.error'));
    }
  };

  const handleRepost = async (post: Post) => {
    try {
      if (post.reposted) {
        await unrepostPost(post.ap_id);
        setPosts(prev => prev.map(p =>
          p.ap_id === post.ap_id ? { ...p, reposted: false, announce_count: p.announce_count - 1 } : p
        ));
      } else {
        await repostPost(post.ap_id);
        setPosts(prev => prev.map(p =>
          p.ap_id === post.ap_id ? { ...p, reposted: true, announce_count: p.announce_count + 1 } : p
        ));
      }
    } catch (e) {
      console.error('Failed to toggle repost:', e);
      setError(t('common.error'));
    }
  };

  const getPlaceholder = () => {
    if (activeTab === 'following') return t('posts.placeholder');
    const community = communities.find(c => c.ap_id === activeTab);
    return community ? `${community.name}に投稿` : t('posts.placeholder');
  };

  return (
    <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
      {/* Story Viewer Modal */}
      {showStoryViewer && actorStories.length > 0 && (
        <StoryViewer
          actorStories={actorStories}
          initialActorIndex={storyViewerActorIndex}
          onClose={() => {
            setShowStoryViewer(false);
            loadStories(); // Refresh to update viewed status
          }}
        />
      )}

      {/* Story Composer Modal */}
      {showStoryComposer && (
        <StoryComposer
          onClose={() => setShowStoryComposer(false)}
          onSuccess={handleStorySuccess}
        />
      )}

      <TimelineMobileMenu
        isOpen={showMenu}
        actor={actor}
        accounts={accounts}
        accountsLoading={accountsLoading}
        currentApId={currentApId}
        showAccountSwitcher={showAccountSwitcher}
        onToggleAccountSwitcher={() => setShowAccountSwitcher((prev) => !prev)}
        onSwitchAccount={handleSwitchAccount}
        onClose={handleCloseMenu}
        t={t}
      />

      <TimelineHeader
        actor={actor}
        communities={communities}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onOpenMenu={handleOpenMenu}
        title={t('timeline.title')}
        followingLabel={t('timeline.following')}
      />

      {/* Story Bar */}
      <StoryBar
        actor={actor}
        actorStories={actorStories}
        loading={storiesLoading}
        onStoryClick={handleStoryClick}
        onAddStory={handleAddStory}
      />

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : posts.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">{t('timeline.empty')}</div>
        ) : (
          <>
            {posts.map((post) => (
              <TimelinePostItem
                key={post.ap_id}
                post={post}
                onReply={() => navigate(`/post/${encodeURIComponent(post.ap_id)}`)}
                onRepost={handleRepost}
                onLike={handleLike}
                onBookmark={handleBookmark}
              />
            ))}            {loadingMore && <div className="p-4 text-center text-neutral-500">{t('common.loading')}</div>}
            {!hasMore && posts.length > 0 && <div className="p-4 text-center text-neutral-600 text-sm">これ以上の投稿はありません</div>}
          </>
        )}
      </div>

      {/* Floating Action Button */}
      <button
        onClick={() => setShowPostModal(true)}
        aria-label="Create post"
        className="fixed bottom-20 right-4 md:bottom-8 md:right-8 w-14 h-14 bg-blue-500 hover:bg-blue-600 rounded-full shadow-lg flex items-center justify-center text-white transition-colors z-40"
      >
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
      </button>

      <TimelinePostModal
        isOpen={showPostModal}
        actor={actor}
        postContent={postContent}
        onPostContentChange={setPostContent}
        placeholder={getPlaceholder()}
        submitLabel={t('posts.post')}
        submittingLabel="投稿中..."
        onClose={handleClosePostModal}
        onSubmit={handlePost}
        posting={posting}
        fileInputRef={fileInputRef}
        onFileSelect={handleFileSelect}
        uploadedMedia={uploadedMedia}
        onRemoveMedia={removeMedia}
        uploading={uploading}
        uploadError={uploadError}
      />
    </div>
  );
}
