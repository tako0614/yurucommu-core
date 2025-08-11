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
}

export function FriendList(props: FriendListProps) {
  const [query, setQuery] = createSignal("");

  // ルームから友達リストを生成
  const friends = createMemo(() => {
    const friendMap = new Map<string, Friend>();
    
    // 2人だけのトークルームから友達を抽出
    const friendRooms = props.rooms.filter(isFriendRoom);
    
    for (const room of friendRooms) {
      // 相手のIDを取得（自分以外のメンバー）
      const friendId = room.members[0]; // 2人だけなので最初のメンバーが相手
      
      if (!friendMap.has(friendId)) {
        friendMap.set(friendId, {
          id: friendId,
          name: room.name || friendId.split('@')[0] || friendId,
          avatar: room.avatar,
          domain: friendId.includes('@') ? friendId.split('@')[1] : undefined,
        });
      }
    }
    
    return Array.from(friendMap.values());
  });

  const filteredFriends = createMemo(() => {
    const q = query().toLowerCase().trim();
    if (!q) return friends();
    return friends().filter((f) => 
      f.name.toLowerCase().includes(q) || f.id.toLowerCase().includes(q)
    );
  });

  return (
    <div class="h-full flex flex-col">
      {/* 検索バー */}
      <div class="p-3 border-b border-[#333]">
        <input
          type="text"
          placeholder="友だちを検索..."
          class="w-full outline-none border-none font-normal p-2 px-3 rounded-lg bg-[#3c3c3c] text-white placeholder-[#aaaaaa]"
          value={query()}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
      </div>

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
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z"
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
                onClick={() => props.onSelectFriend(friend.id)}
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
                    {friend.domain ? `@${friend.domain}` : friend.id}
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
