import { createSignal, For, onMount, Show } from "solid-js";
import { A } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { Post } from "../types/index.ts";
import { fetchBookmarks, unbookmarkPost } from "../lib/api.ts";
import { toggleLike } from "../atoms/posts.ts";
import { formatRelativeTime } from "../lib/datetime.ts";
import { useI18n } from "../lib/i18n.tsx";
import { UserAvatar } from "../components/UserAvatar.tsx";
import { PostContent } from "../components/PostContent.tsx";
import { BookmarkIcon, HeartIcon } from "../components/icons/SocialIcons.tsx";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import { InlineErrorRetry } from "../components/InlineErrorRetry.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { PostSkeleton } from "../components/timeline/PostSkeleton.tsx";
import {
  AttachmentGrid,
  MediaLightbox,
  useMediaLightbox,
} from "../components/MediaLightbox.tsx";

export function BookmarksPage() {
  const actor = useRequiredActor();
  const { t } = useI18n();
  const lightbox = useMediaLightbox();
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);
  const [posts, setPosts] = createSignal<Post[]>([]);
  const [loading, setLoading] = createSignal(true);

  onMount(() => {
    loadBookmarks();
  });

  const loadBookmarks = async () => {
    // Only show loading if no cached data
    if (posts().length === 0) setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchBookmarks();
      setPosts(data);
    } catch (e) {
      console.error("Failed to load bookmarks:", e);
      setLoadError(t("common.loadFailed"));
    } finally {
      setLoading(false);
    }
  };

  const handleLike = async (post: Post) => {
    try {
      await toggleLike(post, (fn) => setPosts(fn));
    } catch (e) {
      console.error("Failed to toggle like:", e);
      setError(t("common.error"));
    }
  };

  const handleUnbookmark = async (postApId: string) => {
    try {
      await unbookmarkPost(postApId);
      setPosts((prev) => prev.filter((p) => p.ap_id !== postApId));
    } catch (e) {
      console.error("Failed to unbookmark:", e);
      setError(t("common.error"));
    }
  };

  return (
    <div class="flex flex-col h-full">
      <Show when={error()}>
        <InlineErrorBanner message={error()!} onClose={clearError} />
      </Show>
      <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 class="text-xl font-bold px-4 py-3">{t("bookmarks.title")}</h1>
      </header>

      <div class="flex-1 overflow-y-auto">
        <Show
          when={!(loadError() && posts().length === 0)}
          fallback={
            <InlineErrorRetry
              message={loadError()!}
              retryLabel={t("common.retry")}
              onRetry={loadBookmarks}
            />
          }
        >
          <Show
            when={!(loading() && posts().length === 0)}
            fallback={<PostSkeleton count={5} />}
          >
            <Show
              when={posts().length > 0}
              fallback={
                <EmptyState
                  icon={<BookmarkIcon class="w-10 h-10" />}
                  title={t("bookmarks.empty")}
                  hint={t("bookmarks.emptyHint")}
                />
              }
            >
              <For each={posts()}>
                {(post) => (
                  <div class="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
                    <A
                      href={`/profile/${encodeURIComponent(post.author.ap_id)}`}
                    >
                      <UserAvatar
                        avatarUrl={post.author.icon_url}
                        name={
                          post.author.name || post.author.preferred_username
                        }
                        size={48}
                      />
                    </A>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-baseline gap-2">
                        <A
                          href={`/profile/${encodeURIComponent(
                            post.author.ap_id,
                          )}`}
                          class="font-bold text-white truncate hover:underline"
                        >
                          {post.author.name || post.author.preferred_username}
                        </A>
                        <span class="text-neutral-500 truncate">
                          @{post.author.username}
                        </span>
                        <span class="text-neutral-500">·</span>
                        <span class="text-neutral-500 text-sm">
                          {formatRelativeTime(post.published)}
                        </span>
                      </div>
                      <A href={`/post/${encodeURIComponent(post.ap_id)}`}>
                        <PostContent
                          content={post.content}
                          summary={post.summary}
                          class="text-[15px] text-neutral-200 mt-1"
                        />
                      </A>
                      <Show
                        when={post.attachments && post.attachments.length > 0}
                      >
                        <AttachmentGrid
                          attachments={post.attachments}
                          onOpen={(idx, e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            lightbox.open(post.attachments, idx);
                          }}
                        />
                      </Show>
                      <div class="flex items-center gap-6 mt-3">
                        <button
                          onClick={() => handleLike(post)}
                          aria-label={
                            post.liked ? t("posts.unlike") : t("posts.like")
                          }
                          aria-pressed={post.liked}
                          class={`flex items-center gap-2 transition-colors ${
                            post.liked
                              ? "text-pink-500"
                              : "text-neutral-500 hover:text-pink-500"
                          }`}
                        >
                          <HeartIcon filled={post.liked || false} />
                          <Show
                            when={
                              post.author.ap_id === actor.ap_id &&
                              post.like_count > 0
                            }
                          >
                            <span class="text-sm">{post.like_count}</span>
                          </Show>
                        </button>
                        <button
                          onClick={() => handleUnbookmark(post.ap_id)}
                          aria-label={t("bookmarks.remove")}
                          class="flex items-center gap-2 text-accent transition-colors"
                          title={t("bookmarks.remove")}
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
        </Show>
      </div>
      <Show when={lightbox.isOpen()}>
        <MediaLightbox
          attachments={lightbox.attachments()}
          index={lightbox.index()}
          onClose={lightbox.close}
        />
      </Show>
    </div>
  );
}

export default BookmarksPage;
