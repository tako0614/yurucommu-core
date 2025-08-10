import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { useAtom } from "solid-jotai";
import { selectedRoomState } from "../states/chat.ts";
import { type Account, activeAccount } from "../states/account.ts";
import { fetchUserInfo, fetchUserInfoBatch } from "./microblog/api.ts";
import {
  addKeyPackage,
  addRoom,
  addRoomMember,
  fetchEncryptedKeyPair,
  fetchEncryptedMessages,
  fetchKeepMessages,
  fetchKeyPackages,
  fetchWelcome,
  removeRoom as deleteRoom,
  removeRoomMember,
  saveEncryptedKeyPair,
  searchRooms,
  sendCommit,
  sendEncryptedMessage,
  sendKeepMessage,
  sendProposal,
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
import { isAdsenseEnabled, loadAdsenseConfig } from "../utils/adsense.ts";
import { ChatRoomList } from "./chat/ChatRoomList.tsx";
import { ChatTitleBar } from "./chat/ChatTitleBar.tsx";
import { ChatMessageList } from "./chat/ChatMessageList.tsx";
import { ChatSendForm } from "./chat/ChatSendForm.tsx";
import { GroupCreateDialog } from "./chat/GroupCreateDialog.tsx";
import type { ActorID, ChatMessage, Room } from "./chat/types.ts";
import { b64ToBuf, bufToB64 } from "../../../shared/buffer.ts";
import {
  decodeMLSMessage,
  encodeMLSMessage,
} from "../../../shared/mls_message.ts";

function adjustHeight(el?: HTMLTextAreaElement) {
  if (el) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }
}

function bufToUrl(buf: ArrayBuffer, type: string): string {
  const blob = new Blob([buf], { type });
  return URL.createObjectURL(blob);
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

interface ActivityPubPreview {
  url: string;
  mediaType: string;
  width?: number;
  height?: number;
  key?: string;
  iv?: string;
}

interface ActivityPubAttachment {
  url: string;
  mediaType: string;
  key?: string;
  iv?: string;
  preview?: ActivityPubPreview;
}

interface ParsedActivityPubNote {
  id?: string;
  content: string;
  attachments?: ActivityPubAttachment[];
}

function parseActivityPubNote(text: string): ParsedActivityPubNote {
  try {
    const obj = JSON.parse(text);
    if (obj && typeof obj === "object" && typeof obj.content === "string") {
      const rawAtt = (obj as { attachment?: unknown }).attachment;
      const attachments = Array.isArray(rawAtt)
        ? rawAtt
          .map((a: unknown) => {
            if (
              a && typeof a === "object" &&
              typeof (a as { url?: unknown }).url === "string"
            ) {
              const mediaType =
                typeof (a as { mediaType?: unknown }).mediaType === "string"
                  ? (a as { mediaType: string }).mediaType
                  : "application/octet-stream";
              const key = typeof (a as { key?: unknown }).key === "string"
                ? (a as { key: string }).key
                : undefined;
              const iv = typeof (a as { iv?: unknown }).iv === "string"
                ? (a as { iv: string }).iv
                : undefined;
              const rawPrev = (a as { preview?: unknown }).preview;
              let preview: ActivityPubPreview | undefined;
              if (
                rawPrev && typeof rawPrev === "object" &&
                typeof (rawPrev as { url?: unknown }).url === "string"
              ) {
                preview = {
                  url: (rawPrev as { url: string }).url,
                  mediaType:
                    typeof (rawPrev as { mediaType?: unknown }).mediaType ===
                        "string"
                      ? (rawPrev as { mediaType: string }).mediaType
                      : "image/jpeg",
                  width: typeof (rawPrev as { width?: unknown }).width ===
                      "number"
                    ? (rawPrev as { width: number }).width
                    : undefined,
                  height: typeof (rawPrev as { height?: unknown }).height ===
                      "number"
                    ? (rawPrev as { height: number }).height
                    : undefined,
                  key: typeof (rawPrev as { key?: unknown }).key === "string"
                    ? (rawPrev as { key: string }).key
                    : undefined,
                  iv: typeof (rawPrev as { iv?: unknown }).iv === "string"
                    ? (rawPrev as { iv: string }).iv
                    : undefined,
                };
              }
              return {
                url: (a as { url: string }).url,
                mediaType,
                key,
                iv,
                preview,
              } as ActivityPubAttachment;
            }
            return null;
          })
          .filter((
            a: ActivityPubAttachment | null,
          ): a is ActivityPubAttachment => !!a)
        : undefined;
      const id = typeof (obj as { id?: unknown }).id === "string"
        ? (obj as { id: string }).id
        : undefined;
      return { id, content: obj.content, attachments };
    }
  } catch {
    /* ignore */
  }
  return { content: text };
}

function expandMembers(members: ActorID[]): { to: ActorID[]; cc: ActorID[] } {
  const unique = Array.from(new Set(members));
  const [primary, ...rest] = unique;
  return { to: primary ? [primary] : [], cc: rest };
}

async function encryptFile(file: File) {
  const buf = await file.arrayBuffer();
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, buf);
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return {
    data: enc,
    key: bufToB64(rawKey),
    iv: bufToB64(iv.buffer),
    mediaType: file.type,
    name: file.name,
  };
}

