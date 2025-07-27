import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedRoomState } from "../states/chat.ts";
import { type Account, activeAccount } from "../states/account.ts";
import { fetchUserInfo, fetchUserInfoBatch } from "./microblog/api.ts";
import {
  addDm,
  addKeyPackage,
  fetchDmList,
  fetchEncryptedKeyPair,
  fetchEncryptedMessages,
  fetchKeyPackages,
  removeDm,
  saveEncryptedKeyPair,
  sendEncryptedMessage,
  sendPublicMessage,
  uploadFile,
} from "./e2ee/api.ts";
import { getDomain } from "../utils/config.ts";
import { addMessageHandler, removeMessageHandler } from "../utils/ws.ts";
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
import { decryptWithPassword, encryptWithPassword } from "../utils/crypto.ts";
import { encryptionKeyState } from "../states/session.ts";
import { GoogleAd } from "./GoogleAd.tsx";
import { isAdsenseEnabled, loadAdsenseConfig } from "../utils/adsense.ts";

function isUrl(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function adjustHeight(el?: HTMLTextAreaElement) {
  if (el) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }
}

function bufToB64(buf: ArrayBuffer): string {
  const u8 = new Uint8Array(buf);
  return btoa(String.fromCharCode(...u8));
}

function b64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

// ActivityPub の Note 形式のテキストから content を取り出す
function parseActivityPubContent(text: string): string {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object" && typeof obj.content === "string") {
      return obj.content;
    }
  } catch {
    /* JSON ではない場合はそのまま返す */
  }
  return text;
}

interface ActivityPubAttachment {
  url: string;
  mediaType: string;
  key?: string;
  iv?: string;
}

interface ParsedActivityPubNote {
  content: string;
  attachments?: ActivityPubAttachment[];
}

function parseActivityPubNote(text: string): ParsedActivityPubNote {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object" && typeof obj.content === "string") {
      const attachments =
        Array.isArray((obj as { attachment?: unknown }).attachment)
          ? (obj as { attachment?: unknown }).attachment
            .map((a: unknown) => {
              if (
                a && typeof a === "object" &&
                typeof (a as { url?: unknown }).url === "string"
              ) {
                return {
                  url: (a as { url: string }).url,
                  mediaType:
                    typeof (a as { mediaType?: unknown }).mediaType === "string"
                      ? (a as { mediaType: string }).mediaType
                      : "application/octet-stream",
                  key: typeof (a as { key?: unknown }).key === "string"
                    ? (a as { key: string }).key
                    : undefined,
                  iv: typeof (a as { iv?: unknown }).iv === "string"
                    ? (a as { iv: string }).iv
                    : undefined,
                } as ActivityPubAttachment;
              }
              return null;
            })
            .filter((
              a: ActivityPubAttachment | null,
            ): a is ActivityPubAttachment => !!a)
          : undefined;
      return { content: obj.content, attachments };
    }
  } catch {
    /* ignore */
  }
  return { content: text };
}

async function encryptFile(file: File) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf);
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return {
    data: bufToB64(enc),
    key: bufToB64(rawKey),
    iv: bufToB64(iv.buffer),
    mediaType: file.type,
  };
}

async function decryptFile(
  data: string,
  keyB64: string,
  ivB64: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    b64ToBuf(keyB64),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const iv = b64ToBuf(ivB64);
  const dec = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    b64ToBuf(data),
  );
  return bufToB64(dec);
}

function getSelfRoomId(user: Account | null): string | null {
  return user ? `${user.userName}@${getDomain()}` : null;
}

type ActorID = string;

interface ChatMessage {
  id: string;
  author: string;
  displayName: string;
  address: string;
  content: string;
  attachments?: { data: string; mediaType: string }[];
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
  lastMessageTime?: Date;
  unreadCount: number;
  isOnline?: boolean;
  avatar?: string;
  type: "dm" | "group" | "memo";
  members: ActorID[];
}

interface ChatProps {
  onShowEncryptionKeyForm?: () => void;
}

