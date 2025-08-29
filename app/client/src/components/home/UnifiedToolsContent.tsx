import {
  createEffect,
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { useAtom } from "solid-jotai";
import {
  accounts as accountsAtom,
  activeAccount,
  activeAccountId,
  fetchAccounts,
} from "../../states/account.ts";
import { followingListMap, setFollowingList } from "../../states/account.ts";
import { apiFetch, getDomain, getOrigin } from "../../utils/config.ts";
import { navigate } from "../../utils/router.ts";
import { fetchPostById } from "../microblog/api.ts";
import { followUser, unfollowUser } from "../microblog/api.ts";
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
  const [accounts, setAccounts] = useAtom(accountsAtom);
  const [followingMap] = useAtom(followingListMap);
  const [, saveFollowing] = useAtom(setFollowingList);
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
  const [qrSvg, setQrSvg] = createSignal<string>("");
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
        setAccounts(results);
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

        // グローバルのフォロー一覧キャッシュ
        const cached = followingMap()[id];
        let list: unknown[] | null = null;
        if (cached) {
          list = Array.isArray(cached) ? cached : [];
        } else {
          // 未キャッシュの場合のみ取得してグローバルへ保存
          const res = await apiFetch(`/api/users/${username}/following`);
          if (res.ok) {
            list = await res.json();
            saveFollowing({
              accountId: id,
              list: Array.isArray(list) ? list : [],
            });
          }
        }

        // followStatus（表示用の真偽値マップ）を更新
        if (list) {
          const map: Record<string, boolean> = {};
          for (const item of list) {
            let actor = "";
            if (typeof item === "string") actor = item;
            else if (item && typeof item === "object") {
              const it = item as Record<string, unknown>;
              actor = (typeof it.actor === "string" && it.actor) || (typeof it.id === "string" && it.id) || (typeof it.userName === "string" && it.userName) || "";
            }
            if (actor) map[actor] = true;
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

  // アクターURLを username@example.com 形式に変換
  const actorToHandle = (actor: string) => {
    try {
      const url = new URL(actor);
      const segs = url.pathname.split("/").filter(Boolean);
      const name = segs[segs.length - 1];
      return `${name}@${url.hostname}`;
    } catch {
      return actor;
    }
  };

  // フォロー関連の処理
  const handleFollow = async (actor: string, userId?: string) => {
    try {
      const account = currentAccount();
      if (!account) {
        console.error("No current account selected");
        return;
      }

      // actorをhandle形式に変換
      const handle = actorToHandle(actor);
      const success = await followUser(handle, account.userName);

      if (success) {
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

        // グローバルステートも更新
        const target = actor;
        setAccounts(
          accounts().map((a) =>
            a.id === selectedAccountId()
              ? { ...a, following: [...a.following, target] }
              : a
          ),
        );
      } else {
        console.error("Failed to follow user");
      }
    } catch (error) {
      console.error("Error following user:", error);
    }
  };

  const handleUnfollow = async (actor: string, userId?: string) => {
    try {
      const account = currentAccount();
      if (!account) {
        console.error("No current account selected");
        return;
      }

      // actorをhandle形式に変換
      const handle = actorToHandle(actor);
      const success = await unfollowUser(handle, account.userName);

      if (success) {
        if (userId) {
          setUsers((prev) =>
            prev.map((user) =>
              user.id === userId
                ? {
                    ...user,
                    isFollowing: false,
                    followerCount: Math.max(0, user.followerCount - 1),
                  }
                : user
            )
          );
        }
        setFollowStatus((prev) => ({ ...prev, [actor]: false }));

        // グローバルステートも更新
        const target = actor;
        setAccounts(
          accounts().map((a) =>
            a.id === selectedAccountId()
              ? { ...a, following: a.following.filter((f) => f !== target) }
              : a
          ),
        );
      } else {
        console.error("Failed to unfollow user");
      }
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
      const svg = await QRCode.toString(handle, { type: "svg" });
      setQrSvg(svg);
      setQrHandle(handle);
      setQrError("");
    } catch (_) {
      setQrError("QRコードの生成に失敗しました");
    }
  };

  const closeQr = () => {
    setQrHandle(null);
    setQrSvg("");
    setQrMsg("");
  };

  // モーダル表示中は body スクロールを抑止して外部レイアウトとの干渉を防ぐ
  createEffect(() => {
    if (qrHandle()) {
      const prev = document.body.style.overflow;
      document.body.dataset._prevOverflow = prev;
      document.body.style.overflow = "hidden";
    } else {
      if (document.body.dataset._prevOverflow !== undefined) {
        document.body.style.overflow = document.body.dataset._prevOverflow;
        delete document.body.dataset._prevOverflow;
      } else {
        document.body.style.overflow = "";
      }
    }
  });

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

        const drawLine = (
          begin: { x: number; y: number },
          end: { x: number; y: number },
          color = "#00E5FF",
        ) => {
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
            const code = jsQR(
              imageData.data,
              imageData.width,
              imageData.height,
            );
            if (code) {
              // ガイド描画
              if (code.location) {
                drawLine(
                  code.location.topLeftCorner,
                  code.location.topRightCorner,
                );
                drawLine(
                  code.location.topRightCorner,
                  code.location.bottomRightCorner,
                );
                drawLine(
                  code.location.bottomRightCorner,
                  code.location.bottomLeftCorner,
                );
                drawLine(
                  code.location.bottomLeftCorner,
                  code.location.topLeftCorner,
                );
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
    <div
      class={`h-full space-y-6 animate-in slide-in-from-bottom-4 duration-500 ${
        qrHandle() ? "pointer-events-none select-none" : ""
      }`}
    >
      <Portal>
        <Show when={qrHandle()}>
          {/* Portal化したQRモーダル: 外部space-yの影響を受けない */}
          <div class="fixed inset-0 z-50 bg-gradient-to-br from-gray-800 via-gray-700 to-gray-900 overflow-y-auto flex items-center justify-center p-6">
            <button
              type="button"
              class="absolute top-6 right-6 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-all duration-200 flex items-center space-x-2"
              onClick={closeQr}
            >
              <svg
                class="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span>閉じる</span>
            </button>

            <div class="w-full">
              <div class="max-w-4xl w-full bg-gray-800 rounded-lg p-8 border border-gray-600 shadow-2xl m-auto">
                <div class="grid grid-cols-1 lg:grid-cols-2 gap-8 items-center">
                  {/* 左側：ユーザー情報 */}
                  <div class="space-y-6 text-center lg:text-left">
                    <div>
                      <div class="flex justify-center lg:justify-start mb-4">
                        <div class="w-24 h-24 bg-gradient-to-br from-gray-400 to-gray-600 rounded-full flex items-center justify-center text-white font-bold text-2xl overflow-hidden">
                          {currentAccount()?.avatarInitial ||
                            currentAccount()?.userName?.charAt(0)
                              .toUpperCase() ||
                            "U"}
                        </div>
                      </div>
                      <h2 class="text-3xl font-bold text-white mb-2">
                        {currentAccount()?.displayName ||
                          currentAccount()?.userName}
                      </h2>
                      <div class="bg-gray-700 rounded-lg p-4 mb-4">
                        <div class="flex items-center justify-center lg:justify-start space-x-2 text-gray-300 mb-2">
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
                              d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                            />
                          </svg>
                          <span class="text-sm font-semibold">
                            ユーザーハンドル
                          </span>
                        </div>
                        <p class="font-mono text-lg text-white break-all">
                          {qrHandle()}
                        </p>
                      </div>
                      <button
                        type="button"
                        class="w-full lg:w-auto px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white font-bold rounded-lg text-lg transition-all duration-200 flex items-center justify-center space-x-2 mx-auto lg:mx-0"
                        onClick={copyHandle}
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
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        <span>コピー</span>
                      </button>
                      <Show when={qrMsg()}>
                        <div class="mt-2 p-2 bg-green-600/20 border border-green-500 rounded-lg">
                          <p class="text-green-300 text-sm flex items-center justify-center space-x-2">
                            <svg
                              class="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            <span>{qrMsg()}</span>
                          </p>
                        </div>
                      </Show>
                      <Show when={qrError()}>
                        <div class="mt-2 p-2 bg-red-600/20 border border-red-500 rounded-lg">
                          <p class="text-red-300 text-sm flex items-center justify-center space-x-2">
                            <svg
                              class="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M6 18L18 6M6 6l12 12"
                              />
                            </svg>
                            <span>{qrError()}</span>
                          </p>
                        </div>
                      </Show>
                    </div>
                  </div>

                  {/* 右側：QRコード */}
                  <div class="flex flex-col items-center space-y-4 justify-center">
                    <div class="bg-white p-6 rounded-lg shadow-lg">
                      <div innerHTML={qrSvg()} class="w-48 h-48" />
                    </div>
                    <div class="text-center">
                      <div class="flex items-center justify-center space-x-2 text-gray-300 mb-2">
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
                            d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                          />
                        </svg>
                        <span class="text-sm font-semibold">QRコード</span>
                      </div>
                      <p class="text-gray-400 text-sm">
                        他のユーザーがスキャンして<br />
                        あなたをフォローできます
                      </p>
                    </div>
                  </div>
                </div>

                {/* フッター情報 */}
                <div class="mt-8 pt-6 border-t border-gray-600">
                  <div class="flex items-center justify-between text-xs text-gray-400">
                    <div class="flex items-center space-x-2">
                      <span>TAKOS Network</span>
                    </div>
                    <div class="flex items-center space-x-4">
                      <span>
                        ID:{" "}
                        {currentAccount()?.id?.substring(0, 8) || "--------"}
                      </span>
                      <span>•</span>
                      <span>{new Date().toLocaleDateString("ja-JP")}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Show>
      </Portal>
      <Show when={showScanner()}>
        <div class="fixed inset-0 z-50 bg-black flex flex-col">
          <button
            type="button"
            class="absolute top-6 right-6 z-10 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-all duration-200 flex items-center space-x-2"
            onClick={() => setShowScanner(false)}
          >
            <svg
              class="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span>閉じる</span>
          </button>

          {/* カメラビュー */}
          <div class="flex-1 relative">
            <video
              class="w-full h-full object-cover"
              autoplay
              playsinline
              muted
              ref={(el) => (videoRef = el)}
            />
            <canvas class="hidden" ref={(el) => (canvasRef = el)} />

            {/* スキャンエリアのオーバーレイ */}
            <div class="absolute inset-0 flex items-center justify-center">
              <div class="relative">
                <div class="w-64 h-64 border-2 border-white/70 rounded-2xl shadow-[0_0_0_9999px_rgba(0,0,0,0.5)]">
                </div>
                {/* コーナーのアニメーション */}
                <div class="absolute top-0 left-0 w-8 h-8 border-l-4 border-t-4 border-blue-400 rounded-tl-2xl animate-pulse">
                </div>
                <div class="absolute top-0 right-0 w-8 h-8 border-r-4 border-t-4 border-blue-400 rounded-tr-2xl animate-pulse">
                </div>
                <div class="absolute bottom-0 left-0 w-8 h-8 border-l-4 border-b-4 border-blue-400 rounded-bl-2xl animate-pulse">
                </div>
                <div class="absolute bottom-0 right-0 w-8 h-8 border-r-4 border-b-4 border-blue-400 rounded-br-2xl animate-pulse">
                </div>
              </div>
            </div>

            {/* ステータス表示 */}
            <div class="absolute bottom-20 left-0 right-0 text-center">
              <div class="bg-black/70 backdrop-blur-sm rounded-full px-6 py-3 mx-auto inline-block">
                <div class="flex items-center justify-center space-x-2 text-white">
                  <Show
                    when={cameraReady()}
                    fallback={
                      <>
                        <svg
                          class="w-5 h-5 animate-spin"
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
                        <span>カメラを起動しています...</span>
                      </>
                    }
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
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                    <span>QRコードを中央に合わせてください</span>
                  </Show>
                </div>
              </div>
            </div>
          </div>

          {/* エラー表示 */}
          <Show when={scanError()}>
            <div class="bg-red-600/20 border-t border-red-600/30 p-4">
              <div class="flex items-center justify-center space-x-2 text-red-300">
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
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L5.082 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
                <span>{scanError()}</span>
              </div>
            </div>
          </Show>

          {/* ボトムツールバー */}
          <div class="bg-gray-900 p-4 border-t border-gray-700">
            <div class="flex items-center justify-center">
              <label class="flex items-center space-x-3 px-6 py-3 bg-gray-700 hover:bg-gray-600 rounded-lg cursor-pointer transition-all duration-200">
                <svg
                  class="w-5 h-5 text-gray-300"
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
                <span class="text-gray-300 font-medium">画像から読み取り</span>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleScanFile}
                  class="hidden"
                />
              </label>
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
        <div class="bg-[#131818]/50 rounded-xl p-6 mb-6">
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
          <div class="mt-4 flex justify-end space-x-3">
            <button
              type="button"
              onClick={openMyQr}
              class="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-purple-600 to-purple-700 hover:from-purple-700 hover:to-purple-800 text-white rounded-lg font-medium transition-all duration-200 shadow-lg"
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
                  d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                />
              </svg>
              <span>自分のQR</span>
            </button>
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              class="flex items-center space-x-2 px-4 py-2 bg-gradient-to-r from-green-600 to-green-700 hover:from-green-700 hover:to-green-800 text-white rounded-lg font-medium transition-all duration-200 shadow-lg"
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
                  d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              <span>QR読み取り</span>
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
                    const handle = actorToHandle(result.actor!);

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
                                  <a
                                    href={`/user/${encodeURIComponent(handle)}`}
                                    class="hover:underline"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      navigate(
                                        `/user/${encodeURIComponent(handle)}`,
                                      );
                                    }}
                                  >
                                    {result.title}
                                  </a>
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
                                    localUser.isFollowing)) ||
                                followStatus()[result.actor!]
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
