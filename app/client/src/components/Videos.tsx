import {
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useAtom } from "solid-jotai";
import { createVideo, fetchVideos, likeVideo } from "./videos/api.ts";
import { Video } from "./videos/types.ts";
import { activeAccount } from "../states/account.ts";

export function Videos() {
  const [currentView, setCurrentView] = createSignal<"timeline" | "shorts">(
    "timeline",
  );
  const [selectedShortIndex, setSelectedShortIndex] = createSignal(0);
  const [showUploadModal, setShowUploadModal] = createSignal(false);
  const [openedVideo, setOpenedVideo] = createSignal<Video | null>(null);
  const [account] = useAtom(activeAccount);
  const [uploadForm, setUploadForm] = createSignal({
    title: "",
    description: "",
    hashtags: "",
    isShort: false,
    duration: "",
    file: null as File | null,
    thumbnail: null as File | null,
  });

  const [videos, { mutate: setVideos }] = createResource(fetchVideos);

  const shortVideos = (): Video[] => (videos() || []).filter((v) => v.isShort);
  const longVideos = (): Video[] => (videos() || []).filter((v) => !v.isShort);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatTime = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return "今";
    if (hours < 24) return `${hours}時間前`;
    const days = Math.floor(hours / 24);
    return `${days}日前`;
  };

  const handleLike = async (video: Video) => {
    const newLikes = await likeVideo(video.id);
    if (newLikes !== null) {
      setVideos((prev) =>
        prev?.map((v) => v.id === video.id ? { ...v, likes: newLikes } : v)
      );
    }
  };

  const playVideo = (video: Video) => {
    setOpenedVideo(video);
  };

  const playShort = (_video: Video, index: number) => {
    setSelectedShortIndex(index);
    setCurrentView("shorts");
  };

  const handleFileUpload = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) {
      setUploadForm((prev) => ({ ...prev, file }));

      // 動画のアスペクト比を自動判定（実際の実装では動画ファイルの解析が必要）
      // ここではファイル名で判定する簡易実装
      const isVertical = file.name.includes("short") ||
        file.name.includes("vertical");
      setUploadForm((prev) => ({ ...prev, isShort: isVertical }));

      const video = document.createElement("video");
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const seconds = video.duration;
        if (!Number.isNaN(seconds)) {
          const m = Math.floor(seconds / 60);
          const s = Math.floor(seconds % 60);
          const str = `${m}:${s.toString().padStart(2, "0")}`;
          setUploadForm((prev) => ({ ...prev, duration: str }));
        }
        URL.revokeObjectURL(video.src);
      };
      video.src = URL.createObjectURL(file);
    }
  };

  const handleThumbnailUpload = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0] || null;
    setUploadForm((prev) => ({ ...prev, thumbnail: file }));
  };

  const submitUpload = async () => {
    const form = uploadForm();
    if (!form.title.trim() || !form.file) return;

    const user = account();
    if (!user) {
      alert("アカウントが選択されていません");
      return;
    }

    const newVideo = await createVideo({
      author: user.userName,
      title: form.title,
      description: form.description,
      hashtags: form.hashtags.split(" ").filter((tag) => tag.startsWith("#")),
      isShort: form.isShort,
      duration: form.duration,
      file: form.file,
      thumbnail: form.thumbnail ?? undefined,
    });
    if (!newVideo) return;

    setVideos((prev) => prev ? [newVideo, ...prev] : [newVideo]);

    // フォームをリセット
    setUploadForm({
      title: "",
      description: "",
      hashtags: "",
      isShort: false,
      duration: "",
      file: null,
      thumbnail: null,
    });
    setShowUploadModal(false);

    // 新しい動画の種類に応じてビューを切り替え
    if (newVideo.isShort) {
      // 新しいショート動画をインデックス0に設定
      setSelectedShortIndex(0);
      setCurrentView("shorts");
    } else {
      setCurrentView("timeline");
    }
  };

  // ショート動画のスクロール処理
  const handleShortsScroll = (direction: "up" | "down") => {
    const currentIndex = selectedShortIndex();
    const shortsList = shortVideos();

    if (direction === "down" && currentIndex < shortsList.length - 1) {
      setSelectedShortIndex(currentIndex + 1);
    } else if (direction === "up" && currentIndex > 0) {
      setSelectedShortIndex(currentIndex - 1);
    }
  };

  // キーボードナビゲーション
  const handleKeyDown = (e: KeyboardEvent) => {
    if (currentView() === "shorts") {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          handleShortsScroll("up");
          break;
        case "ArrowDown":
          e.preventDefault();
          handleShortsScroll("down");
          break;
        case "Escape":
          setCurrentView("timeline");
          break;
      }
    }
  };

  // イベントリスナーの追加・削除
  onMount(() => {
    document.addEventListener("keydown", handleKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div style="background-color: #181818;" class="min-h-screen">
      {/* 投稿モーダル */}
      <Show when={showUploadModal()}>
        <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
          <div
            style="background-color: #1e1e1e;"
            class="rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-600"
          >
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-semibold text-white">
                動画をアップロード
              </h3>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                class="text-gray-400 hover:text-white transition-colors"
              >
                ✕
              </button>
            </div>

            <div class="space-y-4">
              {/* ファイル選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">
                  動画ファイル <span class="text-red-400">*</span>
                </label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileUpload}
                  style="background-color: #2a2a2a;"
                  class="w-full px-3 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-300"
                />
              </div>

              {/* サムネイル選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">
                  サムネイル画像
                </label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailUpload}
                  style="background-color: #2a2a2a;"
                  class="w-full px-3 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-300"
                />
              </div>

              {/* 動画タイプ選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">
                  動画タイプ
                </label>
                <div class="flex space-x-4">
                  <label class="flex items-center">
                    <input
                      type="radio"
                      name="videoType"
                      checked={!uploadForm().isShort}
                      onChange={() =>
                        setUploadForm((prev) => ({ ...prev, isShort: false }))}
                      class="mr-2"
                    />
                    <span class="text-gray-400">通常動画</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      type="radio"
                      name="videoType"
                      checked={uploadForm().isShort}
                      onChange={() =>
                        setUploadForm((prev) => ({ ...prev, isShort: true }))}
                      class="mr-2"
                    />
                    <span class="text-gray-400">ショート動画</span>
                  </label>
                </div>
              </div>

              {/* タイトル */}
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">
                  タイトル <span class="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={uploadForm().title}
                  onInput={(e) =>
                    setUploadForm((prev) => ({
                      ...prev,
                      title: e.target.value,
                    }))}
                  placeholder="動画のタイトルを入力してください"
                  style="background-color: #2a2a2a;"
                  class="w-full px-3 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-300 placeholder-gray-500"
                />
              </div>

              {/* 説明 */}
              <div>
                <label class="block text-sm font-medium text-gray-400 mb-2">
                  説明
                </label>
                <textarea
                  value={uploadForm().description}
                  onInput={(e) =>
                    setUploadForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))}
                  placeholder="動画の説明を入力してください"
                  rows="3"
                  style="background-color: #2a2a2a;"
                  class="w-full px-3 py-2 border border-gray-600 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-gray-300 placeholder-gray-500 resize-none"
                />
              </div>

              {/* アクションボタン */}
              <div class="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  style="background-color: #2a2a2a;"
                  class="flex-1 px-4 py-2 border border-gray-600 text-gray-400 rounded-md hover:bg-gray-600 transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={submitUpload}
                  disabled={!uploadForm().title.trim() || !uploadForm().file}
                  class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-md transition-colors"
                >
                  アップロード
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* メインコンテンツ */}
      <Show when={currentView() === "timeline" && !openedVideo()}>
        <div class="min-h-screen">
          {/* ヘッダー */}
          <div class="bg-[#1e1e1e] border-b border-gray-600">
            {/* Main Bar */}
            <div class="max-w-7xl mx-auto px-4 sm:px-6">
              <div class="flex items-center justify-between h-16">
                {/* Logo */}
                <div class="flex-shrink-0">
                  <h1 class="text-2xl font-bold text-white">
                    動画投稿
                  </h1>
                </div>

                {/* Desktop: Upload */}
                <div class="hidden md:flex items-center">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(true)}
                    class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg font-medium transition-colors flex items-center space-x-2"
                  >
                    <svg
                      class="h-5 w-5"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="1.5"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                    <span>アップロード</span>
                  </button>
                </div>

                {/* Mobile: Upload Icon */}
                <div class="md:hidden flex items-center">
                  <button
                    type="button"
                    onClick={() => setShowUploadModal(true)}
                    class="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-full font-medium transition-colors"
                  >
                    <svg
                      class="h-6 w-6"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke-width="1.5"
                      stroke="currentColor"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        d="M12 4.5v15m7.5-7.5h-15"
                      />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* View switcher / Tabs */}
            <div class="max-w-7xl mx-auto px-4 sm:px-6">
              <div class="border-b border-gray-700">
                <nav class="-mb-px flex space-x-6" aria-label="Tabs">
                  <button
                    type="button"
                    onClick={() => setCurrentView("timeline")}
                    class={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                      currentView() === "timeline"
                        ? "border-blue-400 text-blue-400"
                        : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500"
                    }`}
                  >
                    ホーム
                  </button>
                  <button
                    type="button"
                    onClick={() => setCurrentView("shorts")}
                    class={`whitespace-nowrap py-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                      currentView() === "shorts"
                        ? "border-blue-400 text-blue-400"
                        : "border-transparent text-gray-400 hover:text-gray-200 hover:border-gray-500"
                    }`}
                  >
                    ショート
                  </button>
                </nav>
              </div>
            </div>
          </div>

          <div class="max-w-7xl mx-auto px-6 py-8">
            {/* ショート動画セクション */}
            <Show when={shortVideos().length > 0}>
              <div class="mb-8">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-lg font-medium text-gray-300">
                    📱 ショート動画
                  </h2>
                  <button
                    type="button"
                    onClick={() => setCurrentView("shorts")}
                    class="text-blue-400 hover:text-blue-300 text-sm font-medium"
                  >
                    すべて表示 →
                  </button>
                </div>
                <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                  <For each={shortVideos().slice(0, 8)}>
                    {(video, index) => (
                      <div
                        class="cursor-pointer group"
                        onClick={() => playShort(video, index())}
                      >
                        <div
                          style="background-color: #2a2a2a;"
                          class="relative aspect-[9/16] rounded-lg overflow-hidden mb-2 group-hover:scale-105 transition-transform duration-200"
                        >
                          <img
                            class="w-full h-full object-cover"
                            src={video.thumbnail}
                            alt={video.title}
                          />
                          <div class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded">
                            {video.duration}
                          </div>
                          <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                            <div class="w-12 h-12 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                              <span class="text-white text-xl">▶</span>
                            </div>
                          </div>
                        </div>
                        <h3 class="text-sm font-medium text-gray-300 line-clamp-2 mb-1 group-hover:text-blue-400">
                          {video.title}
                        </h3>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* 通常動画セクション */}
            <div>
              <h2 class="text-lg font-medium text-gray-300 mb-4">
                📹 通常動画
              </h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <For each={longVideos()}>
                  {(video) => (
                    <div
                      class="group cursor-pointer"
                      onClick={() => playVideo(video)}
                    >
                      <div
                        style="background-color: #2a2a2a;"
                        class="relative aspect-video rounded-lg overflow-hidden mb-3 group-hover:scale-105 transition-transform duration-200"
                      >
                        <img
                          class="w-full h-full object-cover"
                          src={video.thumbnail}
                          alt={video.title}
                        />
                        <div class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded">
                          {video.duration}
                        </div>
                        <div class="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                          <div class="w-16 h-16 bg-black/60 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span class="text-white text-2xl">▶</span>
                          </div>
                        </div>
                      </div>
                      <div class="flex space-x-3">
                        <div class="flex-shrink-0 w-10 h-10 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full flex items-center justify-center">
                          <span class="text-white text-sm">
                            {video.authorAvatar}
                          </span>
                        </div>
                        <div class="flex-1 min-w-0">
                          <h3 class="font-medium text-gray-300 mb-1 line-clamp-2 group-hover:text-blue-400">
                            {video.title}
                          </h3>
                          <p class="text-sm text-gray-400 mb-1">
                            {video.author}
                          </p>
                          <div class="text-sm text-gray-500 flex items-center">
                            <span>{formatTime(video.timestamp)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* ショート動画ビューア */}
      <Show when={currentView() === "shorts"}>
        <div class="bg-black min-h-screen flex items-center justify-center">
          <Show
            when={shortVideos().length > 0}
            fallback={
              <div class="text-center space-y-4">
                <p class="text-white text-lg">ショート動画がありません</p>
                <button
                  type="button"
                  onClick={() => setCurrentView("timeline")}
                  class="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg"
                >
                  タイムラインに戻る
                </button>
              </div>
            }
          >
            <div class="relative w-full max-w-md h-screen flex items-center justify-center">
              {(() => {
                const currentShort = shortVideos()[selectedShortIndex()];
                return currentShort
                  ? (
                    <div class="relative w-full aspect-[9/16] max-h-screen bg-black rounded-lg overflow-hidden">
                      <video
                        class="w-full h-full object-cover"
                        src={currentShort.videoUrl}
                        autoplay
                        loop
                        muted
                        playsinline
                      />

                      {/* 動画情報オーバーレイ */}
                      <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent p-6">
                        <div class="flex items-center space-x-3 mb-3">
                          <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                            <span class="text-white text-sm">
                              {currentShort.authorAvatar}
                            </span>
                          </div>
                          <div class="flex-1">
                            <p class="text-white font-semibold">
                              {currentShort.author}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleLike(currentShort)}
                            class="flex items-center space-x-1 bg-white/20 text-white px-3 py-1.5 rounded-full text-sm hover:bg-white/30 transition-colors"
                          >
                            <span>👍</span>
                            <span>{formatNumber(currentShort.likes)}</span>
                          </button>
                        </div>
                        <h3 class="text-white font-medium mb-2 line-clamp-2">
                          {currentShort.title}
                        </h3>
                        <div class="flex items-center text-white/70 text-sm">
                          <span>{formatTime(currentShort.timestamp)}</span>
                        </div>
                      </div>

                      {/* ナビゲーションボタン */}
                      <div class="absolute right-4 top-1/2 transform -translate-y-1/2 flex flex-col space-y-4">
                        <button
                          type="button"
                          onClick={() => handleShortsScroll("up")}
                          disabled={selectedShortIndex() === 0}
                          class="w-12 h-12 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ↑
                        </button>
                        <div class="text-center">
                          <div class="text-white text-sm bg-black/60 rounded-full px-3 py-1 backdrop-blur-sm">
                            {selectedShortIndex() + 1}/{shortVideos().length}
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleShortsScroll("down")}
                          disabled={selectedShortIndex() ===
                            shortVideos().length - 1}
                          class="w-12 h-12 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          ↓
                        </button>
                      </div>

                      {/* 戻るボタン */}
                      <div class="absolute top-6 left-6">
                        <button
                          type="button"
                          onClick={() => setCurrentView("timeline")}
                          class="w-12 h-12 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                        >
                          ←
                        </button>
                      </div>
                    </div>
                  )
                  : null;
              })()}
            </div>
          </Show>
        </div>
      </Show>

      {/* 動画詳細ビュー */}
      <Show when={openedVideo()}>
        <div style="background-color: #181818;" class="min-h-screen">
          <div class="max-w-7xl mx-auto px-6 py-6">
            <div class="flex flex-col lg:flex-row space-y-6 lg:space-y-0 lg:space-x-8">
              {/* メイン動画エリア */}
              <div class="flex-1">
                <button
                  type="button"
                  onClick={() => setOpenedVideo(null)}
                  class="flex items-center space-x-2 text-blue-400 hover:text-blue-300 mb-4 font-medium"
                >
                  <span>←</span>
                  <span>戻る</span>
                </button>
                <div class="bg-black rounded-lg overflow-hidden">
                  <video
                    src={openedVideo()!.videoUrl}
                    controls
                    autoplay
                    preload="metadata"
                    class="w-full aspect-video"
                  />
                </div>
                <div class="mt-6">
                  <h1 class="text-xl font-medium text-gray-300 mb-4">
                    {openedVideo()!.title}
                  </h1>
                  <div class="flex items-center justify-between mb-4">
                    <div class="flex items-center space-x-4">
                      <div class="w-12 h-12 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                        <span class="text-white font-semibold">
                          {openedVideo()!.authorAvatar}
                        </span>
                      </div>
                      <div>
                        <p class="font-medium text-gray-300">
                          {openedVideo()!.author}
                        </p>
                        <p class="text-sm text-gray-400">
                          {formatTime(openedVideo()!.timestamp)}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleLike(openedVideo()!)}
                      style="background-color: #2a2a2a;"
                      class="flex items-center space-x-2 hover:bg-gray-600 text-gray-300 px-4 py-2 rounded-lg transition-colors"
                    >
                      <span>👍</span>
                      <span>{formatNumber(openedVideo()!.likes)}</span>
                    </button>
                  </div>
                  <div
                    style="background-color: #1e1e1e;"
                    class="rounded-lg p-4"
                  >
                    <p class="text-gray-400 whitespace-pre-wrap">
                      {openedVideo()!.description || "説明はありません"}
                    </p>
                  </div>
                </div>
              </div>

              {/* サイドバー - 関連動画 */}
              <div class="w-full lg:w-96 space-y-4">
                <h3 class="text-lg font-medium text-gray-300">関連動画</h3>
                <For
                  each={longVideos().filter((v) => v.id !== openedVideo()!.id)
                    .slice(0, 10)}
                >
                  {(video) => (
                    <div
                      style="background-color: #1e1e1e;"
                      class="flex space-x-3 cursor-pointer p-2 rounded-lg hover:bg-gray-700 transition-colors"
                      onClick={() => playVideo(video)}
                    >
                      <div
                        style="background-color: #2a2a2a;"
                        class="relative w-32 aspect-video rounded overflow-hidden flex-shrink-0"
                      >
                        <img
                          class="w-full h-full object-cover"
                          src={video.thumbnail}
                          alt={video.title}
                        />
                        <div class="absolute bottom-1 right-1 bg-black/80 text-white text-xs px-1.5 py-0.5 rounded">
                          {video.duration}
                        </div>
                      </div>
                      <div class="flex-1 min-w-0">
                        <h4 class="font-medium text-gray-300 text-sm line-clamp-2 mb-1">
                          {video.title}
                        </h4>
                        <p class="text-xs text-gray-400 mb-1">{video.author}</p>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
