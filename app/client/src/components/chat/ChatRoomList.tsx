import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from "solid-js";
import { GoogleAd } from "../GoogleAd.tsx";
import { isUrl } from "../../utils/url.ts";
import type { Room } from "./types.ts";
import { isFriendRoom, isGroupRoom } from "./types.ts";
import { FriendList } from "./FriendList.tsx";
import { FriendRoomList } from "./FriendRoomList.tsx";

interface ChatRoomListProps {
  rooms: Room[];
  selectedRoom: string | null;
  onSelect: (id: string) => void;
  showAds: boolean;
  onCreateDm: () => void;
  segment: "all" | "people" | "groups";
  onSegmentChange: (seg: "all" | "people" | "groups") => void;
  onCreateFriendDm?: (friendId: string) => void;
}

export function ChatRoomList(props: ChatRoomListProps) {
  const [query, setQuery] = createSignal("");
  const [selectedFriend, setSelectedFriend] = createSignal<string | null>(null);

  // ローカルストレージに最後のセグメントを保存/復元
  onMount(() => {
    const saved = globalThis.localStorage.getItem("chat.seg");
    if (saved === "all" || saved === "people" || saved === "groups") {
      if (saved !== props.segment) props.onSegmentChange(saved);
    }
  });
  createEffect(() => {
    globalThis.localStorage.setItem("chat.seg", props.segment);
  });

  const filteredRooms = createMemo(() => {
    const q = query().toLowerCase().trim();
    let base = props.rooms;
    // Keep はセグメントでは除外（"すべて"のみ表示）
    if (props.segment !== "all") {
      base = base.filter((r) => r.type !== "memo");
    }
    if (props.segment === "people") {
      base = base.filter((r) => isFriendRoom(r));
    } else if (props.segment === "groups") {
      base = base.filter((r) => isGroupRoom(r));
    }
    if (!q) return base;
    return base.filter((r) =>
      r.name.toLowerCase().includes(q) ||
      (r.lastMessage ?? "").toLowerCase().includes(q)
    );
  });

  const segUnread = createMemo(() => {
    const all = props.rooms.reduce((a, r) => a + (r.unreadCount || 0), 0);
    const people = props.rooms.filter((r) => isFriendRoom(r))
      .reduce((a, r) => a + (r.unreadCount || 0), 0);
    const groups = all - people;
    return { all, people, groups };
  });

  const getFriendName = (friendId: string) => {
    const room = props.rooms.find((r) =>
      isFriendRoom(r) && r.members.includes(friendId)
    );
    return room?.name || friendId.split("@")[0] || friendId;
  };

  const changeSeg = (seg: "all" | "people" | "groups") => {
    if (seg === "people") {
      // 友だちタブの場合は友達リストにリセット
      setSelectedFriend(null);
    }
    if (seg !== props.segment) props.onSegmentChange(seg);
  };

  const onKeyDownTabs = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const order: ("all" | "people" | "groups")[] = [
        "all",
        "people",
        "groups",
      ];
      const idx = order.indexOf(props.segment);
      const next = e.key === "ArrowLeft"
        ? order[(idx + order.length - 1) % order.length]
        : order[(idx + 1) % order.length];
      changeSeg(next);
    }
  };

  return (
    <div class="min-h-screen p-3 pb-[76px] bg-[#1e1e1e] z-[3] w-screen lg:w-[360px] lg:flex-none lg:shrink-0 lg:border-r lg:border-[#333333]">
      <div class="flex items-center justify-between">
        <div class="text-[28px] mt-[6px] mx-[3px] mb-[8px] font-bold text-white">
          チャット
        </div>
        <div class="flex gap-2">
          <button
            type="button"
            class="px-2 py-1 rounded bg-blue-600 text-white text-sm"
            onClick={props.onCreateDm}
          >
            ＋ 新しいトーク
          </button>
        </div>
      </div>
      <div
        class="flex gap-1 mb-2"
        role="tablist"
        aria-label="トーク一覧のセグメント"
        onKeyDown={(e) => onKeyDownTabs(e as unknown as KeyboardEvent)}
      >
        {(["all", "people", "groups"] as const).map((seg) => (
          <button
            type="button"
            role="tab"
            id={`tab-${seg}`}
            aria-selected={props.segment === seg}
            aria-controls={`panel-${seg}`}
            class={`flex-1 px-2 py-1 rounded ${
              props.segment === seg
                ? "bg-[#4a4a4a] text-white"
                : "bg-[#2b2b2b] text-gray-300"
            }`}
            onClick={() => changeSeg(seg)}
          >
            {seg === "all"
              ? "すべて"
              : seg === "people"
              ? "友だち"
              : "グループ"}
            <Show when={(segUnread()[seg] ?? 0) > 0}>
              <span class="ml-1 inline-block text-xs px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
                {segUnread()[seg]}
              </span>
            </Show>
          </button>
        ))}
      </div>
      <div class="block">
        <input
          type="text"
          placeholder="トークを検索..."
          class="w-full outline-none border-none font-normal p-2 px-3 rounded-lg bg-[#3c3c3c] text-white placeholder-[#aaaaaa]"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <Show when={props.showAds}>
          <div class="my-2">
            <GoogleAd />
          </div>
        </Show>
      </div>

      {/* 友達タブの場合は専用UI、それ以外は従来のリスト表示 */}
      <Show
        when={props.segment === "people"}
        fallback={
          <div class="my-[10px] overflow-y-auto overflow-x-hidden w-full pb-14 scrollbar">
            <ul
              id={`panel-${props.segment}`}
              role="tabpanel"
              aria-labelledby={`tab-${props.segment}`}
              class="w-full h-[calc(100vh-160px)] pb-[70px] scrollbar"
            >
              <Show when={filteredRooms().length === 0}>
                <li class="text-gray-400 text-sm px-2 py-4">
                  {props.segment === "groups"
                    ? "グループはまだありません。『グループ作成』から始めましょう。"
                    : "トークはありません。"}
                </li>
              </Show>
              <For each={filteredRooms()}>
                {(room) => (
                  <li
                    class={`flex items-center cursor-pointer h-16 rounded-lg mb-2 w-full ${
                      props.selectedRoom === room.id
                        ? "bg-[#4a4a4a]"
                        : "hover:bg-[#3c3c3c]"
                    }`}
                    onClick={() => props.onSelect(room.id)}
                  >
                    <div class="flex items-center w-full">
                      <span class="relative w-[40px] h-[40px] flex items-center justify-center">
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
                                room.type === "memo"
                                  ? "bg-green-600"
                                  : "bg-[#444]"
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
        }
      >
        <Show
          when={selectedFriend()}
          fallback={
            <FriendList
              rooms={props.rooms}
              selectedFriend={selectedFriend()}
              onSelectFriend={setSelectedFriend}
            />
          }
        >
          <FriendRoomList
            rooms={props.rooms}
            friendId={selectedFriend()!}
            friendName={getFriendName(selectedFriend()!)}
            selectedRoom={props.selectedRoom}
            onSelectRoom={props.onSelect}
            onBack={() => setSelectedFriend(null)}
            onCreateRoom={() => props.onCreateFriendDm?.(selectedFriend()!)}
          />
        </Show>
      </Show>
    </div>
  );
}
