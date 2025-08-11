import { createSignal, Show, For, createMemo } from "solid-js";
import { isUrl } from "../../utils/url.ts";
import type { Room } from "./types.ts";

interface FriendDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectRoom: (roomId: string) => void;
  onCreateDm: (members: string) => void;
  rooms: Room[];
}

export function FriendDialog(props: FriendDialogProps) {
  const [isCreating, setIsCreating] = createSignal(false);
  const [members, setMembers] = createSignal("");

  // 2人だけのトークルーム（友達）をフィルタリング
  const friendRooms = createMemo(() => {
    return props.rooms.filter((r) => 
      r.type !== "memo" && 
      (r.members?.length ?? 0) + 1 === 2 && 
      !(r.hasName || r.hasIcon)
    );
  });

  const handleCreateDm = async (e: Event) => {
    e.preventDefault();
    const mem = members().trim();
    if (!mem) return;
    
    await props.onCreateDm(mem);
    setMembers("");
    setIsCreating(false);
  };

  const handleClose = () => {
    setMembers("");
    setIsCreating(false);
    props.onClose();
  };

  const selectRoom = (roomId: string) => {
    props.onSelectRoom(roomId);
    handleClose();
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80">
        <div class="bg-[#1e1e1e] rounded-lg w-96 max-h-[80vh] flex flex-col">
          <div class="p-4 border-b border-[#333]">
            <div class="flex items-center justify-between">
              <h2 class="text-white text-lg font-bold">友だち</h2>
              <button
                type="button"
                class="text-gray-400 hover:text-white"
                onClick={handleClose}
              >
                ✕
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-4">
            {/* 既存の友達トークルーム一覧 */}
            <Show when={friendRooms().length > 0}>
              <div class="mb-4">
                <h3 class="text-gray-300 text-sm font-medium mb-2">既存のトーク</h3>
                <div class="space-y-2">
                  <For each={friendRooms()}>
                    {(room) => (
                      <div
                        class="flex items-center p-2 rounded-lg hover:bg-[#3c3c3c] cursor-pointer"
                        onClick={() => selectRoom(room.id)}
                      >
                        <span class="relative w-10 h-10 flex items-center justify-center">
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
                              <span
                                class="w-10 h-10 flex items-center justify-center rounded-full text-white bg-[#444]"
                              >
                                {room.avatar}
                              </span>
                            )}
                        </span>
                        <div class="ml-3 flex-1 min-w-0">
                          <p class="text-white text-sm font-medium truncate">
                            {room.name}
                          </p>
                          <p class="text-gray-400 text-xs truncate">
                            {room.lastMessage}
                          </p>
                        </div>
                        <div class="text-xs text-gray-500">
                          {room.lastMessageTime
                            ? room.lastMessageTime.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })
                            : ""}
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            {/* 新しいトーク作成 */}
            <div>
              <div class="flex items-center justify-between mb-2">
                <h3 class="text-gray-300 text-sm font-medium">新しいトーク</h3>
                <Show when={!isCreating()}>
                  <button
                    type="button"
                    class="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => setIsCreating(true)}
                  >
                    ＋ 作成
                  </button>
                </Show>
              </div>

              <Show when={isCreating()}>
                <form onSubmit={handleCreateDm} class="space-y-3">
                  <input
                    type="text"
                    placeholder="ユーザーのハンドルを入力 (@user または user@domain)"
                    class="w-full p-2 rounded bg-[#3c3c3c] text-white placeholder-[#aaaaaa] outline-none border-none text-sm"
                    value={members()}
                    onInput={(e) => setMembers(e.currentTarget.value)}
                    autofocus
                  />
                  <div class="flex justify-end gap-2">
                    <button
                      type="button"
                      class="px-3 py-1 text-xs rounded bg-[#555] text-white hover:bg-[#666]"
                      onClick={() => {
                        setIsCreating(false);
                        setMembers("");
                      }}
                    >
                      キャンセル
                    </button>
                    <button
                      type="submit"
                      class="px-3 py-1 text-xs rounded bg-blue-600 text-white hover:bg-blue-700"
                      disabled={!members().trim()}
                    >
                      開始
                    </button>
                  </div>
                </form>
              </Show>

              <Show when={!isCreating() && friendRooms().length === 0}>
                <div class="text-center py-8">
                  <p class="text-gray-400 text-sm mb-3">
                    まだ友だちとのトークがありません
                  </p>
                  <button
                    type="button"
                    class="px-4 py-2 text-sm rounded bg-blue-600 text-white hover:bg-blue-700"
                    onClick={() => setIsCreating(true)}
                  >
                    新しいトークを始める
                  </button>
                </div>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
