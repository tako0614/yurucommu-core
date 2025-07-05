import { createResource, createSignal } from "solid-js";
import { CommunityView } from "./microblog/Community.tsx";
import { StoryTray, StoryViewer } from "./microblog/Story.tsx";
import { PostList, PostForm } from "./microblog/Post.tsx";
import { fetchPosts, fetchStories, createPost, updatePost, deletePost, likePost, retweetPost, _replyToPost, viewStory, deleteStory } from "./microblog/api.ts";
import type { MicroblogPost, Story, Community, CommunityPost } from "./microblog/types.ts";

export function Microblog() {
  // タブ切り替え: "recommend" | "following" | "community"
  const [tab, setTab] = createSignal<'recommend' | 'following' | 'community'>('recommend');
  const [newPostContent, setNewPostContent] = createSignal("");
  const [showPostForm, setShowPostForm] = createSignal(false);
  const [_replyingTo, _setReplyingTo] = createSignal<string | null>(null);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [posts, { refetch }] = createResource(fetchPosts);
  // ストーリー
  const [stories, { refetch: refetchStories }] = createResource(fetchStories);
  const [selectedStory, setSelectedStory] = createSignal<Story | null>(null);
  const [showStoryViewer, setShowStoryViewer] = createSignal(false);
  const [currentStoryIndex, setCurrentStoryIndex] = createSignal(0);
  // コミュニティ
  const [showCommunityView, setShowCommunityView] = createSignal(false);
  const [selectedCommunity, setSelectedCommunity] = createSignal<Community | null>(null);
  const [showCreateCommunity, setShowCreateCommunity] = createSignal(false);
  const [communityName, setCommunityName] = createSignal("");
  const [communityDescription, setCommunityDescription] = createSignal("");
  const [communityAvatar, setCommunityAvatar] = createSignal("");
  const [communityBanner, setCommunityBanner] = createSignal("");
  const [communityTags, setCommunityTags] = createSignal("");
  const [communityIsPrivate, setCommunityIsPrivate] = createSignal(false);
  // コミュニティデータ
  const [communities] = createSignal<Community[]>([
    {
      id: "1",
      name: "技術討論",
      description: "プログラミングや最新技術について議論する場所",
      avatar: "",
      banner: "",
      memberCount: 1250,
      postCount: 3420,
      isJoined: true,
      isPrivate: false,
      tags: ["プログラミング", "技術", "開発"],
      rules: ["相手を尊重する", "建設的な議論を心がける", "スパムは禁止"],
      createdAt: "2024-01-15T00:00:00Z",
      moderators: ["admin", "tech_lead"]
    },
    {
      id: "2", 
      name: "アニメ・漫画",
      description: "アニメや漫画の感想・考察を共有しよう",
      avatar: "",
      banner: "",
      memberCount: 2100,
      postCount: 8750,
      isJoined: false,
      isPrivate: false,
      tags: ["アニメ", "漫画", "エンタメ"],
      rules: ["ネタバレ注意", "作品への敬意を忘れずに"],
      createdAt: "2024-02-01T00:00:00Z",
      moderators: ["anime_mod"]
    },
    {
      id: "3",
      name: "料理レシピ",
      description: "美味しい料理のレシピを共有するコミュニティ",
      avatar: "",
      banner: "",
      memberCount: 890,
      postCount: 1560,
      isJoined: true,
      isPrivate: false,
      tags: ["料理", "レシピ", "グルメ"],
      rules: ["レシピは詳細に", "写真の投稿を推奨"],
      createdAt: "2024-03-10T00:00:00Z",
      moderators: ["chef_master"]
    }
  ]);

  // ダミーコミュニティ投稿データ
  const [communityPosts] = createSignal<CommunityPost[]>([
    {
      id: "1",
      communityId: "1",
      content: "TypeScriptの新機能について議論しませんか？特にtemplate literal typesが面白いと思います。",
      author: "dev_user",
      createdAt: "2024-07-05T10:30:00Z",
      likes: 15,
      comments: 8,
      isLiked: false,
      isPinned: true
    },
    {
      id: "2",
      communityId: "1", 
      content: "Denoの最新アップデートでパフォーマンスが大幅に改善されましたね。みなさんはもう試されましたか？",
      author: "deno_fan",
      createdAt: "2024-07-05T09:15:00Z",
      likes: 23,
      comments: 12,
      isLiked: true,
      isPinned: false
    },
    {
      id: "3",
      communityId: "2",
      content: "今期のアニメでおすすめはありますか？特に異世界系で面白いのがあったら教えてください！",
      author: "anime_lover",
      createdAt: "2024-07-05T08:45:00Z",
      likes: 8,
      comments: 15,
      isLiked: false,
      isPinned: false
    },
    {
      id: "4",
      communityId: "3",
      content: "簡単で美味しいパスタレシピを共有します！トマトとバジルの基本パスタです 🍝",
      author: "chef_master",
      createdAt: "2024-07-05T07:20:00Z",
      likes: 32,
      comments: 7,
      isLiked: true,
      isPinned: false
    },
    {
      id: "5",
      communityId: "1",
      content: "ReactからSolidJSに移行を検討中です。パフォーマンスの違いを実感した方いますか？",
      author: "frontend_dev",
      createdAt: "2024-07-05T06:50:00Z",
      likes: 19,
      comments: 11,
      isLiked: false,
      isPinned: false
    }
  ]);

  // ダミーフォロー中投稿データ
  const [followingPosts] = createSignal<MicroblogPost[]>([
    {
      id: "follow_1",
      content: "今日は良い天気ですね！散歩に行ってきます 🌞",
      author: "friend_user",
      createdAt: "2024-07-05T11:00:00Z",
      likes: 5,
      retweets: 2,
      replies: 3,
      isLiked: true,
      hashtags: ["散歩", "天気"]
    },
    {
      id: "follow_2",
      content: "新しいプロジェクトを始めました！がんばります💪",
      author: "colleague_dev",
      createdAt: "2024-07-05T10:45:00Z",
      likes: 12,
      retweets: 4,
      replies: 7,
      hashtags: ["プロジェクト", "開発"]
    }
  ]);

  // コミュニティ関連のハンドラー
  const handleJoinCommunity = (communityId: string) => {
    // TODO: API call to join community
    console.log("Joining community:", communityId);
  };

  const handleLeaveCommunity = (communityId: string) => {
    // TODO: API call to leave community
    console.log("Leaving community:", communityId);
  };

  const handleCreateCommunity = (e: Event) => {
    e.preventDefault();
    // TODO: API call to create community
    console.log("Creating community:", {
      name: communityName(),
      description: communityDescription(),
      isPrivate: communityIsPrivate()
    });
    setShowCreateCommunity(false);
  };

  const handleSelectCommunity = (community: Community) => {
    setSelectedCommunity(community);
    setShowCommunityView(true);
  };

  const handleLikeCommunityPost = (postId: string) => {
    // TODO: API call to like community post
    console.log("Liking community post:", postId);
  };

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
    const prevIndex = currentStoryIndex() === 0 ? storiesArray.length - 1 : currentStoryIndex() - 1;
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
    
    // タブに応じて投稿を選択
    if (tab() === 'recommend') {
      postsToFilter = posts() || [];
    } else if (tab() === 'following') {
      postsToFilter = followingPosts() || [];
    } else if (tab() === 'community') {
      // コミュニティタブの場合はコミュニティ投稿をMicroblogPost形式に変換
      const communityPostsConverted: MicroblogPost[] = (communityPosts() || []).map(post => ({
        id: post.id,
        content: post.content,
        author: post.author,
        createdAt: post.createdAt,
        likes: post.likes,
        retweets: 0,
        replies: post.comments,
        isLiked: post.isLiked,
        hashtags: [],
        mentions: []
      }));
      postsToFilter = communityPostsConverted;
    } else {
      postsToFilter = [];
    }
    
    if (!query) return postsToFilter;
    return postsToFilter.filter(post => 
      post.content.toLowerCase().includes(query) ||
      post.author.toLowerCase().includes(query) ||
      (post.hashtags && post.hashtags.some(tag => tag.toLowerCase().includes(query)))
    );
  };

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const content = newPostContent().trim();
    if (!content) return;

    const success = await createPost(content);
    if (success) {
      setNewPostContent("");
      setShowPostForm(false);
      refetch();
    } else {
      alert("投稿の作成に失敗しました");
    }
  };

  const handleLike = async (id: string) => {
    const success = await likePost(id);
    if (success) {
      refetch();
    }
  };

  const handleRetweet = async (id: string) => {
    const success = await retweetPost(id);
    if (success) {
      refetch();
    }
  };

  const handleReply = (postId: string) => {
    _setReplyingTo(postId);
    setShowPostForm(true);
  };

  const handleEdit = async (id: string, current: string) => {
    const content = prompt("編集内容を入力してください", current);
    if (content === null) return;
    const trimmed = content.trim();
    if (!trimmed) return;
    const success = await updatePost(id, trimmed);
    if (success) {
      refetch();
    } else {
      alert("投稿の更新に失敗しました");
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("この投稿を削除しますか？")) return;
    const success = await deletePost(id);
    if (success) {
      refetch();
    } else {
      alert("投稿の削除に失敗しました");
    }
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("ja-JP");
  };

  return (
    <>
      <style>{`
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
      `}</style>
      <div class="min-h-screen text-white relative">
        {/* ヘッダー + タブ */}
        <div class="sticky top-0 z-20 backdrop-blur-md border-b border-gray-800">
          <div class="max-w-2xl mx-auto px-4 py-4 flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <h1 class="text-xl font-bold">マイクロブログ</h1>
              <div class="relative">
                <input
                  type="text"
                  placeholder="投稿・ユーザー・タグ検索"
                  value={searchQuery()}
                  onInput={(e) => setSearchQuery(e.currentTarget.value)}
                  class="bg-gray-800 rounded-full px-4 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <svg class="absolute right-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
            {/* タブ */}
            <div class="flex gap-4 justify-center">
              <button 
                type="button" 
                class={`tab-btn ${tab()==='recommend' ? 'tab-btn-active' : ''}`} 
                onClick={() => {setTab('recommend'); setShowCommunityView(false);}}
              >
                おすすめ
              </button>
              <button 
                type="button" 
                class={`tab-btn ${tab()==='following' ? 'tab-btn-active' : ''}`} 
                onClick={() => {setTab('following'); setShowCommunityView(false);}}
              >
                フォロー中
              </button>
              <button 
                type="button" 
                class={`tab-btn ${tab()==='community' ? 'tab-btn-active' : ''}`} 
                onClick={() => { setTab('community'); setShowCommunityView(false); setSelectedCommunity(null); }}
              >
                コミュニティ
              </button>
            </div>
          </div>
        </div>
        <div class="max-w-2xl mx-auto">
          <CommunityView
            showCommunityView={showCommunityView()}
            setShowCommunityView={setShowCommunityView}
            selectedCommunity={selectedCommunity()}
            setSelectedCommunity={setSelectedCommunity}
            showCreateCommunity={showCreateCommunity()}
            setShowCreateCommunity={setShowCreateCommunity}
            communityName={communityName()}
            setCommunityName={setCommunityName}
            communityDescription={communityDescription()}
            setCommunityDescription={setCommunityDescription}
            communityAvatar={communityAvatar()}
            setCommunityAvatar={setCommunityAvatar}
            communityBanner={communityBanner()}
            setCommunityBanner={setCommunityBanner}
            communityTags={communityTags()}
            setCommunityTags={setCommunityTags}
            communityIsPrivate={communityIsPrivate()}
            setCommunityIsPrivate={setCommunityIsPrivate}
            communities={communities()}
            communityPosts={communityPosts()}
            handleJoinCommunity={handleJoinCommunity}
            handleLeaveCommunity={handleLeaveCommunity}
            handleCreateCommunity={handleCreateCommunity}
            handleSelectCommunity={handleSelectCommunity}
            handleLikeCommunityPost={handleLikeCommunityPost}
            formatDate={formatDate}
          />

          {(tab() === 'recommend' || tab() === 'following' || tab() === 'community') && (
            <StoryTray
              stories={stories() || []}
              refetchStories={refetchStories}
              handleViewStory={handleViewStory}
            />
          )}

          {(tab() === 'recommend' || tab() === 'following' || tab() === 'community') && (
            <PostList
              posts={filteredPosts()}
              tab={tab()}
              handleReply={handleReply}
              handleRetweet={handleRetweet}
              handleLike={handleLike}
              handleEdit={handleEdit}
              handleDelete={handleDelete}
              formatDate={formatDate}
            />
          )}
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
          showPostForm={showPostForm()}
          setShowPostForm={setShowPostForm}
          newPostContent={newPostContent()}
          setNewPostContent={setNewPostContent}
          handleSubmit={handleSubmit}
        />

        {/* フローティング投稿ボタン（おすすめ・フォロー中・コミュニティタブの時のみ表示） */}
        {(tab() === 'recommend' || tab() === 'following' || tab() === 'community') && (
          <button
            type="button"
            onClick={() => setShowPostForm(true)}
            class="fixed bottom-6 right-6 z-30 bg-blue-500 hover:bg-blue-600 text-white p-4 rounded-full shadow-lg hover:shadow-xl transform hover:scale-105 transition-all duration-200"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        )}
      </div>
    </>
  );
}