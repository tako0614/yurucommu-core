import { Component, createSignal, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { register as apiRegister } from "../api.ts";
import {
  emailState,
  loggedInState,
  passwordState,
  termsRequiredState,
  userNameState,
} from "../state.ts";

const RegisterPage: Component = () => {
  const [userName, setUserName] = useAtom(userNameState);
  const [email, setEmail] = useAtom(emailState);
  const [password, setPassword] = useAtom(passwordState);
  const [, setLoggedIn] = useAtom(loggedInState);
  const [termsRequired] = useAtom(termsRequiredState);
  const [agreed, setAgreed] = createSignal(false);
  const [error, setError] = createSignal("");

  const signup = async (e: SubmitEvent) => {
    e.preventDefault();
    if (await apiRegister(userName(), email(), password(), agreed())) {
      setLoggedIn(false);
      globalThis.location.href = "/verify";
    } else {
      setError("登録に失敗しました");
    }
  };

  return (
    <div class="min-h-screen flex flex-col bg-[#181818] text-gray-100">
      <main class="flex-grow flex items-center justify-center px-4 py-12">
        <div class="w-full max-w-md bg-[#212121] p-8 rounded-lg shadow-xl">
          <div class="mb-8 text-center">
            <h2 class="text-3xl font-semibold mb-2 text-white">新規登録</h2>
            <p class="text-gray-400 text-sm">takos host アカウント作成</p>
          </div>
          <form onSubmit={signup} class="space-y-6">
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
                for="email"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                メールアドレス
              </label>
              <input
                id="email"
                type="email"
                placeholder="example@example.com"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
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
            <Show when={termsRequired}>
              <div class="flex items-center">
                <input
                  id="agree"
                  type="checkbox"
                  checked={agreed()}
                  onChange={(e) => setAgreed(e.currentTarget.checked)}
                  class="h-4 w-4 text-blue-600 bg-gray-700 border-gray-600 rounded"
                />
                <label for="agree" class="ml-2 text-sm text-gray-300">
                  <a
                    href="/terms"
                    class="text-blue-400 hover:underline"
                    target="_blank"
                  >
                    利用規約
                  </a>
                  に同意します
                </label>
              </div>
            </Show>
            <Show when={error()}>
              <p class="text-red-400 text-sm font-medium bg-red-900/30 p-3 rounded-md">
                {error()}
              </p>
            </Show>
            <button
              type="submit"
              disabled={termsRequired && !agreed()}
              class="w-full bg-blue-600 text-white py-3 px-4 rounded-md hover:bg-blue-700 disabled:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-800 transition-colors duration-200"
            >
              登録
            </button>
          </form>
          <p class="mt-6 text-sm text-center">
            既にアカウントをお持ちの方は
            <a href="/auth" class="text-blue-400 hover:underline ml-1">
              ログイン
            </a>
          </p>
        </div>
      </main>
      <footer class="py-6 border-t border-gray-700 text-center">
        <a href="/" class="text-gray-400 hover:text-gray-200">戻る</a>
      </footer>
    </div>
  );
};

export default RegisterPage;
