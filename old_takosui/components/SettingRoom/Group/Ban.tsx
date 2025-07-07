import { useAtom } from "solid-jotai";
import { selectedRoomState } from "../../../utils/room/roomState";
import {
  bannedUsersState,
  isLoadingBanListState,
  selectedTabState,
} from "../../../utils/room/settingRoomState";
import { For } from "solid-js";
import { TakosFetch } from "../../../utils/TakosFetch";

export function GroupSettingBan() {
  const [selectedRoom] = useAtom(selectedRoomState);
  const [selected, setSelected] = useAtom(selectedTabState);
  const [bannedUsers, setBannedUsers] = useAtom(bannedUsersState);
  const [isLoadingBanList, setIsLoadingBanList] = useAtom(
    isLoadingBanListState,
  );
  return (
    <>
      {selected() === "ban" && (
        <>
          <div class="flex flex-col w-full p-4">
            {/* 戻るボタン */}
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

            {/* ヘッダー */}
            <div class="flex justify-between items-center mb-4">
              <h3 class="text-xl font-bold text-white">BANリスト</h3>
              <div
                class="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-sm cursor-pointer"
                onClick={async () => {
                  // BANリストを再読み込み
                  const match = selectedRoom()!.roomid.match(
                    /^g\{([^}]+)\}@(.+)$/,
                  );
                  if (!match) return;

                  setBannedUsers([]);
                  setIsLoadingBanList(true);

                  try {
                    const res = await TakosFetch(
                      `https://${match[2]}/_takos/v1/group/bans/${match[1]}@${
                        match[2]
                      }`,
                    );

                    if (res.ok) {
                      const data = await res.json();
                      setBannedUsers(data.bans || []);
                    }
                  } catch (error) {
                    console.error(
                      "BANリストの取得に失敗しました",
                      error,
                    );
                  } finally {
                    setIsLoadingBanList(false);
                  }
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 inline-block"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                <span class="ml-1">更新</span>
              </div>
            </div>

            {/* 説明テキスト */}
            <p class="text-gray-400 text-sm mb-4">
              グループからBANされたユーザーの一覧です。BANを解除して再度参加を許可できます。
            </p>

            {/* BANリスト */}
            <div class="mt-2 w-full max-h-80 overflow-y-auto pr-1 custom-scrollbar">
              {isLoadingBanList()
                ? (
                  <div class="flex justify-center items-center py-10">
                    <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500">
                    </div>
                  </div>
                )
                : bannedUsers().length > 0
                ? (
                  <For each={bannedUsers()}>
                    {(userId) => (
                      <div class="bg-gray-800 rounded-lg mb-3 overflow-hidden hover:bg-gray-750 transition-colors">
                        <div class="p-3 flex justify-between items-center">
                          <div class="flex items-center space-x-3">
                            {/* ユーザーアバター */}
                            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-red-500 to-pink-600 flex items-center justify-center text-white font-bold">
                              {userId.charAt(0).toUpperCase()}
                            </div>

                            {/* ユーザー情報 */}
                            <div class="flex flex-col">
                              <span class="text-white font-medium break-all">
                                {userId}
                              </span>
                              <span class="text-xs text-red-400">
                                BANされたユーザー
                              </span>
                            </div>
                          </div>

                          {/* アクションボタン */}
                          <button
                            class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded flex items-center transition-colors"
                            onClick={async () => {
                              const match = selectedRoom()!.roomid
                                .match(/^g\{([^}]+)\}@(.+)$/);
                              if (!match) {
                                return;
                              }

                              if (
                                confirm(
                                  `${userId}のBANを解除してよろしいですか？`,
                                )
                              ) {
                                try {
                                  const res = await TakosFetch(
                                    "/api/v2/group/unban",
                                    {
                                      method: "POST",
                                      headers: {
                                        "Content-Type": "application/json",
                                      },
                                      body: JSON.stringify({
                                        groupId: match[1] + "@" +
                                          match[2],
                                        userId: userId,
                                      }),
                                    },
                                  );

                                  if (res.ok) {
                                    // リストから削除
                                    setBannedUsers((prev) =>
                                      prev.filter((id) => id !== userId)
                                    );
                                    alert(
                                      `${userId}のBANを解除しました`,
                                    );
                                  } else {
                                    alert("BANの解除に失敗しました");
                                  }
                                } catch (error) {
                                  console.error(
                                    "BAN解除中にエラーが発生しました",
                                    error,
                                  );
                                  alert(
                                    "BAN解除中にエラーが発生しました",
                                  );
                                }
                              }
                            }}
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              class="h-4 w-4 mr-1"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                              />
                            </svg>
                            BAN解除
                          </button>
                        </div>
                      </div>
                    )}
                  </For>
                )
                : (
                  <div class="flex flex-col items-center justify-center py-8 text-gray-400 bg-gray-800 rounded-lg">
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
                        d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
                      />
                    </svg>
                    <p>現在、BANされているユーザーはいません</p>
                  </div>
                )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
