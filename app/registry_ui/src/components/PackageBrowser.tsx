import { createMemo, createSignal, For, onMount, Show } from "solid-js";
import { req } from "../api.ts";
import PackageCard, { PackageInfo } from "./PackageCard.tsx";

export default function PackageBrowser() {
  const [packages, setPackages] = createSignal<PackageInfo[]>([]);
  const [searchQuery, setSearchQuery] = createSignal("");
  const [sortBy, setSortBy] = createSignal("name");
  const [isLoading, setIsLoading] = createSignal(false);
  const [selectedPackage, setSelectedPackage] = createSignal<
    PackageInfo | null
  >(null);

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

  const handleViewDetails = (pkg: PackageInfo) => {
    setSelectedPackage(pkg);
  };

  const handleInstall = (pkg: PackageInfo) => {
    // コピー機能を提供
    const installCommand = `takopack install ${pkg.identifier}`;
    navigator.clipboard.writeText(installCommand).then(() => {
      alert(
        `インストールコマンドをクリップボードにコピーしました:\n${installCommand}`,
      );
    }).catch(() => {
      alert(`インストールコマンド:\n${installCommand}`);
    });
  };

  onMount(() => {
    refresh();
  });

  return (
    <div class="space-y-8">
      {/* ヒーローセクション */}
      <div class="text-center py-12 bg-gradient-to-br from-purple-900/20 to-blue-900/20 rounded-2xl border border-purple-500/20">
        <div class="max-w-3xl mx-auto px-6">
          <h1 class="text-4xl md:text-5xl font-bold gradient-text mb-4">
            🐙 Takopack Registry
          </h1>
          <p class="text-xl text-gray-300 mb-6">
            高品質な拡張機能とパッケージを発見し、プロジェクトを強化しましょう
          </p>
          <div class="flex flex-col sm:flex-row gap-4 justify-center">
            <div class="text-sm text-gray-400 flex items-center space-x-2">
              <svg
                class="w-5 h-5 text-green-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>{packages().length}個のパッケージが利用可能</span>
            </div>
            <div class="text-sm text-gray-400 flex items-center space-x-2">
              <svg
                class="w-5 h-5 text-blue-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fill-rule="evenodd"
                  d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clip-rule="evenodd"
                />
              </svg>
              <span>安全に検証済み</span>
            </div>
          </div>
        </div>
      </div>

      {/* 検索・フィルター */}
      <div class="bg-gray-800/30 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
        <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-4 lg:space-y-0">
          {/* 検索バー */}
          <div class="flex-1 max-w-2xl">
            <div class="relative">
              <div class="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <svg
                  class="h-5 w-5 text-gray-400"
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
              <input
                type="text"
                value={searchQuery()}
                onInput={(e) => setSearchQuery(e.currentTarget.value)}
                placeholder="拡張機能やパッケージを検索..."
                class="block w-full pl-10 pr-4 py-3 border border-gray-600 rounded-lg bg-gray-700/50 text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors duration-200"
              />
            </div>
          </div>

          {/* ソート・統計 */}
          <div class="flex items-center space-x-4">
            <div class="text-sm text-gray-400">
              {filteredAndSortedPackages().length}個の結果
            </div>
            <select
              value={sortBy()}
              onChange={(e) => setSortBy(e.currentTarget.value)}
              class="px-3 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-sm text-gray-300 focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="name">名前順</option>
              <option value="version">バージョン順</option>
              <option value="updated">更新日順</option>
              <option value="created">作成日順</option>
            </select>
            <button
              type="button"
              onClick={refresh}
              disabled={isLoading()}
              class="p-2 bg-gray-700/50 border border-gray-600 rounded-lg text-gray-300 hover:bg-gray-700 hover:text-white transition-colors disabled:opacity-50"
            >
              <svg
                class={`w-4 h-4 ${isLoading() ? "animate-spin" : ""}`}
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
            </button>
          </div>
        </div>
      </div>

      {/* パッケージ一覧 */}
      <div>
        <Show when={isLoading()}>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[...Array(9)].map(() => (
              <div class="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 animate-pulse">
                <div class="flex items-center space-x-3 mb-4">
                  <div class="w-12 h-12 bg-gray-700 rounded-lg"></div>
                  <div class="flex-1">
                    <div class="h-4 bg-gray-700 rounded mb-2"></div>
                    <div class="h-3 bg-gray-700 rounded w-3/4"></div>
                  </div>
                </div>
                <div class="space-y-2">
                  <div class="h-3 bg-gray-700 rounded"></div>
                  <div class="h-3 bg-gray-700 rounded w-5/6"></div>
                </div>
              </div>
            ))}
          </div>
        </Show>

        <Show when={!isLoading()}>
          <Show when={filteredAndSortedPackages().length === 0}>
            <div class="text-center py-16">
              <svg
                class="mx-auto h-16 w-16 text-gray-400 mb-4"
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
              <h3 class="text-lg font-medium text-gray-300 mb-2">
                {searchQuery()
                  ? "検索結果が見つかりません"
                  : "パッケージがありません"}
              </h3>
              <p class="text-gray-500">
                {searchQuery()
                  ? "別のキーワードで検索してみてください"
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

      {/* パッケージ詳細モーダル */}
      <Show when={selectedPackage()}>
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div class="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div class="p-6 border-b border-gray-700">
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-4">
                  <div class="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-2xl">
                    {selectedPackage()?.name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <h3 class="text-2xl font-bold text-gray-100">
                      {selectedPackage()?.name}
                    </h3>
                    <p class="text-gray-400">{selectedPackage()?.identifier}</p>
                    <div class="flex items-center space-x-4 mt-2">
                      <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-900/20 text-green-400">
                        v{selectedPackage()?.version}
                      </span>
                      <Show when={selectedPackage()?.sha256}>
                        <span class="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-900/20 text-blue-400">
                          <svg
                            class="w-3 h-3 mr-1"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                          >
                            <path
                              fill-rule="evenodd"
                              d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                              clip-rule="evenodd"
                            />
                          </svg>
                          検証済み
                        </span>
                      </Show>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedPackage(null)}
                  class="p-2 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  <svg
                    class="w-6 h-6 text-gray-400"
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
              <Show when={selectedPackage()?.description}>
                <div>
                  <h4 class="text-lg font-semibold text-gray-100 mb-3">説明</h4>
                  <p class="text-gray-300 leading-relaxed">
                    {selectedPackage()?.description}
                  </p>
                </div>
              </Show>

              <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <h4 class="text-lg font-semibold text-gray-100 mb-3">
                    パッケージ情報
                  </h4>
                  <div class="space-y-3">
                    <div class="flex justify-between">
                      <span class="text-gray-400">識別子:</span>
                      <span class="text-gray-300 font-mono text-sm">
                        {selectedPackage()?.identifier}
                      </span>
                    </div>
                    <div class="flex justify-between">
                      <span class="text-gray-400">バージョン:</span>
                      <span class="text-gray-300">
                        {selectedPackage()?.version}
                      </span>
                    </div>
                    <Show when={selectedPackage()?.updatedAt}>
                      <div class="flex justify-between">
                        <span class="text-gray-400">更新日:</span>
                        <span class="text-gray-300">
                          {new Date(selectedPackage()?.updatedAt || "")
                            .toLocaleDateString("ja-JP")}
                        </span>
                      </div>
                    </Show>
                  </div>
                </div>

                <div>
                  <h4 class="text-lg font-semibold text-gray-100 mb-3">
                    インストール
                  </h4>
                  <div class="bg-gray-900/50 rounded-lg p-4 border border-gray-600">
                    <div class="flex items-center justify-between mb-2">
                      <span class="text-sm text-gray-400">コマンドライン:</span>
                      <button
                        type="button"
                        onClick={() => handleInstall(selectedPackage()!)}
                        class="text-xs text-purple-400 hover:text-purple-300"
                      >
                        コピー
                      </button>
                    </div>
                    <code class="text-green-400 text-sm">
                      takopack install {selectedPackage()?.identifier}
                    </code>
                  </div>
                  <Show when={selectedPackage()?.downloadUrl}>
                    <div class="mt-4">
                      <a
                        href={selectedPackage()?.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="inline-flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
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
                            d="M12 10v6m0 0l-4-4m4 4l4-4m3 5a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <span>直接ダウンロード</span>
                      </a>
                    </div>
                  </Show>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
