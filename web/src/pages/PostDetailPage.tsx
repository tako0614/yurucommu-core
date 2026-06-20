import { createEffect, createSignal, For, Show } from "solid-js";
import { A, useNavigate, useParams } from "@solidjs/router";
import { useRequiredActor } from "../hooks/useRequiredActor.ts";
import { MediaAttachment, Post } from "../types/index.ts";
import {
  bookmarkPost,
  createPost,
  deletePost,
  fetchPost,
  fetchReplies,
  likePost,
  unbookmarkPost,
  unlikePost,
} from "../lib/api.ts";
import { useI18n } from "../lib/i18n.tsx";
import { useSetAtom } from "solid-jotai";
import { pushToast, toastsAtom } from "../atoms/toast.ts";
import { ConfirmSheet } from "../components/ConfirmSheet.tsx";
import { formatDateTime } from "../lib/datetime.ts";
import { UserAvatar } from "../components/UserAvatar.tsx";
import { PostContent } from "../components/PostContent.tsx";
import {
  BookmarkIcon,
  HeartIcon,
  ReplyIcon,
} from "../components/icons/SocialIcons.tsx";
import { InlineErrorBanner } from "../components/InlineErrorBanner.tsx";
import {
  mediaAttachmentUrl,
  MediaLightbox,
  useMediaLightbox,
} from "../components/MediaLightbox.tsx";

const BackIcon = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M10 19l-7-7m0 0l7-7m-7 7h18"
    />
  </svg>
);

