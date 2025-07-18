import { Component, createSignal, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { verify as apiVerify } from "../api.ts";
import { loggedInState, userNameState } from "../state.ts";

const VerifyPage: Component = () => {
  const [userName] = useAtom(userNameState);
  const [, setLoggedIn] = useAtom(loggedInState);
  const [code, setCode] = createSignal("");
  const [error, setError] = createSignal("");

  const submit = async (e: SubmitEvent) => {
    e.preventDefault();
    if (await apiVerify(userName(), code())) {
      setLoggedIn(true);
      globalThis.location.href = "/user";
    } else {
      setError("確認に失敗しました");
    }
  };

  return (
    <div class="min-h-screen flex flex-col bg-[#181818] text-gray-100">
      <main class="flex-grow flex items-center justify-center px-4 py-12">
        <div class="w-full max-w-md bg-[#212121] p-8 rounded-lg shadow-xl">
          <div class="mb-8 text-center">
            <h2 class="text-3xl font-semibold mb-2 text-white">メール確認</h2>
            <p class="text-gray-400 text-sm">確認コードを入力してください</p>
          </div>
          <form onSubmit={submit} class="space-y-6">
            <div>
              <label
                for="code"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                確認コード
              </label>
              <input
                id="code"
                placeholder="123456"
                value={code()}
                onInput={(e) => setCode(e.currentTarget.value)}
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
              送信
            </button>
          </form>
        </div>
      </main>
      <footer class="py-6 border-t border-gray-700 text-center">
        <a href="/" class="text-gray-400 hover:text-gray-200">戻る</a>
      </footer>
    </div>
  );
};

export default VerifyPage;
