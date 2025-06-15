import { createSignal, For, Show } from "solid-js";
import { req } from "../api.ts";

interface Domain {
  name: string;
  verified: boolean;
}

export default function DomainSection() {
  const [domains, setDomains] = createSignal<Domain[]>([]);
  const [token, setToken] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [showAddModal, setShowAddModal] = createSignal(false);
  let domainInput!: HTMLInputElement;

  const refresh = async () => {
    setIsLoading(true);
    try {
      const data = await req<{ domains: Domain[] }>("/api/domains");
      setDomains(data.domains);
    } catch (error) {
      console.error("Failed to fetch domains:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const requestDomain = async () => {
    if (!domainInput.value.trim()) return;

    setIsLoading(true);
    try {
      const data = await req<{ token: string }>(
        "/api/domains/request",
        "POST",
        {
          domain: domainInput.value,
        },
      );
      setToken(`認証トークン: takopack-verify=${data.token}`);
      domainInput.value = "";
      setShowAddModal(false);
      await refresh();
    } catch (error) {
      console.error("Failed to request domain:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const verifyDomain = async (name: string) => {
    setIsLoading(true);
    try {
      await req("/api/domains/verify", "POST", { domain: name });
      await refresh();
    } catch (error) {
      console.error("Failed to verify domain:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const viewToken = async (name: string) => {
    setIsLoading(true);
    try {
      const data = await req<{ token: string }>(
        `/api/domains/${encodeURIComponent(name)}/token`,
      );
      setToken(`認証トークン: takopack-verify=${data.token}`);
    } catch (error) {
      console.error("Failed to fetch token:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteDomain = async (name: string) => {
    if (!confirm(`${name} を削除しますか?`)) return;
    setIsLoading(true);
    try {
      await req(`/api/domains/${encodeURIComponent(name)}`, "DELETE");
      await refresh();
    } catch (error) {
      console.error("Failed to delete domain:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // 初期読み込み
  refresh();

  return (
    <div class="space-y-6">
      {/* ヘッダー */}
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-2xl font-bold text-gray-100">ドメイン管理</h2>
          <p class="text-gray-400 text-sm mt-1">
            パッケージ公開に使用するドメインを管理します
          </p>
        </div>
        <div class="flex items-center space-x-3">
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading()}
            class="flex items-center space-x-2 px-4 py-2 bg-gray-700/50 border border-gray-600 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200 disabled:opacity-50"
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
            <span>更新</span>
          </button>{" "}
          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            class="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors duration-200"
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
                d="M12 4v16m8-8H4"
              />
            </svg>
            <span>ドメイン追加</span>
          </button>
        </div>
      </div>

      {/* 統計情報 */}
      <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div class="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-gray-400 text-sm font-medium">総ドメイン数</p>
              <p class="text-2xl font-bold text-gray-100">{domains().length}</p>
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
                  d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9"
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
                {domains().filter((d) => d.verified).length}
              </p>
            </div>
            <div class="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
              <svg
                class="w-6 h-6 text-green-400"
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
        </div>

        <div class="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl p-6">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-gray-400 text-sm font-medium">認証待ち</p>
              <p class="text-2xl font-bold text-gray-100">
                {domains().filter((d) => !d.verified).length}
              </p>
            </div>
            <div class="w-12 h-12 bg-yellow-500/20 rounded-lg flex items-center justify-center">
              <svg
                class="w-6 h-6 text-yellow-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* ドメイン一覧 */}
      <div class="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-xl overflow-hidden">
        <div class="p-6 border-b border-gray-700/50">
          <h3 class="text-lg font-semibold text-gray-100">登録済みドメイン</h3>
        </div>

        <Show when={isLoading()}>
          <div class="p-6">
            <div class="space-y-4">
              {[...Array(3)].map(() => (
                <div class="flex items-center justify-between p-4 bg-gray-700/30 rounded-lg animate-pulse">
                  <div class="flex items-center space-x-3">
                    <div class="w-8 h-8 bg-gray-600 rounded-full"></div>
                    <div class="h-4 bg-gray-600 rounded w-48"></div>
                  </div>
                  <div class="h-6 bg-gray-600 rounded w-20"></div>
                </div>
              ))}
            </div>
          </div>
        </Show>

        <Show when={!isLoading()}>
          <Show when={domains().length === 0}>
            <div class="p-12 text-center">
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
                  d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9v-9m0-9v9"
                />
              </svg>
              <h3 class="mt-2 text-sm font-medium text-gray-300">
                ドメインが登録されていません
              </h3>
              <p class="mt-1 text-sm text-gray-500">
                最初のドメインを追加してパッケージ公開を始めましょう
              </p>{" "}
              <button
                type="button"
                onClick={() => setShowAddModal(true)}
                class="mt-4 inline-flex items-center px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors"
              >
                ドメインを追加
              </button>
            </div>
          </Show>

          <Show when={domains().length > 0}>
            <div class="divide-y divide-gray-700/50">
              <For each={domains()}>
                {(domain) => (
                  <div class="p-6 hover:bg-gray-700/20 transition-colors duration-200">
                    <div class="flex items-center justify-between">
                      <div class="flex items-center space-x-4">
                        <div
                          class={`w-10 h-10 rounded-full flex items-center justify-center ${
                            domain.verified
                              ? "bg-green-500/20 text-green-400"
                              : "bg-yellow-500/20 text-yellow-400"
                          }`}
                        >
                          {domain.verified
                            ? (
                              <svg
                                class="w-5 h-5"
                                fill="currentColor"
                                viewBox="0 0 20 20"
                              >
                                <path
                                  fill-rule="evenodd"
                                  d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                  clip-rule="evenodd"
                                />
                              </svg>
                            )
                            : (
                              <svg
                                class="w-5 h-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  stroke-linecap="round"
                                  stroke-linejoin="round"
                                  stroke-width="2"
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                            )}
                        </div>
                        <div>
                          <h4 class="text-lg font-medium text-gray-100">
                            {domain.name}
                          </h4>
                          <p
                            class={`text-sm font-medium ${
                              domain.verified
                                ? "text-green-400"
                                : "text-yellow-400"
                            }`}
                          >
                            {domain.verified ? "認証済み" : "認証待ち"}
                          </p>
                        </div>
                      </div>

                      <div class="flex items-center space-x-2">
                        <Show when={!domain.verified}>
                          <div class="flex items-center space-x-2">
                            <button
                              type="button"
                              onClick={() => verifyDomain(domain.name)}
                              class="px-3 py-1.5 text-xs font-medium text-yellow-300 border border-yellow-500/30 rounded-lg hover:bg-yellow-500/10 transition-colors duration-200"
                            >
                              認証確認
                            </button>
                            <button
                              type="button"
                              onClick={() => viewToken(domain.name)}
                              class="px-3 py-1.5 text-xs font-medium text-blue-300 border border-blue-500/30 rounded-lg hover:bg-blue-500/10 transition-colors duration-200"
                            >
                              トークン表示
                            </button>
                          </div>
                        </Show>
                        <button
                          type="button"
                          onClick={() => deleteDomain(domain.name)}
                          class="p-2 text-gray-400 hover:text-gray-300 rounded-lg hover:bg-gray-700/50 transition-colors duration-200"
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
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </div>

      {/* 認証トークン表示 */}
      <Show when={token()}>
        <div class="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
          <div class="flex items-start space-x-3">
            <svg
              class="w-5 h-5 text-blue-400 mt-0.5"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fill-rule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                clip-rule="evenodd"
              />
            </svg>
            <div class="flex-1">
              <h4 class="text-sm font-medium text-blue-300">認証トークン</h4>
              <p class="text-sm text-blue-200 mt-1 font-mono bg-blue-500/20 px-2 py-1 rounded">
                {token()}
              </p>
              <p class="text-xs text-blue-300 mt-2">
                このトークンをドメインのDNS TXTレコードに追加してください。
              </p>
            </div>{" "}
            <button
              type="button"
              onClick={() => setToken("")}
              class="p-1 text-blue-400 hover:text-blue-300"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>
      </Show>

      {/* ドメイン追加モーダル */}
      <Show when={showAddModal()}>
        <div class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div class="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md">
            <div class="p-6 border-b border-gray-700">
              <div class="flex items-center justify-between">
                <h3 class="text-xl font-semibold text-gray-100">
                  新しいドメインを追加
                </h3>
                <button
                  onClick={() => setShowAddModal(false)}
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

            <div class="p-6 space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-300 mb-2">
                  ドメイン名
                </label>
                <input
                  ref={domainInput!}
                  placeholder="example.com"
                  class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
                <p class="text-xs text-gray-500 mt-1">
                  パッケージ公開に使用するドメインを入力してください
                </p>
              </div>
            </div>

            <div class="p-6 border-t border-gray-700 flex justify-end space-x-3">
              <button
                onClick={() => setShowAddModal(false)}
                class="px-4 py-2 text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors duration-200"
              >
                キャンセル
              </button>{" "}
              <button
                type="button"
                onClick={requestDomain}
                disabled={isLoading()}
                class="px-6 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors duration-200"
              >
                {isLoading() ? "追加中..." : "ドメインを追加"}
              </button>
            </div>
          </div>
        </div>
      </Show>
    </div>
  );
}