const TrashIcon = () => (
  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path
      stroke-linecap="round"
      stroke-linejoin="round"
      stroke-width={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
);

export function PostDetailPage() {
  const actor = useRequiredActor();
  const params = useParams();
  const navigate = useNavigate();
  const { t } = useI18n();
  const setToasts = useSetAtom(toastsAtom);
  const [error, setError] = createSignal<string | null>(null);
  const clearError = () => setError(null);
  const [post, setPost] = createSignal<Post | null>(null);
  const [replies, setReplies] = createSignal<Post[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [replyContent, setReplyContent] = createSignal("");
  const [replying, setReplying] = createSignal(false);
  // Reply composer textarea — the action-bar reply button focuses it.
  let replyInputRef: HTMLTextAreaElement | undefined;
  // Pending delete target, staged so the shared ConfirmSheet can gate it.
  const [pendingDelete, setPendingDelete] = createSignal<{
    post: Post;
    isReply: boolean;
  } | null>(null);
  const lightbox = useMediaLightbox();

  // Generation guard: a fast post→post navigation must not let a slow prior
  // load land its post/replies under the new post.
  let postLoadGen = 0;
  createEffect(() => {
    const postId = params.postId;
    if (!postId) return;

    const gen = ++postLoadGen;
    setPost(null);
    setReplies([]);
    setReplyContent("");
    setError(null);
    setLoading(true);

    const decodedPostId = decodeURIComponent(postId);
    Promise.all([fetchPost(decodedPostId), fetchReplies(decodedPostId)])
      .then(([postData, repliesData]) => {
        if (gen !== postLoadGen) return;
        setPost(postData);
        setReplies(repliesData);
      })
      .catch((e) => {
        if (gen !== postLoadGen) return;
        console.error("Failed to load post:", e);
        setError(t("common.error"));
      })
      .finally(() => {
        if (gen === postLoadGen) setLoading(false);
      });
  });

  const handleLike = async (targetPost: Post, isReply: boolean = false) => {
    try {
      if (targetPost.liked) {
        await unlikePost(targetPost.ap_id);
        if (isReply) {
          setReplies((prev) =>
            prev.map((r) =>
              r.ap_id === targetPost.ap_id
                ? { ...r, liked: false, like_count: r.like_count - 1 }
                : r,
            ),
          );
        } else {
          setPost((prev) =>
            prev
              ? { ...prev, liked: false, like_count: prev.like_count - 1 }
              : null,
          );
        }
      } else {
        await likePost(targetPost.ap_id);
        if (isReply) {
          setReplies((prev) =>
            prev.map((r) =>
              r.ap_id === targetPost.ap_id
                ? { ...r, liked: true, like_count: r.like_count + 1 }
                : r,
            ),
          );
        } else {
          setPost((prev) =>
            prev
              ? { ...prev, liked: true, like_count: prev.like_count + 1 }
              : null,
          );
        }
      }
    } catch (e) {
      console.error("Failed to toggle like:", e);
      setError(t("common.error"));
    }
  };

  const handleReply = async () => {
    if (!replyContent().trim() || replying() || !post()) return;
    setReplying(true);
    try {
      const newReply = await createPost({
        content: replyContent().trim(),
        in_reply_to: post()!.ap_id,
      });
      setReplies((prev) => [...prev, newReply]);
      setReplyContent("");
      setPost((prev) =>
        prev ? { ...prev, reply_count: prev.reply_count + 1 } : null,
      );
    } catch (e) {
      console.error("Failed to reply:", e);
      setError(t("common.error"));
    } finally {
      setReplying(false);
    }
  };

  const handleDelete = (targetPost: Post, isReply: boolean = false) => {
    setPendingDelete({ post: targetPost, isReply });
  };

  const confirmDelete = async () => {
    const pending = pendingDelete();
    if (!pending) return;
    setPendingDelete(null);
    try {
      await deletePost(pending.post.ap_id);
      if (pending.isReply) {
        setReplies((prev) =>
          prev.filter((r) => r.ap_id !== pending.post.ap_id),
        );
        const currentPost = post();
        if (currentPost) {
          setPost({
            ...currentPost,
            reply_count: Math.max(0, currentPost.reply_count - 1),
          });
        }
        pushToast(setToasts, t("feedback.postDeleted"), { kind: "success" });
      } else {
        navigate(-1);
      }
    } catch (e) {
      console.error("Failed to delete:", e);
      pushToast(setToasts, t("feedback.deleteFailed"), { kind: "error" });
    }
  };

  const handleBookmark = async () => {
    const currentPost = post();
    if (!currentPost) return;
    try {
      if (currentPost.bookmarked) {
        await unbookmarkPost(currentPost.ap_id);
        setPost({ ...currentPost, bookmarked: false });
      } else {
        await bookmarkPost(currentPost.ap_id);
        setPost({ ...currentPost, bookmarked: true });
      }
    } catch (e) {
      console.error("Failed to toggle bookmark:", e);
      setError(t("common.error"));
    }
  };

  return (
    <div class="flex flex-col h-full">
      <Show when={error()}>
        <InlineErrorBanner message={error()!} onClose={clearError} />
      </Show>
      <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div class="flex items-center gap-4 px-4 py-3">
          <button
            onClick={() => navigate(-1)}
            aria-label={t("common.back")}
            class="p-1 hover:bg-neutral-800 rounded-full"
          >
            <BackIcon />
          </button>
          <h1 class="text-xl font-bold">Post</h1>
        </div>
      </header>

      <Show when={loading()}>
        <div class="p-8 text-center text-neutral-500">
          {t("common.loading")}
        </div>
      </Show>

      <Show when={!loading() && !post()}>
        <div class="p-8 text-center text-neutral-500">Post not found</div>
      </Show>

      <Show when={!loading() && post()}>
        <div class="flex-1 overflow-y-auto">
          {/* Main Post */}
          <div class="px-4 py-4 border-b border-neutral-900">
            <div class="flex gap-3">
              <A href={`/profile/${encodeURIComponent(post()!.author.ap_id)}`}>
                <UserAvatar
                  avatarUrl={post()!.author.icon_url}
                  name={
                    post()!.author.name || post()!.author.preferred_username
                  }
                  size={48}
                />
              </A>
              <div class="flex-1">
                <A
                  href={`/profile/${encodeURIComponent(post()!.author.ap_id)}`}
                  class="font-bold text-white hover:underline"
                >
                  {post()!.author.name || post()!.author.preferred_username}
                </A>
                <div class="text-neutral-500">@{post()!.author.username}</div>
              </div>
              <Show when={post()!.author.ap_id === actor.ap_id}>
                <button
                  onClick={() => handleDelete(post()!)}
                  class="p-2 text-neutral-500 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                >
                  <TrashIcon />
                </button>
              </Show>
            </div>
            <PostContent
              content={post()!.content}
              summary={post()!.summary}
              class="text-lg text-neutral-100 mt-3"
            />
            {/* Post Images */}
            <Show when={post()!.attachments.length > 0}>
              <div
                class={`mt-3 grid gap-1 rounded-xl overflow-hidden ${
                  post()!.attachments.length === 1
                    ? "grid-cols-1"
                    : post()!.attachments.length === 2
                      ? "grid-cols-2"
                      : post()!.attachments.length === 3
                        ? "grid-cols-2"
                        : "grid-cols-2"
                }`}
              >
                <For each={post()!.attachments}>
                  {(m, idx) => (
                    <img
                      src={mediaAttachmentUrl(m)}
                      alt={m.name || ""}
                      onClick={(e) => {
                        e.stopPropagation();
                        lightbox.open(post()!.attachments, idx());
                      }}
                      class={`w-full object-cover cursor-zoom-in ${
                        post()!.attachments.length === 1
                          ? "max-h-[500px]"
                          : post()!.attachments.length === 3 && idx() === 0
                            ? "row-span-2 h-full"
                            : "h-48"
                      }`}
                    />
                  )}
                </For>
              </div>
            </Show>
            <div class="text-neutral-500 text-sm mt-3">
              {formatDateTime(post()!.published)}
            </div>
            <div class="flex items-center gap-6 mt-3 pt-3 border-t border-neutral-800">
              <div class="text-sm">
                <span class="font-bold text-white">{post()!.reply_count}</span>
                <span class="text-neutral-500 ml-1">Replies</span>
              </div>
              <Show when={post()!.author.ap_id === actor.ap_id}>
                <div class="text-sm">
                  <span class="font-bold text-white">{post()!.like_count}</span>
                  <span class="text-neutral-500 ml-1">
                    {t("posts.likesLabel")}
                  </span>
                </div>
              </Show>
            </div>
            <div class="flex items-center justify-around mt-3 pt-3 border-t border-neutral-800">
              <button
                onClick={() => {
                  replyInputRef?.focus();
                  replyInputRef?.scrollIntoView({
                    behavior: "smooth",
                    block: "center",
                  });
                }}
                aria-label={t("posts.reply")}
                class="flex items-center gap-2 p-2 text-neutral-500 hover:text-accent transition-colors"
              >
                <ReplyIcon />
              </button>
              <button
                onClick={() => handleLike(post()!)}
                aria-label={post()!.liked ? t("posts.unlike") : t("posts.like")}
                aria-pressed={post()!.liked}
                class={`flex items-center gap-2 p-2 transition-colors ${
                  post()!.liked
                    ? "text-pink-500"
                    : "text-neutral-500 hover:text-pink-500"
                }`}
              >
                <HeartIcon filled={post()!.liked || false} />
              </button>
              <button
                onClick={handleBookmark}
                aria-label={
                  post()!.bookmarked
                    ? t("posts.removeBookmark")
                    : t("posts.bookmark")
                }
                aria-pressed={post()!.bookmarked}
                class={`flex items-center gap-2 p-2 transition-colors ${
                  post()!.bookmarked
                    ? "text-accent"
                    : "text-neutral-500 hover:text-accent"
                }`}
              >
                <BookmarkIcon filled={post()!.bookmarked || false} />
              </button>
            </div>
          </div>

          {/* Reply Composer */}
          <div class="px-4 py-3 border-b border-neutral-900">
            <div class="flex gap-3">
              <UserAvatar
                avatarUrl={actor.icon_url}
                name={actor.name || actor.preferred_username}
                size={40}
              />
              <div class="flex-1">
                <textarea
                  ref={replyInputRef}
                  value={replyContent()}
                  onInput={(e) => setReplyContent(e.currentTarget.value)}
                  placeholder={t("posts.replyPlaceholder")}
                  class="w-full bg-transparent text-white placeholder-neutral-500 resize-none outline-none"
                  rows={2}
                />
                <div class="flex justify-end">
                  <button
                    onClick={handleReply}
                    disabled={!replyContent().trim() || replying()}
                    class="px-4 py-1.5 bg-accent disabled:bg-neutral-800 disabled:text-neutral-600 rounded-full text-sm font-bold transition-colors"
                  >
                    {t("posts.reply")}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Replies */}
          <For each={replies()}>
            {(reply) => (
              <div class="flex gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/30 transition-colors">
                <A href={`/profile/${encodeURIComponent(reply.author.ap_id)}`}>
                  <UserAvatar
                    avatarUrl={reply.author.icon_url}
                    name={reply.author.name || reply.author.preferred_username}
                    size={40}
                  />
                </A>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <A
                      href={`/profile/${encodeURIComponent(
                        reply.author.ap_id,
                      )}`}
                      class="font-bold text-white truncate hover:underline"
                    >
                      {reply.author.name || reply.author.preferred_username}
                    </A>
                    <span class="text-neutral-500 truncate">
                      @{reply.author.username}
                    </span>
                    <span class="text-neutral-500">·</span>
                    <span class="text-neutral-500 text-sm">
                      {formatDateTime(reply.published)}
                    </span>
                    <Show when={reply.author.ap_id === actor.ap_id}>
                      <button
                        onClick={() => handleDelete(reply, true)}
                        aria-label={t("common.delete")}
                        class="ml-auto p-1 text-neutral-500 hover:text-red-500 hover:bg-red-500/10 rounded-full transition-colors"
                      >
                        <TrashIcon />
                      </button>
                    </Show>
                  </div>
                  <PostContent
                    content={reply.content}
                    summary={reply.summary}
                    class="text-[15px] text-neutral-200 mt-1"
                  />
                  <div class="flex items-center gap-6 mt-2">
                    <button
                      onClick={() => handleLike(reply, true)}
                      aria-label={
                        reply.liked ? t("posts.unlike") : t("posts.like")
                      }
                      aria-pressed={reply.liked}
                      class={`flex items-center gap-2 transition-colors ${
                        reply.liked
                          ? "text-pink-500"
                          : "text-neutral-500 hover:text-pink-500"
                      }`}
                    >
                      <HeartIcon filled={reply.liked || false} />
                      <Show
                        when={
                          reply.author.ap_id === actor.ap_id &&
                          reply.like_count > 0
                        }
                      >
                        <span class="text-sm">{reply.like_count}</span>
                      </Show>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </For>

          <Show when={replies().length === 0}>
            <div class="p-8 text-center text-neutral-500">No replies yet</div>
          </Show>
        </div>
      </Show>
      <Show when={lightbox.isOpen()}>
        <MediaLightbox
          attachments={lightbox.attachments()}
          index={lightbox.index()}
          onClose={lightbox.close}
        />
      </Show>
      <ConfirmSheet
        open={pendingDelete() !== null}
        title={t("confirm.deletePostTitle")}
        body={t("confirm.deletePostBody")}
        confirmLabel={t("common.delete")}
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

export default PostDetailPage;
