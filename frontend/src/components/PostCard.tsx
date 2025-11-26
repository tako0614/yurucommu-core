import {
  For,
  Show,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import Avatar from "./Avatar";
import { api, getUser, useMe } from "../lib/api";

type PostCardProps = {
  post: any;
  onUpdated?: (post: any) => void;
  onDeleted?: (id: string) => void;
  defaultShowComments?: boolean;
};

type ReactionState = {
  count: number;
  myReactionId: string | null;
  loading: boolean;
};

type CommentState = {
  items: any[] | null;
  loading: boolean;
  posting: boolean;
  error?: string;
};

function formatTimestamp(value?: string) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value || "";
  }
}

function CommentItem(props: {
  comment: any;
  canDelete: boolean;
  onDelete: (id: string) => void;
}) {
  const [author] = createResource(
    () => props.comment.author_id,
    async (id) => {
      if (!id) return null;
      return getUser(id).catch(() => null);
    },
  );
  const createdAt = createMemo(() =>
    formatTimestamp(props.comment.created_at),
  );

  return (
    <div class="flex gap-2 text-sm">
      <Avatar
        src={author()?.avatar_url || ""}
        alt="コメントユーザー"
        class="w-8 h-8 rounded-full bg-gray-200 dark:bg-neutral-700"
      />
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-semibold text-gray-900 dark:text-white truncate">
            {author()?.display_name || props.comment.author_id}
          </span>
          <span class="text-xs text-gray-500">{createdAt()}</span>
        </div>
        <div class="text-gray-900 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">
          {props.comment.text}
        </div>
      </div>
      <Show when={props.canDelete}>
        <button
          type="button"
          class="text-xs text-gray-500 hover:text-red-500"
          onClick={() => props.onDelete(props.comment.id)}
        >
          削除
        </button>
      </Show>
    </div>
  );
}

