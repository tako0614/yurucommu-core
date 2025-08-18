import { createSignal, Show } from "solid-js";
import { apiFetch } from "../utils/config.ts";

interface SystemSetupFormProps {
  onSuccess: () => void;
}

export function SystemSetupForm(props: SystemSetupFormProps) {
  const [password, setPassword] = createSignal("");
  const [password2, setPassword2] = createSignal("");
  const [domain, setDomain] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");
    if (!password() || password().length < 8) {
      setError("パスワードは8文字以上で入力してください");
      return;
    }
    if (password() !== password2()) {
      setError("パスワードが一致しません");
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiFetch("/api/system/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          password: password(),
          domain: domain().trim() || undefined,
        }),
      });
      const data = await res.json();
      if (data.success) {
        props.onSuccess();
      } else {
        setError(data.error || "セットアップに失敗しました");
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
              システム初期設定
            </h2>
            <p class="text-gray-400 text-sm">
              ログイン用パスワードとドメインを設定します。
            </p>
          </div>
          <form onSubmit={handleSubmit} class="space-y-6">
            <div>
              <label
                for="sysDomain"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                ドメイン名（任意）
              </label>
              <input
                id="sysDomain"
                type="text"
                value={domain()}
                onInput={(e) => setDomain(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                placeholder="example.com"
                disabled={isLoading()}
              />
              <p class="mt-1 text-xs text-gray-400">
                未入力の場合は既存設定を使用します
              </p>
            </div>
            <div>
              <label
                for="sysPass"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                ログイン用パスワード
              </label>
              <input
                id="sysPass"
                type="password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                placeholder="8文字以上で入力"
                disabled={isLoading()}
              />
            </div>
            <div>
              <label
                for="sysPass2"
                class="block text-sm font-medium text-gray-300 mb-2"
              >
                パスワード（確認）
              </label>
              <input
                id="sysPass2"
                type="password"
                value={password2()}
                onInput={(e) => setPassword2(e.currentTarget.value)}
                class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
                placeholder="もう一度入力"
                disabled={isLoading()}
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
              {isLoading() ? "設定中..." : "保存"}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
