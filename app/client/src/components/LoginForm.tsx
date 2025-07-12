import { createSignal, For, onMount, Show } from "solid-js";
import {
  addServer,
  apiFetch,
  getActiveServer,
  getApiBase,
  getServers,
  isTauri,
  setActiveServer,
  setApiBase,
} from "../utils/config.ts";

interface LoginFormProps {
  onLoginSuccess: () => void;
}

export function LoginForm(props: LoginFormProps) {
  const [loginPassword, setLoginPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [serverUrl, setServerUrl] = createSignal("");
  const [servers, setServers] = createSignal<string[]>([]);
  const [showAdd, setShowAdd] = createSignal(false);
  const [newServerUrl, setNewServerUrl] = createSignal("");
  const [newServerPassword, setNewServerPassword] = createSignal("");
  const inTauri = isTauri();

  onMount(() => {
    if (inTauri) {
      setServers(getServers());
      const active = getActiveServer();
      if (active) {
        setServerUrl(active);
        setApiBase(active);
      } else {
        setServerUrl(getApiBase());
      }
    }
  });

  const loginToServer = async (url: string, password: string) => {
    setError("");
    if (!url) {
      setError("サーバーURLを入力してください");
      return;
    }
    if (!password) {
      setError("ログイン用パスワードを入力してください");
      return;
    }
    setApiBase(url);
    addServer(url);
    setActiveServer(url);
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const results = await res.json();
      if (results.success) {
        props.onLoginSuccess();
      } else {
        setError(results.error || "ログインに失敗しました");
      }
    } catch (err) {
      console.error("Login request failed:", err);
      setError("通信エラーが発生しました");
    } finally {
      setIsLoading(false);
    }
  };
  const handleAddServer = async () => {
    await loginToServer(newServerUrl().trim(), newServerPassword());
    setServers(getServers());
    setShowAdd(false);
    setNewServerUrl("");
    setNewServerPassword("");
  };

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    await loginToServer(serverUrl(), loginPassword());
  };

  return (
    <div class="min-h-screen flex flex-col bg-[#181818] text-gray-100">
      <main class="flex-grow flex items-center justify-center px-4 py-12">
        <div class="w-full max-w-md bg-[#212121] p-8 rounded-lg shadow-xl">
          <div class="mb-8 text-center">
            <h2 class="text-3xl font-semibold mb-2 text-white">ようこそ</h2>
            <p class="text-gray-400">
              ActivityPubでWeb自主するためのソフトウェア
            </p>
          </div>

          <div class="mb-8">
            <p class="text-gray-400 text-sm leading-relaxed">
              1人のユーザーが他のユーザーとコミュニケーションを取るためのActivityPubに対応したソフトウェアです。シンプルで使いやすいインターフェースを提供します。
            </p>
          </div>

          <form onSubmit={handleLogin} class="space-y-6">
            <Show when={inTauri}>
              <div class="space-y-2">
                <For each={servers()}>
                  {(s) => (
                    <button
                      type="button"
                      class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-left hover:bg-gray-600"
                      onClick={() => loginToServer(s, loginPassword())}
                    >
                      {s}
                    </button>
                  )}
                </For>
              </div>
              <Show when={showAdd()}>
                <div class="fixed bottom-0 left-0 right-0 bg-[#212121] p-4 border-t border-gray-700 space-y-2">
                  <input
                    type="text"
                    value={newServerUrl()}
                    onInput={(e) => setNewServerUrl(e.currentTarget.value)}
                    class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                    placeholder="http://example.com"
                  />
                  <input
                    type="password"
                    value={newServerPassword()}
                    onInput={(e) => setNewServerPassword(e.currentTarget.value)}
                    class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                    placeholder="パスワード"
                  />
                  <div class="flex justify-end space-x-2">
                    <button
                      type="button"
                      class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                      onClick={handleAddServer}
                    >
                      追加
                    </button>
                    <button
                      type="button"
                      class="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
                      onClick={() => setShowAdd(false)}
                    >
                      閉じる
                    </button>
                  </div>
                </div>
              </Show>
              <button
                type="button"
                class="fixed bottom-4 right-4 bg-green-600 text-white p-3 rounded-full hover:bg-green-700"
                onClick={() => setShowAdd(true)}
              >
                ＋
              </button>
            </Show>
            <div>
              <label
                for="loginPassword"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                ログイン用パスワード
              </label>
              <input
                type="password"
                id="loginPassword"
                value={loginPassword()}
                onInput={(e) => setLoginPassword(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500 transition-colors"
                disabled={isLoading()}
                placeholder="パスワードを入力"
                required
              />
            </div>
            <Show when={error()}>
              <p class="text-red-400 text-sm font-medium bg-red-900/30 p-3 rounded-md">
                {error()}
              </p>
            </Show>
            <button
              type="submit"
              class="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition-colors duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center"
              disabled={isLoading()}
            >
              {isLoading() && (
                <svg
                  class="animate-spin -ml-1 mr-3 h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    class="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    stroke-width="4"
                  >
                  </circle>
                  <path
                    class="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  >
                  </path>
                </svg>
              )}
              {isLoading() ? "ログイン処理中..." : "ログイン"}
            </button>
          </form>
        </div>
      </main>

      <footer class="py-6 border-t border-gray-700">
        <div class="container mx-auto px-4 text-center">
          <p class="text-gray-500 text-sm">
            © 2023 takos. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