async function decryptFile(
  data: ArrayBuffer,
  keyB64: string,
  ivB64: string,
): Promise<ArrayBuffer> {
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
    data,
  );
  return dec;
}
// 画像からプレビュー用の縮小画像を生成
async function generateImagePreview(
  file: File,
): Promise<{ file: File; width: number; height: number } | null> {
  return await new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 320;
      const scale = Math.min(1, max / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (blob) {
            resolve({
              file: new File([blob], `preview-${file.name}.jpg`, {
                type: "image/jpeg",
              }),
              width: w,
              height: h,
            });
          } else {
            resolve(null);
          }
        },
        "image/jpeg",
        0.8,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}
// 動画からプレビュー用の静止画を生成
async function generateVideoPreview(
  file: File,
): Promise<{ file: File; width: number; height: number } | null> {
  return await new Promise((resolve) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.muted = true;
    video.src = url;
    video.onloadeddata = () => {
      const max = 320;
      const scale = Math.min(1, max / video.videoWidth);
      const w = Math.round(video.videoWidth * scale);
      const h = Math.round(video.videoHeight * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        URL.revokeObjectURL(url);
        resolve(null);
        return;
      }
      ctx.drawImage(video, 0, 0, w, h);
      canvas.toBlob(
        (blob) => {
          URL.revokeObjectURL(url);
          if (blob) {
            resolve({
              file: new File([blob], `preview-${file.name}.jpg`, {
                type: "image/jpeg",
              }),
              width: w,
              height: h,
            });
          } else {
            resolve(null);
          }
        },
        "image/jpeg",
        0.8,
      );
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
  });
}
// 添付ファイルをアップロードし、必要ならプレビューも付与
async function buildAttachment(file: File) {
  const enc = await encryptFile(file);
  const url = await uploadFile({
    content: enc.data,
    mediaType: enc.mediaType,
    key: enc.key,
    iv: enc.iv,
    name: file.name,
  });
  if (!url) return undefined;
  let preview: ActivityPubPreview | undefined;
  if (file.type.startsWith("image/")) {
    const p = await generateImagePreview(file);
    if (p) {
      const pEnc = await encryptFile(p.file);
      const pUrl = await uploadFile({
        content: pEnc.data,
        mediaType: pEnc.mediaType,
        key: pEnc.key,
        iv: pEnc.iv,
        name: p.file.name,
      });
      if (pUrl) {
        preview = {
          url: pUrl,
          mediaType: pEnc.mediaType,
          key: pEnc.key,
          iv: pEnc.iv,
          width: p.width,
          height: p.height,
        };
      }
    }
  } else if (file.type.startsWith("video/")) {
    const p = await generateVideoPreview(file);
    if (p) {
      const pEnc = await encryptFile(p.file);
      const pUrl = await uploadFile({
        content: pEnc.data,
        mediaType: pEnc.mediaType,
        key: pEnc.key,
        iv: pEnc.iv,
        name: p.file.name,
      });
      if (pUrl) {
        preview = {
          url: pUrl,
          mediaType: pEnc.mediaType,
          key: pEnc.key,
          iv: pEnc.iv,
          width: p.width,
          height: p.height,
        };
      }
    }
  }
  const attType = file.type.startsWith("image/")
    ? "Image"
    : file.type.startsWith("video/")
    ? "Video"
    : file.type.startsWith("audio/")
    ? "Audio"
    : "Document";
  const att: Record<string, unknown> = {
    type: attType,
    url,
    mediaType: enc.mediaType,
    key: enc.key,
    iv: enc.iv,
  };
  if (preview) {
    att.preview = { type: "Image", ...preview };
  }
  return att;
}

