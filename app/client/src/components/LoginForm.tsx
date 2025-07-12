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

  const handleAddServer = () => {
    const url = serverUrl().trim();
    if (!url) return;
    addServer(url);
    setServers(getServers());
  };

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    setError("");

    if (inTauri) {
      if (!serverUrl()) {
        setError("サーバーURLを入力してください");
        return;
      }
      setApiBase(serverUrl());
      addServer(serverUrl());
      setActiveServer(serverUrl());
    }

    if (!loginPassword()) {
      setError("ログイン用パスワードを入力してください");
      return;
    }

    setIsLoading(true);

    try {
      const res = await apiFetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: loginPassword(),
        }),
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
              <div>
                <label
                  for="serverSelect"
                  class="block text-sm font-medium text-gray-300 mb-2"
                >
                  サーバー選択
                </label>
                <select
                  id="serverSelect"
                  value={serverUrl()}
                  onChange={(e) => setServerUrl(e.currentTarget.value)}
                  class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-2"
                >
                  <option value="">-- 新規サーバー --</option>
                  <For each={servers()}>
                    {(s) => <option value={s}>{s}</option>}
                  </For>
                </select>
                <input
                  type="text"
                  id="serverUrl"
                  value={serverUrl()}
                  onInput={(e) => setServerUrl(e.currentTarget.value)}
                  class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500 transition-colors"
                  placeholder="http://example.com"
                />
                <button
                  type="button"
                  class="mt-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                  onClick={handleAddServer}
                >
                  サーバー追加
                </button>
              </div>
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
