import { Component } from "solid-js";

const NotificationsContent: Component = () => {
  return (
    <div class="space-y-8 animate-in slide-in-from-bottom-4 duration-500">
      {/* ヘッダーセクション */}
      <div class="text-center space-y-2">
        <h2 class="text-3xl font-bold text-gray-100">通知センター</h2>
        <p class="text-gray-400 max-w-2xl mx-auto">
          システムからの重要な通知やアップデート情報を確認できます
        </p>
      </div>

      <div class="bg-gradient-to-br from-[#1a1a1a] to-[#161616] rounded-2xl shadow-xl border border-gray-800/50 overflow-hidden">
        <div class="p-6 border-b border-gray-800/50">
          <div class="flex items-center justify-between">
            <h3 class="text-xl font-semibold text-gray-100">最近の通知</h3>
            <button
              type="button"
              class="text-teal-400 hover:text-teal-300 text-sm font-medium transition-colors duration-200"
            >
              すべてをクリア
            </button>
          </div>
        </div>

        <div class="divide-y divide-gray-800/50">
          <div class="p-6 hover:bg-gray-800/20 transition-colors duration-200 border-l-4 border-teal-500">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 bg-teal-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  class="w-5 h-5 text-teal-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-2">
                  <h4 class="text-lg font-semibold text-gray-100">
                    システム通知
                  </h4>
                  <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                    今日 12:30
                  </span>
                </div>
                <p class="text-gray-300 text-sm leading-relaxed">
                  システムがアップデートされました。最新の機能をご利用いただけます。
                </p>
              </div>
            </div>
          </div>

          <div class="p-6 hover:bg-gray-800/20 transition-colors duration-200 border-l-4 border-green-500">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  class="w-5 h-5 text-green-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-2">
                  <h4 class="text-lg font-semibold text-gray-100">
                    タスク完了
                  </h4>
                  <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                    今日 09:15
                  </span>
                </div>
                <p class="text-gray-300 text-sm leading-relaxed">
                  データバックアップが正常に完了しました。
                </p>
              </div>
            </div>
          </div>

          <div class="p-6 hover:bg-gray-800/20 transition-colors duration-200 border-l-4 border-amber-500">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  class="w-5 h-5 text-amber-400"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                  />
                </svg>
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-2">
                  <h4 class="text-lg font-semibold text-gray-100">警告</h4>
                  <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                    昨日 18:45
                  </span>
                </div>
                <p class="text-gray-300 text-sm leading-relaxed">
                  ディスク容量が90%を超えています。不要なファイルの削除を検討してください。
                </p>
              </div>
            </div>
          </div>

          <div class="p-6 hover:bg-gray-800/20 transition-colors duration-200 border-l-4 border-rose-500">
            <div class="flex items-start space-x-4">
              <div class="w-10 h-10 bg-rose-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                <svg
                  class="w-5 h-5 text-rose-400"
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
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-2">
                  <h4 class="text-lg font-semibold text-gray-100">
                    エラー通知
                  </h4>
                  <span class="text-xs text-gray-400 bg-gray-800/50 px-2 py-1 rounded-full">
                    3日前
                  </span>
                </div>
                <p class="text-gray-300 text-sm leading-relaxed">
                  拡張機能「拡張機能3」でエラーが発生しました。
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="p-6 border-t border-gray-800/50">
          <button
            type="button"
            class="w-full py-3 px-4 text-sm font-medium text-gray-400 hover:text-gray-200 bg-transparent hover:bg-gray-800/30 border border-gray-600/30 hover:border-gray-500/50 rounded-xl transition-all duration-200"
          >
            すべての通知を表示
          </button>
        </div>
      </div>
    </div>
  );
};

export default NotificationsContent;
