import { createSignal, Show } from "solid-js";

interface PublicNavHeaderProps {
  onLogin: () => void;
}

export default function PublicNavHeader(props: PublicNavHeaderProps) {
  const [showMobileMenu, setShowMobileMenu] = createSignal(false);

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
                <p class="text-xs text-gray-400 -mt-1 hidden sm:block">
                  オープンソースパッケージマネージャー
                </p>
              </div>
            </div>
          </div>

          {/* デスクトップナビゲーション */}
          <nav class="hidden md:flex items-center space-x-6">
            <a
              href="#packages"
              class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium"
            >
              パッケージ
            </a>
            <a
              href="#docs"
              class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium"
            >
              ドキュメント
            </a>
            <a
              href="#api"
              class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium"
            >
              API
            </a>
            <a
              href="#github"
              class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium"
            >
              GitHub
            </a>
          </nav>

          {/* 右側のアクション */}
          <div class="flex items-center space-x-4">
            {/* 統計情報 */}
            <div class="hidden lg:flex items-center space-x-4 text-xs text-gray-500">
              <div class="flex items-center space-x-1">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z" />
                </svg>
                <span>オンライン</span>
              </div>
              <div class="w-px h-4 bg-gray-600"></div>
              <div class="flex items-center space-x-1">
                <svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M10 2L3 8v10h4v-6h6v6h4V8l-7-6z"
                    clip-rule="evenodd"
                  />
                </svg>
                <span>無料で利用可能</span>
              </div>
            </div>

            {/* ログインボタン */}
            <button
              type="button"
              onClick={props.onLogin}
              class="flex items-center space-x-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors duration-200 shadow-sm hover:shadow-md"
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
                  d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                />
              </svg>
              <span class="hidden sm:inline">ログイン</span>
            </button>

            {/* モバイルメニューボタン */}
            <button
              type="button"
              onClick={() => setShowMobileMenu(!showMobileMenu())}
              class="md:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
            >
              <svg
                class="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* モバイルメニュー */}
        <Show when={showMobileMenu()}>
          <div class="md:hidden border-t border-gray-800 pt-4 pb-4">
            <nav class="flex flex-col space-y-3">
              <a
                href="#packages"
                class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium py-2"
              >
                パッケージ
              </a>
              <a
                href="#docs"
                class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium py-2"
              >
                ドキュメント
              </a>
              <a
                href="#api"
                class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium py-2"
              >
                API
              </a>
              <a
                href="#github"
                class="text-gray-300 hover:text-white transition-colors duration-200 text-sm font-medium py-2"
              >
                GitHub
              </a>
            </nav>
          </div>
        </Show>
      </div>
    </header>
  );
}
