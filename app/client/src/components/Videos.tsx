import { createSignal, For, Show, onMount, onCleanup } from "solid-js";

interface Video {
  id: string;
  title: string;
  author: string;
  authorAvatar: string;
  thumbnail: string;
  duration: string;
  views: number;
  likes: number;
  timestamp: Date;
  isShort: boolean;
  description?: string;
  hashtags?: string[];
}

export function Videos() {
  const [currentView, setCurrentView] = createSignal<"timeline" | "shorts">("timeline");
  const [selectedShortIndex, setSelectedShortIndex] = createSignal(0);
  const [showUploadModal, setShowUploadModal] = createSignal(false);
  const [uploadForm, setUploadForm] = createSignal({
    title: "",
    description: "",
    hashtags: "",
    isShort: false,
    file: null as File | null
  });
  
  const [videos, setVideos] = createSignal<Video[]>([
    {
      id: "1",
      title: "美しい夕日のタイムラプス",
      author: "NatureFilms",
      authorAvatar: "🌅",
      thumbnail: "/api/placeholder/400/225",
      duration: "2:34",
      views: 12400,
      likes: 1200,
      timestamp: new Date(Date.now() - 3600000),
      isShort: false,
      description: "美しい夕日の風景をタイムラプスで撮影しました。",
      hashtags: ["#nature", "#sunset", "#timelapse"]
    },
    {
      id: "2", 
      title: "料理のコツ",
      author: "CookingMaster",
      authorAvatar: "👨‍🍳",
      thumbnail: "/api/placeholder/225/400",
      duration: "0:45",
      views: 8900,
      likes: 890,
      timestamp: new Date(Date.now() - 7200000),
      isShort: true,
      description: "簡単で美味しい料理のコツを紹介！\n\n材料:\n- 玉ねぎ 1個\n- 塩 少々\n- 胡椒 少々",
      hashtags: ["#cooking", "#recipe", "#shorts"]
    },
    {
      id: "3",
      title: "プログラミング入門",
      author: "CodeTeacher",
      authorAvatar: "💻",
      thumbnail: "/api/placeholder/225/400",
      duration: "1:20",
      views: 15600,
      likes: 2300,
      timestamp: new Date(Date.now() - 10800000),
      isShort: true,
      description: "プログラミングの基礎を短時間で学ぼう！",
      hashtags: ["#programming", "#coding", "#tutorial"]
    },
    {
      id: "4",
      title: "可愛い猫の動画",
      author: "CatLover",
      authorAvatar: "🐱",
      thumbnail: "/api/placeholder/225/400",
      duration: "0:30",
      views: 45600,
      likes: 5200,
      timestamp: new Date(Date.now() - 14400000),
      isShort: true,
      description: "うちの猫ちゃんが可愛すぎる件について",
      hashtags: ["#cat", "#cute", "#pets"]
    },
    {
      id: "5",
      title: "ダンスチャレンジ",
      author: "DanceQueen",
      authorAvatar: "💃",
      thumbnail: "/api/placeholder/225/400",
      duration: "1:00",
      views: 23400,
      likes: 3100,
      timestamp: new Date(Date.now() - 18000000),
      isShort: true,
      description: "最新のダンストレンドに挑戦！",
      hashtags: ["#dance", "#challenge", "#trending"]
    }
  ]);

  const shortVideos = () => videos().filter(v => v.isShort);
  const _longVideos = () => videos().filter(v => !v.isShort);

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const formatTime = (date: Date) => {
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
      setUploadForm(prev => ({ ...prev, file }));
      
      // 動画のアスペクト比を自動判定（実際の実装では動画ファイルの解析が必要）
      // ここではファイル名で判定する簡易実装
      const isVertical = file.name.includes('short') || file.name.includes('vertical');
      setUploadForm(prev => ({ ...prev, isShort: isVertical }));
    }
  };

  const submitUpload = () => {
    const form = uploadForm();
    if (!form.file || !form.title.trim()) return;

    // 新しい動画データを作成
    const newVideo: Video = {
      id: String(Date.now()),
      title: form.title,
      author: "あなた",
      authorAvatar: "😊",
      thumbnail: "/api/placeholder/" + (form.isShort ? "225/400" : "400/225"),
      duration: form.isShort ? "0:30" : "5:00", // 実際の実装では動画ファイルから取得
      views: 0,
      likes: 0,
      timestamp: new Date(),
      isShort: form.isShort,
      description: form.description,
      hashtags: form.hashtags.split(' ').filter(tag => tag.startsWith('#'))
    };

    // 動画リストに追加（実際の実装ではAPIに送信）
    setVideos(prev => [newVideo, ...prev]);
    
    // フォームをリセット
    setUploadForm({
      title: "",
      description: "",
      hashtags: "",
      isShort: false,
      file: null
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
    <div class="h-screen bg-[#121212] flex">
      {/* 投稿モーダル */}
      <Show when={showUploadModal()}>
        <div class="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div class="bg-[#1a1a1a] rounded-lg p-6 w-full max-w-md mx-4">
            <div class="flex items-center justify-between mb-4">
              <h3 class="text-lg font-bold text-white">動画をアップロード</h3>
              <button 
                type="button"
                onClick={() => setShowUploadModal(false)}
                class="text-gray-400 hover:text-white"
              >
                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div class="space-y-4">
              {/* ファイル選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  動画ファイル
                </label>
                <input
                  type="file"
                  accept="video/*"
                  onChange={handleFileUpload}
                  class="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:cursor-pointer hover:file:bg-blue-700"
                />
              </div>
              
              {/* 動画タイプ選択 */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  動画タイプ
                </label>
                <div class="flex space-x-4">
                  <label class="flex items-center">
                    <input
                      type="radio"
                      name="videoType"
                      checked={!uploadForm().isShort}
                      onChange={() => setUploadForm(prev => ({ ...prev, isShort: false }))}
                      class="mr-2"
                    />
                    <span class="text-white">長尺動画</span>
                  </label>
                  <label class="flex items-center">
                    <input
                      type="radio"
                      name="videoType"
                      checked={uploadForm().isShort}
                      onChange={() => setUploadForm(prev => ({ ...prev, isShort: true }))}
                      class="mr-2"
                    />
                    <span class="text-white">縦型ショート</span>
                  </label>
                </div>
              </div>
              
              {/* タイトル */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  タイトル *
                </label>
                <input
                  type="text"
                  value={uploadForm().title}
                  onInput={(e) => setUploadForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="動画のタイトルを入力"
                  class="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              {/* 説明 */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  説明
                </label>
                <textarea
                  value={uploadForm().description}
                  onInput={(e) => setUploadForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="動画の説明を入力"
                  rows="3"
                  class="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                />
              </div>
              
              {/* ハッシュタグ */}
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  ハッシュタグ
                </label>
                <input
                  type="text"
                  value={uploadForm().hashtags}
                  onInput={(e) => setUploadForm(prev => ({ ...prev, hashtags: e.target.value }))}
                  placeholder="#タグ1 #タグ2 #タグ3"
                  class="w-full px-3 py-2 bg-[#2a2a2a] border border-gray-700 rounded-lg text-white placeholder-gray-400 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              
              {/* アクションボタン */}
              <div class="flex space-x-3 pt-4">
                <button
                  type="button"
                  onClick={() => setShowUploadModal(false)}
                  class="flex-1 px-4 py-2 bg-gray-600 hover:bg-gray-700 text-white rounded-lg transition-colors"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={submitUpload}
                  disabled={!uploadForm().file || !uploadForm().title.trim()}
                  class="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
                >
                  アップロード
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>

      {/* YouTube風タイムライン表示 */}
      <Show when={currentView() === "timeline"}>
        <div class="flex-1 overflow-y-auto bg-[#121212]">
          {/* ヘッダー */}
          <div class="sticky top-0 z-10 bg-[#121212] border-b border-gray-800 p-4">
            <div class="flex items-center justify-between">
              <h1 class="text-2xl font-bold text-white">動画</h1>
              <div class="flex items-center space-x-3">
                <button 
                  type="button"
                  onClick={() => setShowUploadModal(true)}
                  class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center space-x-2"
                >
                  <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  <span>動画を投稿</span>
                </button>
                <button 
                  type="button"
                  onClick={() => setCurrentView("shorts")}
                  class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  ショート表示
                </button>
              </div>
            </div>
          </div>
          
          <div class="max-w-7xl mx-auto p-6">
            {/* ショート動画セクション */}
            <Show when={shortVideos().length > 0}>
              <div class="mb-8">
                <div class="flex items-center justify-between mb-4">
                  <h2 class="text-xl font-bold text-white">ショート動画</h2>
                  <button 
                    type="button"
                    onClick={() => setCurrentView("shorts")}
                    class="text-blue-400 hover:text-blue-300 text-sm"
                  >
                    すべて見る
                  </button>
                </div>
                <div class="flex space-x-4 overflow-x-auto pb-4">
                  <For each={shortVideos().slice(0, 6)}>
                    {(video) => (
                      <div 
                        class="flex-shrink-0 w-40 cursor-pointer"
                        onClick={() => {
                          setSelectedShortIndex(shortVideos().findIndex(v => v.id === video.id));
                          setCurrentView("shorts");
                        }}
                      >
                        <div class="relative aspect-[9/16] bg-gradient-to-br from-purple-600 to-pink-600 rounded-lg overflow-hidden mb-2">
                          <div class="absolute inset-0 flex items-center justify-center">
                            <div class="text-center">
                              <div class="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-2 mx-auto">
                                <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                                  <path d="M8 5v14l11-7z"/>
                                </svg>
                              </div>
                              <span class="text-white text-lg">{video.authorAvatar}</span>
                            </div>
                          </div>
                          <div class="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-1 rounded">
                            {video.duration}
                          </div>
                          <div class="absolute top-2 left-2 bg-red-600 text-white text-xs px-2 py-1 rounded-full">
                            Shorts
                          </div>
                        </div>
                        <h3 class="text-white text-sm font-medium line-clamp-2 mb-1">
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
              <h2 class="text-xl font-bold text-white mb-4">おすすめ動画</h2>
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                <For each={videos().filter(v => !v.isShort)}>
                  {(video) => (
                    <div 
                      class="bg-[#1a1a1a] rounded-lg overflow-hidden hover:bg-[#2a2a2a] transition-colors cursor-pointer"
                      onClick={() => {
                        // 長尺動画の詳細表示や再生処理をここに追加
                        console.log("Video clicked:", video.id);
                      }}
                    >
                      <div class="relative aspect-video bg-gradient-to-br from-blue-600 to-purple-600 flex items-center justify-center">
                        <div class="text-center">
                          <div class="w-12 h-12 bg-white/20 rounded-full flex items-center justify-center mb-2 mx-auto">
                            <svg class="w-6 h-6 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          </div>
                          <span class="text-white text-lg">{video.authorAvatar}</span>
                        </div>
                        <div class="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                          {video.duration}
                        </div>
                      </div>
                      <div class="p-4">
                        <h3 class="text-white font-medium mb-2 line-clamp-2">
                          {video.title}
                        </h3>
                        <p class="text-gray-400 text-sm mb-1">
                          {video.author}
                        </p>
                        <div class="text-gray-500 text-xs">
                          {formatNumber(video.views)} 回視聴 • {formatTime(video.timestamp)}
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
      {/* ショート動画フルスクリーンビューア */}
      <Show when={currentView() === "shorts"}>
        <div class="flex-1 relative bg-black">
          {/* 縦スクロール動画ビューア */}
          <div class="h-screen overflow-hidden">
            <Show when={shortVideos().length > 0}>
              <div class="relative h-full flex items-center justify-center">
                {(() => {
                  const currentShort = shortVideos()[selectedShortIndex()];
                  return currentShort ? (
                    <div class="relative w-[365px] h-[650px] bg-gray-900 rounded-lg overflow-hidden">
                      <div class="absolute inset-0 bg-gradient-to-br from-purple-600 via-blue-600 to-green-500 flex items-center justify-center">
                        <div class="text-center">
                          <div class="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center mb-4 mx-auto">
                            <svg class="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                              <path d="M8 5v14l11-7z"/>
                            </svg>
                          </div>
                          <p class="text-white font-medium">{currentShort.title}</p>
                          <p class="text-white/70 text-sm mt-1">{currentShort.duration}</p>
                        </div>
                      </div>
                      
                      {/* 動画情報 */}
                      <div class="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4">
                        <div class="flex items-center space-x-3 mb-3">
                          <div class="w-10 h-10 bg-gradient-to-br from-pink-500 to-orange-500 rounded-full flex items-center justify-center">
                            <span class="text-lg">{currentShort.authorAvatar}</span>
                          </div>
                          <div class="flex-1">
                            <p class="text-white font-medium">{currentShort.author}</p>
                            <p class="text-white/70 text-sm">{formatTime(currentShort.timestamp)}</p>
                          </div>
                          <button type="button" class="bg-red-600 hover:bg-red-700 text-white px-4 py-1 rounded-full text-sm font-medium transition-colors">
                            フォロー
                          </button>
                        </div>
                        <div class="mb-3">
                          <p class="text-white text-sm mb-2">{currentShort.description}</p>
                          <Show when={currentShort.hashtags}>
                            <div class="flex flex-wrap gap-2">
                              <For each={currentShort.hashtags}>
                                {(hashtag) => (
                                  <span class="text-blue-300 text-sm cursor-pointer hover:underline">
                                    {hashtag}
                                  </span>
                                )}
                              </For>
                            </div>
                          </Show>
                        </div>
                        <div class="text-white/70 text-sm">
                          {formatNumber(currentShort.views)} 回視聴 • {formatNumber(currentShort.likes)} いいね
                        </div>
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* 右側のアクションボタン */}
                <div class="absolute right-4 bottom-20 flex flex-col space-y-6">
                  <button type="button" class="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors">
                    <svg class="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                    </svg>
                  </button>
                  <div class="text-center">
                    <button type="button" class="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors mb-1">
                      <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                    </button>
                    <span class="text-white text-xs">
                      {(() => {
                        const currentShort = shortVideos()[selectedShortIndex()];
                        return currentShort ? formatNumber(currentShort.likes) : "0";
                      })()}
                    </span>
                  </div>
                  <button type="button" class="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                    </svg>
                  </button>
                  <button type="button" class="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors">
                    <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                    </svg>
                  </button>
                </div>

                {/* 縦スクロールナビゲーション */}
                <div class="absolute right-8 top-1/2 transform -translate-y-1/2 flex flex-col space-y-4">
                  <button 
                    type="button"
                    onClick={() => handleShortsScroll("up")}
                    disabled={selectedShortIndex() === 0}
                    class="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7" />
                    </svg>
                  </button>
                  <div class="text-center">
                    <div class="text-white text-xs bg-black/50 rounded px-2 py-1">
                      {selectedShortIndex() + 1} / {shortVideos().length}
                    </div>
                  </div>
                  <button 
                    type="button"
                    onClick={() => handleShortsScroll("down")}
                    disabled={selectedShortIndex() === shortVideos().length - 1}
                    class="w-10 h-10 bg-white/20 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-white/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* 戻るボタン */}
                <div class="absolute top-4 left-4">
                  <button 
                    type="button"
                    onClick={() => setCurrentView("timeline")}
                    class="w-10 h-10 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center text-white hover:bg-black/70 transition-colors"
                  >
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                    </svg>
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}