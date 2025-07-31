import {
  createEffect,
  createResource,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../states/account.ts";
import { selectedPostIdState } from "../states/router.ts";
import { PostForm, PostList } from "./microblog/Post.tsx";
import { PostDetailView } from "./microblog/PostDetailView.tsx";
import { Trends } from "./microblog/Trends.tsx";
import { createMemo } from "solid-js";
import {
  createPost,
  deletePost,
  fetchFollowingPosts,
  fetchPostById,
  fetchPostReplies,
  fetchPosts,
  likePost,
  retweetPost,
  updatePost,
} from "./microblog/api.ts";
import type { MicroblogPost } from "./microblog/types.ts";
import { addMessageHandler, removeMessageHandler } from "../utils/ws.ts";

export function Microblog() {
  const [account] = useAtom(activeAccount);
  const [tab, setTab] = createSignal<"following" | "latest">(
    "following",
  );
  const [mobileTab, setMobileTab] = createSignal<"following" | "latest" | "trends">("following");
  const [newPostContent, setNewPostContent] = createSignal("");
  const [newPostAttachments, setNewPostAttachments] = createSignal<{
    url: string;
    type: "image" | "video" | "audio";
  }[]>([]);
  const [_showPostForm, setShowPostForm] = createSignal(false);
  const [_replyingTo, _setReplyingTo] = createSignal<string | null>(null);
  const [quoteTarget, setQuoteTarget] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [limit, setLimit] = createSignal(20);
  const [posts, setPosts] = createSignal<MicroblogPost[]>([]);
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [targetPostId, setTargetPostId] = useAtom(selectedPostIdState);

  // State for the detail view
  const [selectedPost, setSelectedPost] = createSignal<MicroblogPost | null>(
    null,
  );
  const [selectedPostReplies, setSelectedPostReplies] = createSignal<
    MicroblogPost[]
  >([]);

  const loadPostById = async (id: string) => {
    const p = await fetchPostById(id);
    if (!p) {
      setSelectedPost(null);
      setSelectedPostReplies([]);
      return;
    }
    const replies = await fetchPostReplies(id);
    setSelectedPost(p);
    setSelectedPostReplies(replies);
  };

  let sentinel: HTMLDivElement | undefined;

  const loadInitialPosts = async () => {
    const data = await fetchPosts({ limit: limit() });
    setPosts(data);
    setCursor(data.length > 0 ? data[data.length - 1].createdAt : null);
  };

  const loadMorePosts = async () => {
    if (loadingMore() || targetPostId()) return;
    setLoadingMore(true);
    const data = await fetchPosts({
      limit: limit(),
      before: cursor() ?? undefined,
    });
    if (data.length > 0) {
      setPosts((prev) => [...prev, ...data]);
      setCursor(data[data.length - 1].createdAt);
    }
    setLoadingMore(false);
  };

  const resetPosts = () => {
    setPosts([]);
    setCursor(null);
    loadInitialPosts();
  };

  let observer: IntersectionObserver | undefined;
  let wsCleanup: (() => void) | undefined;

  const setupObserver = () => {
    if (observer || !sentinel || targetPostId()) return;
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          loadMorePosts();
        }
      }
    });
    observer.observe(sentinel);
  };

  onMount(() => {
    if (targetPostId()) {
      loadPostById(targetPostId()!);
    } else {
      loadInitialPosts();
    }
    const handler = (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        (msg as { type?: string }).type === "newPost"
      ) {
        const data = (msg as {
          payload: { post: MicroblogPost; timeline: "latest" | "following" };
        }).payload;
        const currentPostId = targetPostId();
        if (currentPostId) {
          // If we're viewing a post, check if the new post is a reply to it
          if (data.post.parentId === currentPostId) {
            setSelectedPostReplies((prev) => [data.post, ...prev]);
          }
          return;
        }
        if (data.timeline === "latest") {
          setPosts((prev) => {
            if (prev.some((p) => p.id === data.post.id)) return prev;
            return [data.post, ...prev];
          });
        } else {
          mutateFollowing((prev) => {
            if (prev?.some((p) => p.id === data.post.id)) return prev;
            return [data.post, ...(prev ?? [])];
          });
        }
      }
    };
    addMessageHandler(handler);
    wsCleanup = () => removeMessageHandler(handler);
  });

  createEffect(() => {
    if (sentinel && !targetPostId()) {
      setupObserver();
    } else {
      observer?.disconnect();
      observer = undefined;
    }
  });

  createEffect(() => {
    const id = targetPostId();
    if (id) {
      loadPostById(id);
    } else {
      // Clear detail view state when returning to timeline
      setSelectedPost(null);
      setSelectedPostReplies([]);
      resetPosts();
    }
  });

  onCleanup(() => {
    observer?.disconnect();
    wsCleanup?.();
  });

  const [
    followingTimelinePosts,
    { refetch: _refetchFollowing, mutate: mutateFollowing },
  ] = createResource(() => {
    const user = account();
    return user ? fetchFollowingPosts(user.userName) : Promise.resolve([]);
  });

  const filteredPosts = () => {
    // 検索を無効化: クエリフィルタせずそのまま返却
    if (tab() === "latest") {
      return posts() || [];
    }
    if (tab() === "following") {
      return followingTimelinePosts() || [];
    }
    return [];
  };

  const filteredPostsMobile = () => {
    // モバイル時: 検索無効化。タブに応じてそのまま返す
    if (mobileTab() === "latest") {
      return posts() || [];
    }
    if (mobileTab() === "following") {
      return followingTimelinePosts() || [];
    }
    return []; // trends のときは投稿リストは表示しない
  };

  const _handleSubmit = async (e: Event) => {
    e.preventDefault();
    const content = newPostContent().trim();
    if (!content) return;

    const user = account();
    if (!user) {
      alert("アカウントが選択されていません");
      return;
    }

    const success = await createPost(
      content,
      user.userName,
      newPostAttachments(),
      _replyingTo() ?? undefined,
      quoteTarget() ?? undefined,
    );
    if (success) {
      setNewPostContent("");
      setNewPostAttachments([]);
      _setReplyingTo(null);
      setQuoteTarget(null);
      setShowPostForm(false);
      resetPosts();
    } else {
      alert("投稿の作成に失敗しました");
    }
  };

  const handleReplySubmit = async (
    content: string,
    attachments: { url: string; type: "image" | "video" | "audio" }[],
  ) => {
    const user = account();
    if (!user) {
      alert("アカウントが選択されていません");
      return;
    }
    const postId = targetPostId();
    if (!postId) return;

    const success = await createPost(
      content,
      user.userName,
      attachments,
      postId,
    );
    if (success) {
      // リプライリストを更新
      await loadPostById(postId);
    } else {
      alert("返信の投稿に失敗しました");
    }
  };

  const handleLike = async (id: string) => {
    const user = account();
    if (!user) return;
    const likes = await likePost(id, user.userName);
    if (likes === null) return;

    const update = (p: MicroblogPost) =>
      p.id === id ? { ...p, likes, isLiked: !p.isLiked } : p;

    if (selectedPost()?.id === id) {
      setSelectedPost(update(selectedPost()!));
    }
    setSelectedPostReplies((prev) => prev.map(update));
    setPosts((prev) => prev.map(update));
    mutateFollowing((prev) => prev?.map(update));
  };

  const handleRetweet = async (id: string) => {
    const user = account();
    if (!user) return;
    const retweets = await retweetPost(id, user.userName);
    if (retweets === null) return;

    const update = (p: MicroblogPost) =>
      p.id === id ? { ...p, retweets, isRetweeted: !p.isRetweeted } : p;

    if (selectedPost()?.id === id) {
      setSelectedPost(update(selectedPost()!));
    }
    setSelectedPostReplies((prev) => prev.map(update));
    setPosts((prev) => prev.map(update));
    mutateFollowing((prev) => prev?.map(update));
  };

  const handleQuote = (id: string) => {
    setQuoteTarget(id);
    _setReplyingTo(null);
    setShowPostForm(true);
  };

  const handleReply = (postId: string) => {
    _setReplyingTo(postId);
    setQuoteTarget(null);
    setShowPostForm(true);
  };

  const handleEdit = async (id: string, current: string) => {
    const content = prompt("編集内容を入力してください", current);
    if (content === null) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    const success = await updatePost(id, trimmed);
    if (success) {
      const postId = targetPostId();
      if (postId) {
        loadPostById(postId);
      } else {
        resetPosts();
      }
    } else {
      alert("投稿の更新に失敗しました");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この投稿を削除しますか？")) return;
    const success = await deletePost(id);
    if (success) {
      const postId = targetPostId();
      if (postId) {
        // If the deleted post is the main post, go back to timeline
        if (postId === id) {
          setTargetPostId(null);
        } else {
          // If it's a reply, just reload the replies
          loadPostById(postId);
        }
      } else {
        resetPosts();
      }
    } else {
      alert("投稿の削除に失敗しました");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("ja-JP");
  };

  const isDesktop = createMemo(() => window.matchMedia("(min-width: 1024px)").matches);

  return (
    <>
      <style>
        {`
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .tab-btn { 
          @apply px-4 py-2 font-medium transition-all duration-200 ease-in-out;
          border-radius: 8px;
          background: transparent;
          color: #9ca3af;
          border-bottom: 2px solid transparent;
        }
        .tab-btn:hover {
          color: #d1d5db;
          background: rgba(75, 85, 99, 0.3);
        }
        .tab-btn-active { 
          color: #ffffff;
          background: rgba(59, 130, 246, 0.1);
          border-bottom-color: #3b82f6;
        }
        .tab-btn-active:hover {
          background: rgba(59, 130, 246, 0.15);
        }
        .layout-desktop {
          display: grid;
          /* 右（トレンド）を少し小さくする配分 */
          grid-template-columns: 1fr 1fr 0.8fr;
          gap: clamp(16px, 2vw, 32px);
        }
        .col-card {
          background: rgba(31, 41, 55, 0.25); /* 彩度/不透明度を下げて控えめに */
          border: 1px solid rgba(107, 114, 128, 0.18); /* ボーダーも薄めに */
          border-radius: 10px;
          backdrop-filter: blur(2px); /* ブラーも弱めに */
        }
        .col-divider {
          position: relative;
        }
        /* 左カラム（最新）の右側だけ薄い仕切り線を出す */
        .col-divider.left::after {
          content: "";
          position: absolute;
          top: 0;
          right: -0.75vw;
          width: 1px;
          height: 100%;
          background: linear-gradient(
            to bottom,
            transparent,
            rgba(107,114,128,0.25) 18%,
            rgba(107,114,128,0.25) 82%,
            transparent
          );
        }
        /* 中央と右の間（フォロー中とトレンドの間）は線を出さない */
        .col-divider.center::after {
          display: none;
        }
        @media (max-width: 1023px) {
          .col-divider.left::after,
          .col-divider.center::after {
            display: none;
          }
        }
        @media (max-width: 1023px) {
          .col-divider::after {
            display: none;
          }
        }
        @media (max-width: 1023px) {
          .layout-desktop {
            display: block;
          }
        }
        .sticky-col {
          position: sticky;
          top: 72px;
          /* sticky領域の高さを少し伸ばしつつ、左右に余白を確保 */
          height: calc(100vh - 96px);
          overflow-y: auto;
          overflow-x: hidden; /* X軸スクロールを抑止 */
        }
        .no-x-scroll {
          overflow-x: hidden; /* カード全体でも水平スクロール抑止 */
        }
        .fit-width {
          max-width: 100%;
          width: 100%;
          box-sizing: border-box;
        }
        .content-wrap {
          max-width: 100%;
          overflow-x: hidden; /* 内部要素のはみ出しを抑止 */
        }
        .content-wrap * {
          max-width: 100%;
        }
        .content-wrap img, .content-wrap video, .content-wrap audio, .content-wrap iframe {
          max-width: 100%;
          height: auto;
          display: block;
        }
      `}
      </style>
      <div class="min-h-screen text-white relative">
        <Show
          when={targetPostId() && selectedPost()}
          fallback={
            <>
              {/* Header + Tabs */}
              <div class="sticky top-0 z-20 backdrop-blur-md border-gray-800">
                <div class="w-full px-6 py-4 flex flex-col gap-2">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2"></div>
                    <div class="flex-1" />
                    <div class="ml-4">
                      <select
                        value={limit()}
                        onChange={(e) => {
                          const v = parseInt(e.currentTarget.value, 10);
                          setLimit(v);
                          resetPosts();
                        }}
                        class="bg-gray-800 rounded px-2 py-1 text-sm"
                      >
                        <option value="20">20</option>
                        <option value="50">50</option>
                        <option value="100">100</option>
                      </select>
                    </div>
                  </div>
                  {/* Tabs */}
                  <div class="flex gap-4 justify-center">
                    {/* デスクトップ: タブは表示せず（3カラムで常時表示） */}
                    {/* モバイル: タブで切替 */}
                    <div style={`display: ${isDesktop() ? "none" : "flex"}`} class="gap-4 justify-center w-full">
                      <button
                        type="button"
                        class={`tab-btn ${mobileTab() === "following" ? "tab-btn-active" : ""}`}
                        onClick={() => setMobileTab("following")}
                      >
                        フォロー中
                      </button>
                      <button
                        type="button"
                        class={`tab-btn ${mobileTab() === "latest" ? "tab-btn-active" : ""}`}
                        onClick={() => setMobileTab("latest")}
                      >
                        新しい順
                      </button>
                      <button
                        type="button"
                        class={`tab-btn ${mobileTab() === "trends" ? "tab-btn-active" : ""}`}
                        onClick={() => setMobileTab("trends")}
                      >
                        トレンド
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* 本文レイアウト: デスクトップ3カラム（左:最新 / 中央:フォロー中 / 右:トレンド） / モバイル1カラム */}
              <div class="w-full px-6 layout-desktop">
                {/* 左カラム（デスクトップ: 新しい順） / モバイル: タブがlatestのとき */}
                <div class="sticky-col pr-2 col-card col-divider left no-x-scroll fit-width" style={`display: ${isDesktop() ? "block" : mobileTab() === "latest" ? "block" : "none"}`}
                >
                  <h3 class="text-sm text-gray-400 font-semibold px-3 py-2" style={`display: ${isDesktop() ? "block" : "none"}`}>新しい順</h3>
                  <div class="content-wrap">
                    <PostList
                      posts={isDesktop() ? (posts() || []) : filteredPostsMobile()}
                      tab={"latest" as any}
                      handleReply={handleReply}
                      handleRetweet={handleRetweet}
                      handleQuote={handleQuote}
                      handleLike={handleLike}
                      handleEdit={handleEdit}
                      handleDelete={handleDelete}
                      formatDate={formatDate}
                    />
                  </div>
                </div>

                {/* 中央カラム（デスクトップ: フォロー中＝メイン） / モバイル: タブがfollowingのとき */}
                <div class="w-full col-card col-divider center no-x-scroll fit-width" style={`display: ${isDesktop() ? "block" : mobileTab() === "following" ? "block" : "none"}`}
                >
                  <h3 class="text-sm text-gray-400 font-semibold px-3 py-2" style={`display: ${isDesktop() ? "block" : "none"}`}>フォロー中</h3>
                  <div class="content-wrap">
                    <PostList
                      posts={isDesktop() ? (followingTimelinePosts() || []) : filteredPostsMobile()}
                      tab={"following" as any}
                      handleReply={handleReply}
                      handleRetweet={handleRetweet}
                      handleQuote={handleQuote}
                      handleLike={handleLike}
                      handleEdit={handleEdit}
                      handleDelete={handleDelete}
                      formatDate={formatDate}
                    />
                  </div>
                  <Show when={(!isDesktop()) && mobileTab() === "following" && filteredPostsMobile().length === 0}>
                    <div class="p-8 text-center">
                      <p class="text-gray-400 text-lg">
                        フォロー中の投稿はありません
                      </p>
                      <p class="text-gray-500 text-sm mt-2">
                        気になるユーザーをフォローしてみましょう
                      </p>
                    </div>
                  </Show>
                  <div ref={(el) => (sentinel = el)} class="h-4" style={`display: ${isDesktop() ? "none" : "block"}`}></div>
                  {(!isDesktop()) && loadingMore() && (
                    <div class="text-center py-4 text-gray-400">
                      読み込み中...
                    </div>
                  )}
                </div>

                {/* 右カラム（デスクトップ: トレンド） / モバイル: タブがtrendsのとき */}
                <div class="sticky-col pl-2 col-card no-x-scroll fit-width" style={`display: ${isDesktop() ? "block" : mobileTab() === "trends" ? "block" : "none"}`}
                >
                  <h3 class="text-sm text-gray-400 font-semibold px-3 py-2" style={`display: ${isDesktop() ? "block" : "none"}`}>トレンド</h3>
                  <div class="text-sm content-wrap">
                    <Trends />
                  </div>
                </div>
              </div>
            </>
          }
        >
          <PostDetailView
            post={selectedPost()!}
            replies={selectedPostReplies()}
            onBack={() => setTargetPostId(null)}
            onReplySubmit={handleReplySubmit}
            handleLike={handleLike}
            handleRetweet={handleRetweet}
            handleQuote={handleQuote}
            handleEdit={handleEdit}
            handleDelete={handleDelete}
            formatDate={formatDate}
          />
        </Show>

        <PostForm
          showPostForm={_showPostForm()}
          setShowPostForm={setShowPostForm}
          newPostContent={newPostContent()}
          setNewPostContent={setNewPostContent}
          handleSubmit={_handleSubmit}
          attachments={newPostAttachments()}
          setAttachments={setNewPostAttachments}
          replyingTo={_replyingTo()}
          quoteId={quoteTarget()}
          currentUser={account() || undefined}
        />
        <Show when={account()}>
          <button
            type="button"
            class="fixed bottom-20 right-6 bg-blue-500 hover:bg-blue-600 text-white p-4 rounded-full shadow-lg transition-colors"
            onClick={() => {
              _setReplyingTo(null);
              setQuoteTarget(null);
              setShowPostForm(true);
            }}
          >
            <svg
              class="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M12 4v16m8-8H4"
              />
            </svg>
          </button>
        </Show>
      </div>
    </>
  );
}
