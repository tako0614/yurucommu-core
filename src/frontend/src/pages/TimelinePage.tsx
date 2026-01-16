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
  repostPost,
  unrepostPost,
  bookmarkPost,
  unbookmarkPost,
  uploadMedia,
  fetchAccounts,
  switchAccount,
  AccountInfo,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';
import { StoryBar, StoryViewer, StoryComposer } from '../components/story';

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

const RepostIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={filled ? 2.5 : 2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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

const CloseIconLarge = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// Menu Icons
const HomeIconMenu = ({ active }: { active?: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
  </svg>
);

const GroupIconMenu = ({ active }: { active?: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

const MessageIconMenu = ({ active }: { active?: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const BellIconMenu = ({ active }: { active?: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
  </svg>
);

const ProfileIconMenu = ({ active }: { active?: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
  </svg>
);

const BookmarkIconMenu = ({ active }: { active?: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
  </svg>
);

const SettingsIconMenu = ({ active }: { active?: boolean }) => (
  <svg className="w-6 h-6" fill={active ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

// File size limits
const MAX_IMAGE_SIZE = 20 * 1024 * 1024; // 20MB

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
    }
  };

  const handleOpenMenu = () => {
    setShowMenu(true);
    loadAccounts();
  };

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
      setUploadError('アップロードに失敗しました');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeMedia = (index: number) => {
    setUploadedMedia(prev => prev.filter((_, i) => i !== index));
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
        setUploadedMedia([]);
        return true;
      }
      return false;
    } catch (e) {
      console.error('Failed to create post:', e);
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

      {/* Mobile Menu Overlay */}
      {showMenu && (
        <div className="fixed inset-0 z-50 md:hidden">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => { setShowMenu(false); setShowAccountSwitcher(false); }}
          />
          {/* Slide-in Menu */}
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-black border-r border-neutral-800 animate-slide-in overflow-y-auto">
            {/* Profile Header */}
            <div className="p-4 border-b border-neutral-800">
              {/* Avatar and Account Switcher Toggle */}
              <div className="flex items-center justify-between mb-3">
                <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.username} size={48} />
                <button
                  onClick={() => setShowAccountSwitcher(!showAccountSwitcher)}
                  className="p-2 rounded-full border border-neutral-700 hover:bg-neutral-800 transition-colors"
                >
                  <svg className={`w-4 h-4 transition-transform ${showAccountSwitcher ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              {/* Name and Username */}
              <p className="font-bold text-white text-lg">{actor.name || actor.username}</p>
              <p className="text-neutral-500">@{actor.username}</p>
              {/* Follow/Follower counts */}
              <div className="flex gap-4 mt-3">
                <Link to={`/profile/${encodeURIComponent(actor.ap_id)}/following`} onClick={() => setShowMenu(false)} className="hover:underline">
                  <span className="font-bold text-white">{actor.following_count || 0}</span>
                  <span className="text-neutral-500 ml-1">{t('profile.following')}</span>
                </Link>
                <Link to={`/profile/${encodeURIComponent(actor.ap_id)}/followers`} onClick={() => setShowMenu(false)} className="hover:underline">
                  <span className="font-bold text-white">{actor.follower_count || 0}</span>
                  <span className="text-neutral-500 ml-1">{t('profile.followers')}</span>
                </Link>
              </div>
            </div>

            {/* Account Switcher */}
            {showAccountSwitcher && (
              <div className="border-b border-neutral-800">
                {accountsLoading ? (
                  <div className="p-4 text-center text-neutral-500">読み込み中...</div>
                ) : (
                  <div className="py-2">
                    {accounts.map((account) => (
                      <button
                        key={account.ap_id}
                        onClick={() => handleSwitchAccount(account.ap_id)}
                        className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 transition-colors ${
                          account.ap_id === currentApId ? 'bg-neutral-900/50' : ''
                        }`}
                      >
                        <UserAvatar avatarUrl={account.icon_url} name={account.name || account.preferred_username} size={40} />
                        <div className="flex-1 text-left">
                          <p className="font-bold text-white">{account.name || account.preferred_username}</p>
                          <p className="text-sm text-neutral-500">@{account.preferred_username}</p>
                        </div>
                        {account.ap_id === currentApId && (
                          <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Navigation */}
            <nav className="p-2">
              <Link to="/profile" onClick={() => setShowMenu(false)} className="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors">
                <ProfileIconMenu />
                <span className="text-lg">{t('nav.profile')}</span>
              </Link>
              <Link to="/bookmarks" onClick={() => setShowMenu(false)} className="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors">
                <BookmarkIconMenu />
                <span className="text-lg">{t('nav.bookmarks')}</span>
              </Link>
              <Link to="/settings" onClick={() => setShowMenu(false)} className="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors">
                <SettingsIconMenu />
                <span className="text-lg">{t('nav.settings')}</span>
              </Link>
            </nav>
          </div>
        </div>
      )}

      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Mobile: User avatar button that opens menu */}
          <button
            onClick={handleOpenMenu}
            aria-label="Open menu"
            className="md:hidden"
          >
            <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.username} size={32} />
          </button>
          {/* Desktop: Show text title */}
          <h1 className="hidden md:block text-xl font-bold">{t('timeline.title')}</h1>
          {/* Mobile: Notification heart icon */}
          <Link to="/notifications" aria-label="Notifications" className="md:hidden p-2 text-white hover:text-pink-500 transition-colors">
            <HeartIcon filled={false} />
          </Link>
        </div>
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
                    <button
                      onClick={() => navigate(`/post/${encodeURIComponent(post.ap_id)}`)}
                      aria-label="Reply"
                      className="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors"
                    >
                      <ReplyIcon />
                      <span className="text-sm">{post.reply_count || ''}</span>
                    </button>
                    <button
                      onClick={() => handleRepost(post)}
                      aria-label={post.reposted ? 'Undo repost' : 'Repost'}
                      aria-pressed={post.reposted}
                      className={`flex items-center gap-2 transition-colors ${post.reposted ? 'text-green-500' : 'text-neutral-500 hover:text-green-500'}`}
                    >
                      <RepostIcon filled={post.reposted} />
                      {post.announce_count > 0 && <span className="text-sm">{post.announce_count}</span>}
                    </button>
                    <button
                      onClick={() => handleLike(post)}
                      aria-label={post.liked ? 'Unlike' : 'Like'}
                      aria-pressed={post.liked}
                      className={`flex items-center gap-2 transition-colors ${post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'}`}
                    >
                      <HeartIcon filled={post.liked} />
                      {post.like_count > 0 && <span className="text-sm">{post.like_count}</span>}
                    </button>
                    <button
                      onClick={() => handleBookmark(post)}
                      aria-label={post.bookmarked ? 'Remove bookmark' : 'Bookmark'}
                      aria-pressed={post.bookmarked}
                      className={`flex items-center gap-2 transition-colors ${post.bookmarked ? 'text-blue-500' : 'text-neutral-500 hover:text-blue-500'}`}
                    >
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

      {/* Post Modal */}
      {showPostModal && (
        <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 p-4 pt-12">
          <div className="bg-black w-full max-w-lg rounded-2xl border border-neutral-800">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
              <button
                onClick={() => {
                  setShowPostModal(false);
                  setPostContent('');
                  setUploadedMedia([]);
                  setUploadError(null);
                }}
                aria-label="Close"
                className="text-white hover:text-neutral-400 transition-colors"
              >
                <CloseIconLarge />
              </button>
              <button
                onClick={async () => {
                  const success = await handlePost();
                  if (success) {
                    setShowPostModal(false);
                  }
                }}
                disabled={(!postContent.trim() && uploadedMedia.length === 0) || posting}
                className="px-4 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-full font-bold text-sm transition-colors"
              >
                {posting ? '投稿中...' : t('posts.post')}
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-4">
              <div className="flex gap-3">
                <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.username} size={48} />
                <div className="flex-1">
                  <textarea
                    value={postContent}
                    onChange={e => setPostContent(e.target.value)}
                    placeholder={getPlaceholder()}
                    className="w-full bg-transparent text-white placeholder-neutral-500 resize-none outline-none text-lg min-h-[120px]"
                    autoFocus
                  />
                  {uploadedMedia.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {uploadedMedia.map((media, idx) => (
                        <div key={idx} className="relative">
                          <img src={media.preview} alt="" className="w-20 h-20 object-cover rounded-lg" />
                          <button
                            onClick={() => removeMedia(idx)}
                            aria-label="Remove media"
                            className="absolute -top-1 -right-1 bg-black/70 rounded-full p-0.5 hover:bg-black"
                          >
                            <CloseIcon />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-neutral-800">
              <input ref={fileInputRef} type="file" accept="image/*" multiple onChange={handleFileSelect} className="hidden" />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading || uploadedMedia.length >= 4}
                aria-label="Add image"
                className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-full disabled:opacity-50 transition-colors"
              >
                <ImageIcon />
              </button>
              {uploading && <span className="text-sm text-neutral-500">アップロード中...</span>}
              {uploadError && <span className="text-sm text-red-500">{uploadError}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
