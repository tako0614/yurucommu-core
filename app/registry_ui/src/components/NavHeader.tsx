import { createSignal, Show } from "solid-js";

interface NavHeaderProps {
  isAuthenticated: boolean;
  onLogout?: () => void;
  onPublish?: () => void;
}

export default function NavHeader(props: NavHeaderProps) {
  const [showUserMenu, setShowUserMenu] = createSignal(false);

  return (
    <header class="bg-gray-900/95 backdrop-blur-sm border-b border-gray-800 sticky top-0 z-50">
      <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div class="flex justify-between items-center h-16">
          {/* ロゴとタイトル */}
          <div class="flex items-center space-x-4">
            <div class="flex items-center space-x-3">
              <div class="w-8 h-8 bg-gradient-to-br from-purple-500 to-blue-600 rounded-lg flex items-center justify-center">
                <span class="text-white font-bold text-lg">🐙</span>
              </div>
              <div>
                <h1 class="text-xl font-bold gradient-text">
                  Takopack Registry
                </h1>
                <p class="text-xs text-gray-400 -mt-1">
                  パッケージマネージャー
                </p>
              </div>
            </div>
          </div>

          {/* ナビゲーション */}
          <nav class="hidden md:flex items-center space-x-6">
            <a
              href="#"
              class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium"
            >
              ホーム
            </a>
            <a
              href="#"
              class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium"
            >
              パッケージ
            </a>
            <a
              href="#"
              class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium"
            >
              ドキュメント
            </a>
            <a
              href="#"
              class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium"
            >
              サポート
            </a>
          </nav>

          {/* 右側のアクション */}
          <div class="flex items-center space-x-4">
            <Show when={props.isAuthenticated}>
              <button
                type="button"
                onClick={props.onPublish}
                class="hidden sm:flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors duration-200 shadow-sm hover:shadow-md"
              >
                <svg
                  class="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 4v16m8-8H4"
                  />
                </svg>
                <span>パッケージを公開</span>
              </button>

              <div class="relative">
                <button
                  type="button"
                  onClick={() => setShowUserMenu(!showUserMenu())}
                  class="flex items-center space-x-2 p-2 rounded-lg hover:bg-gray-800 transition-colors duration-200"
                >
                  <div class="w-8 h-8 bg-gradient-to-br from-green-500 to-teal-600 rounded-full flex items-center justify-center">
                    <svg
                      class="w-4 h-4 text-white"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </div>
                  <svg
                    class="w-4 h-4 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>

                <Show when={showUserMenu()}>
                  <div class="absolute right-0 mt-2 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-lg py-1 z-20">
                    <a
                      href="#"
                      class="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200"
                    >
                      プロフィール
                    </a>
                    <a
                      href="#"
                      class="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200"
                    >
                      マイパッケージ
                    </a>
                    <a
                      href="#"
                      class="block px-4 py-2 text-sm text-gray-300 hover:bg-gray-700 hover:text-white transition-colors duration-200"
                    >
                      設定
                    </a>
                    <hr class="my-1 border-gray-700" />{" "}
                    <button
                      type="button"
                      onClick={props.onLogout}
                      class="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-gray-700 hover:text-red-300 transition-colors duration-200"
                    >
                      ログアウト
                    </button>
                  </div>
                </Show>
              </div>
            </Show>{" "}
            <Show when={!props.isAuthenticated}>
              <button
                type="button"
                class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium"
              >
                ログイン
              </button>
            </Show>
          </div>
        </div>
      </div>
    </header>
  );
}