export default function PostCard(props: PostCardProps) {
  const me = useMe();
  const [post, setPost] = createSignal(props.post);
  const [reactionState, setReactionState] = createSignal<ReactionState>({
    count:
      Number(props.post?.reaction_count ?? props.post?.like_count ?? 0) || 0,
    myReactionId: props.post?.my_reaction_id ?? null,
    loading: false,
  });
  const [commentCount, setCommentCount] = createSignal(
    Number(props.post?.comment_count ?? 0) || 0,
  );
  const [commentState, setCommentState] = createSignal<CommentState>({
    items: props.defaultShowComments ? [] : null,
    loading: false,
    posting: false,
    error: undefined,
  });
  const [commentsOpen, setCommentsOpen] = createSignal(
    props.defaultShowComments ?? false,
  );
  const [commentText, setCommentText] = createSignal("");
  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal(props.post?.text || "");
  const [actionError, setActionError] = createSignal("");
  const [shareCopied, setShareCopied] = createSignal(false);
  let shareResetTimer: ReturnType<typeof setTimeout> | undefined;
  let lastPostId = props.post?.id;

  onCleanup(() => {
    if (shareResetTimer) clearTimeout(shareResetTimer);
  });

  createEffect(() => {
    const p = props.post;
    if (!p) return;
    setPost(p);
    if (p.id !== lastPostId) {
      lastPostId = p.id;
      setReactionState({
        count: Number(p.reaction_count ?? p.like_count ?? 0) || 0,
        myReactionId: p.my_reaction_id ?? null,
        loading: false,
      });
      setCommentCount(Number(p.comment_count ?? 0) || 0);
      setCommentState({
        items: props.defaultShowComments ? [] : null,
        loading: false,
        posting: false,
        error: undefined,
      });
      setCommentsOpen(props.defaultShowComments ?? false);
      setEditText(p.text || "");
    }
  });

  const [author] = createResource(
    () => post().author_id,
    async (id) => {
      if (!id) return null;
      return getUser(id).catch(() => null);
    },
  );

  const mediaUrls = createMemo(() =>
    Array.isArray(post().media_urls)
      ? (post().media_urls as string[]).filter(
          (url) => typeof url === "string" && url.length > 0,
        )
      : [],
  );

  const formattedCreatedAt = createMemo(() =>
    formatTimestamp(post().created_at),
  );
  const shareLabel = createMemo(() =>
    shareCopied() ? "コピーしました" : "共有",
  );
  const postUrl = createMemo(() => {
    try {
      if (typeof window === "undefined") return `/posts/${post().id}`;
      return new URL(`/posts/${post().id}`, window.location.origin).toString();
    } catch {
      return `/posts/${post().id}`;
    }
  });
  const canEdit = createMemo(
    () => !!me() && post()?.author_id && me()!.id === post().author_id,
  );

  const loadReactions = async () => {
    const current = reactionState();
    setReactionState({ ...current, loading: true });
    try {
      const list: any[] = await api(`/posts/${post().id}/reactions`);
      const mine = me() ? list.find((r) => r.user_id === me()!.id) : null;
      setReactionState({
        count: Array.isArray(list) ? list.length : 0,
        myReactionId: mine ? mine.id : null,
        loading: false,
      });
    } catch {
      setReactionState({ ...current, loading: false });
    }
  };

  const loadComments = async () => {
    setCommentState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const list: any[] = await api(`/posts/${post().id}/comments`);
      setCommentState((prev) => ({ ...prev, items: list, loading: false }));
      setCommentCount(Array.isArray(list) ? list.length : 0);
    } catch (err: any) {
      setCommentState((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || "コメントを読み込めませんでした",
      }));
    }
  };

  onMount(() => {
    void loadReactions();
    if (commentsOpen()) {
      void loadComments();
    }
  });

  createEffect(() => {
    if (commentsOpen() && commentState().items === null) {
      void loadComments();
    }
  });

  const toggleLike = async () => {
    const state = reactionState();
    if (state.loading) return;
    setReactionState({ ...state, loading: true });
    try {
      if (state.myReactionId) {
        await api(`/posts/${post().id}/reactions/${state.myReactionId}`, {
          method: "DELETE",
        });
        const nextCount = Math.max(0, state.count - 1);
        setReactionState({
          count: nextCount,
          myReactionId: null,
          loading: false,
        });
        setPost((prev) =>
          prev ? { ...prev, reaction_count: nextCount, like_count: nextCount } : prev,
        );
        props.onUpdated?.({
          ...post(),
          reaction_count: nextCount,
          like_count: nextCount,
        });
      } else {
        const res = await api(`/posts/${post().id}/reactions`, {
          method: "POST",
          body: JSON.stringify({ emoji: "👍" }),
        });
        const reactionId = (res as any)?.id || null;
        const nextCount = state.count + 1;
        setReactionState({
          count: nextCount,
          myReactionId: reactionId,
          loading: false,
        });
        setPost((prev) =>
          prev ? { ...prev, reaction_count: nextCount, like_count: nextCount } : prev,
        );
        props.onUpdated?.({
          ...post(),
          reaction_count: nextCount,
          like_count: nextCount,
        });
      }
    } catch {
      setReactionState({ ...state, loading: false });
    }
  };

  const handleShare = async () => {
    if (typeof window === "undefined") return;
    try {
      if (typeof navigator !== "undefined" && navigator.share) {
        await navigator.share({ url: postUrl() });
        return;
      }
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        await navigator.clipboard.writeText(postUrl());
      }
    } catch {
      // Ignore share errors
    }
    setShareCopied(true);
    if (shareResetTimer) clearTimeout(shareResetTimer);
    shareResetTimer = setTimeout(() => setShareCopied(false), 2000);
  };

  const toggleComments = () => {
    setCommentsOpen((v) => !v);
  };

  const submitComment = async (e: Event) => {
    e.preventDefault();
    const text = commentText().trim();
    if (!text || commentState().posting) return;
    setCommentState((prev) => ({ ...prev, posting: true, error: undefined }));
    try {
      const created = await api(`/posts/${post().id}/comments`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      setCommentText("");
      const nextCount = commentCount() + 1;
      setCommentState((prev) => ({
        ...prev,
        items: [created, ...(prev.items || [])],
        posting: false,
        error: undefined,
      }));
      setCommentCount(nextCount);
      setPost((prev) => (prev ? { ...prev, comment_count: nextCount } : prev));
      props.onUpdated?.({ ...post(), comment_count: nextCount });
    } catch (err: any) {
      setCommentState((prev) => ({
        ...prev,
        posting: false,
        error: err?.message || "コメントを追加できませんでした",
      }));
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    try {
      await api(`/posts/${post().id}/comments/${commentId}`, {
        method: "DELETE",
      });
      setCommentState((prev) => {
        const nextItems = (prev.items || []).filter(
          (c: any) => c.id !== commentId,
        );
        return { ...prev, items: nextItems };
      });
      const nextCount = Math.max(0, commentCount() - 1);
      setCommentCount(nextCount);
      setPost((prev) => (prev ? { ...prev, comment_count: nextCount } : prev));
      props.onUpdated?.({ ...post(), comment_count: nextCount });
    } catch (err: any) {
      setCommentState((prev) => ({
        ...prev,
        error: err?.message || "コメントを削除できませんでした",
      }));
    }
  };

  const handleDeletePost = async () => {
    if (!confirm("この投稿を削除しますか？")) return;
    setActionError("");
    try {
      await api(`/posts/${post().id}`, { method: "DELETE" });
      props.onDeleted?.(post().id);
    } catch (err: any) {
      setActionError(err?.message || "投稿を削除できませんでした");
    }
  };

  const handleUpdatePost = async () => {
    const text = editText().trim();
    if (!text) {
      setActionError("本文を入力してください");
      return;
    }
    setActionError("");
    try {
      const updated = await api(`/posts/${post().id}`, {
        method: "PATCH",
        body: JSON.stringify({
          text,
          media: mediaUrls(),
        }),
      });
      setPost((prev) => ({ ...prev, ...updated, text }));
      setEditing(false);
      props.onUpdated?.({ ...post(), ...updated, text });
    } catch (err: any) {
      setActionError(err?.message || "投稿を更新できませんでした");
    }
  };

  const commentItems = createMemo(() => commentState().items || []);

  return (
    <article class="bg-white dark:bg-neutral-900 border hairline rounded-2xl shadow-sm transition-colors">
      <Show when={post().community_id && (post().community_name || post().community_icon_url)}>
        <a
          href={`/c/${post().community_id}`}
          class="px-4 pt-3 flex items-center gap-2 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-300 dark:hover:text-gray-100 transition-colors"
        >
          <Avatar
            src={post().community_icon_url || ""}
            alt="コミュニティ"
            class="w-4 h-4 rounded"
            variant="community"
          />
          <span>{post().community_name || "コミュニティ"}</span>
        </a>
      </Show>
      <Show when={author()}>
        <div class="px-4 pb-4 pt-3 flex items-start gap-3">
          <a
            href={`/@${encodeURIComponent((post() as any).author_handle || post().author_id)}`}
            class="flex-shrink-0"
          >
            <Avatar
              src={author()?.avatar_url || ""}
              alt="アバター"
              class="w-12 h-12 rounded-full bg-gray-200 dark:bg-neutral-700 object-cover"
            />
          </a>
          <div class="flex-1 min-w-0">
            <div class="flex items-start gap-2">
              <div class="flex flex-wrap items-center gap-x-2 text-[15px] leading-tight">
                <a
                  href={`/@${encodeURIComponent((post() as any).author_handle || post().author_id)}`}
                  class="font-semibold text-gray-900 dark:text-white truncate hover:underline"
                >
                  {author()?.display_name}
                </a>
                <Show when={formattedCreatedAt()}>
                  {(createdAt) => (
                    <>
                      <span class="text-gray-500">·</span>
                      <span class="text-gray-500">{createdAt()}</span>
                    </>
                  )}
                </Show>
              </div>
              <Show when={canEdit()}>
                <div class="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    class="text-xs px-2 py-1 rounded-full border hairline hover:bg-gray-50 dark:hover:bg-neutral-800"
                    onClick={() => {
                      setEditing((v) => !v);
                      setEditText(post().text || "");
                    }}
                  >
                    {editing() ? "キャンセル" : "編集"}
                  </button>
                  <button
                    type="button"
                    class="text-xs px-2 py-1 rounded-full border hairline hover:bg-red-50 dark:hover:bg-red-900/20 text-red-600 dark:text-red-400"
                    onClick={handleDeletePost}
                  >
                    削除
                  </button>
                </div>
              </Show>
            </div>
            <Show when={actionError()}>
              <div class="mt-2 text-xs text-red-500">{actionError()}</div>
            </Show>
            <Show
              when={!editing()}
              fallback={
                <div class="mt-3 space-y-2">
                  <textarea
                    class="w-full rounded-lg border hairline bg-transparent px-3 py-2 text-sm text-gray-900 dark:text-white"
                    rows={3}
                    value={editText()}
                    onInput={(e) =>
                      setEditText((e.target as HTMLTextAreaElement).value)
                    }
                  />
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-full bg-gray-900 text-white text-sm hover:bg-gray-800 disabled:opacity-50"
                      onClick={handleUpdatePost}
                    >
                      更新
                    </button>
                    <button
                      type="button"
                      class="px-3 py-1.5 rounded-full border hairline text-sm hover:bg-gray-50 dark:hover:bg-neutral-800"
                      onClick={() => setEditing(false)}
                    >
                      キャンセル
                    </button>
                  </div>
                </div>
              }
            >
              <a
                href={`/posts/${post().id}`}
                class="mt-2 block text-[15px] leading-[1.5] text-gray-900 dark:text-white whitespace-pre-wrap hover:underline decoration-transparent hover:decoration-current"
              >
                {post().text}
              </a>
            </Show>
            <Show when={mediaUrls().length > 0}>
              <div class="mt-3 rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-700 bg-black/5 dark:bg-white/5">
                <Show
                  when={mediaUrls().length === 1}
                  fallback={
                    <div class="flex overflow-x-auto gap-2 snap-x snap-mandatory">
                      <For each={mediaUrls()}>
                        {(url, idx) => (
                          <div class="flex-shrink-0 basis-full snap-center">
                            <img
                              src={url}
                              alt={`投稿画像${idx() + 1}`}
                              class="w-full h-full max-h-96 object-cover"
                            />
                          </div>
                        )}
                      </For>
                    </div>
                  }
                >
                  <img
                    src={mediaUrls()[0]}
                    alt="投稿画像"
                    class="w-full h-full max-h-96 object-cover"
                  />
                </Show>
              </div>
            </Show>
            <div class="flex items-center justify-between max-w-md mt-4 text-sm text-gray-500">
              <button
                type="button"
                class="flex items-center gap-2 rounded-full px-2 py-1 hover:text-blue-500 transition-colors group"
                aria-label="コメント"
                onClick={toggleComments}
              >
                <div class="p-2 rounded-full group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6"
                    />
                  </svg>
                </div>
                <span>{commentCount()}</span>
              </button>
              <button
                type="button"
                class="flex items-center gap-2 rounded-full px-2 py-1 hover:text-green-500 transition-colors group"
                aria-label="リアクション数"
              >
                <div class="p-2 rounded-full group-hover:bg-green-50 dark:group-hover:bg-green-900/20 transition-colors">
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                </div>
                <span>{reactionState().count}</span>
              </button>
              <button
                type="button"
                class={`flex items-center gap-2 rounded-full px-2 py-1 transition-colors group ${
                  reactionState().myReactionId ? "text-red-500" : "hover:text-red-500"
                }`}
                onClick={toggleLike}
                aria-label="いいね"
                disabled={reactionState().loading}
              >
                <div
                  class={`p-2 rounded-full transition-colors group-hover:bg-red-50 dark:group-hover:bg-red-900/20 ${
                    reactionState().myReactionId ? "bg-red-50 dark:bg-red-900/20" : ""
                  }`}
                >
                  <svg
                    class={`w-5 h-5 ${reactionState().myReactionId ? "fill-current" : ""}`}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"
                    />
                  </svg>
                </div>
                <span>{reactionState().count}</span>
              </button>
              <button
                type="button"
                class="flex items-center gap-2 rounded-full px-2 py-1 hover:text-blue-500 transition-colors group"
                onClick={handleShare}
                aria-label="共有"
              >
                <div class="p-2 rounded-full group-hover:bg-blue-50 dark:group-hover:bg-blue-900/20 transition-colors">
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"
                    />
                  </svg>
                </div>
                <span aria-live="polite">{shareLabel()}</span>
              </button>
            </div>
            <Show when={commentsOpen()}>
              <div class="mt-4 rounded-xl border hairline bg-gray-50 dark:bg-neutral-800/60 px-3 py-3 space-y-3">
                <Show when={commentState().error}>
                  <div class="text-xs text-red-500">{commentState().error}</div>
                </Show>
                <form class="flex gap-2 items-start" onSubmit={submitComment}>
                  <textarea
                    class="flex-1 rounded-lg border hairline bg-white dark:bg-neutral-900 text-sm px-3 py-2 text-gray-900 dark:text-white"
                    placeholder="コメントを書く…"
                    rows={2}
                    value={commentText()}
                    onInput={(e) =>
                      setCommentText((e.target as HTMLTextAreaElement).value)
                    }
                  />
                  <button
                    type="submit"
                    class="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-semibold disabled:opacity-50"
                    disabled={commentState().posting || !commentText().trim()}
                  >
                    {commentState().posting ? "送信中…" : "送信"}
                  </button>
                </form>
                <Show
                  when={!commentState().loading}
                  fallback={<div class="text-sm text-muted">読み込み中…</div>}
                >
                  <Show
                    when={commentItems().length > 0}
                    fallback={<div class="text-sm text-muted">コメントはまだありません</div>}
                  >
                    <div class="space-y-3">
                      <For each={commentItems()}>
                        {(comment) => (
                          <CommentItem
                            comment={comment}
                            canDelete={!!me() && me()!.id === comment.author_id}
                            onDelete={handleDeleteComment}
                          />
                        )}
                      </For>
                    </div>
                  </Show>
                </Show>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </article>
  );
}
