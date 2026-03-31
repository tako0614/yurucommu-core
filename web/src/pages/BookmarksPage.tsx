import { onMount, Show, For } from 'solid-js';
import { A } from '@solidjs/router';
import { atom } from 'jotai';
import { useAtom } from 'solid-jotai';
import { useRequiredActor } from '../hooks/useRequiredActor.ts';
import { Post } from '../types/index.ts';
import { fetchBookmarks, likePost, unlikePost, unbookmarkPost } from '../lib/api.ts';
import { formatRelativeTime } from '../lib/datetime.ts';
import { useI18n } from '../lib/i18n.tsx';
import { UserAvatar } from '../components/UserAvatar.tsx';
import { PostContent } from '../components/PostContent.tsx';
import { HeartIcon, BookmarkIcon } from '../components/icons/SocialIcons.tsx';
import { InlineErrorBanner } from '../components/InlineErrorBanner.tsx';

// Atoms defined at module level
const bookmarks_errorAtom = atom<string | null>(null);
const bookmarks_postsAtom = atom<Post[]>([]);
const bookmarks_loadingAtom = atom(true);

export function BookmarksPage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const [error, setError] = useAtom(bookmarks_errorAtom);
  const clearError = () => setError(null);
  const [posts, setPosts] = useAtom(bookmarks_postsAtom);
  const [loading, setLoading] = useAtom(bookmarks_loadingAtom);

  onMount(() => {
    loadBookmarks();
  });

  const loadBookmarks = async () => {
    // Only show loading if no cached data
    if (posts().length === 0) setLoading(true);
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
    <div class="flex flex-col h-full">
      <Show when={error()}>
        <InlineErrorBanner message={error()!} onClose={clearError} />
      </Show>
      <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 class="text-xl font-bold px-4 py-3">Bookmarks</h1>
      </header>

      <div class="flex-1 overflow-y-auto">
        <Show when={!loading()} fallback={
          <div class="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        }>
          <Show when={posts().length > 0} fallback={
            <div class="p-8 text-center text-neutral-500">No bookmarks yet</div>
          }>
            <For each={posts()}>
              {(post) => (
                <div class="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
                  <A href={`/profile/${encodeURIComponent(post.author.ap_id)}`}>
                    <UserAvatar avatarUrl={post.author.icon_url} name={post.author.name || post.author.preferred_username} size={48} />
                  </A>
                  <div class="flex-1 min-w-0">
                    <div class="flex items-baseline gap-2">
                      <A href={`/profile/${encodeURIComponent(post.author.ap_id)}`} class="font-bold text-white truncate hover:underline">
                        {post.author.name || post.author.preferred_username}
                      </A>
                      <span class="text-neutral-500 truncate">@{post.author.username}</span>
                      <span class="text-neutral-500">·</span>
                      <span class="text-neutral-500 text-sm">{formatRelativeTime(post.published)}</span>
                    </div>
                    <A href={`/post/${encodeURIComponent(post.ap_id)}`}>
                      <PostContent content={post.content} class="text-[15px] text-neutral-200 mt-1" />
                    </A>
                    <div class="flex items-center gap-6 mt-3">
                      <button
                        onClick={() => handleLike(post)}
                        aria-label={post.liked ? 'Unlike' : 'Like'}
                        aria-pressed={post.liked}
                        class={`flex items-center gap-2 transition-colors ${post.liked ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-500'}`}
                      >
                        <HeartIcon filled={post.liked || false} />
                        <Show when={post.author.ap_id === actor.ap_id && post.like_count > 0}>
                          <span class="text-sm">{post.like_count}</span>
                        </Show>
                      </button>
                      <button
                        onClick={() => handleUnbookmark(post.ap_id)}
                        aria-label="Remove bookmark"
                        class="flex items-center gap-2 text-blue-500 hover:text-blue-400 transition-colors"
                        title="Remove bookmark"
                      >
                        <BookmarkIcon filled={true} />
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  );
}

export default BookmarksPage;
