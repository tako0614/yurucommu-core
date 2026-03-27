import { useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { atom } from 'jotai';
import { useAtom } from 'jotai';
import { useRequiredActor } from '../hooks/useRequiredActor';
import { Post } from '../types';
import { fetchBookmarks, likePost, unlikePost, unbookmarkPost } from '../lib/api';
import { formatRelativeTime } from '../lib/datetime';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { PostContent } from '../components/PostContent';
import { HeartIcon, BookmarkIcon } from '../components/icons/SocialIcons';
import { InlineErrorBanner } from '../components/InlineErrorBanner';

// Atoms defined at module level
const bookmarks_errorAtom = atom<string | null>(null);
const bookmarks_postsAtom = atom<Post[]>([]);
const bookmarks_loadingAtom = atom(true);

export function BookmarksPage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const [error, setError] = useAtom(bookmarks_errorAtom);
  const clearError = useCallback(() => setError(null), [setError]);
  const [posts, setPosts] = useAtom(bookmarks_postsAtom);
  const [loading, setLoading] = useAtom(bookmarks_loadingAtom);

  useEffect(() => {
    loadBookmarks();
  }, []);

  const loadBookmarks = async () => {
    // Only show loading if no cached data
    if (posts.length === 0) setLoading(true);
    try {
      const data = await fetchBookmarks();
      setPosts(data);
    } catch (e) {
      console.error('Failed to load bookmarks:', e);
      setError(t('common.error'));
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
      setError(t('common.error'));
    }
  };

  const handleUnbookmark = async (postApId: string) => {
    try {
      await unbookmarkPost(postApId);
      setPosts(prev => prev.filter(p => p.ap_id !== postApId));
    } catch (e) {
      console.error('Failed to unbookmark:', e);
      setError(t('common.error'));
    }
  };

  return (
    <div className="flex flex-col h-full">
      {error && (
        <InlineErrorBanner message={error} onClose={clearError} />
      )}
      <header className="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
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
                  <span className="text-neutral-500 text-sm">{formatRelativeTime(post.published)}</span>
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

export default BookmarksPage;
