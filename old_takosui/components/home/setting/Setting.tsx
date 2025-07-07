import { useAtom } from "solid-jotai";
import { homeSelectedAtom } from "../home";

export function Settings() {
  const [selected, setSelected] = useAtom(homeSelectedAtom);
  return (
    <>
      <div class="flex items-center justify-between p-4">
        <button
          class="text-blue-400 hover:text-blue-300 transition-colors"
          onClick={() => setSelected(null)}
        >
          戻る
        </button>
        <h2 class="font-bold text-xl">設定</h2>
        <div class="w-10"></div> {/* バランス用の空要素 */}
      </div>

      <div class="p-4">
        <ul class="space-y-3">
          <li
            class="p-4 bg-[#1e1e1e] rounded-lg hover:bg-gray-700 transition-all cursor-pointer border border-gray-700 hover:border-gray-600 hover:translate-y-[-2px]"
            onClick={() => setSelected("settings:profile")}
          >
            <div class="flex items-center gap-3">
              <span class="text-blue-400 bg-blue-500/10 p-2 rounded-lg">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z"
                    clip-rule="evenodd"
                  />
                </svg>
              </span>
              <div>
                <div class="font-medium">プロフィール</div>
                <div class="text-xs text-gray-400">
                  名前、アイコン、自己紹介を編集
                </div>
              </div>
            </div>
          </li>
          <li
            class="p-4 bg-[#1e1e1e] rounded-lg hover:bg-gray-700 transition-all cursor-pointer border border-gray-700 hover:border-gray-600 hover:translate-y-[-2px]"
            onClick={() => setSelected("settings:keys")}
          >
            <div class="flex items-center gap-3">
              <span class="text-blue-400 bg-blue-500/10 p-2 rounded-lg">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M18 8a6 6 0 01-7.743 5.743L10 14l-1 1-1 1H6v2H2v-4l4.257-4.257A6 6 0 1118 8zm-6-4a1 1 0 100 2 2 2 0 012 2 1 1 0 102 0 4 4 0 00-4-4z"
                    clip-rule="evenodd"
                  />
                </svg>
              </span>
              <div>
                <div class="font-medium">鍵の管理</div>
                <div class="text-xs text-gray-400">
                  暗号化キーの確認と再生成
                </div>
              </div>
            </div>
          </li>
          <li
            class="p-4 bg-[#1e1e1e] rounded-lg hover:bg-gray-700 transition-all cursor-pointer border border-gray-700 hover:border-gray-600 hover:translate-y-[-2px]"
            onClick={() => setSelected("settings:account")}
          >
            <div class="flex items-center gap-3">
              <span class="text-blue-400 bg-blue-500/10 p-2 rounded-lg">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                    clip-rule="evenodd"
                  />
                </svg>
              </span>
              <div>
                <div class="font-medium">アカウント</div>
                <div class="text-xs text-gray-400">
                  セッション管理、ログアウト、退会
                </div>
              </div>
            </div>
          </li>
        </ul>
      </div>
    </>
  );
}
