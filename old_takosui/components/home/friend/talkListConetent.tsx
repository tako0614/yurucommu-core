import { useAtom } from "solid-jotai";
import { createEffect, createSignal, onMount } from "solid-js";
import { homeSelectedAtom } from "../home";
import { encrypted, setFriendDetailId } from "./friend";
import {
  getCachedEntityInfo,
  TakosFetchEntityInfo,
} from "../../../utils/chache/Icon";

export function TalkListFriend({
  friendId,
}: {
  friendId: string;
}) {
  const [selected, setSelected] = useAtom(homeSelectedAtom);
  const [nickName, setNickName] = createSignal("");
  const [icon, setIcon] = createSignal("");

  onMount(async () => {
    try {
      // まずキャッシュを確認
      const cachedInfo = getCachedEntityInfo(friendId);

      if (cachedInfo) {
        // キャッシュが存在する場合はそれを使用
        cachedInfo.then((info) => {
          setNickName(info.nickName);
          setIcon(info.icon);
        });
      } else {
        // キャッシュがない場合は新たに取得
        const domain = friendId.split("@")[1];
        const info = await TakosFetchEntityInfo(friendId, domain, "friend");
        setNickName(info.nickName);
        setIcon(info.icon);
      }
    } catch (error) {
      console.error(`Failed to load info for ${friendId}:`, error);
      // エラー時はIDをそのまま表示
      setNickName(friendId);
    }
  });

  return (
    <div
      class="flex flex-wrap items-center gap-3 p-2 rounded-lg transition-colors hover:bg-[#282828]"
      onClick={() => {
        // モーダルを開く代わりに状態を変更
        setFriendDetailId(friendId);
        setSelected("friend:detail");
      }}
    >
      <img
        src={icon()}
        alt="icon"
        class="w-12 h-12 rounded-full object-cover flex-shrink-0"
      />
      <div class="flex-1 min-w-0">
        <div class="font-semibold text-lg truncate">
          {nickName()}
        </div>
        <div class="text-xs text-gray-400 truncate">
          {friendId}
        </div>
      </div>
      {encrypted().includes(friendId) && (
        <span class="text-gray-400 flex-shrink-0">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            class="w-6 h-6"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 11c-2.21 0-4 1.79-4 4v1h8v-1c0-2.21-1.79-4-4-4z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M8 11V7a4 4 0 118 0v4"
            />
          </svg>
        </span>
      )}
    </div>
  );
}
