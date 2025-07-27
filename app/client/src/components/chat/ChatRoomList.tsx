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
    <div class="p-talk-list min-h-screen">
      <div class="p-talk-list-title">チャット</div>
      <div class="p-talk-list-search">
        <input type="text" placeholder="チャンネルを検索..." />
        <Show when={props.showAds}>
          <div class="my-2">
            <GoogleAd />
          </div>
        </Show>
      </div>
      <div class="p-talk-list-rooms pb-14 scrollbar">
        <ul class="p-talk-list-rooms__ul h-[calc(100vh-120px)] pb-[70px] scrollbar">
          <For each={props.rooms}>
            {(room) => (
              <li
                class={`c-talk-rooms ${
                  props.selectedRoom === room.id ? "is-active" : ""
                } flex items-center cursor-pointer`}
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
                  <span
                    class="c-talk-rooms-icon"
                    style="display: flex; align-items: center; justify-content: center; width: 40px; height: 40px;"
                  >
                    {isUrl(room.avatar) ||
                        (typeof room.avatar === "string" &&
                          room.avatar.startsWith("data:image/"))
                      ? (
                        <img
                          src={room.avatar}
                          alt="avatar"
                          style={{
                            width: "40px",
                            height: "40px",
                            "object-fit": "cover",
                            "border-radius": "50%",
                          }}
                        />
                      )
                      : (
                        <span
                          style={{
                            width: "40px",
                            height: "40px",
                            display: "flex",
                            "align-items": "center",
                            "justify-content": "center",
                            background: room.type === "memo"
                              ? "#16a34a"
                              : "#444",
                            color: "#fff",
                            "border-radius": "50%",
                            "font-size": "20px",
                          }}
                        >
                          {room.avatar}
                        </span>
                      )}
                  </span>
                  <span class="c-talk-rooms-box w-full">
                    <span class="c-talk-rooms-name flex justify-between items-center w-full">
                      <span class="c-talk-rooms-nickname" style="flex:1;">
                        {room.name}
                      </span>
                      <span
                        class="c-talk-rooms-time text-xs text-gray-500 whitespace-nowrap"
                        style="margin-left:auto; text-align:right;"
                      >
                        {room.lastMessageTime
                          ? room.lastMessageTime.toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                          : ""}
                      </span>
                    </span>
                    <span class="c-talk-rooms-msg flex justify-between items-center">
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
