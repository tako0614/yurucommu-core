import { createResource, createSignal, For } from "solid-js";

interface MicroblogPost {
  id: string;
  content: string;
  author: string;
  createdAt: string;
  likes: number;
  retweets: number;
  replies: number;
  isLiked?: boolean;
  isRetweeted?: boolean;
  images?: string[];
  hashtags?: string[];
  mentions?: string[];
  parentId?: string; // 返信の場合の親投稿ID
}

interface Story {
  id: string;
  author: string;
  content: string;
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
  createdAt: string;
  expiresAt: string;
  views: number;
  isViewed?: boolean;
  backgroundColor?: string;
  textColor?: string;
}

interface Community {
  id: string;
  name: string;
  description: string;
  avatar?: string;
  banner?: string;
  memberCount: number;
  postCount: number;
  isJoined?: boolean;
  isPrivate?: boolean;
  tags?: string[];
  rules?: string[];
  createdAt: string;
  moderators?: string[];
}

interface CommunityPost {
  id: string;
  communityId: string;
  content: string;
  author: string;
  createdAt: string;
  likes: number;
  comments: number;
  isLiked?: boolean;
  images?: string[];
  isPinned?: boolean;
}

const fetchPosts = async (): Promise<MicroblogPost[]> => {
  try {
    const response = await fetch("/api/microblog");
    if (!response.ok) {
      throw new Error("Failed to fetch posts");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching posts:", error);
    return [];
  }
};

const createPost = async (content: string): Promise<boolean> => {
  try {
    const response = await fetch("/api/microblog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ author: "user", content }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error creating post:", error);
    return false;
  }
};

const updatePost = async (id: string, content: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/microblog/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error updating post:", error);
    return false;
  }
};

const deletePost = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/microblog/${id}`, {
      method: "DELETE",
    });
    return response.ok;
  } catch (error) {
    console.error("Error deleting post:", error);
    return false;
  }
};

const likePost = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/microblog/${id}/like`, {
      method: "POST",
    });
    return response.ok;
  } catch (error) {
    console.error("Error liking post:", error);
    return false;
  }
};

const retweetPost = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/microblog/${id}/retweet`, {
      method: "POST",
    });
    return response.ok;
  } catch (error) {
    console.error("Error retweeting post:", error);
    return false;
  }
};

const _replyToPost = async (parentId: string, content: string): Promise<boolean> => {
  try {
    const response = await fetch("/api/microblog", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ author: "user", content, parentId }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error replying to post:", error);
    return false;
  }
};

const fetchStories = async (): Promise<Story[]> => {
  try {
    const response = await fetch("/api/stories");
    if (!response.ok) {
      throw new Error("Failed to fetch stories");
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching stories:", error);
    return [];
  }
};

const createStory = async (content: string, mediaUrl?: string, mediaType?: 'image' | 'video', backgroundColor?: string, textColor?: string): Promise<boolean> => {
  try {
    const response = await fetch("/api/stories", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ 
        author: "user", 
        content, 
        mediaUrl, 
        mediaType, 
        backgroundColor, 
        textColor 
      }),
    });
    return response.ok;
  } catch (error) {
    console.error("Error creating story:", error);
    return false;
  }
};

const viewStory = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/stories/${id}/view`, {
      method: "POST",
    });
    return response.ok;
  } catch (error) {
    console.error("Error viewing story:", error);
    return false;
  }
};

const deleteStory = async (id: string): Promise<boolean> => {
  try {
    const response = await fetch(`/api/stories/${id}`, {
      method: "DELETE",
    });
    return response.ok;
  } catch (error) {
    console.error("Error deleting story:", error);
    return false;
  }
};

