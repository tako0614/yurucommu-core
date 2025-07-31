import { For, Show } from "solid-js";
import { GoogleAd } from "../GoogleAd.tsx";
import { isUrl } from "../../utils/url.ts";
import type { ChatRoom } from "./types.ts";

interface ChatRoomListProps {
  rooms: ChatRoom[];
  selectedRoom: string | null;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onStartLongPress: (id: string) => void;
  onCancelLongPress: () => void;
  showAds: boolean;
}

export function ChatRoomList(props: ChatRoomListProps) {
  return (
    <div class="min-h-screen p-3 pb-[76px] bg-[#1e1e1e] z-[3] w-screen lg:w-[360px] lg:flex-none lg:shrink-0 lg:border-r lg:border-[#333333]">
      <div class="text-[32px] mt-[6px] mx-[3px] mb-[12px] font-bold text-white">
        チャット
      </div>
      <div class="block">
        <input
          type="text"
          placeholder="チャンネルを検索..."
          class="w-full outline-none border-none font-normal p-2 px-3 rounded-lg bg-[#3c3c3c] text-white placeholder-[#aaaaaa]"
        />
        <Show when={props.showAds}>
          <div class="my-2">
            <GoogleAd />
          </div>
        </Show>
      </div>
      <div class="my-[10px] overflow-y-auto overflow-x-hidden w-full pb-14 scrollbar">
        <ul class="w-full h-[calc(100vh-120px)] pb-[70px] scrollbar">
          <For each={props.rooms}>
            {(room) => (
              <li
                class={`flex items-center cursor-pointer h-16 rounded-lg mb-2 w-full ${
                  props.selectedRoom === room.id
                    ? "bg-[#4a4a4a]"
                    : "hover:bg-[#3c3c3c]"
                }`}
                onClick={() => props.onSelect(room.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  props.onRemove(room.id);
                }}
                onTouchStart={() => props.onStartLongPress(room.id)}
                onTouchEnd={props.onCancelLongPress}
                onTouchMove={props.onCancelLongPress}
                onTouchCancel={props.onCancelLongPress}
              >
                <div class="flex items-center w-full">
                  <span class="relative block h-full aspect-square flex items-center justify-center w-[40px] h-[40px]">
                    {isUrl(room.avatar) ||
                        (typeof room.avatar === "string" &&
                          room.avatar.startsWith("data:image/"))
                      ? (
                        <img
                          src={room.avatar}
                          alt="avatar"
                          class="w-[40px] h-[40px] object-cover rounded-full"
                        />
                      )
                      : (
                        <span
                          class={`w-[40px] h-[40px] flex items-center justify-center rounded-full text-white text-[20px] ${
                            room.type === "memo" ? "bg-green-600" : "bg-[#444]"
                          }`}
                        >
                          {room.avatar}
                        </span>
                      )}
                  </span>
                  <span class="pl-[10px] flex flex-col justify-center min-w-0 w-full">
                    <span class="text-[14px] text-white flex justify-between items-center w-full whitespace-nowrap overflow-hidden text-ellipsis">
                      <span class="font-bold flex-1">
                        {room.name}
                      </span>
                      <span
                        class="text-[10px] text-gray-500 ml-1 whitespace-nowrap"
                        style="text-align:right;"
                      >
                        {room.lastMessageTime
                          ? room.lastMessageTime.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                          : ""}
                      </span>
                    </span>
                    <span class="text-[12px] text-[#aaaaaa] font-normal flex justify-between items-center">
                      <p class="truncate">{room.lastMessage}</p>
                    </span>
                  </span>
                </div>
              </li>
            )}
          </For>
        </ul>
      </div>
    </div>
  );
}
