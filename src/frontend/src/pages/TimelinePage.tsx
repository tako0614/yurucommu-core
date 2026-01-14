import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Post, Actor, Community, ActorStories } from '../types';
import {
  fetchTimeline,
  fetchFollowingTimeline,
  fetchCommunities,
  fetchStories,
  createPost,
  likePost,
  unlikePost,
  bookmarkPost,
  unbookmarkPost,
  uploadMedia,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';
import { StoryBar } from '../components/StoryBar';
import { StoryViewer } from '../components/StoryViewer';
import { StoryComposer } from '../components/StoryComposer';

interface TimelinePageProps {
  actor: Actor;
}

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);

const ReplyIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const BookmarkIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
  </svg>
);

const ImageIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

interface UploadedMedia {
  r2_key: string;
  content_type: string;
  preview: string;
}

type TabType = 'following' | string;

export function TimelinePage({ actor }: TimelinePageProps) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [postContent, setPostContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('following');
  const [uploadedMedia, setUploadedMedia] = useState<UploadedMedia[]>([]);
  const [uploading, setUploading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Story state
  const [actorStories, setActorStories] = useState<ActorStories[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(true);
  const [showStoryViewer, setShowStoryViewer] = useState(false);
  const [storyViewerActorIndex, setStoryViewerActorIndex] = useState(0);
  const [showStoryComposer, setShowStoryComposer] = useState(false);

  useEffect(() => {
    fetchCommunities().then(setCommunities).catch(console.error);
    loadStories();
  }, []);

  const loadStories = async () => {
    try {
      const data = await fetchStories();
      setActorStories(data);
    } catch (e) {
      console.error('Failed to load stories:', e);
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
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (uploadedMedia.length >= 4) break;
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
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeMedia = (index: number) => {
    setUploadedMedia(prev => prev.filter((_, i) => i !== index));
  };

  const handlePost = async () => {
    if ((!postContent.trim() && uploadedMedia.length === 0) || posting) return;
    setPosting(true);
    try {
      const newPost = await createPost({
        content: postContent.trim(),
        community_ap_id: activeTab !== 'following' ? activeTab : undefined,
        attachments: uploadedMedia.length > 0 ? uploadedMedia.map(m => ({ r2_key: m.r2_key, content_type: m.content_type })) : undefined,
      });
      setPosts(prev => [newPost, ...prev]);
      setPostContent('');
      setUploadedMedia([]);
    } catch (e) {
      console.error('Failed to create post:', e);
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
    }
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffMins < 1) return 'now';
    if (diffMins < 60) return `${diffMins}m`;
    if (diffHours < 24) return `${diffHours}h`;
    if (diffDays < 7) return `${diffDays}d`;
    return date.toLocaleDateString();
  };

  const getPlaceholder = () => {
    if (activeTab === 'following') return t('posts.placeholder');
    const community = communities.find(c => c.ap_id === activeTab);
    return community ? `${community.name}に投稿` : t('posts.placeholder');
  };

  return (
    <div className="flex flex-col h-full">
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

      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 className="text-xl font-bold px-4 py-3">{t('timeline.title')}</h1>
        <div className="flex overflow-x-auto scrollbar-hide border-b border-neutral-900">
          <button
            onClick={() => setActiveTab('following')}
            className={`px-4 py-3 text-sm font-medium whitespace-nowrap relative transition-colors ${
              activeTab === 'following' ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
            }`}
          >
            {t('timeline.following')}
            {activeTab === 'following' && (
              <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />
            )}
          </button>
          {communities.map(community => (
            <button
              key={community.ap_id}
              onClick={() => setActiveTab(community.ap_id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap relative transition-colors ${
                activeTab === community.ap_id ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
              }`}
            >
              {community.name}
              {activeTab === community.ap_id && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Story Bar */}
      <StoryBar
        actor={actor}
        actorStories={actorStories}
        loading={storiesLoading}
        onStoryClick={handleStoryClick}
        onAddStory={handleAddStory}
      />

      <div className="border-b border-neutral-900 p-4">
        <div className="flex gap-3">
          <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.username} size={48} />
          <div className="flex-1">
            <textarea
              value={postContent}
              onChange={e => setPostContent(e.target.value)}
              placeholder={getPlaceholder()}
              className="w-full bg-transparent text-white placeholder-neutral-500 resize-none outline-none text-lg"
              rows={3}
            />
            {uploadedMedia.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {uploadedMedia.map((media, idx) => (
                  <div key={idx} className="relative">
                    <img src={media.preview} alt="" className="w-20 h-20 object-cover rounded-lg" />
                    <button onClick={() => removeMedia(idx)} className="absolute -top-1 -right-1 bg-black/70 rounded-full p-0.5 hover:bg-black">
                      <CloseIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || uploadedMedia.length >= 4}
                  className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-full disabled:opacity-50 transition-colors"
                >
                  <ImageIcon />
                </button>
                {uploading && <span className="text-sm text-neutral-500">アップロード中...</span>}
              </div>
              <button
                onClick={handlePost}
                disabled={(!postContent.trim() && uploadedMedia.length === 0) || posting}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-full font-bold transition-colors"
              >
                {t('posts.post')}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : posts.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">{t('timeline.empty')}</div>
        ) : (
          <>
            {posts.map(post => (
              <div key={post.ap_id} className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
                <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`}>
                  <UserAvatar avatarUrl={post.author.icon_url} name={post.author.name || post.author.username} size={48} />
                </Link>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`} className="font-bold text-white truncate hover:underline">
                      {post.author.name || post.author.username}
                    </Link>
                    <span className="text-neutral-500 truncate">@{post.author.username}</span>
                    <span className="text-neutral-500">·</span>
                    <span className="text-neutral-500 text-sm">{formatTime(post.published)}</span>
                  </div>
                  <Link to={`/post/${encodeURIComponent(post.ap_id)}`} className="block">
                    <PostContent content={post.content} className="text-[15px] text-neutral-200 mt-1" />
                    {post.attachments && post.attachments.length > 0 && (
                      <div className={`mt-3 grid gap-1 rounded-xl overflow-hidden ${
                        post.attachments.length === 1 ? 'grid-cols-1' : 'grid-cols-2'
                      }`}>
                        {post.attachments.map((m, idx) => (
                          <img key={idx} src={`/media/${m.r2_key}`} alt="" className="w-full object-cover max-h-96" />
                        ))}
                      </div>
                    )}
                  </Link>
                  <div className="flex items-center gap-6 mt-3">
                    <button onClick={() => navigate(`/post/${encodeURIComponent(post.ap_id)}`)} className="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors">
                      <ReplyIcon />
                      <span className="text-sm">{post.reply_count || ''}</span>
                    </button>
                    <button onClick={() => handleLike(post)} className={`flex items-center gap-2 transition-colors ${post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'}`}>
                      <HeartIcon filled={post.liked} />
                      {post.like_count > 0 && <span className="text-sm">{post.like_count}</span>}
                    </button>
                    <button onClick={() => handleBookmark(post)} className={`flex items-center gap-2 transition-colors ${post.bookmarked ? 'text-blue-500' : 'text-neutral-500 hover:text-blue-500'}`}>
                      <BookmarkIcon filled={post.bookmarked} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {loadingMore && <div className="p-4 text-center text-neutral-500">{t('common.loading')}</div>}
            {!hasMore && posts.length > 0 && <div className="p-4 text-center text-neutral-600 text-sm">これ以上の投稿はありません</div>}
          </>
        )}
      </div>
    </div>
  );
}
