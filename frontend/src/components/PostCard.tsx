import { useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import Avatar from "./Avatar";
import { api, getUser, useMe } from "../lib/api";
import { useToast } from "./Toast";
import { useAsyncResource } from "../lib/useAsyncResource";

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

function CommentItem(props: { comment: any; canDelete: boolean; onDelete: (id: string) => void }) {
  const [author] = useAsyncResource(
    () => props.comment.author_id,
    async (id) => {
      if (!id) return null;
      return getUser(id).catch(() => null);
    },
  );
  const createdAt = useMemo(() => formatTimestamp(props.comment.created_at), [props.comment.created_at]);

  return (
    <div className="flex gap-2 text-sm">
      <Avatar src={author.data?.avatar_url || ""} alt="コメントユーザー" className="w-8 h-8 rounded-full bg-gray-200 dark:bg-neutral-700" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-gray-900 dark:text-white truncate">{author.data?.display_name || props.comment.author_id}</span>
          <span className="text-xs text-gray-500">{createdAt}</span>
        </div>
        <div className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">{props.comment.text}</div>
      </div>
      {props.canDelete && (
        <button type="button" className="text-xs text-gray-500 hover:text-red-500" onClick={() => props.onDelete(props.comment.id)}>
          削除
        </button>
      )}
    </div>
  );
}

export default function PostCard(props: PostCardProps) {
  const me = useMe();
  const toast = useToast();
  const [post, setPost] = useState(props.post);
  const [reactionState, setReactionState] = useState<ReactionState>({
    count: Number(props.post?.reaction_count ?? props.post?.like_count ?? 0) || 0,
    myReactionId: props.post?.my_reaction_id ?? null,
    loading: false,
  });
  const [commentCount, setCommentCount] = useState<number>(Number(props.post?.comment_count ?? 0) || 0);
  const [commentState, setCommentState] = useState<CommentState>({
    items: props.defaultShowComments ? [] : null,
    loading: false,
    posting: false,
    error: undefined,
  });
  const [commentsOpen, setCommentsOpen] = useState(props.defaultShowComments ?? false);
  const [commentText, setCommentText] = useState("");
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(props.post?.text || "");
  const [actionError, setActionError] = useState("");
  const [shareCopied, setShareCopied] = useState(false);
  const shareResetTimer = useRef<ReturnType<typeof setTimeout>>();
  const lastPostIdRef = useRef(props.post?.id);
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    return () => {
      if (shareResetTimer.current) clearTimeout(shareResetTimer.current);
    };
  }, []);

  useEffect(() => {
    const p = props.post;
    if (!p) return;
    setPost(p);
    if (p.id !== lastPostIdRef.current) {
      lastPostIdRef.current = p.id;
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
  }, [props.defaultShowComments, props.post]);

  const [author] = useAsyncResource(
    () => post?.author_id,
    async (id) => {
      if (!id) return null;
      return getUser(id).catch(() => null);
    },
  );

  const mediaUrls = useMemo(() => {
    if (!post) return [];
    return Array.isArray(post.media_urls)
      ? (post.media_urls as string[]).filter((url) => typeof url === "string" && url.length > 0)
      : [];
  }, [post]);

  const formattedCreatedAt = useMemo(() => formatTimestamp(post?.created_at), [post?.created_at]);
  const shareLabel = shareCopied ? "コピーしました" : "共有";
  const postUrl = useMemo(() => {
    try {
      if (typeof window === "undefined") return `/posts/${post?.id}`;
      return new URL(`/posts/${post?.id}`, window.location.origin).toString();
    } catch {
      return `/posts/${post?.id}`;
    }
  }, [post?.id]);
  const canEdit = useMemo(() => !!me() && post?.author_id && me()!.id === post.author_id, [me, post]);

  const loadReactions = async () => {
    setReactionState((current) => ({ ...current, loading: true }));
    try {
      const list: any[] = await api(`/posts/${post.id}/reactions`);
      const mine = me() ? list.find((r) => r.user_id === me()!.id) : null;
      setReactionState({
        count: Array.isArray(list) ? list.length : 0,
        myReactionId: mine ? mine.id : null,
        loading: false,
      });
    } catch {
      setReactionState((current) => ({ ...current, loading: false }));
    }
  };

  const loadComments = async () => {
    setCommentState((prev) => ({ ...prev, loading: true, error: undefined }));
    try {
      const list: any[] = await api(`/posts/${post.id}/comments`);
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

  useEffect(() => {
    void loadReactions();
    if (commentsOpen) {
      void loadComments();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (commentsOpen && commentState.items === null) {
      void loadComments();
    }
  }, [commentsOpen, commentState.items]);

  const toggleLike = async () => {
    const state = reactionState;
    if (state.loading) return;
    setReactionState({ ...state, loading: true });
    try {
      if (state.myReactionId) {
        await api(`/posts/${post.id}/reactions/${state.myReactionId}`, {
          method: "DELETE",
        });
        const nextCount = Math.max(0, state.count - 1);
        setReactionState({
          count: nextCount,
          myReactionId: null,
          loading: false,
        });
        setPost((prev: any) => (prev ? { ...prev, reaction_count: nextCount, like_count: nextCount } : prev));
        props.onUpdated?.({
          ...post,
          reaction_count: nextCount,
          like_count: nextCount,
        });
      } else {
        const res = await api(`/posts/${post.id}/reactions`, {
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
        setPost((prev: any) => (prev ? { ...prev, reaction_count: nextCount, like_count: nextCount } : prev));
        props.onUpdated?.({
          ...post,
          reaction_count: nextCount,
          like_count: nextCount,
          my_reaction_id: reactionId,
        });
      }
    } catch (error: any) {
      toast?.showToast?.(error?.message || "リアクションに失敗しました", "error");
      setReactionState({ ...state, loading: false });
    }
  };

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!commentText.trim()) return;
    setCommentState((prev) => ({ ...prev, posting: true, error: undefined }));
    try {
      const res = await api(`/posts/${post.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ text: commentText }),
      });
      setCommentText("");
      setCommentState((prev) => ({
        ...prev,
        items: Array.isArray(prev.items) ? [...prev.items, res] : [res],
        posting: false,
      }));
      setCommentCount((prev) => prev + 1);
      if (commentInputRef.current) {
        commentInputRef.current.value = "";
      }
    } catch (err: any) {
      setCommentState((prev) => ({
        ...prev,
        posting: false,
        error: err?.message || "コメントの投稿に失敗しました",
      }));
    }
  };

  const deleteComment = async (id: string) => {
    if (!window.confirm("コメントを削除しますか？")) return;
    try {
      await api(`/posts/${post.id}/comments/${id}`, { method: "DELETE" });
      setCommentState((prev) => ({
        ...prev,
        items: (prev.items || []).filter((c) => c.id !== id),
      }));
      setCommentCount((prev) => Math.max(0, prev - 1));
    } catch (err: any) {
      toast?.showToast?.(err?.message || "コメント削除に失敗しました", "error");
    }
  };

  const saveEdit = async () => {
    if (!canEdit) return;
    const text = editText.trim();
    if (!text) {
      setActionError("本文を入力してください");
      return;
    }
    setActionError("");
    try {
      const res = await api(`/posts/${post.id}`, {
        method: "PATCH",
        body: JSON.stringify({ text }),
      });
      setEditing(false);
      setPost((prev: any) => (prev ? { ...prev, text } : prev));
      props.onUpdated?.({ ...(post as any), text, ...res });
    } catch (err: any) {
      setActionError(err?.message || "更新に失敗しました");
    }
  };

  const deletePost = async () => {
    if (!window.confirm("この投稿を削除しますか？")) return;
    try {
      await api(`/posts/${post.id}`, { method: "DELETE" });
      props.onDeleted?.(post.id);
    } catch (err: any) {
      toast?.showToast?.(err?.message || "削除に失敗しました", "error");
    }
  };

  const copyShare = async () => {
    try {
      await navigator.clipboard.writeText(postUrl);
      setShareCopied(true);
      if (shareResetTimer.current) clearTimeout(shareResetTimer.current);
      shareResetTimer.current = setTimeout(() => setShareCopied(false), 2000);
    } catch {
      toast?.showToast?.("クリップボードにコピーできませんでした", "error");
    }
  };

  return (
    <article className="bg-white dark:bg-neutral-900 rounded-2xl border hairline shadow-sm overflow-hidden">
      <header className="p-4 flex items-center gap-3">
        <Avatar
          src={author.data?.avatar_url || ""}
          alt={author.data?.display_name || "ユーザー"}
          className="w-10 h-10 rounded-full object-cover bg-gray-100 dark:bg-neutral-800"
        />
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 dark:text-white truncate">
            {author.data?.display_name || post?.author_id || "ユーザー"}
          </div>
          <div className="text-xs text-gray-500">{formattedCreatedAt}</div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 text-xs">
            {!editing ? (
              <>
                <button className="text-blue-600 hover:underline" onClick={() => setEditing(true)}>
                  編集
                </button>
                <button className="text-red-500 hover:underline" onClick={() => deletePost()}>
                  削除
                </button>
              </>
            ) : (
              <>
                <button className="text-blue-600 hover:underline" onClick={() => saveEdit()}>
                  保存
                </button>
                <button className="text-gray-500 hover:underline" onClick={() => setEditing(false)}>
                  キャンセル
                </button>
              </>
            )}
          </div>
        )}
      </header>

      <div className="px-4 pb-4 space-y-3">
        {!editing ? (
          <p className="text-gray-900 dark:text-gray-100 whitespace-pre-wrap leading-relaxed">{post?.text}</p>
        ) : (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              className="w-full rounded-lg border hairline bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
              rows={4}
            />
            {actionError && <div className="text-xs text-red-500">{actionError}</div>}
          </div>
        )}

        {mediaUrls.length > 0 && (
          <div className="grid grid-cols-2 gap-2 rounded-xl overflow-hidden">
            {mediaUrls.map((url) => (
              <img key={url} src={url} alt="投稿画像" className="w-full h-40 object-cover bg-gray-100 dark:bg-neutral-800" />
            ))}
          </div>
        )}

        <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
          <button
            type="button"
            className="flex items-center gap-1 hover:text-blue-600 disabled:opacity-50"
            onClick={() => toggleLike()}
            disabled={reactionState.loading}
          >
            <span role="img" aria-label="like">
              👍
            </span>
            <span>{reactionState.count}</span>
          </button>
          <button type="button" className="flex items-center gap-1 hover:text-blue-600" onClick={() => setCommentsOpen((open) => !open)}>
            <span role="img" aria-label="comments">
              💬
            </span>
            <span>{commentCount}</span>
          </button>
          <button type="button" className="flex items-center gap-1 hover:text-blue-600" onClick={() => void copyShare()}>
            <span>{shareLabel}</span>
          </button>
        </div>
      </div>

      {commentsOpen && (
        <div className="border-t hairline px-4 py-3 space-y-3">
          <form className="flex items-start gap-2" onSubmit={submitComment}>
            <Avatar
              src={(me() as any)?.avatar_url || ""}
              alt="あなた"
              className="w-8 h-8 rounded-full object-cover bg-gray-100 dark:bg-neutral-800"
            />
            <div className="flex-1 space-y-2">
              <textarea
                ref={commentInputRef}
                className="w-full rounded-lg border hairline bg-white dark:bg-neutral-900 px-3 py-2 text-sm"
                placeholder="コメントを追加..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
              />
              <div className="flex items-center gap-3 text-xs text-gray-500">
                {commentState.error && <span className="text-red-500">{commentState.error}</span>}
                <button
                  type="submit"
                  className="ml-auto px-3 py-1.5 rounded-full bg-blue-600 text-white disabled:opacity-50"
                  disabled={commentState.posting}
                >
                  {commentState.posting ? "投稿中..." : "投稿"}
                </button>
              </div>
            </div>
          </form>

          {commentState.loading ? (
            <div className="text-sm text-gray-500">読み込み中...</div>
          ) : commentState.items && commentState.items.length > 0 ? (
            <div className="space-y-3">
              {commentState.items.map((comment: any) => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  canDelete={!!me() && comment.author_id === me()!.id}
                  onDelete={(id) => deleteComment(id)}
                />
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500">コメントはまだありません。</div>
          )}
        </div>
      )}
    </article>
  );
}
