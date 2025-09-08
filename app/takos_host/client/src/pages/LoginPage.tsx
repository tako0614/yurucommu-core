import { Component, createSignal, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { login as apiLogin } from "../api.ts";
import { loggedInState, passwordState, userNameState, termsRequiredState } from "../state.ts";

const LoginPage: Component = () => {
  const [userName, setUserName] = useAtom(userNameState);
  const [password, setPassword] = useAtom(passwordState);
  const [, setLoggedIn] = useAtom(loggedInState);
  const [error, setError] = createSignal("");
  const [termsRequired] = useAtom(termsRequiredState);
  const [agreed, setAgreed] = createSignal(false);

  // 規約に同意したら短命Cookieをセット（サーバー側の /auth/google/start で検証）
  const onAgreeChange = (checked: boolean) => {
    setAgreed(checked);
    if (checked) {
      // 10分の短命クッキー
      const maxAge = 10 * 60; // seconds
      document.cookie = `terms_agreed=yes; Max-Age=${maxAge}; Path=/; SameSite=Lax`;
    } else {
      // 明示的に削除
      document.cookie = "terms_agreed=; Max-Age=0; Path=/; SameSite=Lax";
    }
  };

  return (
    <div class="min-h-screen flex flex-col bg-[#181818] text-gray-100">
      <main class="flex-grow flex items-center justify-center px-4 py-12">
        <div class="w-full max-w-md bg-[#212121] p-8 rounded-lg shadow-xl">
          <div class="mb-8 text-center">
            <h2 class="text-3xl font-semibold mb-2 text-white">
              takos host ログイン
            </h2>
            <p class="text-gray-400 text-sm">Google アカウントでログインしてください</p>
          </div>
          <div class="space-y-6">
            <Show when={termsRequired()}>
              <div>
                <label class="inline-flex items-center gap-2 text-sm text-gray-300">
                  <input
                    type="checkbox"
                    class="h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded"
                    checked={agreed()}
                    onChange={(e) => onAgreeChange((e.currentTarget as HTMLInputElement).checked)}
                  />
                  <span>
                    利用規約に同意します（
                    <a href="/terms" target="_blank" class="text-blue-400 hover:underline">規約を開く</a>
                    ）
                  </span>
                </label>
              </div>
            </Show>
            <a
              href="/auth/google/start"
              class="w-full inline-flex items-center justify-center gap-2 bg-white text-gray-900 py-3 px-4 rounded-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition-colors duration-200 disabled:opacity-50 disabled:pointer-events-none"
              aria-disabled={termsRequired() && !agreed()}
              onClick={(e) => {
                if (termsRequired() && !agreed()) {
                  e.preventDefault();
                }
              }}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 48 48"
                class="w-5 h-5"
              >
                <path
                  fill="#FFC107"
                  d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12 s5.373-12,12-12c3.059,0,5.842,1.154,7.938,3.062l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24 s8.955,20,20,20s20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"
                />
                <path
                  fill="#FF3D00"
                  d="M6.306,14.691l6.571,4.818C14.655,16.108,18.961,13,24,13c3.059,0,5.842,1.154,7.938,3.062 l5.657-5.657C34.046,6.053,29.268,4,24,4C16.318,4,9.59,8.337,6.306,14.691z"
                />
                <path
                  fill="#4CAF50"
                  d="M24,44c5.166,0,9.86-1.977,13.409-5.193l-6.191-5.238C29.211,35.091,26.715,36,24,36 c-5.192,0-9.607-3.317-11.27-7.946l-6.522,5.024C9.423,39.556,16.13,44,24,44z"
                />
                <path
                  fill="#1976D2"
                  d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.094,5.569 c0.001-0.001,0.002-0.001,0.003-0.002l6.191,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"
                />
              </svg>
              Google でログイン
            </a>
          </div>
        </div>
      </main>
      <footer class="py-6 border-t border-gray-700 text-center">
        <a href="/" class="text-gray-400 hover:text-gray-200">戻る</a>
      </footer>
    </div>
  );
};

export default LoginPage;
