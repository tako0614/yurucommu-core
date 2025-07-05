import { createResource, createSignal, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { activeAccount, activeAccountId } from "../../states/account.ts";

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatar: string;
  bio?: string;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  isBlocked: boolean;
  lastSeen?: string;
}

export interface Community {
  id: string;
  name: string;
  description: string;
  avatar: string;
  banner: string;
  memberCount: number;
  postCount: number;
  isJoined: boolean;
  isPrivate: boolean;
  tags: string[];
  rules: string[];
  createdAt: string;
  moderators: string[];
}

export interface SearchResult {
  type: "user" | "community" | "post";
  id: string;
  title: string;
  subtitle: string;
  avatar?: string;
  actor?: string;
  origin?: string;
  metadata?: {
    followers?: number;
    members?: number;
    likes?: number;
    createdAt?: string;
  };
}

// モックデータ
const mockUsers: User[] = [
  {
    id: "1",
    username: "tech_enthusiast",
    displayName: "テックマニア",
    avatar: "",
    bio: "プログラミングと新技術が大好きです",
    followerCount: 1250,
    followingCount: 340,
    isFollowing: false,
    isBlocked: false,
    lastSeen: "2024-07-05T10:30:00Z",
  },
  {
    id: "2",
    username: "creative_designer",
    displayName: "クリエイティブデザイナー",
    avatar: "",
    bio: "UI/UXデザインとアートに情熱を注いでいます",
    followerCount: 890,
    followingCount: 456,
    isFollowing: true,
    isBlocked: false,
    lastSeen: "2024-07-05T09:15:00Z",
  },
  {
    id: "3",
    username: "game_lover",
    displayName: "ゲーム愛好家",
    avatar: "",
    bio: "インディーゲームから大作まで何でもプレイします",
    followerCount: 2100,
    followingCount: 180,
    isFollowing: false,
    isBlocked: false,
    lastSeen: "2024-07-05T08:45:00Z",
  },
];

const mockCommunities: Community[] = [
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
    moderators: ["admin", "tech_lead"],
  },
  {
    id: "2",
    name: "デザイン研究室",
    description: "UI/UXデザインやグラフィックデザインについて学び合う",
    avatar: "",
    banner: "",
    memberCount: 756,
    postCount: 1890,
    isJoined: false,
    isPrivate: false,
    tags: ["デザイン", "UI", "UX", "グラフィック"],
    rules: ["作品には建設的なフィードバックを", "著作権を尊重する"],
    createdAt: "2024-02-20T00:00:00Z",
    moderators: ["design_lead"],
  },
  {
    id: "3",
    name: "ゲーム開発同盟",
    description: "インディーゲーム開発者のためのコミュニティ",
    avatar: "",
    banner: "",
    memberCount: 892,
    postCount: 2156,
    isJoined: true,
    isPrivate: false,
    tags: ["ゲーム開発", "インディー", "プログラミング"],
    rules: ["開発過程の共有を推奨", "他の開発者を支援する"],
    createdAt: "2024-03-05T00:00:00Z",
    moderators: ["game_dev_master"],
  },
  {
    id: "4",
    name: "秘密の料理研究会",
    description: "特別なレシピと料理技術を共有する限定コミュニティ",
    avatar: "",
    banner: "",
    memberCount: 156,
    postCount: 445,
    isJoined: false,
    isPrivate: true,
    tags: ["料理", "レシピ", "グルメ"],
    rules: ["レシピの外部流出禁止", "写真付きの投稿を推奨"],
    createdAt: "2024-04-10T00:00:00Z",
    moderators: ["chef_secret"],
  },
];

