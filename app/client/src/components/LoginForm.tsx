import { createSignal, onMount, Show } from "solid-js";
import { TauriLogin } from "./TauriLogin.tsx";
import {
  addServer,
  apiFetch,
  getOrigin,
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
  const inTauri = isTauri();
  const [oauthHost, setOauthHost] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const res = await apiFetch("/api/config");
      if (res.ok) {
        const data = await res.json();
        setOauthHost(data.oauthHost ?? null);
      }
    } catch {
      // ignore
    }
  });

  onMount(() => {
    if (inTauri) {
      setServerUrl("");
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

  const handleLogin = async (e: Event) => {
    e.preventDefault();
    await loginToServer(serverUrl(), loginPassword());
  };

  const loginWithOAuth = () => {
    if (!oauthHost()) return;
    const base = oauthHost()?.startsWith("http")
      ? oauthHost()
      : `https://${oauthHost()}`;
    const redirect = getOrigin();
    const url = `${base}/oauth/authorize?client_id=${
      encodeURIComponent(redirect)
    }&redirect_uri=${encodeURIComponent(redirect)}`;
    globalThis.location.href = url;
  };

  return (
    <>
      {isTauri()
        ? <TauriLogin onLoginSuccess={props.onLoginSuccess} />
        : (
          <div class="min-h-screen flex flex-col bg-[#181818] text-gray-100">
            <main class="flex-grow flex items-center justify-center px-4 py-12">
              <div class="w-full max-w-md bg-[#212121] p-8 rounded-lg shadow-xl">
                <div class="mb-8 text-center">
                  <h2 class="text-3xl font-semibold mb-2 text-white">
                    ようこそ
                  </h2>
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
                  <Show when={oauthHost()}>
                    <button
                      type="button"
                      onClick={loginWithOAuth}
                      class="w-full bg-green-600 text-white py-3 px-4 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-800"
                    >
                      OAuthでログイン
                    </button>
                  </Show>
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
        )}
    </>
  );
}