export function Chat(props: ChatProps) {
  const [selectedRoom, setSelectedRoom] = useAtom(selectedRoomState); // グローバル状態を使用
  const [account] = useAtom(activeAccount);
  const [encryptionKey, setEncryptionKey] = useAtom(encryptionKeyState);
  const [newMessage, setNewMessage] = createSignal("");
  const [mediaFile, setMediaFile] = createSignal<File | null>(null);
  const [mediaPreview, setMediaPreview] = createSignal<string | null>(null);
  const [showRoomList, setShowRoomList] = createSignal(true); // モバイル用: 部屋リスト表示制御
  const [isMobile, setIsMobile] = createSignal(false); // モバイル判定
  const [chatRooms, setChatRooms] = createSignal<ChatRoom[]>([]);

  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  const [groups, setGroups] = createSignal<Record<string, MLSGroupState>>({});
  const [keyPair, setKeyPair] = createSignal<MLSKeyPair | null>(null);
  // 暗号化はデフォルトではオフにしておく
  const [useEncryption, setUseEncryption] = createSignal(false);
  const [partnerHasKey, setPartnerHasKey] = createSignal(true);
  const partnerKeyCache = new Map<string, string | null>();
  const messageLimit = 30;
  const [showAds, setShowAds] = createSignal(false);
  onMount(async () => {
    await loadAdsenseConfig();
    setShowAds(isAdsenseEnabled());
  });
  const [cursor, setCursor] = createSignal<string | null>(null);
  const [hasMore, setHasMore] = createSignal(true);
  const [loadingOlder, setLoadingOlder] = createSignal(false);
  let chatMainRef: HTMLDivElement | undefined;
  let fileInput: HTMLInputElement | undefined;
  const selectedRoomInfo = createMemo(() =>
    chatRooms().find((r) => r.id === selectedRoom()) ?? null
  );
  const updateRoomLast = (roomId: string, msg?: ChatMessage) => {
    setChatRooms((rooms) => {
      let updated = false;
      const newRooms = rooms.map((r) => {
        if (r.id !== roomId) return r;
        const lastMessage = msg?.attachments && msg.attachments.length > 0
          ? "[添付]" + (msg.content ? " " + msg.content : "")
          : msg?.content ?? "";
        const lastMessageTime = msg?.timestamp;
        if (
          r.lastMessage !== lastMessage ||
          r.lastMessageTime?.getTime() !== lastMessageTime?.getTime()
        ) {
          updated = true;
          return { ...r, lastMessage, lastMessageTime };
        }
        return r;
      });
      return updated ? newRooms : rooms;
    });
  };
  let textareaRef: HTMLTextAreaElement | undefined;
  let wsCleanup: (() => void) | undefined;
  let longPressTimer: number | undefined;

  const removeRoom = async (roomId: string) => {
    const user = account();
    if (!user) return;
    const room = chatRooms().find((r) => r.id === roomId);
    if (!room || room.type !== "dm") return;
    if (!confirm(`${room.name} をDMリストから削除しますか？`)) return;
    if (await removeDm(user.id, roomId)) {
      setChatRooms((prev) => prev.filter((r) => r.id !== roomId));
      if (selectedRoom() === roomId) {
        setSelectedRoom(null);
        setMessages([]);
      }
    }
  };

  const startLongPress = (id: string) => {
    longPressTimer = globalThis.setTimeout(() => removeRoom(id), 600);
  };

  const cancelLongPress = () => {
    if (longPressTimer) {
      globalThis.clearTimeout(longPressTimer);
      longPressTimer = undefined;
    }
  };

  const toggleEncryption = () => {
    // 暗号化ONにしようとした時、相手がkeyPackage未所持なら警告
    if (!useEncryption() && !partnerHasKey()) {
      alert("このユーザーは暗号化された会話に対応していません。");
      return;
    }
    setUseEncryption(!useEncryption());
  };

  const loadGroupStates = async () => {
    const user = account();
    if (!user) return;
    try {
      const stored = await loadMLSGroupStates(user.id);
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
    const user = account();
    if (!user) return;
    const current = groups();
    const obj: Record<string, StoredMLSGroupState> = {};
    for (const [id, g] of Object.entries(current)) {
      obj[id] = await exportGroupState(g);
    }
    await saveMLSGroupStates(user.id, obj);
  };

  const [isGeneratingKeyPair, setIsGeneratingKeyPair] = createSignal(false);

  const ensureKeyPair = async () => {
    if (isGeneratingKeyPair()) return;

    let pair = keyPair();
    const user = account();
    const pass = encryptionKey();
    console.log(pair);
    if (!user || !pass) return null;
    if (!pair) {
      setIsGeneratingKeyPair(true);
      try {
        const stored = await loadMLSKeyPair(user.id);
        if (stored) {
          pair = await importKeyPair(stored as StoredMLSKeyPair);
        }
      } catch (err) {
        console.error("鍵ペアの読み込みに失敗しました", err);
        pair = null;
      }
      if (!pair) {
        const encData = await fetchEncryptedKeyPair(
          user.userName,
        );
        if (encData) {
          try {
            const json = await decryptWithPassword(encData, pass);
            if (json) {
              const storedPair = JSON.parse(json) as StoredMLSKeyPair;
              pair = await importKeyPair(storedPair);
              await saveMLSKeyPair(user.id, storedPair);
            } else {
              alert("暗号化キーが正しくありません");
              setEncryptionKey(null);
              setIsGeneratingKeyPair(false);
              return null;
            }
          } catch (err) {
            console.error("鍵ペアの復号に失敗しました", err);
          }
        }
      }
      if (!pair) {
        pair = await generateMLSKeyPair();
        try {
          const exported = await exportKeyPair(pair);
          await saveMLSKeyPair(user.id, exported);
          const encStr = await encryptWithPassword(
            JSON.stringify(exported),
            pass,
          );
          await saveEncryptedKeyPair(
            user.userName,
            encStr,
          );
          await addKeyPackage(
            user.userName,
            { content: pair.publicKey },
          );
        } catch (err) {
          console.error("鍵ペアの保存に失敗しました", err);
          setIsGeneratingKeyPair(false);
          return null;
        }
      }
      setKeyPair(pair);
      setIsGeneratingKeyPair(false);
    }
    return pair;
  };

  const getPartnerKey = async (userName: string, domain?: string) => {
    const effectiveDomain = domain ?? getDomain();
    const keyId = `${userName}@${effectiveDomain}`;
    if (partnerKeyCache.has(keyId)) {
      const cached = partnerKeyCache.get(keyId);
      return cached;
    }
    const keys = await fetchKeyPackages(
      userName,
      effectiveDomain,
    );
    const pub = keys[0]?.content ?? null;
    partnerKeyCache.set(keyId, pub);
    return pub;
  };

  const fetchMessagesForRoom = async (
    room: ChatRoom,
    params?: { limit?: number; before?: string; after?: string },
  ): Promise<ChatMessage[]> => {
    const user = account();
    if (!user) return [];
    const [partnerUser, partnerDomain] = splitActor(room.members[0]);
    const partner = partnerDomain
      ? `${partnerUser}@${partnerDomain}`
      : `${partnerUser}@${getDomain()}`;
    const encryptedMsgs: ChatMessage[] = [];
    let group = groups()[room.id];
    if (!group) {
      const kp = await ensureKeyPair();
      if (kp) {
        const partnerPub = await getPartnerKey(partnerUser, partnerDomain);
        if (partnerPub) {
          const secret = await deriveMLSSecret(kp.privateKey, partnerPub);
          group = { members: room.members, epoch: Date.now(), secret };
          setGroups({ ...groups(), [room.id]: group });
          saveGroupStates();
        }
      }
    }
    const list = await fetchEncryptedMessages(
      `${user.userName}@${getDomain()}`,
      partner,
      params,
    );
    for (const m of list) {
      const plain = await decryptGroupMessage(group, m.content);
      const note = parseActivityPubNote(plain ?? m.content);
      const text = note.content;
      const listAtt = Array.isArray(m.attachments)
        ? m.attachments
        : note.attachments;
      let attachments: { data: string; mediaType: string }[] | undefined;
      if (Array.isArray(listAtt)) {
        attachments = [];
        for (const at of listAtt) {
          if (typeof at.url === "string") {
            try {
              const res = await fetch(at.url);
              const buf = await res.arrayBuffer();
              const encData = bufToB64(buf);
              let data = encData;
              if (typeof at.key === "string" && typeof at.iv === "string") {
                data = await decryptFile(encData, at.key, at.iv);
              }
              const mt = typeof at.mediaType === "string"
                ? at.mediaType
                : "image/png";
              attachments.push({ data, mediaType: mt });
            } catch {
              /* ignore */
            }
          }
        }
      }
      const fullId = `${user.userName}@${getDomain()}`;
      const isMe = m.from === fullId;
      const displayName = isMe ? user.displayName || user.userName : room.name;
      encryptedMsgs.push({
        id: m.id,
        author: m.from,
        displayName,
        address: m.from,
        content: text,
        attachments,
        timestamp: new Date(m.createdAt),
        type: attachments && attachments.length > 0
          ? attachments[0].mediaType.startsWith("image/") ? "image" : "file"
          : "text",
        isMe,
        avatar: room.avatar,
      });
    }
    const msgs = encryptedMsgs.sort((a, b) =>
      a.timestamp.getTime() - b.timestamp.getTime()
    );
    return msgs;
  };

  const loadMessages = async (room: ChatRoom, isSelectedRoom: boolean) => {
    const msgs = await fetchMessagesForRoom(room, { limit: messageLimit });
    if (msgs.length > 0) {
      setCursor(msgs[0].timestamp.toISOString());
    } else {
      setCursor(null);
    }
    setHasMore(msgs.length === messageLimit);
    if (isSelectedRoom) {
      setMessages(msgs);
    }
    const lastMessage = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
    updateRoomLast(room.id, lastMessage);
  };

  const loadOlderMessages = async (room: ChatRoom) => {
    if (!hasMore() || loadingOlder()) return;
    setLoadingOlder(true);
    const msgs = await fetchMessagesForRoom(room, {
      limit: messageLimit,
      before: cursor() ?? undefined,
    });
    if (msgs.length > 0) {
      setCursor(msgs[0].timestamp.toISOString());
      setMessages((prev) => [...msgs, ...prev]);
    }
    setHasMore(msgs.length === messageLimit);
    setLoadingOlder(false);
  };

  const loadRooms = async () => {
    const user = account();
    if (!user) return;
    const rooms: ChatRoom[] = [
      {
        id: `${user.userName}@${getDomain()}`,
        name: "TAKO Keep",
        userName: user.userName,
        domain: getDomain(),
        avatar: "📝",
        unreadCount: 0,
        type: "memo",
        members: [`${user.userName}@${getDomain()}`],
        lastMessage: "...",
        lastMessageTime: undefined,
      },
    ];

    const handles = (await fetchDmList(user.id)).map((id) =>
      normalizeActor(id)
    );
    if (handles.length > 0) {
      try {
        const infos = await fetchUserInfoBatch(handles, user.id);
        if (infos.length > 0) {
          infos.forEach((info, idx) => {
            const handle = handles[idx];
            rooms.push({
              id: handle,
              name: info.displayName || info.userName,
              userName: info.userName,
              domain: info.domain,
              avatar: info.authorAvatar ||
                info.userName.charAt(0).toUpperCase(),
              unreadCount: 0,
              type: "dm",
              members: [handle],
              lastMessage: "...",
              lastMessageTime: undefined,
            });
          });
        }
      } catch (err) {
        console.error("Failed to load rooms", err);
      }
    }

    const unique = rooms.filter(
      (room, idx, arr) => arr.findIndex((r) => r.id === room.id) === idx,
    );
    setChatRooms(unique);
    // メッセージの取得は選択時に実行する
  };

  const sendMessage = async () => {
    const text = newMessage().trim();
    const roomId = selectedRoom();
    const user = account();
    if (!text && !mediaFile() || !roomId || !user) return;
    const room = chatRooms().find((r) => r.id === roomId);
    if (!room) return;
    if (useEncryption()) {
      let group = groups()[roomId];
      if (!group) {
        const kp = await ensureKeyPair();
        if (!kp) {
          alert("鍵情報が取得できないため送信できません");
          return;
        }
        const [partnerUser, partnerDomain] = splitActor(room.members[0]);
        const partnerPub = await getPartnerKey(partnerUser, partnerDomain);
        if (!partnerPub) {
          setPartnerHasKey(false);
          return;
        }
        setPartnerHasKey(true);
        const secret = await deriveMLSSecret(kp.privateKey, partnerPub);
        group = { members: room.members, epoch: Date.now(), secret };
        setGroups({ ...groups(), [roomId]: group });
        saveGroupStates();
      }
      if (!group) {
        setPartnerHasKey(false);
        return;
      }
      const note: Record<string, unknown> = {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Note",
        id: `urn:uuid:${crypto.randomUUID()}`,
        content: text,
      };
      if (mediaFile()) {
        const file = mediaFile()!;
        const enc = await encryptFile(file);
        const url = await uploadFile({
          content: enc.data,
          mediaType: enc.mediaType,
          key: enc.key,
          iv: enc.iv,
        });
        if (url) {
          const attType = file.type.startsWith("image/")
            ? "Image"
            : file.type.startsWith("video/")
            ? "Video"
            : file.type.startsWith("audio/")
            ? "Audio"
            : "Document";
          note.attachment = [{
            type: attType,
            url,
            mediaType: enc.mediaType,
            key: enc.key,
            iv: enc.iv,
          }];
        }
      }
      const cipher = await encryptGroupMessage(group, JSON.stringify(note));
      const success = await sendEncryptedMessage(
        `${user.userName}@${getDomain()}`,
        {
          to: room.members,
          content: cipher,
        },
      );
      if (!success) {
        alert("メッセージの送信に失敗しました");
        return;
      }
      if (room.type === "dm") {
        await addDm(user.id, room.members[0]);
      }
    } else {
      const note: Record<string, unknown> = {
        "@context": "https://www.w3.org/ns/activitystreams",
        type: "Note",
        id: `urn:uuid:${crypto.randomUUID()}`,
        content: text,
      };
      if (mediaFile()) {
        const file = mediaFile()!;
        const enc = await encryptFile(file);
        const url = await uploadFile({
          content: enc.data,
          mediaType: enc.mediaType,
          key: enc.key,
          iv: enc.iv,
        });
        if (url) {
          const attType = file.type.startsWith("image/")
            ? "Image"
            : file.type.startsWith("video/")
            ? "Video"
            : file.type.startsWith("audio/")
            ? "Audio"
            : "Document";
          note.attachment = [{
            type: attType,
            url,
            mediaType: enc.mediaType,
            key: enc.key,
            iv: enc.iv,
          }];
        }
      }
      const success = await sendPublicMessage(
        `${user.userName}@${getDomain()}`,
        {
          to: room.members,
          content: JSON.stringify(note),
          mediaType: "application/json",
          encoding: "utf-8",
        },
      );
      if (!success) {
        alert("メッセージの送信に失敗しました");
        return;
      }
      if (room.type === "dm") {
        await addDm(user.id, room.members[0]);
      }
    }
    const file = mediaFile();
    const prev = mediaPreview();
    setNewMessage("");
    setMediaFile(null);
    setMediaPreview(null);
    updateRoomLast(roomId, {
      id: "temp",
      author: `${user.userName}@${getDomain()}`,
      displayName: user.displayName || user.userName,
      address: `${user.userName}@${getDomain()}`,
      content: text,
      attachments: file
        ? [{ data: prev ?? "", mediaType: file.type }]
        : undefined,
      timestamp: new Date(),
      type: file ? file.type.startsWith("image/") ? "image" : "file" : "text",
      isMe: true,
      avatar: room.avatar,
    });
    loadMessages(room, true);
  };

  // 画面サイズ検出
  const checkMobile = () => {
    setIsMobile(globalThis.innerWidth < 768);
  };

  // モバイルでの部屋選択時の動作
  const selectRoom = (roomId: string) => {
    console.log("selected room:", roomId); // for debug
    setPartnerHasKey(true);
    setSelectedRoom(roomId);
    if (isMobile()) {
      setShowRoomList(false); // モバイルではチャット画面に切り替え
    }
    // メッセージの取得は selectedRoom 監視の createEffect に任せる
  };

  // チャット一覧に戻る（モバイル用）
  const backToRoomList = () => {
    setShowRoomList(true);
    setSelectedRoom(null); // チャンネル選択状態をリセット
  };

  // イベントリスナーの設定
  onMount(() => {
    checkMobile();
    globalThis.addEventListener("resize", checkMobile);
    // ルーム情報はアカウント取得後の createEffect で読み込む
    loadGroupStates();
    ensureKeyPair();
    const handler = async (msg: unknown) => {
      if (
        typeof msg === "object" &&
        msg !== null &&
        ((msg as { type?: string }).type === "encryptedMessage" ||
          (msg as { type?: string }).type === "publicMessage")
      ) {
        const data = (msg as {
          payload: {
            id: string;
            from: string;
            to: string[];
            content: string;
            mediaType: string;
            encoding: string;
            createdAt: string;
            attachments?: {
              url: string;
              mediaType: string;
              key?: string;
              iv?: string;
            }[];
          };
        }).payload;
        const user = account();
        if (!user) return;
        const self = `${user.userName}@${getDomain()}`;
        const partnerId = data.from === self
          ? data.to.find((v) => v !== self) ?? data.to[0]
          : data.from;
        let room = chatRooms().find((r) => r.id === partnerId);
        if (!room) {
          if (confirm(`${partnerId} からDMが届きました。許可しますか？`)) {
            const info = await fetchUserInfo(normalizeActor(partnerId));
            if (info) {
              room = {
                id: partnerId,
                name: info.displayName || info.userName,
                userName: info.userName,
                domain: info.domain,
                avatar: info.authorAvatar ||
                  info.userName.charAt(0).toUpperCase(),
                unreadCount: 0,
                type: "dm",
                members: [partnerId],
                lastMessage: "...",
                lastMessageTime: undefined,
              };
              setChatRooms((prev) => [...prev, room!]);
              await addDm(user.id, partnerId);
            } else {
              return;
            }
          } else {
            return;
          }
        }
        const isMe = data.from === self;
        const displayName = isMe
          ? user.displayName || user.userName
          : room.name;
        let text = data.content;
        let attachments: { data: string; mediaType: string }[] | undefined;
        if ((msg as { type?: string }).type === "encryptedMessage") {
          const group = groups()[room.id];
          if (group) {
            const plain = await decryptGroupMessage(group, data.content);
            if (plain) {
              const note = parseActivityPubNote(plain);
              text = note.content;
              const listAtt = Array.isArray(data.attachments)
                ? data.attachments
                : note.attachments;
              if (Array.isArray(listAtt)) {
                attachments = [];
                for (const at of listAtt) {
                  if (typeof at.url === "string") {
                    try {
                      const res = await fetch(at.url);
                      const buf = await res.arrayBuffer();
                      const enc = bufToB64(buf);
                      let dec = enc;
                      if (
                        typeof at.key === "string" &&
                        typeof at.iv === "string"
                      ) {
                        dec = await decryptFile(enc, at.key, at.iv);
                      }
                      const mt = typeof at.mediaType === "string"
                        ? at.mediaType
                        : "image/png";
                      attachments.push({ data: dec, mediaType: mt });
                    } catch {
                      /* ignore */
                    }
                  }
                }
              }
            }
          }
        } else {
          const note = parseActivityPubNote(data.content);
          text = note.content;
          const listAtt = Array.isArray(data.attachments)
            ? data.attachments
            : note.attachments;
          if (Array.isArray(listAtt)) {
            attachments = [];
            for (const at of listAtt) {
              if (typeof at.url === "string") {
                try {
                  const res = await fetch(at.url);
                  const buf = await res.arrayBuffer();
                  const enc = bufToB64(buf);
                  let dec = enc;
                  if (
                    typeof at.key === "string" &&
                    typeof at.iv === "string"
                  ) {
                    dec = await decryptFile(enc, at.key, at.iv);
                  }
                  const mt = typeof at.mediaType === "string"
                    ? at.mediaType
                    : "image/png";
                  attachments.push({ data: dec, mediaType: mt });
                } catch {
                  /* ignore */
                }
              }
            }
          }
        }
        const m: ChatMessage = {
          id: data.id,
          author: data.from,
          displayName,
          address: data.from,
          content: parseActivityPubContent(text),
          attachments,
          timestamp: new Date(data.createdAt),
          type: attachments && attachments.length > 0
            ? attachments[0].mediaType.startsWith("image/") ? "image" : "file"
            : "text",
          isMe,
          avatar: room.avatar,
        };
        setMessages((prev) => {
          if (prev.some((msg) => msg.id === m.id)) return prev;
          return [...prev, m];
        });
        updateRoomLast(room.id, m);
      }
    };
    addMessageHandler(handler);
    wsCleanup = () => removeMessageHandler(handler);
    // 初期表示時のメッセージ読み込みも
    // selectedRoom 監視の createEffect に任せる
    adjustHeight(textareaRef);
  });

  createEffect(() => {
    account();
    loadRooms();
  });

  createEffect(() => {
    const roomId = selectedRoom();
    const room = chatRooms().find((r) => r.id === roomId);
    const selfRoomId = getSelfRoomId(account());

    if (room) {
      loadMessages(room, true);
    } else if (roomId && roomId !== selfRoomId) {
      fetchUserInfo(normalizeActor(roomId)).then((info) => {
        if (!info) return;
        const newRoom: ChatRoom = {
          id: roomId,
          name: info.displayName || info.userName,
          userName: info.userName,
          domain: info.domain,
          avatar: info.authorAvatar || info.userName.charAt(0).toUpperCase(),
          unreadCount: 0,
          type: "dm",
          members: [roomId],
          lastMessage: "...",
          lastMessageTime: undefined,
        };
        setChatRooms((prev) => {
          if (prev.some((r) => r.id === newRoom.id)) return prev;
          return [...prev, newRoom];
        });
        loadMessages(newRoom, true);
      });
    } else {
      setMessages([]);
    }
  });

  // URLから直接チャットを開いた場合、モバイルでは自動的にルーム表示を切り替える
  createEffect(() => {
    if (!isMobile()) return;
    const roomId = selectedRoom();
    if (roomId && showRoomList()) {
      setShowRoomList(false);
    } else if (!roomId && !showRoomList()) {
      setShowRoomList(true);
    }
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
    adjustHeight(textareaRef);
  });

  createEffect(() => {
    if (useEncryption() && !partnerHasKey()) {
      alert("このユーザーは暗号化された会話に対応していません。");
    }
  });

  onCleanup(() => {
    globalThis.removeEventListener("resize", checkMobile);
    wsCleanup?.();
  });

  return (
    <>
      <div class="w-full h-screen overflow-hidden">
        <div
          class={`p-talk ${
            isMobile() ? (showRoomList() ? "" : "is-inview") : ""
          } flex`}
          id="chatmain"
        >
          {/* ...existing code... (room list, chat header, message list) ... */}
          <div class="p-talk-list min-h-screen">
            {/* ...existing code... */}
            <div class="p-talk-list-title">チャット</div>
            <div class="p-talk-list-search">
              <input type="text" placeholder="チャンネルを検索..." />
              <Show when={showAds()}>
                <div class="my-2">
                  <GoogleAd />
                </div>
              </Show>
            </div>
            <div class="p-talk-list-rooms pb-14 scrollbar">
              <ul class="p-talk-list-rooms__ul h-[calc(100vh-120px)] pb-[70px] scrollbar">
                <For each={chatRooms()}>
                  {(room) => (
                    <li
                      class={`c-talk-rooms ${
                        selectedRoom() === room.id ? "is-active" : ""
                      } flex items-center cursor-pointer`}
                      onClick={() => selectRoom(room.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        removeRoom(room.id);
                      }}
                      onTouchStart={() => startLongPress(room.id)}
                      onTouchEnd={cancelLongPress}
                      onTouchMove={cancelLongPress}
                      onTouchCancel={cancelLongPress}
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
          <div class="p-talk-chat">
            <Show
              when={selectedRoom()}
              fallback={
                <div class="flex-1 flex items-center justify-center bg-[#121212] min-h-0 h-full">
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
                {/* ...existing code... (chat header, message list) ... */}
                <div
                  class={`p-talk-chat-title ${selectedRoom() ? "" : "hidden"}`}
                  id="chatHeader"
                >
                  <div class="flex items-center gap-2 p-4">
                    <Show when={isMobile()}>
                      <button
                        type="button"
                        class="h-full"
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
                <div
                  class="p-talk-chat-main flex-grow overflow-y-auto pt-[48px]"
                  ref={(el) => (chatMainRef = el)}
                  onScroll={() => {
                    if (!chatMainRef) return;
                    if (chatMainRef.scrollTop < 100) {
                      const roomId = selectedRoom();
                      if (roomId) {
                        const room = chatRooms().find((r) => r.id === roomId);
                        if (room) loadOlderMessages(room);
                      }
                    }
                  }}
                >
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
                                  {isUrl(message.avatar) ||
                                      (typeof message.avatar === "string" &&
                                        message.avatar.startsWith(
                                          "data:image/",
                                        ))
                                    ? (
                                      <img
                                        src={message.avatar}
                                        alt="avatar"
                                        class="rounded-full"
                                      />
                                    )
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
                                    <Show when={message.content}>
                                      <p>{message.content}</p>
                                    </Show>
                                    <Show
                                      when={message.attachments &&
                                        message.attachments.length > 0}
                                    >
                                      <div style="margin-top:4px;">
                                        <For each={message.attachments}>
                                          {(att) => (
                                            <Switch
                                              fallback={
                                                <a
                                                  href={`data:${att.mediaType};base64,${att.data}`}
                                                  download
                                                  class="text-blue-400 underline"
                                                >
                                                  ファイル
                                                </a>
                                              }
                                            >
                                              <Match
                                                when={att.mediaType.startsWith(
                                                  "image/",
                                                )}
                                              >
                                                <img
                                                  src={`data:${att.mediaType};base64,${att.data}`}
                                                  alt="image"
                                                  style={{
                                                    "max-width": "200px",
                                                    "max-height": "200px",
                                                  }}
                                                />
                                              </Match>
                                              <Match
                                                when={att.mediaType.startsWith(
                                                  "video/",
                                                )}
                                              >
                                                <video
                                                  src={`data:${att.mediaType};base64,${att.data}`}
                                                  controls
                                                  style={{
                                                    "max-width": "200px",
                                                    "max-height": "200px",
                                                  }}
                                                />
                                              </Match>
                                              <Match
                                                when={att.mediaType.startsWith(
                                                  "audio/",
                                                )}
                                              >
                                                <audio
                                                  src={`data:${att.mediaType};base64,${att.data}`}
                                                  controls
                                                />
                                              </Match>
                                            </Switch>
                                          )}
                                        </For>
                                      </div>
                                    </Show>
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
                {/* --- ここから送信UIをold_takosui/send.tsx風に --- */}
                <div
                  class="p-talk-chat-send relative bg-[#1e1e1e] py-1 px-2"
                  style={{
                    "padding-bottom":
                      "calc(env(safe-area-inset-bottom, 4px) + 4px)",
                  }}
                >
                  <form
                    class="p-talk-chat-send__form m-0"
                    onSubmit={(e) => e.preventDefault()}
                  >
                    <div class="p-talk-chat-send__msg flex items-center gap-1">
                      <div
                        class="p-talk-chat-send__dummy"
                        aria-hidden="true"
                        style="min-width:0;"
                      >
                        {newMessage().split("\n").map((row) => (
                          <>
                            {row}
                            <br />
                          </>
                        ))}
                      </div>
                      <label class="flex-1">
                        <textarea
                          id="msg"
                          class="p-talk-chat-send__textarea w-full py-1 px-2 text-base leading-tight resize-none"
                          rows="1"
                          ref={(el) => (textareaRef = el)}
                          value={newMessage()}
                          placeholder="メッセージを入力"
                          style="min-height:32px;max-height:80px;"
                          onInput={(e) => {
                            setNewMessage(e.target.value);
                            adjustHeight(textareaRef);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                              e.preventDefault();
                              sendMessage();
                            }
                          }}
                        />
                      </label>
                      <Show when={mediaPreview()}>
                        <div class="ml-2">
                          <Switch
                            fallback={
                              <a
                                href={mediaPreview()!}
                                download
                                class="text-blue-400 underline"
                              >
                                {mediaFile()?.name || "ファイル"}
                              </a>
                            }
                          >
                            <Match
                              when={mediaFile()?.type.startsWith("image/")}
                            >
                              <img
                                src={mediaPreview()!}
                                alt="preview"
                                style={{
                                  "max-width": "80px",
                                  "max-height": "80px",
                                }}
                              />
                            </Match>
                            <Match
                              when={mediaFile()?.type.startsWith("video/")}
                            >
                              <video
                                src={mediaPreview()!}
                                controls
                                style={{
                                  "max-width": "80px",
                                  "max-height": "80px",
                                }}
                              />
                            </Match>
                            <Match
                              when={mediaFile()?.type.startsWith("audio/")}
                            >
                              <audio src={mediaPreview()!} controls />
                            </Match>
                          </Switch>
                        </div>
                      </Show>
                    </div>
                    <div class="flex items-center gap-1 mt-1">
                      <div
                        class={`flex items-center px-2 py-0.5 rounded-full text-xs ${
                          useEncryption()
                            ? "bg-green-700 bg-opacity-25 text-green-400"
                            : "bg-gray-700 bg-opacity-25 text-gray-300"
                        }`}
                        title={useEncryption()
                          ? "暗号化オン (クリックで切り替え)"
                          : "暗号化オフ (クリックで切り替え)"}
                        style="cursor: pointer; min-height:28px;"
                        onClick={toggleEncryption}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-3.5 w-3.5 mr-1"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fill-rule="evenodd"
                            d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                            clip-rule="evenodd"
                          />
                        </svg>
                        {useEncryption() ? "暗号化" : "平文"}
                      </div>
                      {/* メニューボタン（ダミー/本来はメニュー展開） */}
                      <div class="relative">
                        <div
                          class="p-2 cursor-pointer hover:bg-[#2e2e2e] rounded-full transition-colors"
                          // onClick={toggleMenu}
                          title="メニューを開く"
                          style="min-height:28px;"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                          >
                            <line x1="12" y1="5" x2="12" y2="19"></line>
                            <line x1="5" y1="12" x2="19" y2="12"></line>
                          </svg>
                        </div>
                      </div>
                      {/* メディア添付ボタン */}
                      <div
                        class="p-2 cursor-pointer hover:bg-[#2e2e2e] rounded-full transition-colors"
                        onClick={() => fileInput?.click()}
                        title="ファイルを送信"
                        style="min-height:28px;"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <rect
                            x="3"
                            y="3"
                            width="18"
                            height="18"
                            rx="2"
                            ry="2"
                          >
                          </rect>
                          <circle cx="8.5" cy="8.5" r="1.5"></circle>
                          <polyline points="21 15 16 10 5 21"></polyline>
                        </svg>
                        <input
                          ref={(el) => (fileInput = el)}
                          type="file"
                          accept="*/*"
                          class="hidden"
                          style="display:none;"
                          onChange={(e) => {
                            const f = (e.currentTarget as HTMLInputElement)
                              .files?.[0];
                            if (!f) return;
                            setMediaFile(f);
                            const reader = new FileReader();
                            reader.onload = () => {
                              setMediaPreview(reader.result as string);
                            };
                            reader.readAsDataURL(f);
                          }}
                        />
                      </div>
                      {/* 送信ボタン */}
                      <div
                        class={useEncryption() && !encryptionKey()
                          ? "p-talk-chat-send__button opacity-50 cursor-not-allowed"
                          : newMessage().trim() || mediaFile()
                          ? "p-talk-chat-send__button is-active"
                          : "p-talk-chat-send__button"}
                        onClick={useEncryption() && !encryptionKey()
                          ? undefined
                          : sendMessage}
                        style="min-height:28px;"
                        title={useEncryption() && !encryptionKey()
                          ? "暗号化キー未入力のため送信できません"
                          : ""}
                      >
                        <svg
                          width="800px"
                          height="800px"
                          viewBox="0 0 28 28"
                          version="1.1"
                          xmlns="http://www.w3.org/2000/svg"
                        >
                          <g stroke="none" stroke-width="1" fill="none">
                            <g fill="#000000">
                              <path d="M3.78963301,2.77233335 L24.8609339,12.8499121 C25.4837277,13.1477699 25.7471402,13.8941055 25.4492823,14.5168992 C25.326107,14.7744476 25.1184823,14.9820723 24.8609339,15.1052476 L3.78963301,25.1828263 C3.16683929,25.4806842 2.42050372,25.2172716 2.12264586,24.5944779 C1.99321184,24.3238431 1.96542524,24.015685 2.04435886,23.7262618 L4.15190935,15.9983421 C4.204709,15.8047375 4.36814355,15.6614577 4.56699265,15.634447 L14.7775879,14.2474874 C14.8655834,14.2349166 14.938494,14.177091 14.9721837,14.0981464 L14.9897199,14.0353553 C15.0064567,13.9181981 14.9390703,13.8084248 14.8334007,13.7671556 L14.7775879,13.7525126 L4.57894108,12.3655968 C4.38011873,12.3385589 4.21671819,12.1952832 4.16392965,12.0016992 L2.04435886,4.22889788 C1.8627142,3.56286745 2.25538645,2.87569101 2.92141688,2.69404635 C3.21084015,2.61511273 3.51899823,2.64289932 3.78963301,2.77233335 Z">
                              </path>
                            </g>
                          </g>
                        </svg>
                      </div>
                      <Show when={useEncryption() && !encryptionKey()}>
                        <button
                          type="button"
                          onClick={() => props.onShowEncryptionKeyForm?.()}
                          class="p-talk-chat-send__button is-active"
                          title="暗号化キーを設定する"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            class="h-6 w-6"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                          >
                            <path d="M12 2C9.243 2 7 4.243 7 7v3H6a2 2 0 00-2 2v8a2 2 0 002 2h12a2 2 0 002-2v-8a2 2 0 00-2-2h-1V7c0-2.757-2.243-5-5-5zm0 2c1.654 0 3 1.346 3 3v3h-6V7c0-1.654 1.346-3 3-3z" />
                          </svg>
                        </button>
                      </Show>
                    </div>
                  </form>
                </div>
                {/* --- 送信UIここまで --- */}
              </div>
            </Show>
          </div>
        </div>
      </div>
    </>
  );
}

function splitActor(actor: ActorID): [string, string | undefined] {
  if (actor.startsWith("http")) {
    const url = new URL(actor);
    return [url.pathname.split("/").pop()!, url.hostname];
  }
  if (actor.includes("@")) {
    const [user, domain] = actor.split("@");
    return [user, domain];
  }
  return [actor, undefined];
}

function normalizeActor(actor: ActorID): string {
  if (actor.startsWith("http")) {
    try {
      const url = new URL(actor);
      const name = url.pathname.split("/").pop()!;
      return `${name}@${url.hostname}`;
    } catch {
      return actor;
    }
  }
  return actor;
}