export default function UnifiedToolsContent() {
  const [selectedAccountId] = useAtom(activeAccountId);
  const [currentAccount] = useAtom(activeAccount);
  const [activeTab, setActiveTab] = createSignal<
    "search" | "users" | "posts" | "communities"
  >("search");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchType, setSearchType] = createSignal<
    "all" | "users" | "communities" | "posts"
  >("all");
  const [users, setUsers] = createSignal<User[]>(mockUsers);
  const [communities, setCommunities] = createSignal<Community[]>(
    mockCommunities,
  );
  const [followStatus, setFollowStatus] = createSignal<Record<string, boolean>>(
    {},
  );

  const placeholder = () => {
    switch (activeTab()) {
      case "users":
        return "ユーザー検索... (外部ユーザーは username@example.com 形式)";
      case "posts":
        return "投稿内容、ハッシュタグで検索...";
      case "communities":
        return "コミュニティ名、説明、タグで検索...";
      default:
        return "検索... (外部ユーザーは username@example.com 形式で入力)";
    }
  };

  // 検索クエリの解析
  const parseSearchQuery = (query: string) => {
    const trimmed = query.trim();
    if (trimmed.includes("@")) {
      const parts = trimmed.split("@");
      if (parts.length === 2 && parts[1]) {
        return {
          searchTerm: parts[0],
          server: parts[1],
          isRemote: true,
        };
      }
    }
    return {
      searchTerm: trimmed,
      server: null,
      isRemote: false,
    };
  };

  // 検索結果の取得
  const [searchData, { refetch: _refetchSearch }] = createResource(
    () => {
      const q = searchQuery().trim();
      if (!q) return null;
      return `/api/search?q=${encodeURIComponent(q)}&type=${searchType()}`;
    },
    async (url) => {
      if (!url) return [] as SearchResult[];
      try {
        const res = await fetch(url);
        if (!res.ok) return [] as SearchResult[];
        return await res.json();
      } catch {
        return [] as SearchResult[];
      }
    },
  );

  // フィルタリングされた結果（リモート検索時は API 結果、ローカル検索時はキャッシュ + API 結果）
  const getFilteredResults = () => {
    const query = searchQuery().trim();
    if (!query) return [];

    const parsed = parseSearchQuery(query);

    if (parsed.isRemote) {
      // リモート検索の場合は API 結果のみ
      return searchData() ?? [];
    } else {
      // ローカル検索の場合はキャッシュ + API 結果を統合
      const apiResults = searchData() ?? [];
      const localResults: SearchResult[] = [];

      // ユーザーのキャッシュから検索
      if (searchType() === "all" || searchType() === "users") {
        const filteredUsers = users().filter((user) =>
          user.username.toLowerCase().includes(
            parsed.searchTerm.toLowerCase(),
          ) ||
          user.displayName.toLowerCase().includes(
            parsed.searchTerm.toLowerCase(),
          ) ||
          user.bio?.toLowerCase().includes(parsed.searchTerm.toLowerCase())
        );

        for (const user of filteredUsers) {
          localResults.push({
            type: "user",
            id: user.id,
            title: user.displayName,
            subtitle: `@${user.username}`,
            actor: localActor(user.username),
            origin: globalThis.location.host,
            metadata: {
              followers: user.followerCount,
            },
          });
        }
      }

      // コミュニティのキャッシュから検索
      if (searchType() === "all" || searchType() === "communities") {
        const filteredCommunities = communities().filter((community) =>
          community.name.toLowerCase().includes(
            parsed.searchTerm.toLowerCase(),
          ) ||
          community.description.toLowerCase().includes(
            parsed.searchTerm.toLowerCase(),
          ) ||
          community.tags.some((tag) =>
            tag.toLowerCase().includes(parsed.searchTerm.toLowerCase())
          )
        );

        for (const community of filteredCommunities) {
          localResults.push({
            type: "community",
            id: community.id,
            title: community.name,
            subtitle: community.description,
            origin: globalThis.location.host,
            metadata: {
              members: community.memberCount,
            },
          });
        }
      }

      // ローカル結果と API 結果を統合（重複排除）
      const combined = [...localResults];
      for (const apiResult of apiResults) {
        if (
          !combined.find((local) =>
            local.id === apiResult.id && local.type === apiResult.type
          )
        ) {
          combined.push(apiResult);
        }
      }

      return combined;
    }
  };

  const searchResults = () => getFilteredResults();

  const localActor = (name: string) => {
    const { protocol, host } = globalThis.location;
    return `${protocol}//${host}/users/${name}`;
  };

  // フォロー関連の処理
  const handleFollow = async (actor: string, userId?: string) => {
    try {
      if (selectedAccountId()) {
        await fetch(`/api/accounts/${selectedAccountId()}/follow`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target: actor,
            userName: currentAccount()?.userName ?? "",
          }),
        });
      }
      if (userId) {
        setUsers((prev) =>
          prev.map((user) =>
            user.id === userId
              ? {
                ...user,
                isFollowing: true,
                followerCount: user.followerCount + 1,
              }
              : user
          )
        );
      }
      setFollowStatus((prev) => ({ ...prev, [actor]: true }));
    } catch (error) {
      console.error("Failed to follow user:", error);
    }
  };

  const handleUnfollow = async (actor: string, userId?: string) => {
    try {
      if (selectedAccountId()) {
        await fetch(`/api/accounts/${selectedAccountId()}/follow`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target: actor }),
        });
      }
      if (userId) {
        setUsers((prev) =>
          prev.map((user) =>
            user.id === userId
              ? {
                ...user,
                isFollowing: false,
                followerCount: user.followerCount - 1,
              }
              : user
          )
        );
      }
      setFollowStatus((prev) => ({ ...prev, [actor]: false }));
    } catch (error) {
      console.error("Failed to unfollow user:", error);
    }
  };

  // コミュニティ関連の処理
  const handleJoinCommunity = (communityId: string) => {
    try {
      // TODO: API呼び出し
      console.log("Joining community:", communityId);
      setCommunities((prev) =>
        prev.map((community) =>
          community.id === communityId
            ? {
              ...community,
              isJoined: true,
              memberCount: community.memberCount + 1,
            }
            : community
        )
      );
    } catch (error) {
      console.error("Failed to join community:", error);
    }
  };

  const handleLeaveCommunity = (communityId: string) => {
    try {
      // TODO: API呼び出し
      console.log("Leaving community:", communityId);
      setCommunities((prev) =>
        prev.map((community) =>
          community.id === communityId
            ? {
              ...community,
              isJoined: false,
              memberCount: community.memberCount - 1,
            }
            : community
        )
      );
    } catch (error) {
      console.error("Failed to leave community:", error);
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000) {
      return `${(num / 1000).toFixed(1)}K`;
    }
    return num.toString();
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString("ja-JP", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  return (
    <div class="h-full space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <div class="text-center space-y-2">
        <h2 class="text-3xl font-bold text-gray-100">検索</h2>
        <p class="text-gray-400 max-w-2xl mx-auto">
          ユーザー、投稿、コミュニティを簡単に検索・発見
        </p>
      </div>

      {/* タブナビゲーション */}
      <div class="flex justify-center">
        <div class="flex space-x-1 bg-gray-800/50 p-1 rounded-full">
          <button
            type="button"
            onClick={() => {
              setActiveTab("search");
              setSearchType("all");
            }}
            class={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
              activeTab() === "search"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:bg-gray-700/50"
            }`}
          >
            すべて
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("users");
              setSearchType("users");
            }}
            class={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
              activeTab() === "users"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:bg-gray-700/50"
            }`}
          >
            ユーザー
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("posts");
              setSearchType("posts");
            }}
            class={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
              activeTab() === "posts"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:bg-gray-700/50"
            }`}
          >
            投稿
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveTab("communities");
              setSearchType("communities");
            }}
            class={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
              activeTab() === "communities"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:bg-gray-700/50"
            }`}
          >
            コミュニティ
          </button>
        </div>
      </div>

      <div class="max-w-4xl mx-auto">
        <div class="bg-gray-800/50 rounded-xl p-6 mb-6">
          <div class="relative">
            <input
              type="text"
              placeholder={placeholder()}
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="w-full bg-gray-700 rounded-lg px-4 py-3 pl-10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <svg
              class="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400"
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

        {/* 総合検索タブ */}
        <Show when={activeTab() === "search"}>
          <div class="space-y-6">
            {/* 検索結果 */}
            <Show when={searchQuery()}>
              <div class="space-y-3">
                <h3 class="text-lg font-semibold text-gray-200">検索結果</h3>
                <div class="space-y-2">
                  <For each={searchResults()}>
                    {(result) => (
                      <div class="bg-gray-800/50 rounded-lg p-4 hover:bg-gray-800 transition-all duration-200">
                        <div class="flex items-center justify-between">
                          <div class="flex items-center space-x-3">
                            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-400 to-purple-600 flex items-center justify-center text-white font-semibold overflow-hidden">
                              <Show
                                when={result.avatar}
                                fallback={result.title.charAt(0)}
                              >
                                <img
                                  src={result.avatar!}
                                  alt="avatar"
                                  class="w-full h-full object-cover"
                                />
                              </Show>
                            </div>
                            <div>
                              <div class="flex items-center space-x-2">
                                <h4 class="font-semibold text-gray-200">
                                  {result.title}
                                </h4>
                                <span
                                  class={`px-2 py-1 rounded-full text-xs ${
                                    result.type === "user"
                                      ? "bg-green-600/20 text-green-400"
                                      : result.type === "community"
                                      ? "bg-blue-600/20 text-blue-400"
                                      : "bg-yellow-600/20 text-yellow-400"
                                  }`}
                                >
                                  {result.type === "user"
                                    ? "ユーザー"
                                    : result.type === "community"
                                    ? "コミュニティ"
                                    : "投稿"}
                                </span>
                              </div>
                              <p class="text-sm text-gray-400 truncate max-w-md">
                                {result.subtitle}
                              </p>
                              <Show when={result.metadata}>
                                <div class="flex items-center space-x-4 mt-1 text-xs text-gray-500">
                                  <Show when={result.metadata!.followers}>
                                    <span>
                                      {formatNumber(
                                        result.metadata!.followers!,
                                      )} フォロワー
                                    </span>
                                  </Show>
                                  <Show when={result.metadata!.members}>
                                    <span>
                                      {formatNumber(result.metadata!.members!)}
                                      {" "}
                                      メンバー
                                    </span>
                                  </Show>
                                </div>
                              </Show>
                            </div>
                          </div>
                          <div class="flex space-x-2">
                            <Show when={result.type === "user"}>
                              {(() => {
                                const user = users().find((u) =>
                                  u.id === result.id
                                );
                                const followed =
                                  followStatus()[result.actor ?? ""] ??
                                    user?.isFollowing;
                                return followed
                                  ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleUnfollow(
                                          result.actor || "",
                                          result.id,
                                        )}
                                      class="px-3 py-1 bg-gray-600 hover:bg-red-600 text-white rounded-lg text-sm transition-all duration-200"
                                    >
                                      フォロー中
                                    </button>
                                  )
                                  : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleFollow(
                                          result.actor || "",
                                          result.id,
                                        )}
                                      class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-all duration-200"
                                    >
                                      フォロー
                                    </button>
                                  );
                              })()}
                            </Show>
                            <Show when={result.type === "community"}>
                              {(() => {
                                const community = communities().find((c) =>
                                  c.id === result.id
                                );
                                return community?.isJoined
                                  ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleLeaveCommunity(result.id)}
                                      class="px-3 py-1 bg-gray-600 hover:bg-red-600 text-white rounded-lg text-sm transition-all duration-200"
                                    >
                                      参加中
                                    </button>
                                  )
                                  : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleJoinCommunity(result.id)}
                                      class="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-all duration-200"
                                    >
                                      参加
                                    </button>
                                  );
                              })()}
                            </Show>
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                  <Show when={searchResults().length === 0}>
                    <div class="text-center py-8 text-gray-400">
                      <svg
                        class="w-12 h-12 mx-auto mb-4 opacity-50"
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
                      <p>検索結果が見つかりませんでした</p>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        {/* ユーザータブ */}
        <Show when={activeTab() === "users"}>
          <div class="space-y-6">
            {/* ユーザー一覧 */}
            <div class="space-y-3">
              <h3 class="text-lg font-semibold text-gray-200">ユーザー一覧</h3>
              <div class="space-y-2">
                <For
                  each={searchResults().filter((result: SearchResult) =>
                    result.type === "user"
                  )}
                >
                  {(result: SearchResult) => {
                    // ローカルユーザーの詳細情報を取得
                    const localUser = users().find((u) => u.id === result.id);

                    return (
                      <div class="bg-gray-800/50 rounded-lg p-4 hover:bg-gray-800 transition-all duration-200">
                        <div class="flex items-center justify-between">
                          <div class="flex items-center space-x-3">
                            <div class="w-12 h-12 rounded-full bg-gradient-to-br from-green-400 to-blue-600 flex items-center justify-center text-white font-semibold overflow-hidden">
                              <Show
                                when={result.avatar || localUser?.avatar}
                                fallback={result.title.charAt(0)}
                              >
                                <img
                                  src={result.avatar || localUser?.avatar!}
                                  alt="avatar"
                                  class="w-full h-full object-cover"
                                />
                              </Show>
                            </div>
                            <div>
                              <div class="flex items-center space-x-2">
                                <h4 class="font-semibold text-gray-200">
                                  {result.title}
                                </h4>
                                <Show when={result.origin}>
                                  <span class="px-2 py-1 bg-blue-600/20 text-blue-400 text-xs rounded-full">
                                    {result.origin}
                                  </span>
                                </Show>
                              </div>
                              <p class="text-sm text-gray-400">
                                {result.subtitle}
                              </p>
                              <Show when={localUser?.bio}>
                                <p class="text-sm text-gray-400 mt-1">
                                  {localUser!.bio}
                                </p>
                              </Show>
                              <div class="flex items-center space-x-4 mt-2 text-xs text-gray-500">
                                <Show
                                  when={result.metadata?.followers ||
                                    localUser?.followerCount}
                                >
                                  <span>
                                    {formatNumber(
                                      result.metadata?.followers ||
                                        localUser?.followerCount || 0,
                                    )} フォロワー
                                  </span>
                                </Show>
                                <Show when={localUser?.followingCount}>
                                  <span>
                                    {formatNumber(localUser!.followingCount)}
                                    {" "}
                                    フォロー中
                                  </span>
                                </Show>
                                <Show when={localUser?.lastSeen}>
                                  <span>
                                    最終アクティブ:{" "}
                                    {formatDate(localUser!.lastSeen!)}
                                  </span>
                                </Show>
                              </div>
                            </div>
                          </div>
                          <div class="flex space-x-2">
                            <Show when={result.actor}>
                              {(localUser &&
                                  (followStatus()[result.actor!] ??
                                    localUser.isFollowing))
                                ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleUnfollow(
                                        result.actor!,
                                        localUser?.id,
                                      )}
                                    class="px-4 py-2 bg-gray-600 hover:bg-red-600 text-white rounded-lg text-sm transition-all duration-200"
                                  >
                                    フォロー中
                                  </button>
                                )
                                : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleFollow(
                                        result.actor!,
                                        localUser?.id,
                                      )}
                                    class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-all duration-200"
                                  >
                                    フォロー
                                  </button>
                                )}
                            </Show>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
                <Show
                  when={searchResults().filter((result: SearchResult) =>
                    result.type === "user"
                  ).length === 0}
                >
                  <div class="text-center py-8 text-gray-400">
                    <svg
                      class="w-12 h-12 mx-auto mb-4 opacity-50"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                      />
                    </svg>
                    <p>ユーザーが見つかりませんでした</p>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </Show>

        {/* 投稿タブ */}
        <Show when={activeTab() === "posts"}>
          <div class="space-y-6">
            {/* 投稿検索結果 */}
            <div class="space-y-3">
              <h3 class="text-lg font-semibold text-gray-200">投稿検索</h3>
              <Show
                when={searchResults().filter((r: SearchResult) =>
                  r.type === "post"
                ).length >
                  0}
                fallback={
                  <div class="text-center py-8 text-gray-400">
                    <svg
                      class="w-12 h-12 mx-auto mb-4 opacity-50"
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
                    <p>検索結果が見つかりませんでした</p>
                  </div>
                }
              >
                <div class="space-y-2">
                  <For
                    each={searchResults().filter((r: SearchResult) =>
                      r.type === "post"
                    )}
                  >
                    {(post) => (
                      <div class="bg-gray-800/50 rounded-lg p-4 hover:bg-gray-800 transition-all duration-200">
                        <p class="text-gray-200 mb-1">{post.title}</p>
                        <span class="text-xs text-gray-400">
                          {post.subtitle}
                        </span>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>

        {/* コミュニティタブ */}
        <Show when={activeTab() === "communities"}>
          <div class="space-y-6">
            {/* コミュニティ一覧 */}
            <div class="space-y-3">
              <h3 class="text-lg font-semibold text-gray-200">
                コミュニティ一覧
              </h3>
              <div class="space-y-3">
                <For
                  each={searchResults().filter((result: SearchResult) =>
                    result.type === "community"
                  )}
                >
                  {(result: SearchResult) => {
                    // ローカルコミュニティの詳細情報を取得
                    const localCommunity = communities().find((c) =>
                      c.id === result.id
                    );

                    return (
                      <div class="bg-gray-800/50 rounded-lg p-4 hover:bg-gray-800 transition-all duration-200">
                        <div class="flex items-start justify-between">
                          <div class="flex items-start space-x-3 flex-1">
                            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-400 to-pink-600 flex items-center justify-center text-white font-semibold overflow-hidden">
                              <Show
                                when={result.avatar || localCommunity?.avatar}
                                fallback={result.title.charAt(0)}
                              >
                                <img
                                  src={result.avatar || localCommunity?.avatar!}
                                  alt="avatar"
                                  class="w-full h-full object-cover"
                                />
                              </Show>
                            </div>
                            <div class="flex-1">
                              <div class="flex items-center space-x-2 mb-1">
                                <h4 class="font-semibold text-gray-200">
                                  {result.title}
                                </h4>
                                <Show when={localCommunity?.isPrivate}>
                                  <span class="px-2 py-1 bg-yellow-600/20 text-yellow-400 rounded-full text-xs">
                                    プライベート
                                  </span>
                                </Show>
                                <Show when={result.origin}>
                                  <span class="px-2 py-1 bg-blue-600/20 text-blue-400 text-xs rounded-full">
                                    {result.origin}
                                  </span>
                                </Show>
                              </div>
                              <p class="text-sm text-gray-400 mb-2">
                                {result.subtitle}
                              </p>
                              <div class="flex items-center space-x-4 text-xs text-gray-500 mb-2">
                                <Show
                                  when={result.metadata?.members ||
                                    localCommunity?.memberCount}
                                >
                                  <span>
                                    {formatNumber(
                                      result.metadata?.members ||
                                        localCommunity?.memberCount || 0,
                                    )} メンバー
                                  </span>
                                </Show>
                                <Show when={localCommunity?.postCount}>
                                  <span>
                                    {formatNumber(localCommunity!.postCount)}
                                    {" "}
                                    投稿
                                  </span>
                                </Show>
                                <Show when={localCommunity?.createdAt}>
                                  <span>
                                    作成:{" "}
                                    {formatDate(localCommunity!.createdAt)}
                                  </span>
                                </Show>
                              </div>
                              <Show when={localCommunity?.tags}>
                                <div class="flex flex-wrap gap-1">
                                  <For each={localCommunity!.tags}>
                                    {(tag: string) => (
                                      <span class="px-2 py-1 bg-blue-600/20 text-blue-400 rounded-full text-xs">
                                        #{tag}
                                      </span>
                                    )}
                                  </For>
                                </div>
                              </Show>
                            </div>
                          </div>
                          <div class="flex flex-col space-y-2 ml-4">
                            <Show when={localCommunity}>
                              {localCommunity!.isJoined
                                ? (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleLeaveCommunity(localCommunity!.id)}
                                    class="px-3 py-1 bg-gray-600 hover:bg-red-600 text-white rounded-lg text-sm transition-all duration-200"
                                  >
                                    参加中
                                  </button>
                                )
                                : (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleJoinCommunity(localCommunity!.id)}
                                    class="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-all duration-200"
                                  >
                                    参加
                                  </button>
                                )}
                            </Show>
                          </div>
                        </div>
                      </div>
                    );
                  }}
                </For>
                <Show
                  when={searchResults().filter((result: SearchResult) =>
                    result.type === "community"
                  ).length === 0}
                >
                  <div class="text-center py-8 text-gray-400">
                    <svg
                      class="w-12 h-12 mx-auto mb-4 opacity-50"
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
                    <p>コミュニティが見つかりませんでした</p>
                  </div>
                </Show>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
