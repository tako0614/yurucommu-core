import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Post, Member, Community } from '../types';
import {
  fetchTimeline,
  fetchCommunities,
  createPost,
  likePost,
  unlikePost,
  repostPost,
  unrepostPost,
} from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';

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

type TabType = 'following' | string; // 'following' or community id

export function TimelinePage({ currentMember }: TimelinePageProps) {
  const { t } = useI18n();
  const [posts, setPosts] = useState<Post[]>([]);
  const [communities, setCommunities] = useState<Community[]>([]);
  const [loading, setLoading] = useState(true);
  const [postContent, setPostContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [activeTab, setActiveTab] = useState<TabType>('following');

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
    try {
      let data;
      if (activeTab === 'following') {
        data = await fetchTimeline({ limit: 50, filter: 'following' });
      } else {
        data = await fetchTimeline({ limit: 50, filter: 'community', communityId: activeTab });
      }
      setPosts(data.posts || []);
    } catch (e) {
      console.error('Failed to load timeline:', e);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const handlePost = async () => {
    if (!postContent.trim() || posting) return;
    setPosting(true);
    try {
      const postData: { content: string; community_id?: string } = {
        content: postContent.trim(),
      };
      // If posting to a community, include community_id
      if (activeTab !== 'following') {
        postData.community_id = activeTab;
      }
      const newPost = await createPost(postData);
      setPosts(prev => [newPost, ...prev]);
      setPostContent('');
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
            <div className="flex justify-end mt-2">
              <button
                onClick={handlePost}
                disabled={!postContent.trim() || posting}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-full font-bold transition-colors"
              >
                {t('posts.post')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : posts.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">{t('timeline.empty')}</div>
        ) : (
          posts.map(post => (
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
                <p className="text-[15px] text-neutral-200 whitespace-pre-wrap break-words mt-1">
                  {post.content}
                </p>
                {/* Actions */}
                <div className="flex items-center gap-6 mt-3">
                  <button className="flex items-center gap-2 text-neutral-500 hover:text-blue-500 transition-colors">
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
                    <span className="text-sm">{post.like_count || ''}</span>
                  </button>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
