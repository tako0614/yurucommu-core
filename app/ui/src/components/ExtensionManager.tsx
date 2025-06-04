// 拡張機能管理UI (SolidJS)

import { Component, createEffect, createSignal, For, Show } from "solid-js";

type Extension = {
  id: string;
  name: string;
  identifier: string;
  version: string;
  apiVersion: string;
  description?: string;
  author?: string;
  permissions: string[];
  enabled: boolean;
  manifest: {
    name: string;
    identifier: string;
    apiVersion: string;
    permissions: string[];
    activityPub?: unknown;
    eventDefinitions?: Record<string, unknown>;
    description?: string;
  };
};

type ExtensionManagerProps = {
  onBack?: () => void;
};

export const ExtensionManagerComponent: Component<ExtensionManagerProps> = (
  props,
) => {
  const [extensions, setExtensions] = createSignal<Extension[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [errorMessage, setErrorMessage] = createSignal<string>("");
  const [successMessage, setSuccessMessage] = createSignal<string>("");
  const [uploadingFile, setUploadingFile] = createSignal<File | null>(null);

  // 拡張機能一覧を取得
  const loadExtensions = async () => {
    try {
      setLoading(true);
      setErrorMessage("");

      const response = await fetch("/api/extensions");
      const result = await response.json();

      if (result.success) {
        setExtensions(result.extensions || []);
      } else {
        setErrorMessage(result.error || "拡張機能の取得に失敗しました");
      }
    } catch (error) {
      console.error("Failed to load extensions:", error);
      setErrorMessage("拡張機能の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  };

  // 拡張機能のインストール
  const installExtension = async (file: File) => {
    try {
      setLoading(true);
      setErrorMessage("");
      setSuccessMessage("");

      const formData = new FormData();
      formData.append("extension", file);

      const response = await fetch("/api/extensions/install", {
        method: "POST",
        body: formData,
      });
      const result = await response.json();

      if (result.success) {
        setSuccessMessage("拡張機能をインストールしました");
        await loadExtensions(); // 一覧を再読み込み
      } else {
        setErrorMessage(result.error || "インストールに失敗しました");
      }
    } catch (error) {
      console.error("Failed to install extension:", error);
      setErrorMessage("インストールに失敗しました");
    } finally {
      setLoading(false);
      setUploadingFile(null);
    }
  };

  // 拡張機能のアンインストール
  const uninstallExtension = async (extensionId: string) => {
    try {
      setLoading(true);
      setErrorMessage("");
      setSuccessMessage("");

      const response = await fetch(`/api/extensions/${extensionId}`, {
        method: "DELETE",
      });
      const result = await response.json();

      if (result.success) {
        setSuccessMessage("拡張機能をアンインストールしました");
        await loadExtensions(); // 一覧を再読み込み
      } else {
        setErrorMessage(result.error || "アンインストールに失敗しました");
      }
    } catch (error) {
      console.error("Failed to uninstall extension:", error);
      setErrorMessage("アンインストールに失敗しました");
    } finally {
      setLoading(false);
    }
  };

  // 拡張機能の有効/無効切り替え
  const toggleExtension = async (extensionId: string, enabled: boolean) => {
    try {
      setErrorMessage("");
      setSuccessMessage("");

      const response = await fetch(`/api/extensions/${extensionId}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const result = await response.json();

      if (result.success) {
        setSuccessMessage(
          enabled ? "拡張機能を有効にしました" : "拡張機能を無効にしました",
        );
        await loadExtensions(); // 一覧を再読み込み
      } else {
        setErrorMessage(result.error || "切り替えに失敗しました");
      }
    } catch (error) {
      console.error("Failed to toggle extension:", error);
      setErrorMessage("切り替えに失敗しました");
    }
  };

  // ファイル選択処理
  const handleFileSelect = (event: Event) => {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file && file.name.endsWith(".takopack")) {
      setUploadingFile(file);
    } else {
      setErrorMessage(".takopackファイルを選択してください");
    }
  };

  // ファイルインストール実行
  const handleInstall = () => {
    const file = uploadingFile();
    if (file) {
      installExtension(file);
    }
  };

  // メッセージ表示
  const _showMessage = (message: string, isError = false) => {
    if (isError) {
      setErrorMessage(message);
      setSuccessMessage("");
      setTimeout(() => setErrorMessage(""), 5000);
    } else {
      setSuccessMessage(message);
      setErrorMessage("");
      setTimeout(() => setSuccessMessage(""), 3000);
    }
  };

  // 初期化
  createEffect(() => {
    loadExtensions();
  });

  return (
    <div class="min-h-screen bg-[#0a0a0a] text-white">
      <div class="max-w-6xl mx-auto p-6">
        {/* ヘッダー */}
        <div class="flex items-center justify-between mb-6">
          <div class="flex items-center space-x-4">
            <button
              type="button"
              onClick={props.onBack}
              class="flex items-center space-x-2 text-gray-300 hover:text-white transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              <span>戻る</span>
            </button>
            <h1 class="text-2xl font-bold">拡張機能管理</h1>
          </div>

          <div class="flex items-center space-x-3">
            <input
              type="file"
              accept=".takopack"
              onChange={handleFileSelect}
              class="hidden"
              id="extension-file"
            />
            <label
              for="extension-file"
              class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-md cursor-pointer transition-colors"
            >
              ファイルを選択
            </label>
            <Show when={uploadingFile()}>
              <button
                type="button"
                onClick={handleInstall}
                disabled={loading()}
                class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white rounded-md transition-colors"
              >
                インストール
              </button>
            </Show>
          </div>
        </div>

        {/* メッセージ表示 */}
        <Show when={errorMessage()}>
          <div class="mb-4 p-4 bg-red-900/50 border border-red-500 rounded-md">
            <p class="text-red-200">{errorMessage()}</p>
          </div>
        </Show>

        <Show when={successMessage()}>
          <div class="mb-4 p-4 bg-green-900/50 border border-green-500 rounded-md">
            <p class="text-green-200">{successMessage()}</p>
          </div>
        </Show>

        {/* 選択されたファイル表示 */}
        <Show when={uploadingFile()}>
          <div class="mb-4 p-4 bg-gray-800 rounded-md">
            <p class="text-gray-300">
              選択されたファイル:{" "}
              <span class="text-white">{uploadingFile()?.name}</span>
            </p>
          </div>
        </Show>

        {/* ローディング */}
        <Show when={loading()}>
          <div class="text-center py-8">
            <div class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-teal-500">
            </div>
            <p class="mt-2 text-gray-400">読み込み中...</p>
          </div>
        </Show>

        {/* 拡張機能一覧 */}
        <Show when={!loading()}>
          <div class="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <For each={extensions()}>
              {(extension) => (
                <div class="bg-[#181918] rounded-lg border border-gray-700 p-5">
                  <div class="flex items-start justify-between mb-3">
                    <div>
                      <h3 class="text-lg font-semibold text-white">
                        {extension.manifest.name}
                      </h3>
                      <p class="text-sm text-gray-400">
                        v{extension.version}
                      </p>
                    </div>
                    <span
                      class={`px-2 py-1 text-xs rounded-full ${
                        extension.enabled
                          ? "bg-green-900 text-green-200"
                          : "bg-gray-700 text-gray-300"
                      }`}
                    >
                      {extension.enabled ? "有効" : "無効"}
                    </span>
                  </div>

                  <Show when={extension.manifest.description}>
                    <p class="text-sm text-gray-300 mb-3">
                      {extension.manifest.description}
                    </p>
                  </Show>

                  <div class="mb-3">
                    <p class="text-xs text-gray-500 mb-1">権限:</p>
                    <div class="flex flex-wrap gap-1">
                      <For each={extension.manifest.permissions}>
                        {(permission) => (
                          <span class="px-2 py-1 text-xs bg-gray-700 text-gray-300 rounded">
                            {permission}
                          </span>
                        )}
                      </For>
                    </div>
                  </div>

                  <div class="flex space-x-2">
                    <button
                      type="button"
                      onClick={() =>
                        toggleExtension(extension.id, !extension.enabled)}
                      disabled={loading()}
                      class={`flex-1 px-3 py-2 text-sm rounded-md transition-colors disabled:opacity-50 ${
                        extension.enabled
                          ? "bg-yellow-600 hover:bg-yellow-700 text-white"
                          : "bg-teal-600 hover:bg-teal-700 text-white"
                      }`}
                    >
                      {extension.enabled ? "無効化" : "有効化"}
                    </button>
                    <button
                      type="button"
                      onClick={() => uninstallExtension(extension.id)}
                      disabled={loading()}
                      class="px-3 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-md transition-colors"
                    >
                      削除
                    </button>
                  </div>
                </div>
              )}
            </For>
          </div>

          <Show when={extensions().length === 0}>
            <div class="text-center py-12">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="mx-auto h-12 w-12 text-gray-500 mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
              <p class="text-gray-400">
                インストールされた拡張機能はありません
              </p>
              <p class="text-sm text-gray-500 mt-2">
                .takopackファイルを選択してインストールしてください
              </p>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
};

export { ExtensionManagerComponent as ExtensionManager };
export default ExtensionManagerComponent;
