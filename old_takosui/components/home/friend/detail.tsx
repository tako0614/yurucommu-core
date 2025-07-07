import { useAtom } from "solid-jotai";
import { createEffect, createSignal } from "solid-js";
import { homeSelectedAtom } from "../home";
import { encrypted, friendDetailId } from "./friend";
import { TakosFetch } from "../../../utils/TakosFetch";

export function FriendDetail() {
  const [selected, setSelected] = useAtom(homeSelectedAtom);
  const [friendDetails, setFriendDetails] = createSignal<{
    nickName: string;
    icon: string;
    friendId: string;
  }>({ nickName: "", icon: "", friendId: "" });

  // 友だち情報を取得
  createEffect(async () => {
    const friendId = friendDetailId();
    if (!friendId) return;

    try {
      const host = friendId.split("@")[1];
      const [iconResponse, nickNameResponse] = await Promise.all([
        TakosFetch(`https://${host}/_takos/v1/user/${friendId}/icon`),
        TakosFetch(`https://${host}/_takos/v1/user/${friendId}/nickName`),
      ]);

      const iconData = await iconResponse.json();
      const nickNameData = await nickNameResponse.json();

      setFriendDetails({
        nickName: nickNameData.nickName,
        icon: iconData.icon,
        friendId: friendId,
      });
    } catch (error) {
      console.error("友だち詳細取得エラー:", error);
    }
  });

  return (
    <>
      <div class="flex items-center justify-between p-4">
        <button
          class="text-blue-400 hover:text-blue-300 transition-colors"
          onClick={() => setSelected("friends")}
        >
          戻る
        </button>
        <h2 class="font-bold text-xl">友だち詳細</h2>
        <div class="w-10"></div> {/* バランス用の空要素 */}
      </div>

      <div class="p-4">
        <div class="p-4 bg-gray-800/70 border border-gray-700 rounded-lg">
          <div class="flex items-center gap-4">
            <img
              src={`data:image/png;base64,${friendDetails().icon}`}
              alt="icon"
              class="w-20 h-20 rounded-full object-cover border-2 border-gray-700"
            />
            <div>
              <h3 class="text-xl font-bold mb-1">{friendDetails().nickName}</h3>
              <p class="text-sm text-blue-400">{friendDetails().friendId}</p>
            </div>
          </div>

          <div class="mt-6 space-y-3">
            <button class="w-full p-3 bg-blue-600 rounded-md hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"
                />
              </svg>
              チャットを開始
            </button>

            {!encrypted().includes(friendDetailId()!) && (
              <button
                onClick={() => setSelected("friend:verify")}
                class="w-full p-3 bg-green-600/80 rounded-md hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
                鍵の検証
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
