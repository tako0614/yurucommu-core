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
  const [mobileTab, setMobileTab] = createSignal<
    "following" | "latest" | "trends"
  >("following");
  const [newPostContent, setNewPostContent] = createSignal("");
  const [newPostAttachments, setNewPostAttachments] = createSignal<{
    url: string;
    type: "image" | "video" | "audio";
  }[]>([]);
  const [_showPostForm, setShowPostForm] = createSignal(false);
  const [_replyingTo, _setReplyingTo] = createSignal<string | null>(null);
  const [quoteTarget, setQuoteTarget] = createSignal<string | null>(null);
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

  return (
    <>
      <div class="min-h-screen text-[#E6E7EA] relative">
        <Show
          when={targetPostId() && selectedPost()}
          fallback={
            <>
              {/* モバイル用タブナビゲーション */}
              <div class="lg:hidden sticky top-0 z-30 bg-[#0F141A]/90 backdrop-blur-md border-b border-[#2B3340]/60">
                <div class="flex">
                  <button
                    type="button"
                    class={`flex-1 py-4 px-2 text-sm font-medium transition-all duration-200 ${
                      mobileTab() === "following"
                        ? "text-[#D5D7DB] border-b-2 border-[#9AA3AF] bg-[#1B222C]/50"
                        : "text-[#9AA3AF] hover:text-[#CDD1D6] hover:bg-[#1B222C]/40"
                    }`}
                    onClick={() => setMobileTab("following")}
                  >
                    フォロー中
                  </button>
                  <button
                    type="button"
                    class={`flex-1 py-4 px-2 text-sm font-medium transition-all duration-200 ${
                      mobileTab() === "latest"
                        ? "text-[#D5D7DB] border-b-2 border-[#9AA3AF] bg-[#1B222C]/50"
                        : "text-[#9AA3AF] hover:text-[#CDD1D6] hover:bg-[#1B222C]/40"
                    }`}
                    onClick={() => setMobileTab("latest")}
                  >
                    最新
                  </button>
                  <button
                    type="button"
                    class={`flex-1 py-4 px-2 text-sm font-medium transition-all duration-200 ${
                      mobileTab() === "trends"
                        ? "text-[#D5D7DB] border-b-2 border-[#9AA3AF] bg-[#1B222C]/50"
                        : "text-[#9AA3AF] hover:text-[#CDD1D6] hover:bg-[#1B222C]/40"
                    }`}
                    onClick={() => setMobileTab("trends")}
                  >
                    トレンド
                  </button>
                </div>
              </div>

              {/* 表示件数セレクター（右上固定） */}
              <div class="fixed top-4 right-4 z-40 lg:top-6 lg:right-6">
                <select
                  value={limit()}
                  onChange={(e) => {
                    const v = parseInt(e.currentTarget.value, 10);
                    setLimit(v);
                    resetPosts();
                  }}
                  class="bg-[#1B222C]/80 backdrop-blur-sm border border-[#2B3340]/60 rounded-lg px-3 py-2 text-sm text-[#D5D7DB] hover:bg-[#222A35]/80 transition-colors shadow-md"
                >
                  <option value="20">20件</option>
                  <option value="50">50件</option>
                  <option value="100">100件</option>
                </select>
              </div>

              {/* メインレイアウト: デスクトップ3カラム / モバイル1カラム */}
              <div class="lg:grid lg:grid-cols-[1fr_1.2fr_0.8fr] lg:gap-6 lg:px-6 lg:py-4 max-lg:pb-20">
                {/* 左カラム（デスクトップ: 最新投稿） */}
                <div class="hidden lg:block lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
                  <div class="bg-[#151A21]/60 backdrop-blur-sm rounded-xl border border-[#2B3340]/50 h-full">
                    <div class="sticky top-0 bg-[#151A21]/80 backdrop-blur-sm px-4 py-3 border-b border-[#2B3340]/50 rounded-t-xl">
                      <h3 class="text-lg font-semibold text-[#D5D7DB] flex items-center gap-2">
                        <svg
                          class="w-5 h-5 text-[#B9C0CA]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                        最新投稿
                      </h3>
                    </div>
                    <div class="p-4 overflow-x-hidden text-[#CDD1D6]">
                      <PostList
                        posts={posts() || []}
                        tab="latest"
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
                </div>

                {/* 中央カラム（デスクトップ: フォロー中投稿） / モバイル: 選択されたタブの内容 */}
                <div class="lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-hidden max-lg:min-h-screen">
                  <div class="bg-[#151A21]/60 backdrop-blur-sm rounded-xl border border-[#2B3340]/50 h-full lg:flex lg:flex-col">
                    {/* デスクトップ用ヘッダー */}
                    <div class="hidden lg:block sticky top-0 bg-[#151A21]/80 backdrop-blur-sm px-4 py-3 border-b border-[#2B3340]/50 rounded-t-xl">
                      <h3 class="text-lg font-semibold text-[#D5D7DB] flex items-center gap-2">
                        <svg
                          class="w-5 h-5 text-[#B9C0CA]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                          />
                        </svg>
                        フォロー中
                      </h3>
                    </div>

                    {/* コンテンツエリア */}
                    <div class="flex-1 overflow-y-auto lg:p-4 max-lg:pt-16 text-[#CDD1D6]">
                      {/* モバイル: タブに応じた表示 */}
                      <div class="lg:hidden">
                        <Show when={mobileTab() === "following"}>
                          <PostList
                            posts={followingTimelinePosts() || []}
                            tab="following"
                            handleReply={handleReply}
                            handleRetweet={handleRetweet}
                            handleQuote={handleQuote}
                            handleLike={handleLike}
                            handleEdit={handleEdit}
                            handleDelete={handleDelete}
                            formatDate={formatDate}
                          />
                          <Show
                            when={(followingTimelinePosts() || []).length === 0}
                          >
                            <div class="p-8 text-center">
                              <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-[#2B3340]/50 flex items-center justify-center">
                                <svg
                                  class="w-8 h-8 text-[#7C8899]"
                                  fill="none"
                                  stroke="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path
                                    stroke-linecap="round"
                                    stroke-linejoin="round"
                                    stroke-width="2"
                                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                                  />
                                </svg>
                              </div>
                              <p class="text-gray-400 text-lg font-medium mb-2">
                                フォロー中の投稿はありません
                              </p>
                              <p class="text-gray-500 text-sm">
                                気になるユーザーをフォローしてタイムラインを充実させましょう
                              </p>
                            </div>
                          </Show>
                        </Show>

                        <Show when={mobileTab() === "latest"}>
                          <PostList
                            posts={posts() || []}
                            tab="latest"
                            handleReply={handleReply}
                            handleRetweet={handleRetweet}
                            handleQuote={handleQuote}
                            handleLike={handleLike}
                            handleEdit={handleEdit}
                            handleDelete={handleDelete}
                            formatDate={formatDate}
                          />
                        </Show>

                        <Show when={mobileTab() === "trends"}>
                          <div class="p-4">
                            <Trends />
                          </div>
                        </Show>
                      </div>

                      {/* デスクトップ: フォロー中投稿のみ */}
                      <div class="hidden lg:block text-[#CDD1D6]">
                        <PostList
                          posts={followingTimelinePosts() || []}
                          tab="following"
                          handleReply={handleReply}
                          handleRetweet={handleRetweet}
                          handleQuote={handleQuote}
                          handleLike={handleLike}
                          handleEdit={handleEdit}
                          handleDelete={handleDelete}
                          formatDate={formatDate}
                        />
                        <Show
                          when={(followingTimelinePosts() || []).length === 0}
                        >
                          <div class="p-8 text-center">
                            <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-[#2B3340]/50 flex items-center justify-center">
                              <svg
                                class="w-8 h-8 text-[#7C8899]"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                                />
                              </svg>
                            </div>
                            <p class="text-gray-400 text-lg font-medium mb-2">
                              フォロー中の投稿はありません
                            </p>
                            <p class="text-gray-500 text-sm">
                              気になるユーザーをフォローしてタイムラインを充実させましょう
                            </p>
                          </div>
                        </Show>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 右カラム（デスクトップ: トレンド） */}
                <div class="hidden lg:block lg:sticky lg:top-4 lg:h-[calc(100vh-2rem)] lg:overflow-y-auto">
                  <div class="bg-[#151A21]/60 backdrop-blur-sm rounded-xl border border-[#2B3340]/50 h-full">
                    <div class="sticky top-0 bg-[#151A21]/80 backdrop-blur-sm px-4 py-3 border-b border-[#2B3340]/50 rounded-t-xl">
                      <h3 class="text-lg font-semibold text-[#D5D7DB] flex items-center gap-2">
                        <svg
                          class="w-5 h-5 text-[#B9C0CA]"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                          />
                        </svg>
                        トレンド
                      </h3>
                    </div>
                    <div class="p-4 overflow-x-hidden text-[#CDD1D6]">
                      <Trends />
                    </div>
                  </div>
                </div>

                {/* モバイル用無限スクロール要素 */}
                <div class="lg:hidden">
                  <div ref={(el) => (sentinel = el)} class="h-4"></div>
                  <Show when={loadingMore()}>
                    <div class="text-center py-8">
                      <div class="inline-flex items-center gap-2 text-gray-400">
                        <svg
                          class="animate-spin w-5 h-5"
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
                        読み込み中...
                      </div>
                    </div>
                  </Show>
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
            class="fixed bottom-6 right-6 bg-[#2B3340] hover:bg-[#343D4B] text-[#E6E7EA] p-4 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 z-50"
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
