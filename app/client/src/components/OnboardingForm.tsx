import { createSignal, Show } from "solid-js";
import { apiFetch } from "../utils/config.ts";

interface OnboardingFormProps {
  onSuccess: () => void;
}

export function OnboardingForm(props: OnboardingFormProps) {
  const [username, setUsername] = createSignal("");
  const [displayName, setDisplayName] = createSignal("");
  const [follow, setFollow] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");
    if (!username()) {
      setError("ユーザー名を入力してください");
      return;
    }
    const name = username().trim();
    if (!/^[-_a-zA-Z0-9]{3,32}$/.test(name)) {
      setError("ユーザー名は英数字/[-,_]で3〜32文字");
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: name,
          displayName: displayName() || name,
          follow: follow().split(",").map((s) => s.trim()).filter(Boolean),
        }),
      });
      const data = await res.json();
      if (data.success) {
        props.onSuccess();
      } else {
        setError(data.error || "初期設定に失敗しました");
      }
    } catch {
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
            <h2 class="text-3xl font-semibold mb-2 text-white">
              アカウント作成
            </h2>
            <p class="text-gray-400 text-sm">
              最初のアカウントを作成し、興味のあるアカウントをフォローしましょう。
            </p>
          </div>
          <form onSubmit={handleSubmit} class="space-y-6">
            <div>
              <label
                for="setupUsername"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                ユーザー名
              </label>
              <input
                id="setupUsername"
                type="text"
                value={username()}
                onInput={(e) => setUsername(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                placeholder="alice"
                disabled={isLoading()}
              />
              <p class="mt-1 text-xs text-gray-400">
                英数字と - _ が利用可能（3〜32文字）
              </p>
            </div>
            <div>
              <label
                for="setupDisplayName"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                表示名(任意)
              </label>
              <input
                id="setupDisplayName"
                type="text"
                value={displayName()}
                onInput={(e) => setDisplayName(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                disabled={isLoading()}
              />
            </div>
            <div>
              <label
                for="setupFollow"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                フォローするユーザー(任意, カンマ区切り)
              </label>
              <input
                id="setupFollow"
                type="text"
                value={follow()}
                onInput={(e) => setFollow(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                disabled={isLoading()}
              />
              <p class="mt-1 text-xs text-gray-400">
                例: https://example.com/users/alice,
                https://remote.social/users/bob
              </p>
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
              {isLoading() ? "設定中..." : "完了"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
