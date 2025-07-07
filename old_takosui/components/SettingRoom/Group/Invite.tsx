import { useAtom } from "solid-jotai";
import { For, Show } from "solid-js";
import {
  friendListState,
  selectedTabState,
} from "../../../utils/room/settingRoomState";
import { selectedRoomState } from "../../../utils/room/roomState";
import { TakosFetch } from "../../../utils/TakosFetch";

export function GroupSettingInvite() {
  const [selected, setSelected] = useAtom(selectedTabState);
  const [friendList, setFriendList] = useAtom(friendListState);
  const [selectedRoom] = useAtom(selectedRoomState);
  return (
    <>
      {selected() === "invite" && (
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
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-xl font-bold text-white">友達を招待</h3>
              <span class="bg-gray-700 text-gray-300 px-2 py-1 rounded text-sm">
                {friendList().length} 人
              </span>
            </div>

            {/* 検索バー */}
            <div class="mb-5">
              <div class="relative">
                <input
                  type="text"
                  class="w-full bg-gray-700 text-white px-4 py-2 pl-10 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="招待するユーザー名を入力してください"
                />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5 absolute left-3 top-2.5 text-gray-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fill-rule="evenodd"
                    d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                    clip-rule="evenodd"
                  />
                </svg>
              </div>
            </div>

            {/* 招待リスト */}
            <div class="mt-3 w-full max-h-72 overflow-y-auto pr-1 custom-scrollbar">
              <For each={friendList()}>
                {(friend) => (
                  <div class="bg-gray-800 rounded-lg mb-3 overflow-hidden hover:bg-gray-750 transition-colors">
                    <div class="p-3 flex justify-between items-center">
                      <div class="flex items-center space-x-3">
                        {/* ユーザーアバター */}
                        <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
                          {friend.charAt(0).toUpperCase()}
                        </div>

                        {/* ユーザー名 */}
                        <span class="text-white font-medium break-all">
                          {friend}
                        </span>
                      </div>

                      <button
                        class="bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-md transition-colors flex items-center space-x-1"
                        onClick={() => {
                          const match = selectedRoom()!.roomid.match(
                            /^g\{([^}]+)\}@(.+)$/,
                          );
                          if (!match) {
                            return;
                          }
                          const friendUserName = match[1];
                          const domainFromRoom = match[2];
                          const res = TakosFetch("/api/v2/group/invite", {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                            },
                            body: JSON.stringify({
                              groupId: friendUserName + "@" +
                                domainFromRoom,
                              userId: friend,
                            }),
                          });
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 7a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1V7z" />
                        </svg>
                        <span>招待</span>
                      </button>
                    </div>
                  </div>
                )}
              </For>

              {/* 友達が見つからない場合 */}
              <Show when={friendList().length === 0}>
                <div class="flex flex-col items-center justify-center py-8 text-gray-400">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    class="h-12 w-12 mb-2"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"
                    />
                  </svg>
                  <p>招待可能なユーザーが見つかりません</p>
                </div>
              </Show>
            </div>
          </div>
        </>
      )}
    </>
  );
}