function getSelfRoomId(user: Account | null): string | null {
  return user ? `${user.userName}@${getDomain()}` : null;
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
  const [chatRooms, setChatRooms] = createSignal<Room[]>([]);

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
  const selectedRoomInfo = createMemo(() =>
    chatRooms().find((r) => r.id === selectedRoom()) ?? null
  );
  const [showGroupDialog, setShowGroupDialog] = createSignal(false);
  const [groupDialogMode, setGroupDialogMode] = createSignal<
    "create" | "invite" | "dm"
  >("create");
  const [segment, setSegment] = createSignal<"all" | "people" | "groups">("all");

  // ルーム重複防止ユーティリティ
  function upsertRooms(next: Room[]) {
    setChatRooms((prev) => {
      const map = new Map<string, Room>();
      // 既存を入れてから next で上書き（最新情報を反映）
      for (const r of prev) map.set(r.id, r);
      for (const r of next) map.set(r.id, r);
      return Array.from(map.values());
    });
  }
  function upsertRoom(room: Room) {
    upsertRooms([room]);
  }
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
    if (!room) return;
    if (!confirm(`${room.name} のルームを削除しますか？`)) return;
    if (await deleteRoom(user.id, roomId)) {
      setChatRooms((prev) => prev.filter((r) => r.id !== roomId));
      if (selectedRoom() === roomId) {
        setSelectedRoom(null);
        setMessages([]);
      }
    }
  };

  const leaveRoom = async (roomId: string) => {
    const user = account();
    if (!user) return;
    const room = chatRooms().find((r) => r.id === roomId);
    if (!room) return;
    if (!confirm(`${room.name} から退出しますか？`)) return;
    const me = `${user.userName}@${getDomain()}` as ActorID;
    await removeRoomMember(roomId, me);
    const remaining = room.members.filter((m) => m !== me);
    const { to: toList, cc: ccList } = expandMembers(remaining);
    const proposal = { type: "remove" as const, member: me };
    await sendProposal(me, toList, ccList, proposal);
    await sendCommit(me, toList, ccList, {
      type: "commit",
      epoch: 0,
      proposals: [proposal],
    });
    if (await deleteRoom(user.id, roomId)) {
      setChatRooms((prev) => prev.filter((r) => r.id !== roomId));
      if (selectedRoom() === roomId) {
        setSelectedRoom(null);
        setMessages([]);
      }
    }
  };

  const kickMember = async (roomId: string, member: string) => {
    const user = account();
    if (!user) return;
    const room = chatRooms().find((r) => r.id === roomId);
    if (!room) return;
    const target = normalizeActor(member as ActorID);
    if (!room.members.includes(target)) return;
    if (!confirm(`${target} を追放しますか？`)) return;
    await removeRoomMember(roomId, target);
    const remaining = room.members.filter((m) => m !== target);
    const { to: toList, cc: ccList } = expandMembers(remaining);
    const proposal = { type: "remove" as const, member: target };
    await sendProposal(
      `${user.userName}@${getDomain()}`,
      toList,
      ccList,
      proposal,
    );
    await sendCommit(`${user.userName}@${getDomain()}`, toList, ccList, {
      type: "commit",
      epoch: 0,
      proposals: [proposal],
    });
    setChatRooms((prev) =>
      prev.map((r) => r.id === roomId ? { ...r, members: remaining } : r)
    );
  };

  const promptKick = () => {
    const roomId = selectedRoom();
    if (!roomId) return;
    const target = globalThis.prompt(
      "追放するメンバーのハンドルを入力してください",
    );
    if (target) kickMember(roomId, target);
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
    room: Room,
    params?: { limit?: number; before?: string; after?: string },
  ): Promise<ChatMessage[]> => {
    const user = account();
    if (!user) return [];
    if (room.type === "memo") {
      const list = await fetchKeepMessages(
        `${user.userName}@${getDomain()}`,
        params,
      );
      const msgs = list.map((m) => ({
        id: m.id,
        author: `${user.userName}@${getDomain()}`,
        displayName: user.displayName || user.userName,
        address: `${user.userName}@${getDomain()}`,
        content: m.content,
        timestamp: new Date(m.createdAt),
        type: "text",
        isMe: true,
        avatar: room.avatar,
      }));
      return msgs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }
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
      const decoded = decodeMLSMessage(m.content);
      if (!decoded) {
        const isMe = m.from === `${user.userName}@${getDomain()}`;
        const displayName = isMe
          ? user.displayName || user.userName
          : room.name;
        encryptedMsgs.push({
          id: m.id,
          author: m.from,
          displayName,
          address: m.from,
          content: m.content,
          timestamp: new Date(m.createdAt),
          type: "text",
          isMe,
          avatar: room.avatar,
        });
        continue;
      }
      const note = decoded.type === "PrivateMessage"
        ? parseActivityPubNote(
          (await decryptGroupMessage(group, decoded.body)) ?? decoded.body,
        )
        : parseActivityPubNote(decoded.body);
      const text = note.content;
      const listAtt = Array.isArray(m.attachments)
        ? m.attachments
        : note.attachments;
      let attachments:
        | {
          data?: string;
          url?: string;
          mediaType: string;
          preview?: { url?: string; data?: string; mediaType?: string };
        }[]
        | undefined;
      if (Array.isArray(listAtt)) {
        attachments = [];
        for (const at of listAtt) {
          if (typeof at.url === "string") {
            const mt = typeof at.mediaType === "string"
              ? at.mediaType
              : "application/octet-stream";
            let preview;
            if (at.preview && typeof at.preview.url === "string") {
              const pmt = typeof at.preview.mediaType === "string"
                ? at.preview.mediaType
                : "image/jpeg";
              try {
                const pres = await fetch(at.preview.url);
                let pbuf = await pres.arrayBuffer();
                if (
                  typeof at.preview.key === "string" &&
                  typeof at.preview.iv === "string"
                ) {
                  pbuf = await decryptFile(pbuf, at.preview.key, at.preview.iv);
                }
                preview = { url: bufToUrl(pbuf, pmt), mediaType: pmt };
              } catch {
                preview = { url: at.preview.url, mediaType: pmt };
              }
            }
            try {
              const res = await fetch(at.url);
              let buf = await res.arrayBuffer();
              if (typeof at.key === "string" && typeof at.iv === "string") {
                buf = await decryptFile(buf, at.key, at.iv);
              }
              if (
                mt.startsWith("video/") ||
                mt.startsWith("audio/") ||
                buf.byteLength > 1024 * 1024
              ) {
                attachments.push({
                  url: bufToUrl(buf, mt),
                  mediaType: mt,
                  preview,
                });
              } else {
                attachments.push({
                  data: bufToB64(buf),
                  mediaType: mt,
                  preview,
                });
              }
            } catch {
              attachments.push({ url: at.url, mediaType: mt, preview });
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

  const loadMessages = async (room: Room, isSelectedRoom: boolean) => {
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

  const loadOlderMessages = async (room: Room) => {
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
    const rooms: Room[] = [
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
    const list = await searchRooms(user.id);
    for (const r of list) {
      rooms.push({
        id: r.id,
        name: r.name ?? "",
        userName: user.userName,
        domain: getDomain(),
        avatar: r.icon ?? (r.name ? r.name.charAt(0).toUpperCase() : "👥"),
        unreadCount: 0,
        type: "group",
        members: r.members,
        hasName: r.hasName,
        hasIcon: r.hasIcon,
        lastMessage: "...",
        lastMessageTime: undefined,
      });
    }

    await applyDisplayFallback(rooms);

    const unique = rooms.filter(
      (room, idx, arr) => arr.findIndex((r) => r.id === room.id) === idx,
    );
    setChatRooms(unique);
    // メッセージの取得は選択時に実行する
  };

  const applyDisplayFallback = async (rooms: Room[]) => {
    const user = account();
    if (!user) return;
    const selfHandle = `${user.userName}@${getDomain()}` as ActorID;
    const twoNoName = rooms.filter((r) => r.type !== "memo" && ((r.members?.length ?? 0) + 1 === 2) && !(r.hasName || r.hasIcon));
    const ids = twoNoName
      .map((r) => r.members.find((m) => m !== selfHandle))
      .filter((v): v is string => !!v);
    if (ids.length > 0) {
      const infos = await fetchUserInfoBatch(ids, user.id);
      for (let i = 0; i < twoNoName.length; i++) {
        const info = infos[i];
        const r = twoNoName[i];
        if (info) {
          r.name = info.displayName || info.userName;
          r.avatar = info.authorAvatar || r.avatar;
        }
      }
    }
    // 3人以上の自動生成（簡易）
    const multi = rooms.filter((r) => r.type !== "memo" && ((r.members?.length ?? 0) + 1) >= 3 && !(r.hasName));
    const needIds = Array.from(new Set(multi.flatMap((r) => r.members)));
    if (needIds.length > 0) {
      const infos = await fetchUserInfoBatch(needIds, user.id);
      const map = new Map<string, typeof infos[number]>();
      for (let i = 0; i < needIds.length; i++) map.set(needIds[i], infos[i]);
      for (const r of multi) {
        const names = r.members.map((m) => map.get(m)?.displayName || map.get(m)?.userName).filter(Boolean) as string[];
        const top = names.slice(0, 2);
        const rest = Math.max(0, names.length + 1 - top.length - 1); // +1 = 自分
        r.name = top.length > 0 ? `${top.join("、")}${rest > 0 ? ` ほか${rest}名` : ""}` : r.name;
        r.avatar = r.avatar || "👥";
      }
    }
  };

  const openGroupDialog = () => {
    setGroupDialogMode("create");
    setShowGroupDialog(true);
  };

  const openInviteDialog = () => {
    setGroupDialogMode("invite");
    setShowGroupDialog(true);
  };

  const openDmDialog = () => {
    setGroupDialogMode("dm");
    setShowGroupDialog(true);
  };

  const createGroup = async (name: string, membersInput: string) => {
    const user = account();
    if (!user) return;
    const members = membersInput.split(",").map((s) => normalizeActor(s.trim()))
      .filter(Boolean) as ActorID[];
    // 名前未設定（空文字）は 1:1 作成時に許容
    if (members.length === 0) return;
    const id = crypto.randomUUID();
    const room: Room = {
      id,
      name,
      userName: user.userName,
      domain: getDomain(),
      avatar: name ? name.charAt(0).toUpperCase() : "👥",
      unreadCount: 0,
      type: "group",
      members,
      hasName: !!name && name.trim() !== "",
      hasIcon: false,
      lastMessage: "...",
      lastMessageTime: undefined,
    };
    // 1:1（name 未設定）なら相手プロフィールで見た目をフォールバック
    await applyDisplayFallback([room]);
    setChatRooms((prev) => [...prev, room]);
    await addRoom(user.id, { id, name, members });
    const allMembers: ActorID[] = [
      `${user.userName}@${getDomain()}` as ActorID,
      ...members,
    ];
    const { to: toList, cc: ccList } = expandMembers(allMembers);
    const proposals = members.map((m) => ({ type: "add", member: m }));
    for (const p of proposals) {
      await sendProposal(
        `${user.userName}@${getDomain()}`,
        toList,
        ccList,
        p,
      );
    }
    const commit = {
      type: "commit" as const,
      epoch: 0,
      proposals,
      welcomes: members.map((m) => ({
        type: "welcome" as const,
        member: m,
        epoch: 0,
        tree: {},
        secret: "",
      })),
    };
    await sendCommit(
      `${user.userName}@${getDomain()}`,
      toList,
      ccList,
      commit,
    );
    await fetchWelcome(`${user.userName}@${getDomain()}`, id);
    setShowGroupDialog(false);
  };

  const inviteMembers = async (membersInput: string) => {
    const user = account();
    const roomId = selectedRoom();
    if (!user || !roomId) return;
    const room = chatRooms().find((r) => r.id === roomId);
    if (!room) return;
    const newMembers = membersInput.split(",").map((s) =>
      normalizeActor(s.trim())
    )
      .filter((m) => m && !room.members.includes(m)) as ActorID[];
    if (newMembers.length === 0) return;
    for (const m of newMembers) {
      await addRoomMember(roomId, m);
    }
    const allMembers: ActorID[] = [
      `${user.userName}@${getDomain()}` as ActorID,
      ...room.members,
    ];
    const { to: toList, cc: ccList } = expandMembers(allMembers);
    const proposals = newMembers.map((m) => ({
      type: "add" as const,
      member: m,
    }));
    for (const p of proposals) {
      await sendProposal(
        `${user.userName}@${getDomain()}`,
        toList,
        ccList,
        p,
      );
    }
    const commit = {
      type: "commit" as const,
      epoch: 0,
      proposals,
      welcomes: newMembers.map((m) => ({
        type: "welcome" as const,
        member: m,
        epoch: 0,
        tree: {},
        secret: "",
      })),
    };
    await sendCommit(
      `${user.userName}@${getDomain()}`,
      toList,
      ccList,
      commit,
    );
    setChatRooms((prev) =>
      prev.map((r) =>
        r.id === roomId ? { ...r, members: [...r.members, ...newMembers] } : r
      )
    );
    setShowGroupDialog(false);
  };

  const sendMessage = async () => {
    const text = newMessage().trim();
    const roomId = selectedRoom();
    const user = account();
    if (!text && !mediaFile() || !roomId || !user) return;
    const room = chatRooms().find((r) => r.id === roomId);
    if (!room) return;
    if (room.type === "memo") {
      const res = await sendKeepMessage(
        `${user.userName}@${getDomain()}`,
        text,
      );
      if (!res) {
        alert("メモの保存に失敗しました");
        return;
      }
      const msg: ChatMessage = {
        id: res.id,
        author: `${user.userName}@${getDomain()}`,
        displayName: user.displayName || user.userName,
        address: `${user.userName}@${getDomain()}`,
        content: res.content,
        timestamp: new Date(res.createdAt),
        type: "text",
        isMe: true,
        avatar: room.avatar,
      };
      setMessages((prev) => [...prev, msg]);
      setNewMessage("");
      setMediaFile(null);
      setMediaPreview(null);
      return;
    }
    const { to: toList, cc: ccList } = expandMembers(room.members);
    // クライアント側で仮のメッセージIDを生成しておく
    const localId = crypto.randomUUID();
    const group = groups()[roomId];
    if (!group) {
      alert("グループが初期化されていないため送信できません");
      return;
    }
    const note: Record<string, unknown> = {
      "@context": "https://www.w3.org/ns/activitystreams",
      type: "Note",
      id: `urn:uuid:${localId}`,
      content: text,
    };
    if (mediaFile()) {
      const file = mediaFile()!;
      const att = await buildAttachment(file);
      if (att) note.attachment = [att];
    }
    const cipher = await encryptGroupMessage(group, JSON.stringify(note));
    const msg = encodeMLSMessage("PrivateMessage", cipher);
    const success = await sendEncryptedMessage(
      `${user.userName}@${getDomain()}`,
      toList,
      ccList,
      {
        id: `urn:uuid:${localId}`,
        content: msg,
        mediaType: "message/mls",
        encoding: "base64",
      },
    );
    if (!success) {
      alert("メッセージの送信に失敗しました");
      return;
    }
    // 入力欄をクリア
    setNewMessage("");
    setMediaFile(null);
    setMediaPreview(null);
    // WebSocketからメッセージ受信を待つため、即座の表示は行わない
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

    // WebSocket からのメッセージを安全に型ガードして処理する
    interface IncomingAttachment {
      url: string;
      mediaType: string;
      key?: string;
      iv?: string;
    }
    interface IncomingPayload {
      id: string;
      from: string;
      to: string[];
      content: string;
      mediaType: string;
      encoding: string;
      createdAt: string;
      attachments?: IncomingAttachment[];
    }
    type IncomingMsgType = "encryptedMessage" | "publicMessage";
    interface IncomingMessage {
      type: IncomingMsgType;
      payload: IncomingPayload;
    }
    const isStringArray = (v: unknown): v is string[] =>
      Array.isArray(v) && v.every((x) => typeof x === "string");

    const isAttachment = (v: unknown): v is IncomingAttachment =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as { url?: unknown }).url === "string" &&
      typeof (v as { mediaType?: unknown }).mediaType === "string" &&
      (typeof (v as { key?: unknown }).key === "string" ||
        typeof (v as { key?: unknown }).key === "undefined") &&
      (typeof (v as { iv?: unknown }).iv === "string" ||
        typeof (v as { iv?: unknown }).iv === "undefined");

    const isPayload = (v: unknown): v is IncomingPayload => {
      if (typeof v !== "object" || v === null) return false;
      const o = v as Record<string, unknown>;
      const base = typeof o.id === "string" &&
        typeof o.from === "string" &&
        isStringArray(o.to) &&
        typeof o.content === "string" &&
        typeof o.mediaType === "string" &&
        typeof o.encoding === "string" &&
        typeof o.createdAt === "string";
      if (!base) return false;
      if (typeof o.attachments === "undefined") return true;
      return Array.isArray(o.attachments) && o.attachments.every(isAttachment);
    };

    const isIncomingMessage = (v: unknown): v is IncomingMessage => {
      if (typeof v !== "object" || v === null) return false;
      const o = v as Record<string, unknown>;
      const t = o.type;
      if (t !== "encryptedMessage" && t !== "publicMessage") return false;
      return isPayload(o.payload);
    };

    const handler = async (msg: unknown) => {
      if (!isIncomingMessage(msg)) {
        // 想定外のメッセージは無視
        return;
      }
      const data = msg.payload;
      const user = account();
      if (!user) return;

      // フィルタ: 自分宛て/自分発でないメッセージは無視
      const self = `${user.userName}@${getDomain()}`;
      if (!(data.to.includes(self) || data.from === self)) {
        return;
      }

      const partnerId = data.from === self
        ? (data.to.find((v) => v !== self) ?? data.to[0])
        : data.from;

      const normalizedPartner = normalizeActor(partnerId);
      const [partnerName] = splitActor(normalizedPartner);
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      let room = chatRooms().find((r) => r.id === partnerName);
      if (!room) {
        for (const t of data.to) {
          const normalized = normalizeActor(t);
          const [toName] = splitActor(normalized);
          const g = chatRooms().find((r) => r.id === toName);
          if (g) {
            room = g;
            break;
          }
        }
      }
      if (!room && uuidRe.test(partnerName)) {
        // グループIDと推測されるがまだ一覧に存在しない場合はDMを作成しない
        return;
      }
      if (!room) {
        room = chatRooms().find((r) => r.id === normalizedPartner);
        if (!room) {
          if (
            confirm(
              `${normalizedPartner} からメッセージが届きました。許可しますか？`,
            )
          ) {
            const info = await fetchUserInfo(normalizeActor(normalizedPartner));
            if (info) {
              room = {
                id: normalizedPartner,
                name: info.displayName || info.userName,
                userName: info.userName,
                domain: info.domain,
                avatar: info.authorAvatar ||
                  info.userName.charAt(0).toUpperCase(),
                unreadCount: 0,
                type: "group",
                members: [normalizedPartner],
                lastMessage: "...",
                lastMessageTime: undefined,
              };
              upsertRoom(room!);
            } else {
              return;
            }
          } else {
            return;
          }
        }
      }

      const isMe = data.from === self;
      const displayName = isMe
        ? (user.displayName || user.userName)
        : room.name;
      const decoded = decodeMLSMessage(data.content);
      if (!decoded) return;

      let text = decoded.body;
      let attachments:
        | {
          data?: string;
          url?: string;
          mediaType: string;
          preview?: { url?: string; data?: string; mediaType?: string };
        }[]
        | undefined;
      let localId: string | undefined;

      if (msg.type === "encryptedMessage") {
        const group = groups()[room.id];
        if (group) {
          const plain = await decryptGroupMessage(group, decoded.body);
          if (plain) {
            const note = parseActivityPubNote(plain);
            text = note.content;
            localId = note.id?.startsWith("urn:uuid:")
              ? note.id.slice(9)
              : note.id;
            const listAtt = Array.isArray(data.attachments)
              ? data.attachments
              : note.attachments;
            if (Array.isArray(listAtt)) {
              attachments = [];
              for (const at of listAtt) {
                if (typeof at.url === "string") {
                  let preview;
                  if (at.preview && typeof at.preview.url === "string") {
                    const pmt = typeof at.preview.mediaType === "string"
                      ? at.preview.mediaType
                      : "image/jpeg";
                    try {
                      const pres = await fetch(at.preview.url);
                      let pbuf = await pres.arrayBuffer();
                      if (
                        typeof at.preview.key === "string" &&
                        typeof at.preview.iv === "string"
                      ) {
                        pbuf = await decryptFile(
                          pbuf,
                          at.preview.key,
                          at.preview.iv,
                        );
                      }
                      preview = { url: bufToUrl(pbuf, pmt), mediaType: pmt };
                    } catch {
                      preview = { url: at.preview.url, mediaType: pmt };
                    }
                  }
                  try {
                    const res = await fetch(at.url);
                    let buf = await res.arrayBuffer();
                    if (
                      typeof at.key === "string" && typeof at.iv === "string"
                    ) {
                      buf = await decryptFile(buf, at.key, at.iv);
                    }
                    const mt = typeof at.mediaType === "string"
                      ? at.mediaType
                      : "application/octet-stream";
                    if (
                      mt.startsWith("video/") || mt.startsWith("audio/") ||
                      buf.byteLength > 1024 * 1024
                    ) {
                      attachments.push({
                        url: bufToUrl(buf, mt),
                        mediaType: mt,
                        preview,
                      });
                    } else {
                      attachments.push({
                        data: bufToB64(buf),
                        mediaType: mt,
                        preview,
                      });
                    }
                  } catch {
                    const mt = typeof at.mediaType === "string"
                      ? at.mediaType
                      : "application/octet-stream";
                    attachments.push({ url: at.url, mediaType: mt, preview });
                  }
                }
              }
            }
          }
        }
      } else {
        const note = parseActivityPubNote(decoded.body);
        text = note.content;
        localId = note.id?.startsWith("urn:uuid:") ? note.id.slice(9) : note.id;
        const listAtt = Array.isArray(data.attachments)
          ? data.attachments
          : note.attachments;
        if (Array.isArray(listAtt)) {
          attachments = [];
          for (const at of listAtt) {
            if (typeof at.url === "string") {
              const mt = typeof at.mediaType === "string"
                ? at.mediaType
                : "application/octet-stream";
              let preview;
              if (at.preview && typeof at.preview.url === "string") {
                const pmt = typeof at.preview.mediaType === "string"
                  ? at.preview.mediaType
                  : "image/jpeg";
                try {
                  const pres = await fetch(at.preview.url);
                  let pbuf = await pres.arrayBuffer();
                  if (
                    typeof at.preview.key === "string" &&
                    typeof at.preview.iv === "string"
                  ) {
                    pbuf = await decryptFile(
                      pbuf,
                      at.preview.key,
                      at.preview.iv,
                    );
                  }
                  preview = { url: bufToUrl(pbuf, pmt), mediaType: pmt };
                } catch {
                  preview = { url: at.preview.url, mediaType: pmt };
                }
              }
              try {
                const res = await fetch(at.url);
                let buf = await res.arrayBuffer();
                if (typeof at.key === "string" && typeof at.iv === "string") {
                  buf = await decryptFile(buf, at.key, at.iv);
                }
                if (
                  mt.startsWith("video/") || mt.startsWith("audio/") ||
                  buf.byteLength > 1024 * 1024
                ) {
                  attachments.push({
                    url: bufToUrl(buf, mt),
                    mediaType: mt,
                    preview,
                  });
                } else {
                  attachments.push({
                    data: bufToB64(buf),
                    mediaType: mt,
                    preview,
                  });
                }
              } catch {
                attachments.push({ url: at.url, mediaType: mt, preview });
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
          ? (attachments[0].mediaType.startsWith("image/") ? "image" : "file")
          : "text",
        isMe,
        avatar: room.avatar,
      };
      setMessages((prev) => {
        if (localId) {
          const idx = prev.findIndex((msg) => msg.id === localId);
          if (idx !== -1) {
            const newMsgs = [...prev];
            newMsgs[idx] = m;
            return newMsgs;
          }
        }
        if (prev.some((msg) => msg.id === m.id)) return prev;
        return [...prev, m];
      });
      updateRoomLast(room.id, m);
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

  createEffect(
    on(
      () => selectedRoom(),
      async (roomId) => {
        const selfRoomId = getSelfRoomId(account());
        if (!roomId) {
          setMessages([]);
          return;
        }

        const normalizedRoomId = normalizeActor(roomId);
        let room = chatRooms().find((r) => r.id === normalizedRoomId);

        // ルームが存在しない場合は作成を試行
        if (!room && normalizedRoomId !== selfRoomId) {
          const info = await fetchUserInfo(normalizeActor(normalizedRoomId));
          const user = account();
          if (info && user) {
            room = {
              id: normalizedRoomId,
              name: info.displayName || info.userName,
              userName: info.userName,
              domain: info.domain,
              avatar: info.authorAvatar ||
                info.userName.charAt(0).toUpperCase(),
              unreadCount: 0,
              type: "group",
              members: [normalizedRoomId],
              lastMessage: "...",
              lastMessageTime: undefined,
            };
            upsertRoom(room);
            await addRoom(user.id, {
              id: normalizedRoomId,
              name: room.name,
              members: [normalizedRoomId],
            });
          }
        }

        // ルームが見つかった場合はメッセージを読み込み
        if (room) {
          await loadMessages(room, true);
        } else if (roomId === selfRoomId) {
          // セルフルーム（TAKO Keep）の場合は空のメッセージリストを設定
          setMessages([]);
        } else {
          setMessages([]);
        }
      },
    ),
  );

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
          class={`${
            isMobile()
              ? "w-[200vw] h-dvh flex-row transition-transform duration-200 ease-[cubic-bezier(0.11,0.91,0.4,0.94)]"
              : "w-full"
          } flex h-full ${
            isMobile() ? (showRoomList() ? "" : "-translate-x-[100vw]") : ""
          }`}
          id="chatmain"
        >
          {/* ルームリスト */}
          <div class={isMobile() ? "w-[100vw] flex-shrink-0" : ""}>
            <ChatRoomList
              rooms={chatRooms()}
              selectedRoom={selectedRoom()}
              onSelect={selectRoom}
              onRemove={removeRoom}
              onStartLongPress={startLongPress}
              onCancelLongPress={cancelLongPress}
              showAds={showAds()}
              onCreateGroup={openGroupDialog}
              onCreateDm={openDmDialog}
              segment={segment()}
              onSegmentChange={setSegment}
            />
          </div>
          <div
            class={isMobile() ? "w-[100vw] flex-shrink-0" : "flex-grow w-full"}
          >
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
                        ? "チャンネルを選択してください"
                        : "左のサイドバーからチャンネルを選択して会話を開始しましょう"}
                    </p>
                  </div>
                </div>
              }
            >
              <div class="relative flex flex-col bg-[#1e1e1e] h-full w-full">
                <ChatTitleBar
                  isMobile={isMobile()}
                  selectedRoom={selectedRoomInfo()}
                  onBack={backToRoomList}
                />
                <div class="flex gap-2 p-2">
                  <button
                    type="button"
                    class="px-2 py-1 rounded bg-[#3c3c3c] text-white"
                    onClick={openInviteDialog}
                  >
                    メンバー招待
                  </button>
                  <button
                    type="button"
                    class="px-2 py-1 rounded bg-[#3c3c3c] text-white"
                    onClick={() => {
                      const id = selectedRoom();
                      if (id) leaveRoom(id);
                    }}
                  >
                    退出
                  </button>
                  <button
                    type="button"
                    class="px-2 py-1 rounded bg-[#3c3c3c] text-white"
                    onClick={promptKick}
                  >
                    追放
                  </button>
                </div>
                <ChatMessageList
                  messages={messages()}
                  onReachTop={() => {
                    const roomId = selectedRoom();
                    if (roomId) {
                      const room = chatRooms().find((r) => r.id === roomId);
                      if (room) loadOlderMessages(room);
                    }
                  }}
                />
                <ChatSendForm
                  newMessage={newMessage()}
                  setNewMessage={setNewMessage}
                  mediaFile={mediaFile()}
                  setMediaFile={setMediaFile}
                  mediaPreview={mediaPreview()}
                  setMediaPreview={setMediaPreview}
                  useEncryption={useEncryption()}
                  encryptionKey={encryptionKey()}
                  toggleEncryption={toggleEncryption}
                  sendMessage={sendMessage}
                  onShowEncryptionKeyForm={props.onShowEncryptionKeyForm}
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
      <GroupCreateDialog
        isOpen={showGroupDialog()}
        mode={groupDialogMode()}
        onClose={() => setShowGroupDialog(false)}
        onCreate={createGroup}
        onInvite={inviteMembers}
      />
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
