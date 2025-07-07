import { useAtom } from "solid-jotai";
import { selectedRoomState } from "../../../utils/room/roomState";
import {
  isLoadingRequestsState,
  joinRequestsState,
  selectedTabState,
} from "../../../utils/room/settingRoomState";
import { groupChannelState } from "../../sidebar/SideBar";
import { For } from "solid-js";
import { TakosFetch } from "../../../utils/TakosFetch";

export function GroupSettingRequest() {
  const [selectedRoom] = useAtom(selectedRoomState);
  const [selected, setSelected] = useAtom(selectedTabState);
  const [groupChannel, setGroupChannel] = useAtom(groupChannelState);

  const [joinRequests, setJoinRequests] = useAtom(joinRequestsState);
  const [isLoadingRequests, setIsLoadingRequests] = useAtom(
    isLoadingRequestsState,
  );
  return (
    <>
      {selected() === "request" && (
        <>
          <div class="flex flex-col w-full p-4">
            {/* 戻るボタン - 変更なし */}
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
              <h3 class="text-xl font-bold text-white">
                参加リクエスト
              </h3>
              <div
                class="bg-blue-600 hover:bg-blue-700 text-white px-2 py-1 rounded text-sm cursor-pointer"
                onClick={async () => {
                  // リクエスト一覧を再読み込み
                  const match = selectedRoom()!.roomid.match(
                    /^g\{([^}]+)\}@(.+)$/,
                  );
                  if (!match) return;

                  setJoinRequests([]);
                  setIsLoadingRequests(true);

                  try {
                    const res = await TakosFetch(
                      `https://${match[2]}/_takos/v1/group/requests/${
                        match[1] + "@" + match[2]
                      }`,
                    );

                    if (res.ok) {
                      const data = await res.json();
                      setJoinRequests(data.requests || []);
                    }
                  } catch (error) {
                    console.error(
                      "参加リクエストの取得に失敗しました",
                      error,
                    );
                  } finally {
                    setIsLoadingRequests(false);
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
              グループへの参加をリクエストしているユーザーの一覧です。リクエストを承認または拒否できます。
            </p>

            {/* リクエスト一覧 - ユーザーIDのみの配列に対応 */}
            <div class="mt-2 w-full max-h-80 overflow-y-auto pr-1 custom-scrollbar">
              {isLoadingRequests()
                ? (
                  <div class="flex justify-center items-center py-10">
                    <div class="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-blue-500">
                    </div>
                  </div>
                )
                : joinRequests().length > 0
                ? (
                  <For each={joinRequests()}>
                    {(userId) => (
                      <div class="bg-gray-800 rounded-lg mb-3 overflow-hidden hover:bg-gray-750 transition-colors">
                        <div class="p-3 flex justify-between items-center">
                          <div class="flex items-center space-x-3">
                            {/* ユーザーアバター */}
                            <div class="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-bold">
                              {userId.charAt(0).toUpperCase()}
                            </div>

                            {/* ユーザー情報 - 日時情報なし */}
                            <div class="flex flex-col">
                              <span class="text-white font-medium break-all">
                                {userId}
                              </span>
                            </div>
                          </div>

                          {/* アクションボタン */}
                          <div class="flex space-x-2">
                            <button
                              class="bg-green-500 hover:bg-green-600 text-white px-3 py-1.5 rounded flex items-center transition-colors"
                              onClick={async () => {
                                const match = selectedRoom()!.roomid
                                  .match(/^g\{([^}]+)\}@(.+)$/);
                                if (!match) return;

                                try {
                                  const res = await TakosFetch(
                                    "/api/v2/group/join/accept",
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
                                    setJoinRequests((prev) =>
                                      prev.filter((id) => id !== userId)
                                    );

                                    // メンバーリストを更新
                                    const friendUserName = match[1];
                                    const domainFromRoom = match[2];
                                    const baseUrl =
                                      `https://${domainFromRoom}/_takos/v1/group`;

                                    const members = await TakosFetch(
                                      `${baseUrl}/members/${
                                        friendUserName + "@" +
                                        domainFromRoom
                                      }`,
                                    ).then((res) => res.json());

                                    setGroupChannel((pre) => ({
                                      ...pre!,
                                      members: members.members,
                                    }));
                                  } else {
                                    alert(
                                      "リクエストの承認に失敗しました",
                                    );
                                  }
                                } catch (error) {
                                  console.error(
                                    "リクエスト承認中にエラーが発生しました",
                                    error,
                                  );
                                  alert(
                                    "リクエスト承認中にエラーが発生しました",
                                  );
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
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                              承認
                            </button>

                            <button
                              class="bg-red-500 hover:bg-red-600 text-white px-3 py-1.5 rounded flex items-center transition-colors"
                              onClick={async () => {
                                const match = selectedRoom()!.roomid
                                  .match(/^g\{([^}]+)\}@(.+)$/);
                                if (!match) return;

                                try {
                                  const res = await TakosFetch(
                                    "/_takos/v1/group/requests/reject",
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
                                    setJoinRequests((prev) =>
                                      prev.filter((id) => id !== userId)
                                    );
                                  } else {
                                    alert(
                                      "リクエストの拒否に失敗しました",
                                    );
                                  }
                                } catch (error) {
                                  console.error(
                                    "リクエスト拒否中にエラーが発生しました",
                                    error,
                                  );
                                  alert(
                                    "リクエスト拒否中にエラーが発生しました",
                                  );
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
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                              拒否
                            </button>
                          </div>
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
                        d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
                      />
                    </svg>
                    <p>現在、参加リクエストはありません</p>
                  </div>
                )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
