import { createMemo, createSignal, For, Show } from "solid-js";
import { isUrl } from "../../utils/url.ts";
import type { Room } from "./types.ts";

interface FriendRoomListProps {
  rooms: Room[];
  friendId: string;
  friendName: string;
  selectedRoom: string | null;
  onSelectRoom: (roomId: string) => void;
  onBack: () => void;
  onCreateRoom: () => void;
}

export function FriendRoomList(props: FriendRoomListProps) {
  const [query, setQuery] = createSignal("");

  // 選択された友達とのトークルームを取得
  const friendRooms = createMemo(() => {
    return props.rooms.filter((room) => {
      const members = (room.members ?? []).map(normalizeHandle).filter((
        v,
      ): v is string => !!v);
      if (members.includes(props.friendId)) return true;
      // members が未補完のときは、ID が friendId と一致する 1:1 とみなす
      const rid = normalizeHandle(room.id);
      if (members.length === 0 && rid && rid === props.friendId) return true;
      return false;
    });
  });

  function normalizeHandle(id?: string): string | undefined {
    if (!id) return undefined;
    if (id.startsWith("http")) {
      try {
        const u = new URL(id);
        const name = u.pathname.split("/").pop() || "";
        if (!name) return undefined;
        return `${name}@${u.hostname}`;
      } catch {
        return undefined;
      }
    }
    if (id.includes("@")) return id;
    // 裸の文字列はハンドルとみなさない
    return undefined;
  }

  const filteredRooms = createMemo(() => {
    const q = query().toLowerCase().trim();
    const base = friendRooms();
    const byQuery = !q
      ? base
      : base.filter((r) =>
        r.name.toLowerCase().includes(q) ||
        (r.lastMessage ?? "").toLowerCase().includes(q)
      );
    const time = (d?: Date) => (d ? d.getTime() : 0);
    return byQuery.sort((a, b) => {
      const ua = a.unreadCount || 0;
      const ub = b.unreadCount || 0;
      if (ua !== ub) return ub - ua;
      const ta = time(a.lastMessageTime);
      const tb = time(b.lastMessageTime);
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name);
    });
  });

  return (
    <div class="h-full flex flex-col">
      {/* ヘッダー */}
      <div class="p-3 border-b border-[#333] flex items-center">
        <button
          type="button"
          class="mr-3 p-1 rounded hover:bg-[#3c3c3c]"
          onClick={props.onBack}
        >
          <svg
            class="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div class="flex-1">
          <h2 class="text-white font-medium">{props.friendName}とのトーク</h2>
        </div>
        <button
          type="button"
          class="px-2 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
          onClick={props.onCreateRoom}
        >
          ＋ 新しいトーク
        </button>
      </div>

      {/* 検索バー */}
      <div class="p-3">
        <input
          type="text"
          placeholder="トークを検索..."
          class="w-full outline-none border-none font-normal p-2 px-3 rounded-lg bg-[#3c3c3c] text-white placeholder-[#aaaaaa]"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>

      {/* トークルームリスト */}
      <div class="flex-1 overflow-y-auto px-3">
        <Show when={filteredRooms().length === 0}>
          <div class="text-center py-8">
            <div class="w-16 h-16 bg-[#2a2a2a] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                class="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <h3 class="text-lg font-medium text-white mb-2">
              トークがありません
            </h3>
            <p class="text-gray-400 text-sm mb-4">
              {props.friendName}との新しいトークを始めましょう
            </p>
            <button
              type="button"
              class="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-700"
              onClick={props.onCreateRoom}
            >
              新しいトークを作成
            </button>
          </div>
        </Show>

        <div class="space-y-2 pb-4">
          <For each={filteredRooms()}>
            {(room) => (
              <div
                class={`flex items-center cursor-pointer p-3 rounded-lg transition-colors ${
                  props.selectedRoom === room.id
                    ? "bg-[#4a4a4a]"
                    : "hover:bg-[#3c3c3c]"
                }`}
                onClick={() => props.onSelectRoom(room.id)}
              >
                <div class="relative w-10 h-10 flex items-center justify-center">
                  {isUrl(room.avatar) ||
                      (typeof room.avatar === "string" &&
                        room.avatar.startsWith("data:image/"))
                    ? (
                      <img
                        src={room.avatar}
                        alt="avatar"
                        class="w-10 h-10 object-cover rounded-full"
                      />
                    )
                    : (
                      <div class="w-10 h-10 flex items-center justify-center rounded-full text-white bg-[#444]">
                        {room.avatar || room.name.charAt(0).toUpperCase() ||
                          "👥"}
                      </div>
                    )}
                </div>

                <div class="ml-3 flex-1 min-w-0">
                  <div class="flex justify-between items-center w-full">
                    <p class="text-white text-sm font-medium truncate flex-1">
                      {room.name || "無題のトーク"}
                    </p>
                    <span class="text-xs text-gray-500 ml-2 whitespace-nowrap">
                      {room.lastMessageTime
                        ? room.lastMessageTime.toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                        : ""}
                    </span>
                  </div>
                  <div class="flex justify-between items-center">
                    <p class="text-gray-400 text-xs truncate flex-1">
                      {room.lastMessage || "メッセージがありません"}
                    </p>
                    <Show when={room.unreadCount > 0}>
                      <span class="ml-2 inline-block text-xs px-1.5 py-0.5 rounded-full bg-blue-600 text-white">
                        {room.unreadCount}
                      </span>
                    </Show>
                  </div>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
