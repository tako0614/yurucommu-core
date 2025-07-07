import { useAtom } from "solid-jotai";
import { selectedTabState } from "../../../utils/room/settingRoomState";
import { selectedRoomState } from "../../../utils/room/roomState";
import { TakosFetch } from "../../../utils/TakosFetch";

export function GroupSettingLeave() {
  const [selected, setSelected] = useAtom(selectedTabState);
  const [selectedRoom] = useAtom(selectedRoomState);
  return (
    <>
      {selected() === "leave" && (
        <>
          {/*戻るボタン*/}
          <div class="flex flex-col w-full p-4">
            <div
              class="flex items-center cursor-pointer mb-6 text-blue-400 hover:text-blue-300 transition-colors"
              onClick={() => setSelected(false)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5 mr-1"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
                  clip-rule="evenodd"
                />
              </svg>
              <span class="font-medium">戻る</span>
            </div>

            {/* タイトル */}
            <div class="mb-6">
              <h3 class="text-xl font-bold text-white">
                グループから退出
              </h3>
            </div>

            {/* 警告メッセージ */}
            <div class="bg-red-900/30 border border-red-500/30 rounded-lg p-4 mb-6">
              <div class="flex items-start">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-6 w-6 text-red-500 mr-3 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <div>
                  <h4 class="text-lg font-medium text-red-400 mb-1">
                    注意
                  </h4>
                  <p class="text-white">
                    グループから退出すると、このグループのメッセージにアクセスできなくなります。この操作は取り消せません。
                  </p>
                </div>
              </div>
            </div>

            {/* 確認メッセージと操作ボタン */}
            <div class="text-center mb-6">
              <p class="text-white text-lg font-medium mb-6">
                本当にこのグループから退出しますか？
              </p>

              <div class="flex justify-center space-x-4">
                <button
                  class="bg-gray-700 hover:bg-gray-600 text-white px-6 py-2 rounded-md transition-colors"
                  onClick={() => setSelected(false)}
                >
                  キャンセル
                </button>

                <button
                  class="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-md transition-colors flex items-center"
                  onClick={() => {
                    const match = selectedRoom()!.roomid.match(
                      /^g\{([^}]+)\}@(.+)$/,
                    );
                    if (!match) {
                      return;
                    }
                    const friendUserName = match[1];
                    const domainFromRoom = match[2];
                    const res = TakosFetch("/api/v2/group/leave", {
                      method: "POST",
                      headers: {
                        "Content-Type": "application/json",
                      },
                      body: JSON.stringify({
                        groupId: friendUserName + "@" +
                          domainFromRoom,
                      }),
                    });
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-5 w-5 mr-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h6a2 2 0 012 2v1"
                    />
                  </svg>
                  退出する
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
