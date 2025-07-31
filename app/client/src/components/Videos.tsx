import {
  createResource,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { createVideo, fetchVideos } from "./videos/api.ts";
import { Video } from "./videos/types.ts";
export function Videos() {
  const [currentView, setCurrentView] = createSignal<"timeline" | "shorts">(
    "timeline",
  );
  const [selectedShortIndex, setSelectedShortIndex] = createSignal(0);
  const [showUploadModal, setShowUploadModal] = createSignal(false);
  const [openedVideo, setOpenedVideo] = createSignal<Video | null>(null);
  const [uploadForm, setUploadForm] = createSignal({
    title: "",
    description: "",
    hashtags: "",
    isShort: false,
    file: null as File | null,
    thumbnail: null as File | null,
  });

  const [videos, { mutate: setVideos }] = createResource(fetchVideos);

  const shortVideos = (): Video[] => (videos() || []).filter((v) => v.isShort);
  const _longVideos = (): Video[] => (videos() || []).filter((v) => !v.isShort);

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

    const newVideo = await createVideo({
      author: "あなた",
      title: form.title,
      description: form.description,
      hashtags: form.hashtags.split(" ").filter((tag) => tag.startsWith("#")),
      isShort: form.isShort,
      duration: form.isShort ? "0:30" : "5:00",
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
    <div class="bg-[#0f0f0f] flex h-screen">
      {/* 投稿モーダル */}
      <Show when={showUploadModal()}>
        <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 backdrop-blur-sm">
          <div class="bg-[#212121] rounded-xl p-6 w-full max-w-lg mx-4 shadow-2xl border border-gray-700">
            <div class="flex items-center justify-between mb-6">
              <h3 class="text-xl font-semibold text-white">
                動画をアップロード
              </h3>
              <button
                type="button"
                onClick={() => setShowUploadModal(false)}
                class="text-gray-400 hover:text-white p-2 rounded-full hover:bg-gray-700 transition-colors"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <div class="space-y-5">
              {/* ファイル選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-3">
                  動画ファイル
                </label>
                <div class="relative">
                  <input
                    type="file"
                    accept="video/*"
                    onChange={handleFileUpload}
                    class="w-full px-4 py-3 bg-[#181818] border border-gray-600 rounded-lg text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-red-600 file:text-white file:font-medium file:cursor-pointer hover:file:bg-red-700 hover:border-gray-500 transition-colors"
                  />
                </div>
              </div>

              {/* サムネイル選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-3">
                  サムネイル画像
                </label>
                <div class="relative">
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleThumbnailUpload}
                    class="w-full px-4 py-3 bg-[#181818] border border-gray-600 rounded-lg text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-red-600 file:text-white file:font-medium file:cursor-pointer hover:file:bg-red-700 hover:border-gray-500 transition-colors"
                  />
                </div>
              </div>

              {/* 動画タイプ選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-3">
                  動画タイプ
                </label>
                <div class="flex space-x-6">
                  <label class="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="videoType"
                      checked={!uploadForm().isShort}
                      onChange={() =>
                        setUploadForm((prev) => ({ ...prev, isShort: false }))}
                      class="mr-3 w-4 h-4 text-red-600 bg-gray-700 border-gray-600 focus:ring-red-500"
                    />
                    <span class="text-white font-medium">長尺動画</span>
                  </label>
                  <label class="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="videoType"
                      checked={uploadForm().isShort}
                      onChange={() =>
                        setUploadForm((prev) => ({ ...prev, isShort: true }))}
                      class="mr-3 w-4 h-4 text-red-600 bg-gray-700 border-gray-600 focus:ring-red-500"
                    />
                    <span class="text-white font-medium">YouTube Shorts</span>
                  </label>
                </div>
              </div>

              {/* タイトル */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-3">
                  タイトル <span class="text-red-500">*</span>
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
                  class="w-full px-4 py-3 bg-[#181818] border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-red-500 hover:border-gray-500 transition-colors"
                />
              </div>

              {/* 説明 */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-3">
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
                  rows="4"
                  class="w-full px-4 py-3 bg-[#181818] border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-red-500 hover:border-gray-500 transition-colors resize-none"
                />
              </div>

              {/* ハッシュタグ */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-3">
                  ハッシュタグ
                </label>
                <input
                  type="text"
                  value={uploadForm().hashtags}
                  onInput={(e) =>
                    setUploadForm((prev) => ({
                      ...prev,
                      hashtags: e.target.value,
                    }))}
                  placeholder="#タグ1 #タグ2 #タグ3"
                  class="w-full px-4 py-3 bg-[#181818] border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-red-500 focus:border-red-500 hover:border-gray-500 transition-colors"
                />
              </div>

              {/* アクションボタン */}
              <div class="flex space-x-4 pt-6">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  class="flex-1 px-6 py-3 bg-transparent border border-gray-600 hover:border-gray-500 text-white rounded-lg transition-colors font-medium"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={submitUpload}
                  disabled={!uploadForm().title.trim()}
                  class="flex-1 px-6 py-3 bg-red-600 hover:bg-red-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors font-medium shadow-lg"
                >
                  アップロード
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* YouTube風タイムライン表示 */}
      <Show when={currentView() === "timeline" && !openedVideo()}>
        <div class="flex-1 overflow-y-auto bg-[#0f0f0f]">
          {/* ヘッダー */}
          <div class="sticky top-0 z-10 bg-[#0f0f0f]/95 backdrop-blur-sm border-b border-gray-800/50 px-6 py-4">
            <div class="flex items-center justify-between max-w-screen-2xl mx-auto">
              <div class="flex items-center space-x-4">
                <div class="flex items-center space-x-3">
                  <div class="w-8 h-8 bg-red-600 rounded flex items-center justify-center">
                    <svg
                      class="w-5 h-5 text-white"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                    </svg>
                  </div>
                  <h1 class="text-xl font-normal text-white">動画</h1>
                </div>
                <div class="hidden md:flex bg-[#181818] rounded-full px-4 py-2 border border-gray-700">
                  <input
                    type="text"
                    placeholder="検索"
                    class="bg-transparent text-white placeholder-gray-400 outline-none w-96"
                  />
                  <button
                    type="button"
                    class="ml-3 text-gray-400 hover:text-white"
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
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(true)}
                  class="flex items-center space-x-2 px-4 py-2 bg-transparent border border-gray-600 hover:border-gray-500 text-white rounded-full transition-colors"
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
                      d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                    />
                  </svg>
                  <span class="hidden sm:inline">作成</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentView("shorts")}
                  class="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-full transition-colors"
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
                      d="M7 4V2a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v2h4a1 1 0 0 1 0 2h-1v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6H3a1 1 0 0 1 0-2h4z"
                    />
                  </svg>
                  <span class="hidden sm:inline">Shorts</span>
                </button>
              </div>
            </div>
          </div>

          <div class="max-w-screen-2xl mx-auto px-6 py-6">
            {/* カテゴリタブ */}
            <div class="flex space-x-3 mb-6 overflow-x-auto pb-2">
              {[
                "すべて",
                "音楽",
                "ゲーム",
                "ニュース",
                "スポーツ",
                "学習",
                "料理",
                "旅行",
                "技術",
                "映画",
              ].map((category) => (
                <button
                  type="button"
                  class={`flex-shrink-0 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${
                    category === "すべて"
                      ? "bg-white text-black"
                      : "bg-[#1f1f1f] text-white hover:bg-[#2f2f2f]"
                  }`}
                >
                  {category}
                </button>
              ))}
            </div>

            {/* ショート動画セクション */}
            <Show when={shortVideos().length > 0}>
              <div class="mb-8">
                <div class="flex items-center justify-between mb-4">
                  <div class="flex items-center space-x-2">
                    <div class="w-6 h-6 bg-red-600 rounded flex items-center justify-center">
                      <svg
                        class="w-4 h-4 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                    <h2 class="text-xl font-medium text-white">Shorts</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setCurrentView("shorts")}
                    class="text-[#3ea6ff] hover:text-blue-300 text-sm font-medium flex items-center space-x-1"
                  >
                    <span>すべて表示</span>
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
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                  </button>
                </div>
                <div class="flex space-x-4 overflow-x-auto pb-4 scrollbar-hide">
                  <For each={shortVideos().slice(0, 8)}>
                    {(video) => (
                      <div
                        class="flex-shrink-0 w-40 cursor-pointer group"
                        onClick={() => {
                          setSelectedShortIndex(
                            shortVideos().findIndex((v) => v.id === video.id),
                          );
                          setCurrentView("shorts");
                        }}
                      >
                        <div class="relative aspect-[9/16] bg-gradient-to-br from-red-500 via-pink-500 to-purple-600 rounded-xl overflow-hidden mb-3 group-hover:scale-105 transition-transform duration-200">
                          <div class="absolute inset-0 flex items-center justify-center">
                            <div class="text-center">
                              <div class="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-2 mx-auto group-hover:bg-white/30 transition-colors">
                                <svg
                                  class="w-6 h-6 text-white"
                                  fill="currentColor"
                                  viewBox="0 0 24 24"
                                >
                                  <path d="M8 5v14l11-7z" />
                                </svg>
                              </div>
                              <span class="text-white text-lg">
                                {video.authorAvatar}
                              </span>
                            </div>
                          </div>
                          <div class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded font-medium">
                            {video.duration}
                          </div>
                          <div class="absolute top-2 left-2 bg-red-600 text-white text-xs px-2 py-1 rounded font-medium">
                            Shorts
                          </div>
                        </div>
                        <h3 class="text-white text-sm font-medium line-clamp-2 mb-1 group-hover:text-gray-300">
                          {video.title}
                        </h3>
                        <p class="text-gray-400 text-xs">
                          {formatNumber(video.views)} 回視聴
                        </p>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* 長尺動画セクション */}
            <div>
              <h2 class="text-xl font-medium text-white mb-4">
                あなたへのおすすめ
              </h2>
              <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                <For each={_longVideos()}>
                  {(video) => (
                    <div
                      class="group cursor-pointer"
                      onClick={() => {
                        setOpenedVideo(video);
                      }}
                    >
                      <div class="relative aspect-video rounded-xl overflow-hidden mb-3 group-hover:rounded-lg transition-all duration-200">
                        <img
                          class="w-full h-full object-cover"
                          src={video.thumbnail}
                          alt={video.title}
                        />
                        <div class="absolute bottom-2 right-2 bg-black/80 text-white text-xs px-2 py-1 rounded font-medium">
                          {video.duration}
                        </div>
                      </div>
                      <div class="flex space-x-3">
                        <div class="flex-shrink-0 w-9 h-9 bg-gradient-to-br from-green-400 to-blue-500 rounded-full flex items-center justify-center">
                          <span class="text-sm">{video.authorAvatar}</span>
                        </div>
                        <div class="flex-1 min-w-0">
                          <h3 class="text-white font-medium mb-1 line-clamp-2 text-sm leading-5 group-hover:text-gray-300">
                            {video.title}
                          </h3>
                          <p class="text-gray-400 text-xs mb-1 hover:text-gray-300 cursor-pointer">
                            {video.author}
                          </p>
                          <div class="text-gray-400 text-xs flex items-center space-x-1">
                            <span>{formatNumber(video.views)} 回視聴</span>
                            <span>•</span>
                            <span>{formatTime(video.timestamp)}</span>
                          </div>
                        </div>
                        <button
                          type="button"
                          class="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-white p-1"
                        >
                          <svg
                            class="w-4 h-4"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </For>
              </div>
            </div>
          </div>
        </div>
      </Show>
      {/* ショート動画フルスクリーンビューア */}
      <Show when={currentView() === "shorts"}>
        <div class="flex-1 relative bg-black">
          {/* 縦スクロール動画ビューア */}
          <div class="h-screen overflow-hidden">
            <Show when={shortVideos().length > 0}>
              <div class="relative h-full flex items-center justify-center">
                {(() => {
                  const currentShort = shortVideos()[selectedShortIndex()];
                  return currentShort
                    ? (
                      <div class="relative w-[360px] h-[640px] bg-gray-900 rounded-lg overflow-hidden shadow-2xl">
                        <video
                          class="w-full h-full object-cover"
                          src={currentShort.videoUrl}
                          autoplay
                          loop
                          muted
                          playsinline
                        />

                        {/* 動画情報オーバーレイ */}
                        <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-4">
                          <div class="flex items-center space-x-3 mb-3">
                            <div class="w-10 h-10 bg-gradient-to-br from-pink-500 to-orange-500 rounded-full flex items-center justify-center">
                              <span class="text-lg">
                                {currentShort.authorAvatar}
                              </span>
                            </div>
                            <div class="flex-1">
                              <p class="text-white font-medium">
                                {currentShort.author}
                              </p>
                              <p class="text-white/70 text-sm">
                                {formatTime(currentShort.timestamp)}
                              </p>
                            </div>
                            <button
                              type="button"
                              class="bg-white text-black px-4 py-1.5 rounded-full text-sm font-medium hover:bg-gray-200 transition-colors"
                            >
                              チャンネル登録
                            </button>
                          </div>
                          <div class="mb-3">
                            <p class="text-white text-sm mb-2 line-clamp-3">
                              {currentShort.description}
                            </p>
                            <Show when={currentShort.hashtags}>
                              <div class="flex flex-wrap gap-2">
                                <For each={currentShort.hashtags}>
                                  {(hashtag) => (
                                    <span class="text-[#3ea6ff] text-sm cursor-pointer hover:underline">
                                      {hashtag}
                                    </span>
                                  )}
                                </For>
                              </div>
                            </Show>
                          </div>
                          <div class="flex items-center space-x-4 text-white/70 text-sm">
                            <div class="flex items-center space-x-1">
                              <svg
                                class="w-4 h-4"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path
                                  fill-rule="evenodd"
                                  d="M1.323 11.447C2.811 6.976 7.028 3.75 12.001 3.75c4.97 0 9.185 3.223 10.675 7.69.12.362.12.752 0 1.113-1.487 4.471-5.705 7.697-10.677 7.697-4.97 0-9.186-3.223-10.675-7.69a1.762 1.762 0 010-1.113zM17.25 12a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                              <span>{formatNumber(currentShort.views)}</span>
                            </div>
                            <div class="flex items-center space-x-1">
                              <svg
                                class="w-4 h-4"
                                fill="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path d="M7.493 18.75c-.425 0-.82-.236-.975-.632A7.48 7.48 0 016 15.375c0-1.75.599-3.358 1.602-4.634.151-.192.373-.309.6-.397.473-.183.89-.514 1.212-.924a9.042 9.042 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3a.75.75 0 01.75-.75 2.25 2.25 0 012.25 2.25c0 1.152-.26 2.243-.723 3.218-.266.558-.645 1.05-1.09 1.453-.812.736-1.35 1.83-1.35 3.027 0 .99.284 1.914.781 2.688.56.87 1.284 1.414 2.118 1.414.394 0 .74.215.925.563.188.35.102.777-.18 1.051l-1.432 1.368c-.296.283-.66.451-1.062.451H9.493z" />
                              </svg>
                              <span>{formatNumber(currentShort.likes)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                    : null;
                })()}

                {/* 右側のアクションボタン */}
                <div class="absolute right-6 bottom-24 flex flex-col space-y-4">
                  <div class="text-center">
                    <button
                      type="button"
                      class="w-12 h-12 bg-[#272727] backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-[#3f3f3f] transition-colors mb-2"
                    >
                      <svg
                        class="w-6 h-6"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                      </svg>
                    </button>
                    <span class="text-white text-xs block">
                      {(() => {
                        const currentShort =
                          shortVideos()[selectedShortIndex()];
                        return currentShort
                          ? formatNumber(currentShort.likes)
                          : "0";
                      })()}
                    </span>
                  </div>

                  <div class="text-center">
                    <button
                      type="button"
                      class="w-12 h-12 bg-[#272727] backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-[#3f3f3f] transition-colors mb-2"
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
                          d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                        />
                      </svg>
                    </button>
                    <span class="text-white text-xs block">132</span>
                  </div>

                  <button
                    type="button"
                    class="w-12 h-12 bg-[#272727] backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-[#3f3f3f] transition-colors"
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
                        d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z"
                      />
                    </svg>
                  </button>

                  <button
                    type="button"
                    class="w-12 h-12 bg-[#272727] backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-[#3f3f3f] transition-colors"
                  >
                    <svg
                      class="w-6 h-6"
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                  </button>

                  <button
                    type="button"
                    class="w-12 h-12 bg-[#272727] backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-[#3f3f3f] transition-colors"
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
                        d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                      />
                    </svg>
                  </button>
                </div>

                {/* 縦スクロールナビゲーション */}
                <div class="absolute right-8 top-1/2 transform -translate-y-1/2 flex flex-col space-y-3">
                  <button
                    type="button"
                    onClick={() => handleShortsScroll("up")}
                    disabled={selectedShortIndex() === 0}
                    class="w-10 h-10 bg-[#272727]/80 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-[#3f3f3f] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
                        d="M5 15l7-7 7 7"
                      />
                    </svg>
                  </button>
                  <div class="text-center">
                    <div class="text-white text-xs bg-black/60 rounded-full px-2 py-1 backdrop-blur-sm">
                      {selectedShortIndex() + 1} / {shortVideos().length}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleShortsScroll("down")}
                    disabled={selectedShortIndex() === shortVideos().length - 1}
                    class="w-10 h-10 bg-[#272727]/80 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-[#3f3f3f] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
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
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                </div>

                {/* 戻るボタン */}
                <div class="absolute top-6 left-6">
                  <button
                    type="button"
                    onClick={() => setCurrentView("timeline")}
                    class="w-10 h-10 bg-[#272727]/80 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-[#3f3f3f] transition-colors"
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
                        d="M10 19l-7-7m0 0l7-7m-7 7h18"
                      />
                    </svg>
                  </button>
                </div>

                {/* YouTubeロゴ */}
                <div class="absolute top-6 left-1/2 transform -translate-x-1/2">
                  <div class="flex items-center space-x-2 bg-black/40 backdrop-blur-sm rounded-full px-4 py-2">
                    <div class="w-6 h-6 bg-red-600 rounded flex items-center justify-center">
                      <svg
                        class="w-4 h-4 text-white"
                        fill="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
                      </svg>
                    </div>
                    <span class="text-white text-sm font-medium">Shorts</span>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={openedVideo()}>
        <div class="flex-1 overflow-y-auto bg-[#0f0f0f]">
          <div class="max-w-screen-2xl mx-auto px-6 py-6 flex flex-col lg:flex-row space-y-6 lg:space-y-0 lg:space-x-6">
            <div class="flex-1">
              <button
                type="button"
                onClick={() => setOpenedVideo(null)}
                class="text-red-500 hover:underline mb-4"
              >
                戻る
              </button>
              <video
                src={openedVideo()!.videoUrl}
                controls
                autoplay
                preload="metadata"
                class="w-full rounded-xl"
              />
              <h2 class="text-lg font-semibold text-white mt-4">
                {openedVideo()!.title}
              </h2>
              <p class="text-sm text-gray-300 mt-2">
                {openedVideo()!.description}
              </p>
              <div class="bg-[#181818] p-4 rounded mt-4">
                <p class="text-gray-400 text-sm">コメント機能は未実装です</p>
              </div>
            </div>
            <div class="w-full lg:w-80 space-y-4">
              <For each={_longVideos()}>
                {(video) => (
                  <div
                    class="flex space-x-3 cursor-pointer"
                    onClick={() => setOpenedVideo(video)}
                  >
                    <img
                      class="w-40 h-24 object-cover rounded"
                      src={video.thumbnail}
                      alt={video.title}
                    />
                    <div class="flex-1">
                      <p class="text-white text-sm line-clamp-2">
                        {video.title}
                      </p>
                      <p class="text-gray-400 text-xs">{video.author}</p>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
