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
import { StoryTray, StoryViewer } from "./microblog/Story.tsx";
import { PostForm, PostList } from "./microblog/Post.tsx";
import {
  _replyToPost,
  createPost,
  deletePost,
  deleteStory,
  fetchFollowingPosts,
  fetchPostById,
  fetchPostReplies,
  fetchPosts,
  fetchStories,
  likePost,
  retweetPost,
  updatePost,
  viewStory,
} from "./microblog/api.ts";
import type { MicroblogPost, Story } from "./microblog/types.ts";
import { addMessageHandler, removeMessageHandler } from "../utils/ws.ts";

export function Microblog() {
  // タブ切り替え: "following" | "latest"
  const [account] = useAtom(activeAccount);
  const [tab, setTab] = createSignal<"following" | "latest">(
    "following",
  );
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
  const loadPostById = async (id: string) => {
    const p = await fetchPostById(id);
    if (!p) {
      setPosts([]);
      setCursor(null);
      return;
    }
    const replies = await fetchPostReplies(id);
    setPosts([p, ...replies]);
    setCursor(null);
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
      resetPosts();
    }
  });

  onCleanup(() => {
    observer?.disconnect();
    wsCleanup?.();
  });
  // フォロー中投稿の取得
  const [
    followingTimelinePosts,
    { refetch: _refetchFollowing, mutate: mutateFollowing },
  ] = createResource(() => {
    const user = account();
    return user ? fetchFollowingPosts(user.userName) : Promise.resolve([]);
  });
  // ストーリー
  const [stories, { refetch: refetchStories }] = createResource(fetchStories);
  const [selectedStory, setSelectedStory] = createSignal<Story | null>(null);
  const [showStoryViewer, setShowStoryViewer] = createSignal(false);
  const [currentStoryIndex, setCurrentStoryIndex] = createSignal(0);

  // ストーリー関連のハンドラー
  const handleViewStory = async (story: Story, index: number) => {
    await viewStory(story.id);
    setSelectedStory(story);
    setCurrentStoryIndex(index);
    setShowStoryViewer(true);
    refetchStories();
  };

  const nextStory = () => {
    const storiesArray = stories() || [];
    const nextIndex = (currentStoryIndex() + 1) % storiesArray.length;
    setCurrentStoryIndex(nextIndex);
    setSelectedStory(storiesArray[nextIndex]);
  };

  const previousStory = () => {
    const storiesArray = stories() || [];
    const prevIndex = currentStoryIndex() === 0
      ? storiesArray.length - 1
      : currentStoryIndex() - 1;
    setCurrentStoryIndex(prevIndex);
    setSelectedStory(storiesArray[prevIndex]);
  };

  const closeStoryViewer = () => {
    setShowStoryViewer(false);
    setSelectedStory(null);
  };

  const handleDeleteStory = async (id: string) => {
    if (!confirm("このストーリーを削除しますか？")) return;
    const success = await deleteStory(id);
    if (success) {
      refetchStories();
      closeStoryViewer();
    } else {
      alert("ストーリーの削除に失敗しました");
    }
  };

  const filteredPosts = () => {
    const query = searchQuery().toLowerCase();
    let postsToFilter: MicroblogPost[] = [];

    if (targetPostId()) {
      postsToFilter = posts() || [];
    } else {
      if (tab() === "latest") {
        postsToFilter = posts() || [];
      } else if (tab() === "following") {
        postsToFilter = followingTimelinePosts() || [];
      } else {
        postsToFilter = [];
      }
    }

    if (!query) return postsToFilter;
    return postsToFilter.filter((post) =>
      post.content.toLowerCase().includes(query) ||
      post.userName.toLowerCase().includes(query) ||
      (post.hashtags &&
        post.hashtags.some((tag) => tag.toLowerCase().includes(query)))
    );
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

  const handleLike = async (id: string) => {
    const user = account();
    if (!user) return;
    const likes = await likePost(id, user.userName);
    if (likes !== null) {
      setPosts((prev) =>
        prev.map((p) => p.id === id ? { ...p, likes, isLiked: true } : p)
      );
    }
  };

  const handleRetweet = async (id: string) => {
    const user = account();
    if (!user) return;
    const retweets = await retweetPost(id, user.userName);
    if (retweets !== null) {
      setPosts((prev) =>
        prev.map((p) => p.id === id ? { ...p, retweets, isRetweeted: true } : p)
      );
    }
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
      resetPosts();
    } else {
      alert("投稿の更新に失敗しました");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この投稿を削除しますか？")) return;
    const success = await deletePost(id);
    if (success) {
      resetPosts();
    } else {
      alert("投稿の削除に失敗しました");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("ja-JP");
  };

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
      `}
      </style>
      <div class="min-h-screen text-white relative">
        {/* ヘッダー + タブ */}
        <div class="sticky top-0 z-20 backdrop-blur-md border-b border-gray-800">
          <div class="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <Show when={targetPostId()}>
                  <button
                    type="button"
                    onClick={() => setTargetPostId(null)}
                    class="p-2 text-gray-400 hover:text-white"
                  >
                    ← 戻る
                  </button>
                </Show>
              </div>
              <div class="flex justify-end flex-1 relative">
                <input
                  type="text"
                  placeholder="投稿・ユーザー・タグ検索"
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  class="bg-gray-800 rounded-full px-4 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <svg
                  class="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
              </div>
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
            {/* タブ */}
            <div class="flex gap-4 justify-center">
              <button
                type="button"
                class={`tab-btn ${
                  tab() === "following" ? "tab-btn-active" : ""
                }`}
                onClick={() => {
                  setTab("following");
                }}
              >
                フォロー中
              </button>
              <button
                type="button"
                class={`tab-btn ${tab() === "latest" ? "tab-btn-active" : ""}`}
                onClick={() => {
                  setTab("latest");
                }}
              >
                新しい順
              </button>
            </div>
          </div>
        </div>
        <div class="max-w-2xl mx-auto">
          {(tab() === "latest" || tab() === "following") && (
            <StoryTray
              stories={stories() || []}
              refetchStories={refetchStories}
              handleViewStory={handleViewStory}
            />
          )}

          {(tab() === "latest" || tab() === "following") && (
            <PostList
              posts={filteredPosts()}
              tab={tab()}
              handleReply={handleReply}
              handleRetweet={handleRetweet}
              handleQuote={handleQuote}
              handleLike={handleLike}
              handleEdit={handleEdit}
              handleDelete={handleDelete}
              formatDate={formatDate}
              isThread={!!targetPostId()}
            />
          )}

          <Show when={tab() === "following" && filteredPosts().length === 0}>
            <div class="p-8 text-center">
              <p class="text-gray-400 text-lg">フォロー中の投稿はありません</p>
              <p class="text-gray-500 text-sm mt-2">
                気になるユーザーをフォローしてみましょう
              </p>
            </div>
          </Show>

          <Show when={!targetPostId()}>
            <div ref={(el) => (sentinel = el)} class="h-4"></div>
            {loadingMore() && (
              <div class="text-center py-4 text-gray-400">読み込み中...</div>
            )}
          </Show>
        </div>

        <StoryViewer
          showStoryViewer={showStoryViewer()}
          selectedStory={selectedStory()}
          stories={stories() || []}
          currentStoryIndex={currentStoryIndex()}
          previousStory={previousStory}
          nextStory={nextStory}
          closeStoryViewer={closeStoryViewer}
          handleDeleteStory={handleDeleteStory}
          formatDate={formatDate}
        />

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
      </div>
    </>
  );
}
