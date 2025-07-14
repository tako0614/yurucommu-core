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
    if (await apiLogin(userName(), password())) {
      setLoggedIn(true);
      globalThis.location.href = "/user";
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
