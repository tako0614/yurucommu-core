import { createSignal, Show } from "solid-js";
import { req } from "../api.ts";

interface LoginFormModalProps {
  onSuccess: () => void;
  onClose: () => void;
}

export default function LoginFormModal(props: LoginFormModalProps) {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [isRegisterMode, setIsRegisterMode] = createSignal(false);
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal("");

  const login = async () => {
    if (!email() || !password()) {
      setError("すべてのフィールドを入力してください");
      return;
    }
    setIsLoading(true);
    try {
      await req("/api/login", "POST", { email: email(), password: password() });
      props.onSuccess();
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : "ログインに失敗しました";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const register = async () => {
    if (!email() || !password()) {
      setError("すべてのフィールドを入力してください");
      return;
    }

    setIsLoading(true);
    try {
      await req("/api/register", "POST", {
        email: email(),
        password: password(),
      });
      setError("");
      alert("登録が完了しました。認証メールをご確認ください。");
      setIsRegisterMode(false);
    } catch (error: unknown) {
      const message = error instanceof Error
        ? error.message
        : "登録に失敗しました";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (isRegisterMode()) {
      register();
    } else {
      login();
    }
  };
  return (
    <div
      class="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && props.onClose) {
          props.onClose();
        }
      }}
    >
      <div class="bg-gray-800 border border-gray-700 rounded-2xl w-full max-w-md shadow-2xl">
        {/* ヘッダー */}
        <div class="p-6 border-b border-gray-700">
          <div class="flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                <span class="text-white font-bold text-lg">🐙</span>
              </div>
              <div>
                <h2 class="text-xl font-bold text-gray-100">
                  {isRegisterMode() ? "アカウント登録" : "ログイン"}
                </h2>
                <p class="text-sm text-gray-400">
                  {isRegisterMode()
                    ? "新しいアカウントを作成"
                    : "既存のアカウントでログイン"}
                </p>
              </div>
            </div>{" "}
            <Show when={props.onClose}>
              <button
                type="button"
                onClick={props.onClose}
                class="p-2 hover:bg-gray-700 rounded-lg transition-colors"
              >
                <svg
                  class="w-5 h-5 text-gray-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </Show>
          </div>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSubmit} class="p-6 space-y-6">
          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              メールアドレス
            </label>
            <input
              type="email"
              value={email()}
              onInput={(e) => setEmail(e.currentTarget.value)}
              placeholder="user@example.com"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors"
              required
              disabled={isLoading()}
            />
          </div>

          <div>
            <label class="block text-sm font-medium text-gray-300 mb-2">
              パスワード
            </label>
            <input
              type="password"
              value={password()}
              onInput={(e) => setPassword(e.currentTarget.value)}
              placeholder="パスワードを入力"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors"
              required
              disabled={isLoading()}
            />
          </div>

          <Show when={error()}>
            <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-3">
              <div class="flex items-center space-x-2">
                <svg
                  class="w-5 h-5 text-red-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fill-rule="evenodd"
                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span class="text-red-300 text-sm">{error()}</span>
              </div>
            </div>
          </Show>

          <button
            type="submit"
            disabled={isLoading()}
            class="w-full flex items-center justify-center space-x-2 px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors duration-200"
          >
            <Show when={isLoading()}>
              <div class="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin">
              </div>
            </Show>
            <span>
              {isLoading()
                ? (isRegisterMode() ? "登録中..." : "ログイン中...")
                : (isRegisterMode() ? "アカウントを登録" : "ログイン")}
            </span>
          </button>
        </form>

        {/* フッター */}
        <div class="p-6 border-t border-gray-700 text-center">
          <button
            type="button"
            onClick={() => {
              setIsRegisterMode(!isRegisterMode());
              setError("");
            }}
            class="text-purple-400 hover:text-purple-300 text-sm transition-colors"
          >
            {isRegisterMode()
              ? "既にアカウントをお持ちですか？ログイン"
              : "アカウントをお持ちでない場合は登録"}
          </button>
        </div>
      </div>
    </div>
  );
}