export function Microblog() {
  const [newPostContent, setNewPostContent] = createSignal("");
  const [showPostForm, setShowPostForm] = createSignal(false);
  const [_replyingTo, _setReplyingTo] = createSignal<string | null>(null);
  const [_selectedEmoji, _setSelectedEmoji] = createSignal("");
  const [showEmojiPicker, setShowEmojiPicker] = createSignal(false);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [posts, { refetch }] = createResource(fetchPosts);
  
  // ストーリー関連の状態
  const [stories, { refetch: refetchStories }] = createResource(fetchStories);
  const [showStoryForm, setShowStoryForm] = createSignal(false);
  const [storyContent, setStoryContent] = createSignal("");
  const [storyMediaUrl, setStoryMediaUrl] = createSignal("");
  const [storyBackgroundColor, setStoryBackgroundColor] = createSignal("#1DA1F2");
  const [storyTextColor, setStoryTextColor] = createSignal("#FFFFFF");
  const [selectedStory, setSelectedStory] = createSignal<Story | null>(null);
  const [showStoryViewer, setShowStoryViewer] = createSignal(false);
  const [currentStoryIndex, setCurrentStoryIndex] = createSignal(0);

  // コミュニティ関連の状態
  const [showCommunityView, setShowCommunityView] = createSignal(false);
  const [selectedCommunity, setSelectedCommunity] = createSignal<Community | null>(null);
  const [showCreateCommunity, setShowCreateCommunity] = createSignal(false);
  const [communityName, setCommunityName] = createSignal("");
  const [communityDescription, setCommunityDescription] = createSignal("");
  const [communityAvatar, setCommunityAvatar] = createSignal("");
  const [communityBanner, setCommunityBanner] = createSignal("");
  const [communityTags, setCommunityTags] = createSignal("");
  const [communityIsPrivate, setCommunityIsPrivate] = createSignal(false);

  // ダミーコミュニティデータ
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
    }
  ]);

  const emojis = ["😀", "😂", "🥰", "😎", "🤔", "👍", "❤️", "🔥", "✨", "🎉", "💯", "🚀"];

  const storyBackgroundColors = [
    "#1DA1F2", "#E91E63", "#9C27B0", "#673AB7", "#3F51B5", 
    "#2196F3", "#00BCD4", "#009688", "#4CAF50", "#FF9800", 
    "#FF5722", "#795548", "#607D8B", "#000000"
  ];

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
  const handleCreateStory = async (e: Event) => {
    e.preventDefault();
    const content = storyContent().trim();
    if (!content) return;

    const success = await createStory(
      content, 
      storyMediaUrl() || undefined, 
      undefined, 
      storyBackgroundColor(), 
      storyTextColor()
    );
    
    if (success) {
      setStoryContent("");
      setStoryMediaUrl("");
      setShowStoryForm(false);
      refetchStories();
    } else {
      alert("ストーリーの作成に失敗しました");
    }
  };

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
    if (!query) return posts() || [];
    return (posts() || []).filter(post => 
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

  const insertEmoji = (emoji: string) => {
    setNewPostContent(newPostContent() + emoji);
    setShowEmojiPicker(false);
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
        .scrollbar-hide {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }
      `}</style>
      <div class="min-h-screen text-white relative">
      {/* ヘッダー */}
      <div class="sticky top-0 z-10 backdrop-blur-md border-b border-gray-800">
        <div class="max-w-2xl mx-auto px-4 py-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-4">
              <h1 class="text-xl font-bold">ホーム</h1>
              <button
                type="button"
                onClick={() => setShowCommunityView(!showCommunityView())}
                class="text-blue-400 hover:text-blue-300 font-medium transition-colors"
              >
                コミュニティ
              </button>
            </div>
            <div class="relative">
              <input
                type="text"
                placeholder="投稿を検索..."
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
          </div>
        </div>
      </div>

      <div class="max-w-2xl mx-auto">
        {/* コミュニティビュー */}
        {showCommunityView() && !selectedCommunity() && (
          <div class="p-4">
            <div class="flex items-center justify-between mb-6">
              <h2 class="text-2xl font-bold">コミュニティ</h2>
              <button
                type="button"
                onClick={() => setShowCreateCommunity(true)}
                class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full font-medium transition-colors"
              >
                新規作成
              </button>
            </div>

            {/* コミュニティ一覧 */}
            <div class="space-y-4">
              <For each={communities()}>
                {(community) => (
                  <div class="bg-gray-900 rounded-xl p-6 border border-gray-800 hover:border-gray-700 transition-colors">
                    <div class="flex items-start justify-between">
                      <div class="flex-1">
                        <div class="flex items-center space-x-3 mb-3">
                          <div class="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-600 rounded-lg flex items-center justify-center">
                            <span class="text-white font-bold text-lg">
                              {community.name.charAt(0)}
                            </span>
                          </div>
                          <div>
                            <h3 class="text-lg font-bold text-white hover:text-blue-400 cursor-pointer" 
                                onClick={() => handleSelectCommunity(community)}>
                              {community.name}
                            </h3>
                            <div class="flex items-center space-x-4 text-sm text-gray-400">
                              <span>{community.memberCount.toLocaleString()} メンバー</span>
                              <span>{community.postCount.toLocaleString()} 投稿</span>
                              {community.isPrivate && (
                                <span class="bg-yellow-500/20 text-yellow-400 px-2 py-1 rounded-full text-xs">
                                  非公開
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <p class="text-gray-300 mb-3">{community.description}</p>
                        <div class="flex flex-wrap gap-2">
                          <For each={community.tags}>
                            {(tag) => (
                              <span class="bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full text-xs">
                                #{tag}
                              </span>
                            )}
                          </For>
                        </div>
                      </div>
                      <div class="ml-4">
                        {community.isJoined ? (
                          <button
                            type="button"
                            onClick={() => handleLeaveCommunity(community.id)}
                            class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-full text-sm transition-colors"
                          >
                            参加中
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleJoinCommunity(community.id)}
                            class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm transition-colors"
                          >
                            参加する
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}

        {/* 個別コミュニティビュー */}
        {showCommunityView() && selectedCommunity() && (
          <div class="p-4">
            {/* コミュニティヘッダー */}
            <div class="bg-gray-900 rounded-xl overflow-hidden border border-gray-800 mb-6">
              {/* バナー */}
              <div class="h-32 bg-gradient-to-r from-purple-600 to-pink-600"></div>
              
              {/* コミュニティ情報 */}
              <div class="p-6">
                <div class="flex items-start justify-between">
                  <div class="flex items-center space-x-4">
                    <div class="w-16 h-16 bg-gradient-to-br from-purple-500 to-pink-600 rounded-xl flex items-center justify-center -mt-8 border-4 border-gray-900">
                      <span class="text-white font-bold text-xl">
                        {selectedCommunity()!.name.charAt(0)}
                      </span>
                    </div>
                    <div>
                      <h2 class="text-2xl font-bold text-white">{selectedCommunity()!.name}</h2>
                      <div class="flex items-center space-x-4 text-sm text-gray-400 mt-1">
                        <span>{selectedCommunity()!.memberCount.toLocaleString()} メンバー</span>
                        <span>{selectedCommunity()!.postCount.toLocaleString()} 投稿</span>
                      </div>
                    </div>
                  </div>
                  <div class="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={() => {setSelectedCommunity(null); setShowCommunityView(true);}}
                      class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800 transition-colors"
                    >
                      <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                      </svg>
                    </button>
                    {selectedCommunity()!.isJoined ? (
                      <button
                        type="button"
                        onClick={() => handleLeaveCommunity(selectedCommunity()!.id)}
                        class="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-full text-sm transition-colors"
                      >
                        参加中
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleJoinCommunity(selectedCommunity()!.id)}
                        class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-full text-sm transition-colors"
                      >
                        参加する
                      </button>
                    )}
                  </div>
                </div>
                <p class="text-gray-300 mt-4">{selectedCommunity()!.description}</p>
                <div class="flex flex-wrap gap-2 mt-4">
                  <For each={selectedCommunity()!.tags}>
                    {(tag) => (
                      <span class="bg-blue-500/20 text-blue-400 px-2 py-1 rounded-full text-xs">
                        #{tag}
                      </span>
                    )}
                  </For>
                </div>
              </div>
            </div>

            {/* コミュニティ投稿 */}
            <div class="space-y-4">
              <For each={communityPosts().filter(post => post.communityId === selectedCommunity()!.id)}>
                {(post) => (
                  <div class={`bg-gray-900 rounded-xl p-6 border border-gray-800 ${post.isPinned ? 'border-yellow-500/50' : ''}`}>
                    {post.isPinned && (
                      <div class="flex items-center space-x-2 mb-3 text-yellow-400">
                        <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path d="M4 3a2 2 0 100 4h12a2 2 0 100-4H4z" />
                          <path fill-rule="evenodd" d="M3 8a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
                          <path d="M8 15v-2a1 1 0 112 0v2h2a1 1 0 110 2H8a1 1 0 110-2h0z" />
                        </svg>
                        <span class="text-sm font-medium">ピン留め投稿</span>
                      </div>
                    )}
                    <div class="flex space-x-3">
                      <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center flex-shrink-0">
                        <span class="text-white font-bold text-sm">
                          {post.author.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div class="flex-1">
                        <div class="flex items-center space-x-2 mb-2">
                          <span class="font-bold text-white">{post.author}</span>
                          <span class="text-gray-500">·</span>
                          <span class="text-gray-500 text-sm">{formatDate(post.createdAt)}</span>
                        </div>
                        <div class="text-white mb-4 leading-relaxed">{post.content}</div>
                        <div class="flex items-center space-x-6">
                          <button
                            type="button"
                            onClick={() => handleLikeCommunityPost(post.id)}
                            class={`flex items-center space-x-2 transition-colors group ${
                              post.isLiked ? "text-red-400" : "text-gray-500 hover:text-red-400"
                            }`}
                          >
                            <div class="p-2 rounded-full group-hover:bg-red-400/10 transition-colors">
                              <svg
                                class="w-5 h-5"
                                fill={post.isLiked ? "currentColor" : "none"}
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
                            <span class="text-sm">{post.likes}</span>
                          </button>
                          <button
                            type="button"
                            class="flex items-center space-x-2 text-gray-500 hover:text-blue-400 transition-colors group"
                          >
                            <div class="p-2 rounded-full group-hover:bg-blue-400/10 transition-colors">
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
                                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                                />
                              </svg>
                            </div>
                            <span class="text-sm">{post.comments}</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        )}        {/* ストーリーエリア（通常投稿ビューの時のみ表示） */}
        {!showCommunityView() && (
          <div class="border-b border-gray-800 py-4 px-4">
            <div class="flex items-center space-x-4 overflow-x-auto scrollbar-hide">
              {/* ストーリー作成ボタン */}
              <button
                type="button"
                onClick={() => setShowStoryForm(true)}
                class="flex-shrink-0 flex flex-col items-center space-y-2 cursor-pointer"
              >
                <div class="w-16 h-16 border-2 border-dashed border-gray-600 rounded-full flex items-center justify-center hover:border-blue-400 transition-colors">
                  <svg class="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                </div>
                <span class="text-xs text-gray-400">ストーリー</span>
              </button>

              {/* ストーリー一覧 */}
              <For each={stories()}>
                {(story, index) => (
                  <button
                    type="button"
                    onClick={() => handleViewStory(story, index())}
                    class="flex-shrink-0 flex flex-col items-center space-y-2 cursor-pointer group"
                  >
                    <div class={`w-16 h-16 rounded-full p-0.5 ${story.isViewed ? 'bg-gray-600' : 'bg-gradient-to-tr from-yellow-400 via-red-500 to-pink-500'}`}>
                      <div class="w-full h-full bg-black rounded-full flex items-center justify-center overflow-hidden">
                        {story.mediaUrl ? (
                          <img src={story.mediaUrl} alt="" class="w-full h-full object-cover" />
                        ) : (
                          <div 
                            class="w-full h-full flex items-center justify-center text-white font-bold text-sm"
                            style={`background: ${story.backgroundColor || '#1DA1F2'}`}
                          >
                            {story.author.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>
                    </div>
                    <span class="text-xs text-gray-400 group-hover:text-white transition-colors max-w-16 truncate">
                      {story.author}
                    </span>
                  </button>
                )}
              </For>
            </div>
          </div>
        )}
        {/* ストーリー作成フォーム（モーダル形式） */}
        {showStoryForm() && (
          <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-gray-900 rounded-xl p-6 w-full max-w-lg mx-4 border border-gray-700">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-bold">新しいストーリー</h2>
                <button
                  type="button"
                  onClick={() => setShowStoryForm(false)}
                  class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
              
              <form onSubmit={handleCreateStory} class="space-y-4">
                {/* プレビュー */}
                <div 
                  class="aspect-[9/16] rounded-xl p-4 flex flex-col justify-center items-center text-center relative overflow-hidden"
                  style={`background: ${storyBackgroundColor()}; color: ${storyTextColor()}`}
                >
                  {storyMediaUrl() && (
                    <img src={storyMediaUrl()} alt="" class="absolute inset-0 w-full h-full object-cover" />
                  )}
                  <div class="relative z-10">
                    <div class="text-lg font-bold mb-2">
                      {storyContent() || "ここにテキストが表示されます"}
                    </div>
                  </div>
                </div>

                {/* テキスト入力 */}
                <textarea
                  value={storyContent()}
                  onInput={(e) => setStoryContent(e.currentTarget.value)}
                  placeholder="ストーリーに何か書いてみましょう..."
                  maxlength={200}
                  class="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 resize-none border border-gray-700 focus:border-blue-500 outline-none"
                  rows={3}
                />

                {/* 背景色選択 */}
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">背景色</label>
                  <div class="flex space-x-2 flex-wrap gap-2">
                    <For each={storyBackgroundColors}>
                      {(color) => (
                        <button
                          type="button"
                          onClick={() => setStoryBackgroundColor(color)}
                          class={`w-8 h-8 rounded-full border-2 ${storyBackgroundColor() === color ? 'border-white' : 'border-gray-600'}`}
                          style={`background: ${color}`}
                        />
                      )}
                    </For>
                  </div>
                </div>

                {/* テキスト色選択 */}
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">テキスト色</label>
                  <div class="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => setStoryTextColor("#FFFFFF")}
                      class={`w-8 h-8 rounded-full border-2 ${storyTextColor() === "#FFFFFF" ? 'border-blue-500' : 'border-gray-600'} bg-white`}
                    />
                    <button
                      type="button"
                      onClick={() => setStoryTextColor("#000000")}
                      class={`w-8 h-8 rounded-full border-2 ${storyTextColor() === "#000000" ? 'border-blue-500' : 'border-gray-600'} bg-black`}
                    />
                  </div>
                </div>

                {/* メディアURL */}
                <input
                  type="url"
                  value={storyMediaUrl()}
                  onInput={(e) => setStoryMediaUrl(e.currentTarget.value)}
                  placeholder="画像URLを入力（オプション）"
                  class="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
                />

                <div class="flex items-center justify-between">
                  <span class="text-sm text-gray-500">
                    {storyContent().length}/200
                  </span>
                  <button
                    type="submit"
                    class={`px-6 py-2 rounded-full font-bold transition-all duration-200 ${
                      !storyContent().trim() || storyContent().length > 200
                        ? "bg-blue-400/50 text-white/50 cursor-not-allowed"
                        : "bg-blue-500 hover:bg-blue-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105"
                    }`}
                    disabled={!storyContent().trim() || storyContent().length > 200}
                  >
                    ストーリーを作成
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ツイートフォーム（モーダル形式） */}
        {showPostForm() && (
          <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-gray-900 rounded-xl p-6 w-full max-w-lg mx-4 border border-gray-700">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-bold">新しいツイート</h2>
                <button
                  type="button"
                  onClick={() => setShowPostForm(false)}
                  class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
              
              <form onSubmit={handleSubmit} class="space-y-4">
                <div class="flex space-x-3">
                  <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                    <svg
                      class="w-6 h-6 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </div>
                  <div class="flex-1">
                    <textarea
                      value={newPostContent()}
                      onInput={(e) => setNewPostContent(e.currentTarget.value)}
                      placeholder=""
                      maxlength={280}
                      class="w-full bg-transparent text-xl placeholder-gray-500 resize-none border-none outline-none"
                      rows={4}
                    />
                  </div>
                </div>

                <div class="flex items-center justify-between">
                  <div class="flex items-center space-x-4">
                    <button
                      type="button"
                      class="text-blue-400 hover:bg-blue-400/10 p-2 rounded-full transition-colors"
                    >
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
                          d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                        />
                      </svg>
                    </button>
                    <div class="relative">
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(!showEmojiPicker())}
                        class="text-blue-400 hover:bg-blue-400/10 p-2 rounded-full transition-colors"
                      >
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
                            d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                      </button>
                      {showEmojiPicker() && (
                        <div class="absolute bottom-full mb-2 bg-gray-800 rounded-lg p-3 shadow-lg border border-gray-700 grid grid-cols-6 gap-2">
                          <For each={emojis}>
                            {(emoji) => (
                              <button
                                type="button"
                                onClick={() => insertEmoji(emoji)}
                                class="text-xl hover:bg-gray-700 p-1 rounded transition-colors"
                              >
                                {emoji}
                              </button>
                            )}
                          </For>
                        </div>
                      )}
                    </div>
                  </div>

                  <div class="flex items-center space-x-3">
                    <span
                      class={`text-sm ${
                        newPostContent().length > 260
                          ? "text-red-400"
                          : newPostContent().length > 240
                          ? "text-yellow-400"
                          : "text-gray-500"
                      }`}
                    >
                      {newPostContent().length > 0 && (
                        <div class="relative w-8 h-8">
                          <svg
                            class="w-8 h-8 transform -rotate-90"
                            viewBox="0 0 32 32"
                          >
                            <circle
                              cx="16"
                              cy="16"
                              r="14"
                              stroke="currentColor"
                              stroke-width="2"
                              fill="none"
                              class="text-gray-700"
                            />
                            <circle
                              cx="16"
                              cy="16"
                              r="14"
                              stroke="currentColor"
                              stroke-width="2"
                              fill="none"
                              stroke-dasharray={`${
                                (newPostContent().length / 280) * 88
                              } 88`}
                              class={newPostContent().length > 260
                                ? "text-red-400"
                                : newPostContent().length > 240
                                ? "text-yellow-400"
                                : "text-blue-400"}
                            />
                          </svg>
                          {newPostContent().length > 240 && (
                            <span class="absolute inset-0 flex items-center justify-center text-xs font-bold">
                              {280 - newPostContent().length}
                            </span>
                          )}
                        </div>
                      )}
                    </span>
                    <button
                      type="submit"
                      class={`px-6 py-2 rounded-full font-bold transition-all duration-200 ${
                        !newPostContent().trim() || newPostContent().length > 280
                          ? "bg-blue-400/50 text-white/50 cursor-not-allowed"
                          : "bg-blue-500 hover:bg-blue-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105"
                      }`}
                      disabled={!newPostContent().trim() ||
                        newPostContent().length > 280}
                    >
                      ツイートする
                    </button>
                  </div>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* コミュニティ作成フォーム（モーダル形式） */}
        {showCreateCommunity() && (
          <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div class="bg-gray-900 rounded-xl p-6 w-full max-w-lg mx-4 border border-gray-700">
              <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-bold">新しいコミュニティを作成</h2>
                <button
                  type="button"
                  onClick={() => setShowCreateCommunity(false)}
                  class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-800"
                >
                  <svg class="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
              
              <form onSubmit={handleCreateCommunity} class="space-y-4">
                {/* コミュニティ名 */}
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">コミュニティ名</label>
                  <input
                    type="text"
                    value={communityName()}
                    onInput={(e) => setCommunityName(e.currentTarget.value)}
                    placeholder="コミュニティの名前を入力"
                    class="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
                    required
                  />
                </div>

                {/* 説明 */}
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">説明</label>
                  <textarea
                    value={communityDescription()}
                    onInput={(e) => setCommunityDescription(e.currentTarget.value)}
                    placeholder="コミュニティの説明を入力"
                    class="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
                    rows={3}
                    required
                  />
                </div>

                {/* アバターURL */}
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">アバター画像URL（オプション）</label>
                  <input
                    type="url"
                    value={communityAvatar()}
                    onInput={(e) => setCommunityAvatar(e.currentTarget.value)}
                    placeholder="https://example.com/avatar.jpg"
                    class="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* バナーURL */}
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">バナー画像URL（オプション）</label>
                  <input
                    type="url"
                    value={communityBanner()}
                    onInput={(e) => setCommunityBanner(e.currentTarget.value)}
                    placeholder="https://example.com/banner.jpg"
                    class="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* タグ */}
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">タグ（カンマ区切り）</label>
                  <input
                    type="text"
                    value={communityTags()}
                    onInput={(e) => setCommunityTags(e.currentTarget.value)}
                    placeholder="技術, プログラミング, 開発"
                    class="w-full bg-gray-800 rounded-lg p-3 text-white placeholder-gray-500 border border-gray-700 focus:border-blue-500 outline-none"
                  />
                </div>

                {/* 非公開設定 */}
                <div class="flex items-center space-x-3">
                  <input
                    type="checkbox"
                    id="private-community"
                    checked={communityIsPrivate()}
                    onChange={(e) => setCommunityIsPrivate(e.currentTarget.checked)}
                    class="w-4 h-4 text-blue-600 bg-gray-800 border-gray-600 rounded focus:ring-blue-500"
                  />
                  <label for="private-community" class="text-sm text-gray-300">
                    非公開コミュニティにする
                  </label>
                </div>

                <div class="flex items-center justify-end space-x-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setShowCreateCommunity(false)}
                    class="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    class={`px-6 py-2 rounded-full font-bold transition-all duration-200 ${
                      !communityName().trim() || !communityDescription().trim()
                        ? "bg-blue-400/50 text-white/50 cursor-not-allowed"
                        : "bg-blue-500 hover:bg-blue-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105"
                    }`}
                    disabled={!communityName().trim() || !communityDescription().trim()}
                  >
                    作成
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 投稿一覧（通常ビューの時のみ表示） */}
        {!showCommunityView() && (
          <div class="divide-y divide-gray-800">
            <For each={filteredPosts()}>
              {(post) => (
                <div class="p-4 hover:bg-gray-950/50 transition-colors cursor-pointer">
                <div class="flex space-x-3">
                  <div class="w-12 h-12 bg-gradient-to-br from-purple-500 to-pink-600 rounded-full flex items-center justify-center flex-shrink-0">
                    <span class="text-white font-bold text-sm">
                      {post.author.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  <div class="flex-1 min-w-0">
                    <div class="flex items-center space-x-2 mb-1">
                      <span class="font-bold text-white hover:underline cursor-pointer">
                        {post.author}
                      </span>
                      <span class="text-gray-500">·</span>
                      <span class="text-gray-500 text-sm">
                        {formatDate(post.createdAt)}
                      </span>
                    </div>

                    <div class="text-white mb-3 leading-relaxed">
                      {post.content}
                    </div>

                    <div class="flex items-center justify-between max-w-md">
                      <button
                        type="button"
                        onClick={() => handleReply(post.id)}
                        class="flex items-center space-x-2 text-gray-500 hover:text-blue-400 transition-colors group"
                      >
                        <div class="p-2 rounded-full group-hover:bg-blue-400/10 transition-colors">
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
                              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                            />
                          </svg>
                        </div>
                        <span class="text-sm">{post.replies || 0}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleRetweet(post.id)}
                        class={`flex items-center space-x-2 transition-colors group ${
                          post.isRetweeted ? "text-green-400" : "text-gray-500 hover:text-green-400"
                        }`}
                      >
                        <div class="p-2 rounded-full group-hover:bg-green-400/10 transition-colors">
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
                        <span class="text-sm">{post.retweets || 0}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleLike(post.id)}
                        class={`flex items-center space-x-2 transition-colors group ${
                          post.isLiked ? "text-red-400" : "text-gray-500 hover:text-red-400"
                        }`}
                      >
                        <div class="p-2 rounded-full group-hover:bg-red-400/10 transition-colors">
                          <svg
                            class="w-5 h-5"
                            fill={post.isLiked ? "currentColor" : "none"}
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
                        <span class="text-sm">{post.likes || 0}</span>
                      </button>

                      <button
                        type="button"
                        class="flex items-center space-x-2 text-gray-500 hover:text-blue-400 transition-colors group"
                      >
                        <div class="p-2 rounded-full group-hover:bg-blue-400/10 transition-colors">
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
                      </button>

                      <button
                        type="button"
                        onClick={() => handleEdit(post.id, post.content)}
                        class="flex items-center space-x-2 text-gray-500 hover:text-yellow-400 transition-colors group"
                      >
                        <div class="p-2 rounded-full group-hover:bg-yellow-400/10 transition-colors">
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
                              d="M4 21h16M4 17l6-6M16 5l3 3-6 6-3-3-6 6"
                            />
                          </svg>
                        </div>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDelete(post.id)}
                        class="flex items-center space-x-2 text-gray-500 hover:text-red-400 transition-colors group"
                      >
                        <div class="p-2 rounded-full group-hover:bg-red-400/10 transition-colors">
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
                              d="M6 7h12M9 7v10m6-10v10M4 7h16l-1 14H5L4 7z"
                            />
                          </svg>
                        </div>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </For>
          </div>
        )}
      </div>

      {/* ストーリー視聴モーダル */}
      {showStoryViewer() && selectedStory() && (
        <div class="fixed inset-0 bg-black z-50 flex items-center justify-center">
          <div class="relative w-full max-w-sm h-full">
            {/* 進行状況バー */}
            <div class="absolute top-4 left-4 right-4 z-20 flex space-x-1">
              <For each={stories()}>
                {(_, index) => (
                  <div class="flex-1 h-1 bg-gray-600 rounded">
                    <div 
                      class={`h-full bg-white rounded transition-all duration-300 ${
                        index() < currentStoryIndex() ? 'w-full' : 
                        index() === currentStoryIndex() ? 'w-full' : 'w-0'
                      }`}
                    />
                  </div>
                )}
              </For>
            </div>

            {/* ストーリーコンテンツ */}
            <div class="w-full h-full relative">
              {selectedStory()!.mediaUrl && (
                <img 
                  src={selectedStory()!.mediaUrl} 
                  alt="" 
                  class="w-full h-full object-cover"
                />
              )}
              <div 
                class="absolute inset-0 flex flex-col justify-end p-6"
                style={
                  !selectedStory()!.mediaUrl ? 
                  `background-color: ${selectedStory()!.backgroundColor};` +
                  `color: ${selectedStory()!.textColor};` :
                  "background: linear-gradient(transparent, rgba(0,0,0,0.7))"
                }
              >
                <div class="text-white">
                  <div class="flex items-center space-x-2 mb-2">
                    <span class="font-bold text-lg">{selectedStory()!.author}</span>
                    <span class="text-sm opacity-75">
                      {formatDate(selectedStory()!.createdAt)}
                    </span>
                  </div>
                  <div class="text-lg leading-relaxed">
                    {selectedStory()!.content}
                  </div>
                </div>
              </div>
            </div>

            {/* ナビゲーションエリア */}
            <div class="absolute inset-0 flex">
              <button
                type="button"
                onClick={previousStory}
                class="flex-1 opacity-0 hover:opacity-10 bg-black transition-opacity"
              />
              <button
                type="button"
                onClick={nextStory}
                class="flex-1 opacity-0 hover:opacity-10 bg-black transition-opacity"
              />
            </div>

            {/* 閉じるボタン */}
            <button
              type="button"
              onClick={closeStoryViewer}
              class="absolute top-4 right-4 z-20 text-white p-2 rounded-full bg-black/50 hover:bg-black/70 transition-colors"
            >
              <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 20 20">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>

            {/* 削除ボタン（自分のストーリーの場合） */}
            {selectedStory()!.author === "user" && (
              <button
                type="button"
                onClick={() => handleDeleteStory(selectedStory()!.id)}
                class="absolute bottom-4 right-4 z-20 text-white p-2 rounded-full bg-red-500/50 hover:bg-red-500/70 transition-colors"
              >
                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}
      </div>
    </>
  );
}
