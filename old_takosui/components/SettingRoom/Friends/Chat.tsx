import { useAtom } from "solid-jotai";
import { selectedFriendTabState } from "../../../utils/room/settingRoomState";

export function FriendSettingChat() {
  const [selected, setSelected] = useAtom(selectedFriendTabState);

  return (
    <>
      {selected() === "chat" && (
        <div class="p-4">
          <div class="flex items-center mb-4">
            <button
              class="text-white hover:text-gray-300 mr-2"
              onClick={() => setSelected(false)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            <h2 class="text-lg font-medium text-white">チャット設定</h2>
          </div>

          <div class="space-y-4">
            {/* チャット設定のコンテンツがここに入ります */}
            <div class="bg-gray-800 rounded-lg p-4">
              <h3 class="text-white text-md font-medium mb-2">
                メッセージ保存期間
              </h3>
              <select class="w-full bg-gray-700 text-white rounded p-2 border border-gray-600">
                <option value="forever">無期限</option>
                <option value="year">1年</option>
                <option value="month">1ヶ月</option>
                <option value="week">1週間</option>
              </select>
            </div>

            <div class="bg-gray-800 rounded-lg p-4">
              <h3 class="text-white text-md font-medium mb-2">既読設定</h3>
              <div class="flex items-center">
                <input type="checkbox" id="read-receipts" class="mr-3" />
                <label for="read-receipts" class="text-white">
                  既読通知を送信する
                </label>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
