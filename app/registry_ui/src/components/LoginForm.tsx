import { createSignal, Show } from "solid-js";
import { req } from "../api.ts";

export default function LoginForm(props: { onAuthed: () => void }) {
  const [email, setEmail] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [isLoading, setIsLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [isRegisterMode, setIsRegisterMode] = createSignal(false);

  const login = async () => {
    if (!email() || !password()) {
      setError("メールアドレスとパスワードを入力してください");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      await req("/api/login", "POST", { email: email(), password: password() });
      props.onAuthed();
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
      setError("メールアドレスとパスワードを入力してください");
      return;
    }

    setIsLoading(true);
    setError("");

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
    <div class="min-h-screen bg-gray-900 flex items-center justify-center px-4 py-12">
      <div class="w-full max-w-md">
        {/* ロゴとタイトル */}
        <div class="text-center mb-8">
          <div class="mx-auto w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-xl">
            <span class="text-white font-bold text-2xl">🐙</span>
          </div>
          <h2 class="text-3xl font-bold gradient-text">Takopack Registry</h2>
          <p class="text-gray-400 mt-2">
            {isRegisterMode()
              ? "新しいアカウントを作成"
              : "アカウントにログイン"}
          </p>
        </div>

        {/* フォーム */}
        <div class="bg-gray-800/50 backdrop-blur-sm border border-gray-700/50 rounded-2xl p-8 shadow-xl">
          <form onSubmit={handleSubmit} class="space-y-6">
            <div>
              <label class="block text-sm font-medium text-gray-300 mb-2">
                メールアドレス
              </label>
              <input
                type="email"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                placeholder="your@email.com"
                disabled={isLoading()}
                class="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors duration-200 disabled:opacity-50"
                required
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
                disabled={isLoading()}
                class="w-full px-4 py-3 bg-gray-700/50 border border-gray-600 rounded-lg text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-colors duration-200 disabled:opacity-50"
                required
              />
            </div>

            <Show when={error()}>
              <div class="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
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
                  <p class="text-red-300 text-sm">{error()}</p>
                </div>
              </div>
            </Show>

            <button
              type="submit"
              disabled={isLoading()}
              class="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white font-medium rounded-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg hover:shadow-xl flex items-center justify-center space-x-2"
            >
              <Show when={isLoading()}>
                <div class="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin">
                </div>
              </Show>
              <span>
                {isLoading()
                  ? "処理中..."
                  : (isRegisterMode() ? "アカウントを作成" : "ログイン")}
              </span>
            </button>
          </form>

          {/* モード切替 */}
          <div class="mt-6 text-center">
            <button
              type="button"
              onClick={() => {
                setIsRegisterMode(!isRegisterMode());
                setError("");
              }}
              class="text-purple-400 hover:text-purple-300 text-sm font-medium transition-colors duration-200"
            >
              {isRegisterMode()
                ? "既にアカウントをお持ちですか？ログイン"
                : "アカウントをお持ちでない方は新規登録"}
            </button>
          </div>
        </div>

        {/* フッター */}
        <div class="mt-8 text-center">
          <p class="text-gray-500 text-sm">
            Takopack Registry - パッケージ管理システム
          </p>
        </div>
      </div>
    </div>
  );
}
