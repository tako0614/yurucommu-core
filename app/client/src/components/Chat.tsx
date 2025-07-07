import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedRoomState } from "../states/chat.ts";
import { activeAccount } from "../states/account.ts";
import type { UserInfo } from "./microblog/api.ts";
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
  displayName: string;
  address: string;
  content: string;
  timestamp: Date;
  type: "text" | "image" | "file";
  avatar?: string;
  isMe?: boolean;
}

interface ChatRoom {
  id: string;
  name: string;
  userName: string;
  domain: string;
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
  const partnerKeyCache = new Map<string, string | null>();
  const selectedRoomInfo = createMemo(() =>
    chatRooms().find((r) => r.id === selectedRoom()) ?? null
  );
  let poller: number | undefined;
  let textareaRef: HTMLTextAreaElement | undefined;

  const adjustHeight = () => {
    if (textareaRef) {
      textareaRef.style.height = "auto";
      textareaRef.style.height = `${textareaRef.scrollHeight}px`;
    }
  };

  const isUrl = (value?: string): boolean => {
    if (!value) return false;
    try {
      const url = new URL(value.trim());
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  };

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

  const getPartnerKey = async (userName: string) => {
    if (partnerKeyCache.has(userName)) {
      return partnerKeyCache.get(userName);
    }
    const keys = await fetchKeyPackages(userName);
    const pub = keys[0]?.content ?? null;
    partnerKeyCache.set(userName, pub);
    return pub;
  };

  const loadRooms = async () => {
    const user = account();
    if (!user) return;
    const ids = Array.from(
      new Set([
        ...(user.followers ?? []),
        ...(user.following ?? []),
      ]),
    );
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
        const infos = await res.json() as UserInfo[];
        const rooms = infos.reduce<ChatRoom[]>((acc, info) => {
          const id = info.domain
            ? `${info.userName}@${info.domain}`
            : info.userName;
          acc.push({
            id,
            name: info.displayName || info.userName,
            userName: info.userName,
            domain: info.domain,
            avatar: info.authorAvatar || info.userName.charAt(0).toUpperCase(),
            unreadCount: 0,
            type: "dm",
            members: [info.userName],
          });
          return acc;
        }, []);
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
      const partnerPub = await getPartnerKey(room.members[0]);
      if (!partnerPub) {
        alert("相手が鍵を登録していないため、メッセージを送れません");
        return;
      }
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
      const isMe = m.from === user.userName;
      const displayName = isMe ? user.displayName || user.userName : room.name;
      const domain = isMe ? globalThis.location.hostname : room.domain;
      msgs.push({
        id: m.id,
        author: m.from,
        displayName,
        address: `${m.from}@${domain}`,
        content: plain ?? "",
        timestamp: new Date(m.createdAt),
        type: "text",
        isMe,
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
      const partnerPub = await getPartnerKey(room.members[0]);
      if (!partnerPub) {
        alert("相手が鍵を登録していないため、メッセージを送れません");
        return;
      }
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
    const success = await sendEncryptedMessage(user.userName, {
      to: room.members,
      content: cipher,
    });
    if (!success) {
      alert("メッセージの送信に失敗しました");
      return;
    }
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
    adjustHeight();
  });

  createEffect(() => {
    account();
    loadRooms();
  });

  createEffect(() => {
    selectedRoom();
    groups();
    account();
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

  createEffect(() => {
    newMessage();
    adjustHeight();
  });

  onCleanup(() => {
    globalThis.removeEventListener("resize", checkMobile);
    if (poller) clearInterval(poller);
  });

  return (
    <>
      <div class="wrapper w-full">
        <main
          class={`p-talk ${
            isMobile() ? (showRoomList() ? "" : "is-inview") : ""
          } flex`}
          id="chatmain"
        >
          <div class="p-talk-list min-h-screen">
            <div class="p-talk-list-title">チャット</div>
            <div class="p-talk-list-search">
              <input type="text" placeholder="チャンネルを検索..." />
            </div>
            <div class="p-talk-list-rooms pb-14 scrollbar">
              <ul class="p-talk-list-rooms__ul h-[calc(100vh-120px)] pb-[70px] scrollbar">
                <For each={chatRooms()}>
                  {(room) => (
                    <li
                      class={`c-talk-rooms ${
                        selectedRoom() === room.id ? "is-active" : ""
                      }`}
                    >
                      <button type="button" onClick={() => selectRoom(room.id)}>
                        <span class="c-talk-rooms-icon">
                          {isUrl(room.avatar)
                            ? <img src={room.avatar} alt="avatar" />
                            : (
                              room.avatar
                            )}
                        </span>
                        <span class="c-talk-rooms-box">
                          <span class="c-talk-rooms-name">
                            <span class="c-talk-rooms-nickname">
                              {room.name}
                            </span>
                            <span class="c-talk-rooms-locate">
                              @{room.domain}
                            </span>
                          </span>
                          <span class="c-talk-rooms-msg">
                            <p>{room.lastMessage}</p>
                          </span>
                        </span>
                      </button>
                    </li>
                  )}
                </For>
              </ul>
            </div>
          </div>
          <div class="p-talk-chat">
            <Show
              when={selectedRoom()}
              fallback={
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
              }
            >
              <div class="p-talk-chat-container min-h-dvh flex flex-col">
                <div
                  class={`p-talk-chat-title ${selectedRoom() ? "" : "hidden"}`}
                  id="chatHeader"
                >
                  <div class="flex items-center gap-2 p-4">
                    <Show when={isMobile()}>
                      <button
                        type="button"
                        class="p-talk-chat-prev"
                        onClick={backToRoomList}
                      >
                        <svg
                          role="img"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 24 24"
                          stroke="#ffffff"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                          fill="none"
                          class="w-5 h-5"
                        >
                          <polyline points="14 18 8 12 14 6" />
                        </svg>
                      </button>
                    </Show>
                    <h2>{selectedRoomInfo()?.name}</h2>
                  </div>
                </div>
                <div class="p-talk-chat-main flex-grow overflow-y-auto">
                  <ul class="p-talk-chat-main__ul">
                    <For each={messages()}>
                      {(message, i) => {
                        const prev = messages()[i() - 1];
                        const isPrimary = !prev ||
                          prev.author !== message.author;
                        const cls = `c-talk-chat ${
                          message.isMe ? "self" : "other"
                        } ${isPrimary ? "primary" : "subsequent"}`;
                        return (
                          <li class={cls}>
                            <div class="c-talk-chat-box">
                              <Show when={!message.isMe && isPrimary}>
                                <div class="c-talk-chat-icon">
                                  {isUrl(message.avatar)
                                    ? <img src={message.avatar} alt="avatar" />
                                    : message.avatar}
                                </div>
                              </Show>
                              <div class="c-talk-chat-right">
                                <Show when={!message.isMe && isPrimary}>
                                  <p class="c-talk-chat-name">
                                    {message.displayName}
                                  </p>
                                </Show>
                                <div class="flex items-end">
                                  <Show when={message.isMe}>
                                    <span class="text-xs text-gray-500 mr-2">
                                      {message.timestamp.toLocaleTimeString(
                                        [],
                                        {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        },
                                      )}
                                    </span>
                                  </Show>
                                  <div class="c-talk-chat-msg">
                                    <p>{message.content}</p>
                                  </div>
                                  <Show when={!message.isMe}>
                                    <span class="text-xs text-gray-500 ml-2">
                                      {message.timestamp.toLocaleTimeString(
                                        [],
                                        {
                                          hour: "2-digit",
                                          minute: "2-digit",
                                        },
                                      )}
                                    </span>
                                  </Show>
                                </div>
                              </div>
                            </div>
                          </li>
                        );
                      }}
                    </For>
                  </ul>
                </div>
                <div class="p-talk-chat-send">
                  <div class="p-talk-chat-send__form">
                    <div class="p-talk-chat-send__msg">
                      <label for="msg" />
                      <textarea
                        id="msg"
                        class="p-talk-chat-send__textarea"
                        rows="1"
                        ref={(el) => (textareaRef = el)}
                        value={newMessage()}
                        onInput={(e) => {
                          setNewMessage(e.target.value);
                          adjustHeight();
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                          }
                        }}
                      />
                    </div>
                    <button
                      type="button"
                      class={`p-talk-chat-send__button ${
                        newMessage().trim() ? "is-active" : ""
                      }`}
                      onClick={sendMessage}
                      disabled={!newMessage().trim()}
                    >
                      <svg viewBox="0 0 24 24">
                        <g>
                          <path d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                        </g>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </Show>
          </div>
        </main>
      </div>
    </>
  );
}
