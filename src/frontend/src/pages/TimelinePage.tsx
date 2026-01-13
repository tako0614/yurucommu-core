import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Post, Member, Community, MediaAttachment } from '../types';
import {
  fetchTimeline,
  fetchCommunities,
  createPost,
  likePost,
  unlikePost,
  repostPost,
  unrepostPost,
  bookmarkPost,
  unbookmarkPost,
  uploadFile,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';

interface TimelinePageProps {
  currentMember: Member;
}

// Icons
const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);

const RepostIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
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

const GlobeIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const UnlistedIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
  </svg>
);

const FollowersIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
  </svg>
);

interface UploadedMedia {
  r2_key: string;
  content_type: string;
  preview: string;
}

type TabType = 'following' | string; // 'following' or community id

export function TimelinePage({ currentMember }: TimelinePageProps) {
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
  const [visibility, setVisibility] = useState<'public' | 'unlisted' | 'followers'>('public');
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Load communities on mount
  useEffect(() => {
    fetchCommunities().then(data => {
      setCommunities(data.communities || []);
    }).catch(e => {
      console.error('Failed to load communities:', e);
    });
  }, []);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setHasMore(true);
    try {
      let data;
      if (activeTab === 'following') {
        data = await fetchTimeline({ limit: 20, filter: 'following' });
      } else {
        data = await fetchTimeline({ limit: 20, filter: 'community', communityId: activeTab });
      }
      const loadedPosts = data.posts || [];
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
      let data;
      if (activeTab === 'following') {
        data = await fetchTimeline({ limit: 20, filter: 'following', before: lastPost.id });
      } else {
        data = await fetchTimeline({ limit: 20, filter: 'community', communityId: activeTab, before: lastPost.id });
      }
      const newPosts = data.posts || [];
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

  // Infinite scroll handler
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
        if (uploadedMedia.length >= 4) break; // Max 4 images
        const result = await uploadFile(file);
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
      const postData: { content: string; community_id?: string; media?: { r2_key: string; content_type: string }[]; visibility?: 'public' | 'unlisted' | 'followers' } = {
        content: postContent.trim(),
        visibility,
      };
      // If posting to a community, include community_id
      if (activeTab !== 'following') {
        postData.community_id = activeTab;
      }
      // Add media if present
      if (uploadedMedia.length > 0) {
        postData.media = uploadedMedia.map(m => ({ r2_key: m.r2_key, content_type: m.content_type }));
      }
      const newPost = await createPost(postData);
      setPosts(prev => [newPost, ...prev]);
      setPostContent('');
      setUploadedMedia([]);
      setVisibility('public');
    } catch (e) {
      console.error('Failed to create post:', e);
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.id);
        setPosts(prev => prev.map(p =>
          p.id === post.id ? { ...p, liked: false, like_count: p.like_count - 1 } : p
        ));
      } else {
        await likePost(post.id);
        setPosts(prev => prev.map(p =>
          p.id === post.id ? { ...p, liked: true, like_count: p.like_count + 1 } : p
        ));
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
    }
  };

  const handleRepost = async (post: Post) => {
    try {
      if (post.reposted) {
        await unrepostPost(post.id);
        setPosts(prev => prev.map(p =>
          p.id === post.id ? { ...p, reposted: false, repost_count: p.repost_count - 1 } : p
        ));
      } else {
        await repostPost(post.id);
        setPosts(prev => prev.map(p =>
          p.id === post.id ? { ...p, reposted: true, repost_count: p.repost_count + 1 } : p
        ));
      }
    } catch (e) {
      console.error('Failed to toggle repost:', e);
    }
  };

  const handleBookmark = async (post: Post) => {
    try {
      if (post.bookmarked) {
        await unbookmarkPost(post.id);
        setPosts(prev => prev.map(p =>
          p.id === post.id ? { ...p, bookmarked: false } : p
        ));
      } else {
        await bookmarkPost(post.id);
        setPosts(prev => prev.map(p =>
          p.id === post.id ? { ...p, bookmarked: true } : p
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
    if (activeTab === 'following') {
      return t('posts.placeholder');
    }
    const community = communities.find(c => c.id === activeTab);
    return community ? `${community.name}に投稿` : t('posts.placeholder');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 className="text-xl font-bold px-4 py-3">{t('timeline.title')}</h1>
        {/* Tabs */}
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
              key={community.id}
              onClick={() => setActiveTab(community.id)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap relative transition-colors ${
                activeTab === community.id ? 'text-white' : 'text-neutral-500 hover:bg-neutral-900/50'
              }`}
            >
              {community.name}
              {activeTab === community.id && (
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-12 h-1 bg-blue-500 rounded-full" />
              )}
            </button>
          ))}
        </div>
      </header>

      {/* Compose */}
      <div className="border-b border-neutral-900 p-4">
        <div className="flex gap-3">
          <UserAvatar
            avatarUrl={currentMember.avatar_url}
            name={currentMember.display_name || currentMember.username}
            size={48}
          />
          <div className="flex-1">
            <textarea
              value={postContent}
              onChange={e => setPostContent(e.target.value)}
              placeholder={getPlaceholder()}
              className="w-full bg-transparent text-white placeholder-neutral-500 resize-none outline-none text-lg"
              rows={3}
            />
            {/* Image preview */}
            {uploadedMedia.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {uploadedMedia.map((media, idx) => (
                  <div key={idx} className="relative">
                    <img
                      src={media.preview}
                      alt=""
                      className="w-20 h-20 object-cover rounded-lg"
                    />
                    <button
                      onClick={() => removeMedia(idx)}
                      className="absolute -top-1 -right-1 bg-black/70 rounded-full p-0.5 hover:bg-black"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="flex items-center justify-between mt-2">
              <div className="flex items-center gap-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading || uploadedMedia.length >= 4}
                  className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-full disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title="画像を追加"
                >
                  <ImageIcon />
                </button>
                <div className="relative group">
                  <button
                    className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-full transition-colors flex items-center gap-1"
                    title="公開範囲"
                  >
                    {visibility === 'public' && <GlobeIcon />}
                    {visibility === 'unlisted' && <UnlistedIcon />}
                    {visibility === 'followers' && <FollowersIcon />}
                  </button>
                  <div className="absolute left-0 bottom-full mb-1 hidden group-hover:block bg-neutral-800 rounded-lg shadow-lg py-1 min-w-[140px] z-20">
                    <button
                      onClick={() => setVisibility('public')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-700 ${visibility === 'public' ? 'text-blue-500' : 'text-white'}`}
                    >
                      <GlobeIcon /> 公開
                    </button>
                    <button
                      onClick={() => setVisibility('unlisted')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-700 ${visibility === 'unlisted' ? 'text-blue-500' : 'text-white'}`}
                    >
                      <UnlistedIcon /> 非収載
                    </button>
                    <button
                      onClick={() => setVisibility('followers')}
                      className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-neutral-700 ${visibility === 'followers' ? 'text-blue-500' : 'text-white'}`}
                    >
                      <FollowersIcon /> フォロワーのみ
                    </button>
                  </div>
                </div>
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

      {/* Timeline */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : posts.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">{t('timeline.empty')}</div>
        ) : (
          <>
          {posts.map(post => (
            <div
              key={post.id}
              className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors"
            >
              <Link to={`/profile/${post.member_id}`}>
                <UserAvatar
                  avatarUrl={post.avatar_url}
                  name={post.display_name || post.username}
                  size={48}
                />
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <Link to={`/profile/${post.member_id}`} className="font-bold text-white truncate hover:underline">
                    {post.display_name || post.username}
                  </Link>
                  <span className="text-neutral-500 truncate">@{post.username}</span>
                  <span className="text-neutral-500">·</span>
                  <span className="text-neutral-500 text-sm">{formatTime(post.created_at)}</span>
                </div>
                <Link to={`/post/${post.id}`} className="block">
                  <PostContent
                    content={post.content}
                    className="text-[15px] text-neutral-200 mt-1"
                  />
                  {/* Post Images */}
                  {post.media_json && (() => {
                    try {
                      const media: MediaAttachment[] = JSON.parse(post.media_json);
                      if (media.length === 0) return null;
                      return (
                        <div className={`mt-3 grid gap-1 rounded-xl overflow-hidden ${
                          media.length === 1 ? 'grid-cols-1' :
                          media.length === 2 ? 'grid-cols-2' :
                          media.length === 3 ? 'grid-cols-2' : 'grid-cols-2'
                        }`}>
                          {media.map((m, idx) => (
                            <img
                              key={idx}
                              src={`/media/${m.r2_key}`}
                              alt=""
                              className={`w-full object-cover ${
                                media.length === 1 ? 'max-h-96' :
                                media.length === 3 && idx === 0 ? 'row-span-2 h-full' : 'h-40'
                              }`}
                            />
                          ))}
                        </div>
                      );
                    } catch { return null; }
                  })()}
                </Link>
                {/* Actions */}
                <div className="flex items-center gap-6 mt-3">
                  <button
                    onClick={() => navigate(`/post/${post.id}`)}
                    className="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors"
                  >
                    <ReplyIcon />
                    <span className="text-sm">{post.reply_count || ''}</span>
                  </button>
                  <button
                    onClick={() => handleRepost(post)}
                    className={`flex items-center gap-2 transition-colors ${
                      post.reposted ? 'text-green-500' : 'text-neutral-500 hover:text-green-500'
                    }`}
                  >
                    <RepostIcon />
                    <span className="text-sm">{post.repost_count || ''}</span>
                  </button>
                  <button
                    onClick={() => handleLike(post)}
                    className={`flex items-center gap-2 transition-colors ${
                      post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'
                    }`}
                  >
                    <HeartIcon filled={post.liked || false} />
                    {post.member_id === currentMember.id && post.like_count > 0 && (
                      <span className="text-sm">{post.like_count}</span>
                    )}
                  </button>
                  <button
                    onClick={() => handleBookmark(post)}
                    className={`flex items-center gap-2 transition-colors ${
                      post.bookmarked ? 'text-blue-500' : 'text-neutral-500 hover:text-blue-500'
                    }`}
                  >
                    <BookmarkIcon filled={post.bookmarked || false} />
                  </button>
                </div>
              </div>
            </div>
          ))}
          {loadingMore && (
            <div className="p-4 text-center text-neutral-500">{t('common.loading')}</div>
          )}
          {!hasMore && posts.length > 0 && (
            <div className="p-4 text-center text-neutral-600 text-sm">
              これ以上の投稿はありません
            </div>
          )}
          </>
        )}
      </div>
    </div>
  );
}
