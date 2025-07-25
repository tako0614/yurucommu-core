import {
  createEffect,
  createResource,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { useAtom } from "solid-jotai";
import {
  accounts as accountsAtom,
  activeAccount,
  activeAccountId,
  fetchAccounts,
} from "../../states/account.ts";
import { apiFetch, getDomain, getOrigin } from "../../utils/config.ts";
import { fetchPostById } from "../microblog/api.ts";
import { PostItem } from "../microblog/Post.tsx";
import QRCode from "qrcode";
import jsQR from "https://esm.sh/jsqr@1.4.0";

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

export interface VideoResult {
  id: string;
  title: string;
  author: string;
  thumbnail?: string;
  views: number;
}

export interface SearchResult {
  type: "user" | "post" | "video";
  id: string;
  title: string;
  subtitle: string;
  avatar?: string;
  actor?: string;
  origin?: string;
  metadata?: {
    followers?: number;
    likes?: number;
    createdAt?: string;
    views?: number;
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

export default function UnifiedToolsContent() {
  const [selectedAccountId, setSelectedAccountId] = useAtom(activeAccountId);
  const [currentAccount] = useAtom(activeAccount);
  const [accounts, setAccountsState] = useAtom(accountsAtom);
  const [activeTab, setActiveTab] = createSignal<
    "users" | "posts" | "videos"
  >("users");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchType, setSearchType] = createSignal<
    "users" | "posts" | "videos"
  >("users");
  const [users, setUsers] = createSignal<User[]>(mockUsers);
  const [followStatus, setFollowStatus] = createSignal<Record<string, boolean>>(
    {},
  );
  const [qrHandle, setQrHandle] = createSignal<string | null>(null);
  const [qrData, setQrData] = createSignal<string>("");
  const [showScanner, setShowScanner] = createSignal(false);
  const [scanError, setScanError] = createSignal("");
  const [qrError, setQrError] = createSignal("");

  onMount(async () => {
    if (accounts().length === 0) {
      try {
        const results = await fetchAccounts();
        setAccountsState(results);
        if (results.length > 0 && !selectedAccountId()) {
          setSelectedAccountId(results[0].id);
        }
      } catch (err) {
        console.error("Failed to load accounts:", err);
      }
    }
  });

  createEffect(() => {
    const id = selectedAccountId();
    if (!id) return;
    (async () => {
      try {
        const res = await apiFetch(`/api/accounts/${id}/following`);
        if (res.ok) {
          const data = await res.json();
          const map: Record<string, boolean> = {};
          for (const actor of data.following as string[]) {
            map[actor] = true;
          }
          setFollowStatus((prev) => ({ ...map, ...prev }));
        }
      } catch {
        /* ignore */
      }
    })();
  });

  const placeholder = () => {
    switch (activeTab()) {
      case "users":
        return "ユーザー検索... (外部ユーザーは userName@example.com 形式)";
      case "posts":
        return "投稿内容、ハッシュタグで検索...";
      case "videos":
        return "動画タイトル、説明で検索...";
      default:
        return "検索... (外部ユーザーは userName@example.com 形式で入力)";
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
        const res = await apiFetch(url);
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
      if (searchType() === "users") {
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
            origin: new URL(getOrigin()).host,
            metadata: {
              followers: user.followerCount,
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
    return `${getOrigin()}/users/${name}`;
  };

  // フォロー関連の処理
  const handleFollow = async (actor: string, userId?: string) => {
    try {
      if (selectedAccountId()) {
        await apiFetch(`/api/accounts/${selectedAccountId()}/follow`, {
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
        await apiFetch(`/api/accounts/${selectedAccountId()}/follow`, {
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

  const openMyQr = async () => {
    if (!currentAccount()) {
      setQrError("アカウント情報がありません");
      return;
    }
    try {
      const handle = `${currentAccount()!.userName}@${getDomain()}`;
      const qrDataUrl = await QRCode.toDataURL(handle);
      setQrData(qrDataUrl);
      setQrHandle(handle);
      setQrError("");
    } catch (_) {
      setQrError("QRコードの生成に失敗しました");
    }
  };

  const closeQr = () => {
    setQrHandle(null);
    setQrData("");
  };

  const handleScanFile = async (e: Event) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files || !files[0]) return;
    setScanError("");
    const bmp = await createImageBitmap(files[0]);
    const canvas = document.createElement("canvas");
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(bmp, 0, 0);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height);
    if (code) {
      setSearchQuery(code.data);
      setShowScanner(false);
    } else {
      setScanError("QRコードを読み取れませんでした");
    }
  };

  function SearchPost(props: { id: string }) {
    const [post] = createResource(() => fetchPostById(props.id));
    const formatDate = (date: string) => new Date(date).toLocaleString("ja-JP");
    return (
      <Show when={post()}>
        {(p) => (
          <PostItem
            post={p}
            tab="latest"
            handleReply={() => {}}
            handleRetweet={() => {}}
            handleQuote={() => {}}
            handleLike={() => {}}
            handleEdit={() => {}}
            handleDelete={() => {}}
            formatDate={formatDate}
          />
        )}
      </Show>
    );
  }

  return (
    <div class="h-full space-y-6 animate-in slide-in-from-bottom-4 duration-500">
      <Show when={qrHandle()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={closeQr}
        >
          <div
            class="bg-gray-800 rounded-lg p-6 space-y-4 w-64"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 class="text-lg font-bold text-white text-center">QRコード</h3>
            <img src={qrData()} alt="qr" class="mx-auto" />
            <p class="text-center text-gray-300 break-all">{qrHandle()}</p>
            <button
              type="button"
              class="mx-auto px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
              onClick={closeQr}
            >
              閉じる
            </button>
          </div>
        </div>
      </Show>
      <Show when={showScanner()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
          onClick={() => setShowScanner(false)}
        >
          <div
            class="bg-gray-800 rounded-lg p-6 space-y-4 w-64"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 class="text-lg font-bold text-white text-center">QR読み取り</h3>
            <input
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleScanFile}
              class="text-sm text-gray-300"
            />
            <Show when={scanError()}>
              <p class="text-red-400 text-sm text-center">{scanError()}</p>
            </Show>
            <button
              type="button"
              class="mx-auto px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded"
              onClick={() => setShowScanner(false)}
            >
              閉じる
            </button>
          </div>
        </div>
      </Show>
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
              setActiveTab("videos");
              setSearchType("videos");
            }}
            class={`px-4 py-2 rounded-full text-sm font-semibold transition-all duration-200 ${
              activeTab() === "videos"
                ? "bg-blue-600 text-white shadow-sm"
                : "text-gray-400 hover:bg-gray-700/50"
            }`}
          >
            動画
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
          <div class="mt-4 flex justify-end space-x-2">
            <button
              type="button"
              onClick={openMyQr}
              class="px-3 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm transition-all duration-200"
            >
              自分のQR
            </button>
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              class="px-3 py-1 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm transition-all duration-200"
            >
              QR読み取り
            </button>
          </div>
          <Show when={qrError()}>
            <p class="mt-2 text-red-400 text-sm text-right">{qrError()}</p>
          </Show>
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
                                      : result.type === "video"
                                      ? "bg-purple-600/20 text-purple-400"
                                      : "bg-yellow-600/20 text-yellow-400"
                                  }`}
                                >
                                  {result.type === "user"
                                    ? "ユーザー"
                                    : result.type === "video"
                                    ? "動画"
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

        {/* 動画タブ */}
        <Show when={activeTab() === "videos"}>
          <div class="space-y-6">
            <div class="space-y-3">
              <h3 class="text-lg font-semibold text-gray-200">動画検索</h3>
              <Show
                when={searchResults().filter((r: SearchResult) =>
                  r.type === "video"
                ).length > 0}
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
                  <For each={searchResults().filter((r) => r.type === "video")}>
                    {(v) => (
                      <div class="bg-gray-800/50 rounded-lg p-4 flex space-x-3 hover:bg-gray-800 transition-all duration-200">
                        <Show when={v.avatar}>
                          <img
                            src={v.avatar!}
                            alt="thumb"
                            class="w-24 h-16 object-cover rounded"
                          />
                        </Show>
                        <div class="flex-1">
                          <p class="text-gray-200">{v.title}</p>
                          <p class="text-xs text-gray-400">{v.subtitle}</p>
                          <Show when={v.metadata?.views}>
                            <p class="text-xs text-gray-500">
                              {formatNumber(v.metadata!.views!)} 回視聴
                            </p>
                          </Show>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </Show>
            </div>
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
                    {(post) => <SearchPost id={post.id} />}
                  </For>
                </div>
              </Show>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
