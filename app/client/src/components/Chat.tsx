import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedRoomState } from "../states/chat.ts";
import { activeAccount } from "../states/account.ts";
import {
  addKeyPackage,
  fetchEncryptedMessages,
  fetchKeyPackages,
  sendEncryptedMessage,
} from "./e2ee/api.ts";
import {
  decryptGroupMessage,
  deriveMLSSecret,
  encryptGroupMessage,
  exportGroupState,
  exportKeyPair,
  generateMLSKeyPair,
  importGroupState,
  importKeyPair,
  MLSGroupState,
  MLSKeyPair,
  StoredMLSGroupState,
  StoredMLSKeyPair,
} from "./e2ee/mls.ts";
import {
  loadMLSGroupStates,
  loadMLSKeyPair,
  saveMLSGroupStates,
  saveMLSKeyPair,
} from "./e2ee/storage.ts";

interface ChatMessage {
  id: string;
  author: string;
  content: string;
  timestamp: Date;
  type: "text" | "image" | "file";
  avatar?: string;
  isMe?: boolean;
}

interface ChatRoom {
  id: string;
  name: string;
  lastMessage?: string;
  unreadCount: number;
  isOnline?: boolean;
  avatar?: string;
  type: "dm" | "group";
  members: string[];
}

export function Chat() {
  const [selectedRoom, setSelectedRoom] = useAtom(selectedRoomState); // グローバル状態を使用
  const [account] = useAtom(activeAccount);
  const [newMessage, setNewMessage] = createSignal("");
  const [showRoomList, setShowRoomList] = createSignal(true); // モバイル用: 部屋リスト表示制御
  const [isMobile, setIsMobile] = createSignal(false); // モバイル判定
  const [chatRooms, setChatRooms] = createSignal<ChatRoom[]>([]);

  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [groups, setGroups] = createSignal<Record<string, MLSGroupState>>({});
  const [keyPair, setKeyPair] = createSignal<MLSKeyPair | null>(null);
  let poller: number | undefined;

  const loadGroupStates = async () => {
    try {
      const stored = await loadMLSGroupStates();
      const map: Record<string, MLSGroupState> = {};
      for (const [id, data] of Object.entries(stored)) {
        map[id] = await importGroupState(data);
      }
      setGroups(map);
    } catch (err) {
      console.error("Failed to load group states", err);
    }
  };

  const saveGroupStates = async () => {
    const current = groups();
    const obj: Record<string, StoredMLSGroupState> = {};
    for (const [id, g] of Object.entries(current)) {
      obj[id] = await exportGroupState(g);
    }
    await saveMLSGroupStates(obj);
  };

  const ensureKeyPair = async () => {
    let pair = keyPair();
    const user = account();
    if (!user) return null;
    if (!pair) {
      const stored = await loadMLSKeyPair();
      if (stored) {
        pair = await importKeyPair(stored as StoredMLSKeyPair);
      } else {
        pair = await generateMLSKeyPair();
        await saveMLSKeyPair(await exportKeyPair(pair));
        await addKeyPackage(user.userName, { content: pair.publicKey });
      }
      setKeyPair(pair);
    }
    return pair;
  };

  const loadRooms = async () => {
    const user = account();
    if (!user) return;
    const ids = Array.from(new Set([...user.followers, ...user.following]));
    if (ids.length === 0) {
      setChatRooms([]);
      return;
    }
    try {
      const res = await fetch("/api/user-info/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: ids }),
      });
      if (res.ok) {
        const infos = await res.json() as {
          userName: string;
          displayName?: string;
          authorAvatar?: string;
        }[];
        const rooms = infos.map((info, idx: number) => ({
          id: ids[idx],
          name: info.displayName ?? info.userName,
          avatar: info.authorAvatar || info.userName.charAt(0).toUpperCase(),
          unreadCount: 0,
          type: "dm" as const,
          members: [ids[idx]],
        }));
        setChatRooms(rooms);
      }
    } catch (err) {
      console.error("Failed to load rooms", err);
    }
  };

  const loadMessages = async () => {
    const roomId = selectedRoom();
    const user = account();
    if (!roomId || !user) return;
    let group = groups()[roomId];
    const room = chatRooms().find((r) => r.id === roomId);
    if (!room) return;
    if (!group) {
      const kp = await ensureKeyPair();
      if (!kp) return;
      const partnerKeys = await fetchKeyPackages(room.members[0]);
      const partnerPub = partnerKeys[0]?.content;
      if (!partnerPub) return;
      const secret = await deriveMLSSecret(kp.privateKey, partnerPub);
      group = {
        members: [user.userName, ...room.members],
        epoch: Date.now(),
        secret,
      };
      setGroups({ ...groups(), [roomId]: group });
      saveGroupStates();
    }
    const list = await fetchEncryptedMessages(user.userName, room.members[0]);
    const msgs: ChatMessage[] = [];
    for (const m of list) {
      const plain = await decryptGroupMessage(group!, m.content);
      msgs.push({
        id: m.id,
        author: m.from,
        content: plain ?? "",
        timestamp: new Date(m.createdAt),
        type: "text",
        isMe: m.from === user.userName,
        avatar: room.avatar,
      });
    }
    setMessages(msgs);
  };

  const sendMessage = async () => {
    const text = newMessage().trim();
    const roomId = selectedRoom();
    const user = account();
    if (!text || !roomId || !user) return;
    const room = chatRooms().find((r) => r.id === roomId);
    if (!room) return;
    let group = groups()[roomId];
    if (!group) {
      const kp = await ensureKeyPair();
      if (!kp) return;
      const partnerKeys = await fetchKeyPackages(room.members[0]);
      const partnerPub = partnerKeys[0]?.content;
      if (!partnerPub) return;
      const secret = await deriveMLSSecret(kp.privateKey, partnerPub);
      group = {
        members: [user.userName, ...room.members],
        epoch: Date.now(),
        secret,
      };
      setGroups({ ...groups(), [roomId]: group });
      saveGroupStates();
    }
    const cipher = await encryptGroupMessage(group, text);
    await sendEncryptedMessage(user.userName, {
      to: room.members,
      content: cipher,
    });
    setNewMessage("");
    loadMessages();
  };

  // 画面サイズ検出
  const checkMobile = () => {
    setIsMobile(globalThis.innerWidth < 768);
  };

  // モバイルでの部屋選択時の動作
  const selectRoom = (roomId: string) => {
    setSelectedRoom(roomId);
    if (isMobile()) {
      setShowRoomList(false); // モバイルではチャット画面に切り替え
    }
    loadMessages();
    if (poller) clearInterval(poller);
    poller = setInterval(loadMessages, 5000);
  };

  // チャット一覧に戻る（モバイル用）
  const backToRoomList = () => {
    setShowRoomList(true);
    setSelectedRoom(null); // チャンネル選択状態をリセット
    if (poller) clearInterval(poller);
  };

  // イベントリスナーの設定
  onMount(() => {
    checkMobile();
    globalThis.addEventListener("resize", checkMobile);
    loadRooms();
    loadGroupStates();
    ensureKeyPair();
    loadMessages();
  });

  createEffect(() => {
    loadRooms();
    loadMessages();
  });

  createEffect(() => {
    account();
    loadGroupStates();
    ensureKeyPair();
  });

  createEffect(() => {
    groups();
    saveGroupStates();
  });

  onCleanup(() => {
    globalThis.removeEventListener("resize", checkMobile);
    if (poller) clearInterval(poller);
  });

  return (
    <div class="flex h-full">
      {/* サイドバー - チャットルーム一覧 (デスクトップ常時表示 / モバイル条件表示) */}
      <div
        class={`${
          isMobile() ? (showRoomList() ? "w-full" : "hidden") : "w-80"
        } bg-[#1a1a1a] border-r border-gray-800 flex flex-col h-full transition-all duration-300`}
      >
        <div class="p-4 border-b border-gray-800">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-xl font-bold text-white">チャット</h2>
            {/* モバイル用: 選択された部屋があれば戻るボタンを表示 */}
            <Show when={isMobile() && selectedRoom() && !showRoomList()}>
              <button
                type="button"
                onClick={backToRoomList}
                class="text-gray-400 hover:text-white transition-colors"
              >
                <svg
                  class="w-6 h-6"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
              </button>
            </Show>
          </div>
          <div class="relative">
            <input
              type="text"
              placeholder="チャンネルを検索..."
              class="w-full px-4 py-2 bg-[#2a2a2a] border border-gray-700 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-white placeholder-gray-400"
            />
            <div class="absolute right-3 top-2.5">
              <svg
                class="w-4 h-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                >
                </path>
              </svg>
            </div>
          </div>
        </div>

        <div class="flex-1 overflow-y-auto">
          <div class="p-2">
            <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-2">
              グループチャット
            </div>
            <For each={chatRooms().filter((room) => room.type === "group")}>
              {(room) => (
                <div
                  class={`p-3 mx-1 rounded-lg cursor-pointer transition-all duration-200 ${
                    selectedRoom() === room.id
                      ? "bg-[#3a3a3a] text-white"
                      : "text-gray-300 hover:bg-[#2a2a2a] hover:text-white"
                  }`}
                  onClick={() => selectRoom(room.id)}
                >
                  <div class="flex items-center space-x-3">
                    <div class="relative">
                      <div class="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-sm font-bold">
                        {room.avatar}
                      </div>
                      <Show when={room.isOnline}>
                        <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 border-2 border-[#1a1a1a] rounded-full">
                        </div>
                      </Show>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between">
                        <p class="text-sm font-medium truncate">
                          # {room.name}
                        </p>
                        <Show when={room.unreadCount > 0}>
                          <span class="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1rem] text-center">
                            {room.unreadCount}
                          </span>
                        </Show>
                      </div>
                      <Show when={room.lastMessage}>
                        <p class="text-xs text-gray-400 truncate mt-1">
                          {room.lastMessage}
                        </p>
                      </Show>
                    </div>
                  </div>
                </div>
              )}
            </For>

            <div class="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 px-2 mt-4">
              ダイレクトメッセージ
            </div>
            <For each={chatRooms().filter((room) => room.type === "dm")}>
              {(room) => (
                <div
                  class={`p-3 mx-1 rounded-lg cursor-pointer transition-all duration-200 ${
                    selectedRoom() === room.id
                      ? "bg-[#3a3a3a] text-white"
                      : "text-gray-300 hover:bg-[#2a2a2a] hover:text-white"
                  }`}
                  onClick={() => selectRoom(room.id)}
                >
                  <div class="flex items-center space-x-3">
                    <div class="relative">
                      <div class="w-8 h-8 bg-gradient-to-br from-green-500 to-teal-600 rounded-full flex items-center justify-center text-sm font-bold">
                        {room.avatar}
                      </div>
                      <Show when={room.isOnline}>
                        <div class="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 bg-green-400 border-2 border-[#1a1a1a] rounded-full">
                        </div>
                      </Show>
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center justify-between">
                        <p class="text-sm font-medium truncate">
                          {room.name}
                        </p>
                        <Show when={room.unreadCount > 0}>
                          <span class="bg-red-500 text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[1rem] text-center">
                            {room.unreadCount}
                          </span>
                        </Show>
                      </div>
                      <Show when={room.lastMessage}>
                        <p class="text-xs text-gray-400 truncate mt-1">
                          {room.lastMessage}
                        </p>
                      </Show>
                    </div>
                  </div>
                </div>
              )}
            </For>
          </div>
        </div>
      </div>

      {/* メインチャットエリア (デスクトップ常時表示 / モバイル条件表示) */}
      <div
        class={`${
          isMobile() ? (showRoomList() ? "hidden" : "w-full") : "flex-1"
        } flex flex-col h-full transition-all duration-300`}
      >
        <Show when={selectedRoom()}>
          {/* チャットヘッダー */}
          <div class="p-4 bg-[#1a1a1a] border-b border-gray-800">
            <div class="flex items-center justify-between">
              <div class="flex items-center space-x-3">
                {/* モバイル用: 戻るボタン */}
                <Show when={isMobile()}>
                  <button
                    type="button"
                    onClick={backToRoomList}
                    class="p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-colors mr-2"
                  >
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M10 19l-7-7m0 0l7-7m-7 7h18"
                      />
                    </svg>
                  </button>
                </Show>
                <div class="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center text-white font-bold">
                  {chatRooms().find((r) => r.id === selectedRoom())?.avatar}
                </div>
                <div>
                  <h3 class="text-lg font-semibold text-white">
                    {chatRooms().find((r) => r.id === selectedRoom())?.type ===
                        "group"
                      ? "# "
                      : ""}
                    {chatRooms().find((r) => r.id === selectedRoom())?.name}
                  </h3>
                  <p class="text-sm text-gray-400">
                    {chatRooms().find((r) => r.id === selectedRoom())?.type ===
                        "group"
                      ? "3 メンバー, 2 オンライン"
                      : "オンライン"}
                  </p>
                </div>
              </div>
              <div class="flex items-center space-x-2">
                {/* モバイル用: ハンバーガーメニュー（ルーム一覧非表示時のみ） */}
                <Show when={isMobile() && !showRoomList()}>
                  <button
                    type="button"
                    onClick={backToRoomList}
                    class="p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-colors"
                  >
                    <svg
                      class="w-5 h-5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M4 6h16M4 12h16M4 18h16"
                      />
                    </svg>
                  </button>
                </Show>
                <button
                  type="button"
                  class="p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-colors"
                >
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-colors"
                >
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-colors"
                >
                  <svg
                    class="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>

          {/* メッセージエリア */}
          <div class="flex-1 overflow-y-auto p-4 bg-[#121212] min-h-0">
            <div class="space-y-4">
              <For each={messages()}>
                {(message) => (
                  <div
                    class={`flex ${
                      message.isMe ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      class={`flex items-start space-x-3 max-w-[70%] ${
                        message.isMe ? "flex-row-reverse space-x-reverse" : ""
                      }`}
                    >
                      <Show when={!message.isMe}>
                        <div class="w-8 h-8 bg-gradient-to-br from-green-500 to-teal-600 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                          {message.avatar}
                        </div>
                      </Show>
                      <div
                        class={`flex flex-col ${
                          message.isMe ? "items-end" : "items-start"
                        }`}
                      >
                        <Show when={!message.isMe}>
                          <div class="flex items-center space-x-2 mb-1">
                            <span class="text-sm font-medium text-white">
                              {message.author}
                            </span>
                            <span class="text-xs text-gray-500">
                              {message.timestamp.toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </span>
                          </div>
                        </Show>
                        <div
                          class={`px-4 py-2 rounded-2xl ${
                            message.isMe
                              ? "bg-blue-600 text-white"
                              : "bg-[#2a2a2a] text-gray-100"
                          }`}
                        >
                          <p class="text-sm whitespace-pre-wrap">
                            {message.content}
                          </p>
                        </div>
                        <Show when={message.isMe}>
                          <span class="text-xs text-gray-500 mt-1">
                            {message.timestamp.toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </Show>
                      </div>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </div>

          {/* メッセージ入力エリア */}
          <div
            class={`p-4 bg-[#1a1a1a] border-t border-gray-800 ${
              isMobile() ? "pb-safe-bottom" : ""
            }`}
          >
            <div class="flex items-end space-x-3">
              <button
                type="button"
                class={`p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-colors ${
                  isMobile() ? "hidden" : ""
                }`}
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"
                  />
                </svg>
              </button>
              <div class="flex-1 relative">
                <textarea
                  value={newMessage()}
                  onInput={(e) => setNewMessage(e.target.value)}
                  placeholder={isMobile()
                    ? "メッセージ..."
                    : "メッセージを入力..."}
                  class={`w-full px-4 py-3 pr-12 bg-[#2a2a2a] border border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-white placeholder-gray-400 resize-none scrollbar-thin scrollbar-thumb-gray-600 scrollbar-track-transparent ${
                    isMobile() ? "text-base" : ""
                  }`}
                  rows="1"
                  style="max-height: 120px;"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      sendMessage();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={sendMessage}
                  class={`absolute right-2 bottom-2 w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${
                    newMessage().trim()
                      ? "bg-blue-600 hover:bg-blue-700 text-white"
                      : "bg-gray-700 text-gray-400 cursor-not-allowed"
                  }`}
                  disabled={!newMessage().trim()}
                >
                  <svg
                    class="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                    />
                  </svg>
                </button>
              </div>
              <button
                type="button"
                class="p-2 text-gray-400 hover:text-white hover:bg-[#2a2a2a] rounded-lg transition-colors"
              >
                <svg
                  class="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </button>
            </div>
          </div>
        </Show>

        <Show when={!selectedRoom()}>
          <div class="flex-1 flex items-center justify-center bg-[#121212] min-h-0">
            <div class="text-center px-4">
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
                {isMobile() ? "チャンネルを選択" : "チャンネルを選択"}
              </h3>
              <p class="text-gray-400 text-sm">
                {isMobile()
                  ? "左上のメニューからチャンネルを選択してください"
                  : "左のサイドバーからチャンネルを選択して会話を開始しましょう"}
              </p>
            </div>
          </div>
        </Show>
      </div>
    </div>
  );
}
