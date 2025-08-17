import { createSignal, Show, For, createMemo } from "solid-js";
import { isUrl } from "../../utils/url.ts";
import type { Room } from "./types.ts";
import { isFriendRoom } from "./types.ts";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";
import { getDomain } from "../../utils/config.ts";

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
  const [account] = useAtom(activeAccount);
  const [localQuery, setLocalQuery] = createSignal("");
  const q = () => (props.query !== undefined ? props.query : localQuery());
  const setQuery = (v: string) =>
    props.onQueryChange ? props.onQueryChange(v) : setLocalQuery(v);

  // ルームから友達リストを生成
  const friends = createMemo(() => {
    const me = account();
    const selfHandle = me ? `${me.userName}@${getDomain()}` : undefined;
    const friendMap = new Map<string, Friend>();
    // フレンド候補: 自分以外の候補がちょうど1名の未命名ルーム
    const candidateRooms = props.rooms.filter((r) => {
      if (r.type === "memo") return false;
      if (r.hasName || r.hasIcon) return false;
      const base = (r.members && r.members.length > 0) ? r.members : (r.pendingInvites ?? []);
      const norm = base
        .filter((m): m is string => typeof m === "string" && !!m)
        .map((m) => normalizeHandle(m) || m);
      const others = norm.filter((m) => m !== selfHandle);
      // ID が @ を含む/含まないにかかわらず、他者候補が1名なら候補にする
      if (others.length === 1) return true;
      // さらに base が1名でも候補にする（未正規化の暫定ID対応）
      return base.length === 1 && (selfHandle ? base[0] !== selfHandle : true);
    });
    for (const room of candidateRooms) {
      const base = (room.members && room.members.length > 0)
        ? room.members
        : (room.pendingInvites ?? []);
      // 自分以外の最初のID
      const raw = base.find((m) => m && m !== selfHandle) ?? base[0];
      if (!raw) continue;
      const friendId = normalizeHandle(raw) || raw;
      if (selfHandle && friendId === selfHandle) continue;
      if (!friendMap.has(friendId)) {
        const isSelfLikeName = me && (room.name === me.displayName || room.name === me.userName || room.name === selfHandle);
        const short = friendId.includes("@") ? friendId.split("@")[0] : friendId;
        const fromPending = (!room.members || room.members.length === 0) && (room.pendingInvites?.length === 1);
        const fallbackName = (short || friendId);
        friendMap.set(friendId, {
          id: friendId,
          name: (room.name && !isSelfLikeName) ? room.name : fallbackName,
          avatar: room.avatar,
          domain: friendId.includes("@") ? friendId.split("@")[1] : undefined,
        });
      }
    }
    // 並び順: 未読合計 → 最終アクティビティ → 名前
    const items = Array.from(friendMap.values());
    const unreadSum = (fid: string) =>
      props.rooms
        .filter((r) => r.type !== "memo" && !(r.hasName || r.hasIcon))
        .filter((r) => (r.members?.includes(fid)) || (r.pendingInvites?.includes(fid)))
        .reduce((a, r) => a + (r.unreadCount || 0), 0);
    const lastTime = (fid: string) => {
      let t = 0;
      for (const r of props.rooms) {
        if (r.type === "memo") continue;
        const match = (r.members?.includes(fid)) || (r.pendingInvites?.includes(fid));
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
      return (a.name || a.id).localeCompare(b.name || b.id);
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
