import { createMemo, createSignal, For, Show } from "solid-js";
import { req } from "../api.ts";
import PackageCard, { PackageInfo } from "./PackageCard.tsx";
import SearchBar from "./SearchBar.tsx";

export default function PackageSection() {
  const [packages, setPackages] = createSignal<PackageInfo[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [sortBy, setSortBy] = createSignal("name");
  const [isLoading, setIsLoading] = createSignal(false);
  const [selectedPackage, setSelectedPackage] = createSignal<
    PackageInfo | null
  >(null);
  const [showPublishModal, setShowPublishModal] = createSignal(false);
  // フォーム用の参照
  let idInput!: HTMLInputElement;
  let nameInput!: HTMLInputElement;
  let versionInput!: HTMLInputElement;
  let descInput!: HTMLTextAreaElement;
  let urlInput!: HTMLInputElement;
  let shaInput!: HTMLInputElement;

  const filteredAndSortedPackages = createMemo(() => {
    let filtered = packages();

    // 検索フィルター
    const query = searchQuery().toLowerCase();
    if (query) {
      filtered = filtered.filter((pkg) =>
        pkg.name.toLowerCase().includes(query) ||
        pkg.identifier.toLowerCase().includes(query) ||
        pkg.description?.toLowerCase().includes(query)
      );
    }

    // ソート
    filtered.sort((a, b) => {
      switch (sortBy()) {
        case "version":
          return b.version.localeCompare(a.version);
        case "updated":
          return new Date(b.updatedAt || 0).getTime() -
            new Date(a.updatedAt || 0).getTime();
        case "created":
          return new Date(b.createdAt || 0).getTime() -
            new Date(a.createdAt || 0).getTime();
        default:
          return a.name.localeCompare(b.name);
      }
    });

    return filtered;
  });

  const refresh = async () => {
    setIsLoading(true);
    try {
      const data = await req<{ packages: PackageInfo[] }>("/_takopack/search");
      setPackages(data.packages);
    } catch (error) {
      console.error("Failed to fetch packages:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const addPackage = async () => {
    setIsLoading(true);
    try {
      await req("/api/packages", "POST", {
        identifier: idInput.value,
        name: nameInput.value,
        version: versionInput.value,
        description: descInput.value,
        downloadUrl: urlInput.value,
        sha256: shaInput.value || undefined,
      });

      // フォームをリセット
      idInput.value = "";
      nameInput.value = "";
      versionInput.value = "";
      descInput.value = "";
      urlInput.value = "";
      shaInput.value = "";

      setShowPublishModal(false);
      await refresh();
    } catch (error) {
      console.error("Failed to add package:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInstall = (pkg: PackageInfo) => {
    // インストール処理のシミュレーション
    console.log("Installing package:", pkg.identifier);
    // 実際のインストール処理をここに実装
  };

  const handleViewDetails = (pkg: PackageInfo) => {
    setSelectedPackage(pkg);
  };

  // 初期読み込み
  refresh();

  return (
    <div class="min-h-screen bg-gray-900">
      {/* 検索バー */}
      <SearchBar
        searchQuery={searchQuery()}
        onSearchChange={setSearchQuery}
        onSortChange={setSortBy}
        packageCount={filteredAndSortedPackages().length}
        isLoading={isLoading()}
      />

      {/* メインコンテンツ */}
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* 統計情報 */}
        <div class="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
          <div class="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-gray-400 text-sm font-medium">総パッケージ数</p>
                <p class="text-2xl font-bold text-gray-100">
                  {packages().length}
                </p>
              </div>
              <div class="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
                <svg
                  class="w-6 h-6 text-blue-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M20 7l-8-4-8 4m16 0l-8 4-8-4m16 0v10l-8 4-8-4V7"
                  />
                </svg>
              </div>
            </div>
          </div>

          <div class="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-gray-400 text-sm font-medium">検索結果</p>
                <p class="text-2xl font-bold text-gray-100">
                  {filteredAndSortedPackages().length}
                </p>
              </div>
              <div class="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
                <svg
                  class="w-6 h-6 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
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

          <div class="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-gray-400 text-sm font-medium">認証済み</p>
                <p class="text-2xl font-bold text-gray-100">
                  {packages().filter((p) => p.sha256).length}
                </p>
              </div>
              <div class="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
                <svg
                  class="w-6 h-6 text-purple-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
            </div>
          </div>{" "}
          <button
            type="button"
            onClick={() => setShowPublishModal(true)}
            class="bg-gradient-to-br from-purple-500 to-blue-600 hover:from-purple-600 hover:to-blue-700 border border-purple-500/20 rounded-xl p-6 text-left transition-all duration-300 hover:shadow-lg hover:shadow-purple-500/25 group"
          >
            <div class="flex items-center justify-between">
              <div>
                <p class="text-purple-100 text-sm font-medium">
                  新しいパッケージ
                </p>
                <p class="text-xl font-bold text-white">公開する</p>
              </div>
              <div class="w-12 h-12 bg-white/20 rounded-lg flex items-center justify-center group-hover:bg-white/30 transition-colors">
                <svg
                  class="w-6 h-6 text-white"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
              </div>
            </div>
          </button>
        </div>

        {/* パッケージ一覧 */}
        <div class="space-y-6">
          <div class="flex items-center justify-between">
            <h2 class="text-2xl font-bold text-gray-100">パッケージ</h2>{" "}
            <button
              type="button"
              onClick={refresh}
              class="flex items-center space-x-2 px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200"
            >
              <svg
                class="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
              <span>更新</span>
            </button>
          </div>

          <Show when={isLoading()}>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map(() => (
                <div class="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 animate-pulse">
                  <div class="flex items-center space-x-3 mb-4">
                    <div class="w-12 h-12 bg-gray-700 rounded-lg"></div>
                    <div class="flex-1">
                      <div class="h-4 bg-gray-700 rounded mb-2"></div>
                      <div class="h-3 bg-gray-700 rounded w-3/4"></div>
                    </div>
                  </div>
                  <div class="h-3 bg-gray-700 rounded mb-2"></div>
                  <div class="h-3 bg-gray-700 rounded w-5/6"></div>
                </div>
              ))}
            </div>
          </Show>

          <Show when={!isLoading()}>
            <Show when={filteredAndSortedPackages().length === 0}>
              <div class="text-center py-12">
                <svg
                  class="mx-auto h-12 w-12 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2M4 13h2m8-8v4m0 0l-2-2m2 2l2-2"
                  />
                </svg>
                <h3 class="mt-2 text-sm font-medium text-gray-300">
                  パッケージが見つかりません
                </h3>
                <p class="mt-1 text-sm text-gray-500">
                  {searchQuery()
                    ? "検索条件を変更してみてください"
                    : "まだパッケージが公開されていません"}
                </p>
              </div>
            </Show>

            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <For each={filteredAndSortedPackages()}>
                {(pkg) => (
                  <PackageCard
                    package={pkg}
                    onInstall={handleInstall}
                    onViewDetails={handleViewDetails}
                  />
                )}
              </For>
            </div>
          </Show>
        </div>
      </div>

      {/* パッケージ公開モーダル */}
      <Show when={showPublishModal()}>
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div class="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div class="p-6 border-b border-gray-700">
              <div class="flex items-center justify-between">
                <h3 class="text-xl font-semibold text-gray-100">
                  新しいパッケージを公開
                </h3>{" "}
                <button
                  type="button"
                  onClick={() => setShowPublishModal(false)}
                  class="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <svg
                    class="w-5 h-5 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
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
            </div>

            <div class="p-6 space-y-6">
              <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    識別子
                  </label>
                  <input
                    ref={idInput!}
                    placeholder="com.example.package"
                    class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-300 mb-2">
                    パッケージ名
                  </label>
                  <input
                    ref={nameInput!}
                    placeholder="My Package"
                    class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  バージョン
                </label>
                <input
                  ref={versionInput!}
                  placeholder="1.0.0"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  説明
                </label>
                <textarea
                  ref={descInput!}
                  placeholder="パッケージの説明を入力してください..."
                  rows={3}
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-none"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  ダウンロードURL
                </label>
                <input
                  ref={urlInput!}
                  placeholder="https://example.com/package.zip"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  SHA256ハッシュ（オプション）
                </label>
                <input
                  ref={shaInput!}
                  placeholder="ファイルのSHA256ハッシュ値"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>
            </div>

            <div class="p-6 border-t border-gray-700 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setShowPublishModal(false)}
                class="px-4 py-2 text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors duration-200"
              >
                キャンセル
              </button>{" "}
              <button
                type="button"
                onClick={addPackage}
                disabled={isLoading()}
                class="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors duration-200"
              >
                {isLoading() ? "公開中..." : "パッケージを公開"}
              </button>
            </div>
          </div>
        </div>
      </Show>

      {/* パッケージ詳細モーダル */}
      <Show when={selectedPackage()}>
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div class="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            {/* モーダルの内容は必要に応じて詳細を追加 */}
            <div class="p-6">
              <div class="flex items-center justify-between mb-6">
                <h3 class="text-xl font-semibold text-gray-100">
                  パッケージ詳細
                </h3>{" "}
                <button
                  type="button"
                  onClick={() => setSelectedPackage(null)}
                  class="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <svg
                    class="w-5 h-5 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
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
              <div class="space-y-4">
                <h4 class="text-lg font-medium text-gray-100">
                  {selectedPackage()?.name}
                </h4>
                <p class="text-gray-400">{selectedPackage()?.identifier}</p>
                <p class="text-gray-300">{selectedPackage()?.description}</p>
                <div class="flex items-center space-x-4 text-sm text-gray-400">
                  <span>バージョン: {selectedPackage()?.version}</span>
                  <span>URL: {selectedPackage()?.downloadUrl}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
