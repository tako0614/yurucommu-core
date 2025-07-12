import { createSignal, Show } from "solid-js";

interface AddServerFormProps {
  onAdd: (url: string, password: string) => Promise<void>;
  onClose: () => void;
}

export function AddServerForm(props: AddServerFormProps) {
  const [url, setUrl] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [error, setError] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    setError("");
    if (!url()) {
      setError("サーバーURLを入力してください");
      return;
    }
    if (!password()) {
      setError("パスワードを入力してください");
      return;
    }
    setIsLoading(true);
    await props.onAdd(url().trim(), password());
    setIsLoading(false);
    setUrl("");
    setPassword("");
  };

  return (
    <div
      class="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-[#212121] p-8 rounded-lg shadow-xl w-full max-w-md z-50 text-gray-100"
      style="box-shadow: 0 8px 32px rgba(0,0,0,0.35);"
    >
      <div class="mb-8 text-center">
        <h2 class="text-2xl font-semibold mb-2 text-white">サーバー追加</h2>
      </div>
      <form onSubmit={handleSubmit} class="space-y-6">
        <div>
          <label
            for="addServerUrl"
            class="block text-sm font-medium text-gray-300 mb-2"
          >
            サーバーURL
          </label>
          <input
            type="text"
            id="addServerUrl"
            value={url()}
            onInput={(e) => setUrl(e.currentTarget.value)}
            class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
            placeholder="http://example.com"
            disabled={isLoading()}
          />
        </div>
        <div>
          <label
            for="addServerPassword"
            class="block text-sm font-medium text-gray-300 mb-2"
          >
            パスワード
          </label>
          <input
            type="password"
            id="addServerPassword"
            value={password()}
            onInput={(e) => setPassword(e.currentTarget.value)}
            class="w-full px-4 py-3 bg-gray-700 border border-gray-600 rounded-md text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 placeholder-gray-500"
            placeholder="パスワード"
            disabled={isLoading()}
          />
        </div>
        <Show when={error()}>
          <p class="text-red-400 text-sm font-medium bg-red-900/30 p-3 rounded-md">
            {error()}
          </p>
        </Show>
        <div class="flex justify-end space-x-2">
          <button
            type="button"
            class="bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
            onClick={props.onClose}
            disabled={isLoading()}
          >
            閉じる
          </button>
          <button
            type="submit"
            class="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed"
            disabled={isLoading()}
          >
            {isLoading() ? "追加中..." : "追加"}
          </button>
        </div>
      </form>
    </div>
  );
}
