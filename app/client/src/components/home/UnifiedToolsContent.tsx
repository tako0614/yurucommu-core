import {
  createEffect,
  createResource,
  createSignal,
  For,
  onMount,
  Show,
  onCleanup,
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

export interface SearchResult {
  type: "user" | "post";
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
  };
}

export default function UnifiedToolsContent() {
  const [selectedAccountId, setSelectedAccountId] = useAtom(activeAccountId);
  const [currentAccount] = useAtom(activeAccount);
  const [accounts, setAccountsState] = useAtom(accountsAtom);
  const [activeTab, setActiveTab] = createSignal<"users" | "posts">("users");
  const [searchQuery, setSearchQuery] = createSignal("");
  const [searchType, setSearchType] = createSignal<"users" | "posts">(
    "users",
  );
  function getDefaultUseFaspSearch() {
    try {
      const v = localStorage.getItem("useFaspSearch");
      return v === null ? true : v !== "0";
    } catch {
      return true;
    }
  }
  const [useFaspSearch, setUseFaspSearch] = createSignal<boolean>(
    getDefaultUseFaspSearch(),
  );
  const [users, setUsers] = createSignal<User[]>([]);
  const [followStatus, setFollowStatus] = createSignal<Record<string, boolean>>(
    {},
  );
  const [qrHandle, setQrHandle] = createSignal<string | null>(null);
  const [qrData, setQrData] = createSignal<string>("");
  const [showScanner, setShowScanner] = createSignal(false);
  const [scanError, setScanError] = createSignal("");
  const [qrError, setQrError] = createSignal("");
  const [qrMsg, setQrMsg] = createSignal("");
  const [cameraReady, setCameraReady] = createSignal(false);

  let videoRef: HTMLVideoElement | null = null;
  let canvasRef: HTMLCanvasElement | null = null;
  let rafId: number | null = null;
  let mediaStream: MediaStream | null = null;

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
        const username = accounts().find((a) => a.id === id)?.userName;
        if (!username) return;
        const res = await apiFetch(`/api/users/${username}/following`);
        if (res.ok) {
          const data = await res.json();
          const map: Record<string, boolean> = {};
          for (const actor of data as string[]) {
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
      return `/api/search?q=${
        encodeURIComponent(q)
      }&type=${searchType()}&useFasp=${useFaspSearch() ? "1" : "0"}`;
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
        await apiFetch("/api/follow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            follower: currentAccount()?.userName ?? "",
            target: actor,
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
        await apiFetch("/api/follow", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            follower: currentAccount()?.userName ?? "",
            target: actor,
          }),
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
    setQrMsg("");
  };

  const copyHandle = async () => {
    if (!qrHandle()) return;
    try {
      await navigator.clipboard.writeText(qrHandle()!);
  setQrMsg("コピーしました");
  setTimeout(() => setQrMsg(""), 1500);
    } catch (_) {
      setQrError("コピーに失敗しました");
    }
  };

  const downloadQr = () => {
    if (!qrData()) return;
    try {
      const a = document.createElement("a");
      a.href = qrData();
      a.download = `${currentAccount()?.userName ?? "user"}-takos-qr.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (_) {
      setQrError("画像の保存に失敗しました");
    }
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

  const startScanner = async () => {
    setScanError("");
    setCameraReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("このブラウザーはカメラに対応していません");
      }
      mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      if (!videoRef) throw new Error("ビデオ要素が初期化されていません");
      videoRef.srcObject = mediaStream;
      await videoRef.play();

      const onLoaded = () => {
        if (!videoRef || !canvasRef) return;
        const w = videoRef.videoWidth || 640;
        const h = videoRef.videoHeight || 480;
        canvasRef.width = w;
        canvasRef.height = h;
        setCameraReady(true);

        const ctx = canvasRef.getContext("2d");
        if (!ctx) return;

        const drawLine = (begin: { x: number; y: number }, end: { x: number; y: number }, color = "#00E5FF") => {
          ctx.beginPath();
          ctx.moveTo(begin.x, begin.y);
          ctx.lineTo(end.x, end.y);
          ctx.lineWidth = 4;
          ctx.strokeStyle = color;
          ctx.stroke();
        };

        const tick = () => {
          if (!videoRef || !canvasRef) return;
          const width = canvasRef.width;
          const height = canvasRef.height;
          // 描画
          ctx.drawImage(videoRef, 0, 0, width, height);
          try {
            const imageData = ctx.getImageData(0, 0, width, height);
            const code = jsQR(imageData.data, imageData.width, imageData.height);
            if (code) {
              // ガイド描画
              if (code.location) {
                drawLine(code.location.topLeftCorner, code.location.topRightCorner);
                drawLine(code.location.topRightCorner, code.location.bottomRightCorner);
                drawLine(code.location.bottomRightCorner, code.location.bottomLeftCorner);
                drawLine(code.location.bottomLeftCorner, code.location.topLeftCorner);
              }
              setSearchQuery(code.data);
              setShowScanner(false);
              return;
            }
          } catch (_) {
            // ignore frame errors
          }
          rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);
      };

      if (videoRef.readyState >= 2) {
        onLoaded();
      } else {
        videoRef.onloadedmetadata = onLoaded;
      }
    } catch (err) {
      console.error(err);
      setScanError("カメラを利用できません: 権限や端末設定を確認してください");
    }
  };

  const stopScanner = () => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
      mediaStream = null;
    }
    setCameraReady(false);
  };

  createEffect(() => {
    if (showScanner()) {
      startScanner();
    } else {
      stopScanner();
    }
  });

  onCleanup(() => stopScanner());

  function SearchPost(props: { id: string }) {
    const [post] = createResource(() => fetchPostById(props.id));
    const formatDate = (date: string) => new Date(date).toLocaleString("ja-JP");
    return (
      <Show when={post()}>
        {(p) => (
          <PostItem
            post={p()}
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
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={closeQr}
        >
          <div
            class="w-[360px] sm:w-[560px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div class="rounded-2xl p-[2px] bg-gradient-to-br from-blue-500 via-purple-500 to-fuchsia-500 shadow-2xl">
              <div class="rounded-2xl bg-gray-900">
                <div class="p-6 sm:p-8">
                  <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center gap-3">
                      <img src="/takos.svg" alt="Takos" class="w-6 h-6 opacity-90" />
                      <span class="text-xs uppercase tracking-widest text-gray-400">Takos Contact Card</span>
                    </div>
                    <span class="text-[10px] text-gray-500">Scan to follow</span>
                  </div>

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-6 items-center">
                    <div>
                      <div class="flex items-center gap-5">
                        <div class="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-blue-600 overflow-hidden flex items-center justify-center text-white font-bold text-2xl select-none">
                          {currentAccount()?.avatarInitial ?? currentAccount()?.userName?.charAt(0) ?? "U"}
                        </div>
                        <div>
                          <div class="text-2xl font-bold text-white leading-tight">
                            {currentAccount()?.displayName ?? currentAccount()?.userName}
                          </div>
                          <div class="text-base text-gray-400">@{currentAccount()?.userName}</div>
                          <div class="mt-2 flex items-center gap-2 text-xs">
                            <span class="px-2 py-1 rounded-full bg-blue-500/10 text-blue-300 border border-blue-500/20">
                              {getDomain()}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div class="mt-4">
                        <div class="flex items-center gap-2 bg-gray-800/70 rounded-lg px-3 py-2 border border-white/5">
                          <svg class="w-4 h-4 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 00-9.33-5"/><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M2 16a6 6 0 005 5"/></svg>
                          <span class="text-gray-200 text-sm break-all">{qrHandle()}</span>
                          <button
                            type="button"
                            class="ml-auto text-xs px-2 py-1 rounded bg-gray-700 hover:bg-gray-600 text-white"
                            onClick={copyHandle}
                          >
                            コピー
                          </button>
                        </div>
                        <Show when={qrMsg()}>
                          <p class="mt-1 text-xs text-emerald-400">{qrMsg()}</p>
                        </Show>
                        <Show when={qrError()}>
                          <p class="mt-1 text-xs text-red-400">{qrError()}</p>
                        </Show>
                      </div>
                    </div>

                    <div>
                      <div class="relative">
                        <div class="rounded-xl bg-white p-3 shadow-inner">
                          <img src={qrData()} alt="qr" class="w-full h-auto rounded" />
                        </div>
                        <div class="pointer-events-none absolute -inset-[2px] rounded-xl bg-gradient-to-br from-white/10 to-transparent"></div>
                      </div>
                    </div>
                  </div>

                  <div class="mt-6 flex items-center justify-end gap-3">
                    <button
                      type="button"
                      class="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm transition-all duration-200"
                      onClick={downloadQr}
                    >
                      PNG保存
                    </button>
                    <button
                      type="button"
                      class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-all duration-200"
                      onClick={closeQr}
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>
      <Show when={showScanner()}>
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowScanner(false)}
        >
          <div
            class="bg-gray-900 rounded-2xl p-5 sm:p-6 w-[360px] sm:w-[520px] space-y-4 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 class="text-lg font-bold text-white text-center">QRをカメラで読み取り</h3>

            <div class="relative rounded-xl overflow-hidden bg-black/40 border border-white/10">
              <video
                class="w-full h-[280px] object-cover opacity-90"
                autoplay
                playsinline
                muted
                ref={(el) => (videoRef = el)}
              />
              <canvas class="hidden" ref={(el) => (canvasRef = el)} />

              <div class="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div class="w-48 h-48 border-2 border-white/70 rounded-lg shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"></div>
              </div>
              <div class="absolute bottom-2 left-0 right-0 text-center text-xs text-gray-300">
                {cameraReady() ? "QRを中央に合わせてください" : "カメラを起動しています…"}
              </div>
            </div>

            <Show when={scanError()}>
              <p class="text-red-400 text-sm text-center">{scanError()}</p>
            </Show>
            <div class="text-center text-xs text-gray-400">
              カメラが使えない場合はファイルから読み取れます
            </div>
            <div class="flex items-center justify-between gap-2">
              <label class="text-sm text-gray-200 px-3 py-2 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-700">
                画像から読み取り
                <input type="file" accept="image/*" onChange={handleScanFile} class="hidden" />
              </label>
              <button
                type="button"
                class="ml-auto px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm transition-all duration-200"
                onClick={() => setShowScanner(false)}
              >
                閉じる
              </button>
            </div>
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
        </div>
      </div>

      <div class="max-w-4xl mx-auto">
        <div class="bg-[#181818]/50 rounded-xl p-6 mb-6">
          <div class="relative">
            <input
              type="text"
              placeholder={placeholder()}
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
              class="w-full bg-gray-700 rounded-lg px-4 py-3 pl-10 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div class="mt-3 flex items-center gap-2 text-sm text-gray-300">
              <label class="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useFaspSearch()}
                  onChange={(e) => {
                    setUseFaspSearch(e.currentTarget.checked);
                    try {
                      localStorage.setItem(
                        "useFaspSearch",
                        e.currentTarget.checked ? "1" : "0",
                      );
                    } catch {
                      /* ignore */
                    }
                  }}
                />
                FASPを使って検索
              </label>
            </div>
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
