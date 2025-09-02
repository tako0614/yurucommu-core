import { Component, createSignal, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { login as apiLogin } from "../api.ts";
import { loggedInState, passwordState, userNameState } from "../state.ts";

const LoginPage: Component = () => {
  const [userName, setUserName] = useAtom(userNameState);
  const [password, setPassword] = useAtom(passwordState);
  const [, setLoggedIn] = useAtom(loggedInState);
  const [error, setError] = createSignal("");

  const login = async (e: SubmitEvent) => {
    e.preventDefault();
    const res = await apiLogin(userName(), password());
    if (res.success) {
      setLoggedIn(true);
      globalThis.location.href = res.redirect ?? "/user";
    } else {
      setError("ログインに失敗しました");
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
            <p class="text-gray-400 text-sm">管理画面へログイン</p>
          </div>
          <form onSubmit={login} class="space-y-6">
            <div>
              <label
                for="userName"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                ユーザー名
              </label>
              <input
                id="userName"
                placeholder="ユーザー名"
                value={userName()}
                onInput={(e) => setUserName(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                required
              />
            </div>
            <div>
              <label
                for="password"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                パスワード
              </label>
              <input
                type="password"
                id="password"
                placeholder="パスワード"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
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
              class="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition-colors duration-200"
            >
              ログイン
            </button>
            <p class="text-sm text-center mt-6">
              アカウントをお持ちでない方は
              <a href="/signup" class="text-blue-400 hover:underline ml-1">
                新規登録
              </a>
            </p>
            <div class="flex items-center gap-2 my-2">
              <div class="h-px bg-gray-600 flex-1" />
              <span class="text-gray-400 text-xs">または</span>
              <div class="h-px bg-gray-600 flex-1" />
            </div>
            <a
              href="/auth/google/start"
              class="w-full inline-flex items-center justify-center gap-2 bg-white text-gray-900 py-3 px-4 rounded-md hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition-colors duration-200"
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
          </form>
        </div>
      </main>
      <footer class="py-6 border-t border-gray-700 text-center">
        <a href="/" class="text-gray-400 hover:text-gray-200">戻る</a>
      </footer>
    </div>
  );
};

export default LoginPage;
