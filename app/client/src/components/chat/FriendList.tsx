import { createSignal, Show, For, createMemo } from "solid-js";
import { isUrl } from "../../utils/url.ts";
import type { Room } from "./types.ts";
import { isFriendRoom } from "./types.ts";

interface Friend {
  id: string; // actor ID
  name: string;
  avatar?: string;
  isOnline?: boolean;
  domain?: string;
}

interface FriendListProps {
  rooms: Room[];
  onSelectFriend: (friendId: string) => void;
  selectedFriend?: string | null;
  query?: string; // 親から検索語を受け取る場合に使用
  onQueryChange?: (v: string) => void; // 親に検索語変更を通知する場合に使用
  showSearch?: boolean; // 内部の検索バーを表示するか
}

export function FriendList(props: FriendListProps) {
  const [localQuery, setLocalQuery] = createSignal("");
  const q = () => (props.query !== undefined ? props.query : localQuery());
  const setQuery = (v: string) =>
    props.onQueryChange ? props.onQueryChange(v) : setLocalQuery(v);

  // ルームから友達リストを生成
  const friends = createMemo(() => {
    const friendMap = new Map<string, Friend>();
    const friendRooms = props.rooms.filter(isFriendRoom);
    for (const room of friendRooms) {
      const raw = (room.members && room.members.length > 0)
        ? room.members[0]
        : (room.id.includes("@") ? room.id : undefined);
      const friendId = normalizeHandle(raw);
      if (!friendId) continue;
      if (!friendMap.has(friendId)) {
        friendMap.set(friendId, {
          id: friendId,
          name: room.name || friendId.split("@")[0] || friendId,
          avatar: room.avatar,
          domain: friendId.includes("@") ? friendId.split("@")[1] : undefined,
        });
      }
    }
    // 並び順: 未読合計 → 最終アクティビティ → 名前
    const items = Array.from(friendMap.values());
    const unreadSum = (fid: string) =>
      props.rooms.filter((r) => isFriendRoom(r) && (
        (r.members?.includes(fid)) || (r.members?.length ?? 0) === 0 && r.id === fid
      )).reduce((a, r) => a + (r.unreadCount || 0), 0);
    const lastTime = (fid: string) => {
      let t = 0;
      for (const r of props.rooms) {
        if (!isFriendRoom(r)) continue;
        const match = (r.members?.includes(fid)) || (r.members?.length ?? 0) === 0 && r.id === fid;
        if (!match) continue;
        const ts = r.lastMessageTime ? r.lastMessageTime.getTime() : 0;
        if (ts > t) t = ts;
      }
      return t;
    };
    items.sort((a, b) => {
      const ua = unreadSum(a.id);
      const ub = unreadSum(b.id);
      if (ua !== ub) return ub - ua;
      const ta = lastTime(a.id);
      const tb = lastTime(b.id);
      if (ta !== tb) return tb - ta;
      return a.name.localeCompare(b.name);
    });
    return items;
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

  const filteredFriends = createMemo(() => {
    const qq = q().toLowerCase().trim();
    if (!qq) return friends();
    return friends().filter((f) =>
      f.name.toLowerCase().includes(qq) || f.id.toLowerCase().includes(qq)
    );
  });

  return (
    <div class="h-full flex flex-col">
      {/* 検索バー（必要に応じて非表示可） */}
      <Show when={props.showSearch !== false}>
        <div class="p-3 border-b border-[#333]">
          <input
            type="text"
            placeholder="友だちを検索..."
            class="w-full outline-none border-none font-normal p-2 px-3 rounded-lg bg-[#3c3c3c] text-white placeholder-[#aaaaaa]"
            value={q()}
            onInput={(e) => setQuery(e.currentTarget.value)}
          />
        </div>
      </Show>

      {/* 友達リスト */}
      <div class="flex-1 overflow-y-auto p-3">
        <Show when={filteredFriends().length === 0}>
          <div class="text-center py-8">
            <div class="w-16 h-16 bg-[#2a2a2a] rounded-full flex items-center justify-center mx-auto mb-4">
              <svg
                class="w-8 h-8 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M5.121 17.804A13.937 13.937 0 0112 15c2.5 0 4.847.655 6.879 1.804"
                />
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M15 11a3 3 0 10-6 0 3 3 0 006 0z"
                />
              </svg>
            </div>
            <h3 class="text-lg font-medium text-white mb-2">友だちがいません</h3>
            <p class="text-gray-400 text-sm">
              新しいトークを開始して友だちを増やしましょう
            </p>
          </div>
        </Show>

        <div class="space-y-2">
          <For each={filteredFriends()}>
            {(friend) => (
              <div
                class={`flex items-center p-3 rounded-lg cursor-pointer transition-colors ${
                  props.selectedFriend === friend.id
                    ? "bg-[#4a4a4a]"
                    : "hover:bg-[#3c3c3c]"
                }`}
                onClick={() => {
                  console.log("Friend clicked:", friend.id); // デバッグ用
                  props.onSelectFriend(friend.id);
                }}
              >
                <div class="relative w-12 h-12 flex items-center justify-center">
                  {isUrl(friend.avatar) ||
                    (typeof friend.avatar === "string" &&
                      friend.avatar.startsWith("data:image/"))
                    ? (
                      <img
                        src={friend.avatar}
                        alt="avatar"
                        class="w-12 h-12 object-cover rounded-full"
                      />
                    )
                    : (
                      <div
                        class="w-12 h-12 flex items-center justify-center rounded-full text-white bg-[#444]"
                      >
                        {friend.avatar || friend.name.charAt(0).toUpperCase()}
                      </div>
                    )}
                  
                  {/* オンライン状態の表示（将来的に実装） */}
                  <Show when={friend.isOnline}>
                    <div class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-[#1e1e1e]"></div>
                  </Show>
                </div>
                
                <div class="ml-3 flex-1 min-w-0">
                  <p class="text-white text-sm font-medium truncate">
                    {friend.name}
                  </p>
                  <p class="text-gray-400 text-xs truncate">
                    {friend.id}
                  </p>
                </div>
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}
