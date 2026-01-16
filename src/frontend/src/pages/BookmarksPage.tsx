import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Post, Actor } from '../types';
import { fetchBookmarks, likePost, unlikePost, unbookmarkPost } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';

interface BookmarksPageProps {
  actor: Actor;
}

const HeartIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
  </svg>
);

const BookmarkIcon = ({ filled }: { filled: boolean }) => (
  <svg className="w-5 h-5" fill={filled ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
  </svg>
);

export function BookmarksPage({ actor }: BookmarksPageProps) {
  const { t } = useI18n();
  const [posts, setPosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadBookmarks();
  }, []);

  const loadBookmarks = async () => {
    try {
      const data = await fetchBookmarks();
      setPosts(data);
    } catch (e) {
      console.error('Failed to load bookmarks:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async (post: Post) => {
    try {
      if (post.liked) {
        await unlikePost(post.ap_id);
        setPosts(prev => prev.map(p => p.ap_id === post.ap_id ? { ...p, liked: false, like_count: p.like_count - 1 } : p));
      } else {
        await likePost(post.ap_id);
        setPosts(prev => prev.map(p => p.ap_id === post.ap_id ? { ...p, liked: true, like_count: p.like_count + 1 } : p));
      }
    } catch (e) {
      console.error('Failed to toggle like:', e);
    }
  };

  const handleUnbookmark = async (postApId: string) => {
    try {
      await unbookmarkPost(postApId);
      setPosts(prev => prev.filter(p => p.ap_id !== postApId));
    } catch (e) {
      console.error('Failed to unbookmark:', e);
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

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 className="text-xl font-bold px-4 py-3">Bookmarks</h1>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : posts.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">No bookmarks yet</div>
        ) : (
          posts.map(post => (
            <div key={post.ap_id} className="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
              <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`}>
                <UserAvatar avatarUrl={post.author.icon_url} name={post.author.name || post.author.preferred_username} size={48} />
              </Link>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <Link to={`/profile/${encodeURIComponent(post.author.ap_id)}`} className="font-bold text-white truncate hover:underline">
                    {post.author.name || post.author.preferred_username}
                  </Link>
                  <span className="text-neutral-500 truncate">@{post.author.username}</span>
                  <span className="text-neutral-500">·</span>
                  <span className="text-neutral-500 text-sm">{formatTime(post.published)}</span>
                </div>
                <Link to={`/post/${encodeURIComponent(post.ap_id)}`}>
                  <PostContent content={post.content} className="text-[15px] text-neutral-200 mt-1" />
                </Link>
                <div className="flex items-center gap-6 mt-3">
                  <button
                    onClick={() => handleLike(post)}
                    aria-label={post.liked ? 'Unlike' : 'Like'}
                    aria-pressed={post.liked}
                    className={`flex items-center gap-2 transition-colors ${post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'}`}
                  >
                    <HeartIcon filled={post.liked || false} />
                    {post.author.ap_id === actor.ap_id && post.like_count > 0 && (
                      <span className="text-sm">{post.like_count}</span>
                    )}
                  </button>
                  <button
                    onClick={() => handleUnbookmark(post.ap_id)}
                    aria-label="Remove bookmark"
                    className="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors"
                    title="Remove bookmark"
                  >
                    <BookmarkIcon filled={true} />
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
