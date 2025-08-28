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
import {
  fetchFollowing as _fetchFollowing,
  fetchUserInfo,
  fetchUserInfoBatch,
} from "./microblog/api.ts";
import { apiFetch, getDomain } from "../utils/config.ts";
import { navigate } from "../utils/router.ts";
import { addMessageHandler, removeMessageHandler } from "../utils/ws.ts";
import { isAdsenseEnabled, loadAdsenseConfig } from "../utils/adsense.ts";
import { ChatRoomList } from "./chat/ChatRoomList.tsx";
import ChatCreateDMDialog from "./chat/ChatCreateDMDialog.tsx";
import { GroupCreateDialog } from "./chat/GroupCreateDialog.tsx";
import { ChatTitleBar } from "./chat/ChatTitleBar.tsx";
import { ChatSettingsOverlay } from "./chat/ChatSettingsOverlay.tsx";
import { ChatMessageList } from "./chat/ChatMessageList.tsx";
import { ChatSendForm } from "./chat/ChatSendForm.tsx";
// GroupCreateDialog removed from this view; creation flows via ChatRoomList
import type { ActorID, ChatMessage, Room } from "./chat/types.ts";
import { b64ToBuf, bufToB64 } from "@takos/buffer";
import {
  fetchDirectMessages as _fetchDirectMessages,
  sendDirectMessage,
} from "./chat/api.ts";

/* ローカルキャッシュ用の軽量ヘルパー
   メモリ上の Map を用いた実装 */
const messageCache = new Map<string, unknown[]>();

function cacheKey(accountId: string, roomId: string) {
  return `${accountId}:${roomId}`;
}

function loadDecryptedMessages(accountId: string, roomId: string) {
  const v = messageCache.get(cacheKey(accountId, roomId));
  if (!Array.isArray(v)) return undefined;
  return (v as Record<string, unknown>[]).map((m) => {
    const rawTs = m.timestamp ?? Date.now();
    const ts = new Date(rawTs as string | number | Date);
    return {
      ...m,
      timestamp: isNaN(ts.getTime()) ? new Date() : ts,
    } as ChatMessage;
  });
}

function saveDecryptedMessages(
  accountId: string,
  roomId: string,
  v: unknown,
) {
  if (Array.isArray(v)) messageCache.set(cacheKey(accountId, roomId), v);
}
/* uploadFile: ファイルを multipart/form-data で送信し、URL または null を返す */
async function uploadFile(opts: { file: File; key?: string; iv?: string }) {
  try {
    const fd = new FormData();
    fd.append("file", opts.file);
    if (opts.key) fd.append("key", opts.key);
    if (opts.iv) fd.append("iv", opts.iv);
    const res = await apiFetch("/api/files", {
      method: "POST",
      body: fd,
    });
    if (res.ok) {
      const j = await res.json();
      return j.url as string | null;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function sendMemoMessage(
  handle: string,
  content: string,
  attachments?: Record<string, unknown>[],
) {
  try {
    const payload: Record<string, unknown> = {
      from: handle,
      to: handle,
      content,
    };
    // zod schema requires `type` field. choose note for text-only or
    // image/video/file when attachments present (based on mediaType)
    const computeType = (atts?: Record<string, unknown>[]) => {
      if (!Array.isArray(atts) || atts.length === 0) return "note";
      const mt = String(atts[0].mediaType ?? "");
      if (mt.startsWith("image/")) return "image";
      if (mt.startsWith("video/")) return "video";
      return "file";
    };
    payload.type = computeType(attachments);
    if (Array.isArray(attachments) && attachments.length > 0) {
      payload.attachments = attachments;
    }
    const res = await apiFetch(`/api/dm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) return await res.json();
  } catch {
    // ignore network errors
  }
  return null;
}

// ActivityPub の Note 形式のテキストから content を取り出す
function _parseActivityPubContent(text: string): string {
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

function _parseActivityPubNote(text: string): ParsedActivityPubNote {
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

// テキストエリアの自動高さ調整ユーティリティ
function adjustHeight(el?: HTMLTextAreaElement) {
  if (!el) return;
  try {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  } catch {
    // ignore styling errors in unusual environments
  }
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

async function _decryptFile(
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
  const encFile = new File([enc.data], file.name, { type: enc.mediaType });
  const url = await uploadFile({
    file: encFile,
    key: enc.key,
    iv: enc.iv,
  });
  if (!url) return undefined;
  let preview: ActivityPubPreview | undefined;
  if (file.type.startsWith("image/")) {
    const p = await generateImagePreview(file);
    if (p) {
      // プレビューは平文で保存し、クライアントで直接表示できるようにする
      const pUrl = await uploadFile({ file: p.file });
      if (pUrl) {
        preview = {
          url: pUrl,
          mediaType: p.file.type || "image/jpeg",
          width: p.width,
          height: p.height,
        };
      }
    }
  } else if (file.type.startsWith("video/")) {
    const p = await generateVideoPreview(file);
    if (p) {
      // 動画のプレビューも平文で保存して表示に用いる
      const pUrl = await uploadFile({ file: p.file });
      if (pUrl) {
        preview = {
          url: pUrl,
          mediaType: p.file.type || "image/jpeg",
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

function getSelfRoomId(_user: Account | null): string | null {
  // セルフルーム（TAKO Keep）のIDは固定で "memo"
  return _user ? "memo" : null;
}

export function Chat() {
  const [selectedRoom, setSelectedRoom] = useAtom(selectedRoomState); // グローバル状態を使用
  const [account] = useAtom(activeAccount);
  const _bindingStatus = () => null as string | null;
  const _bindingInfo = () => null as unknown;
  const _assessBinding = (
    _userId?: string,
    _roomId?: string,
    _actor?: string,
    _credentialFingerprint?: string,
    _ktIncluded?: boolean,
  ) => ({ status: "Unknown", info: null, kt: { included: false } });
  const _ktInfo = () => ({ included: false });
  const [newMessage, setNewMessage] = createSignal("");
  // 添付を複数扱えるように配列で保持
  const [mediaFiles, setMediaFiles] = createSignal<File[]>([]);
  const [mediaPreviews, setMediaPreviews] = createSignal<string[]>([]);
  const [showRoomList, setShowRoomList] = createSignal(true); // モバイル用: 部屋リスト表示制御
  const [isMobile, setIsMobile] = createSignal(false); // モバイル判定
  const [chatRooms, setChatRooms] = createSignal<Room[]>([]);
  const [roomsReady, setRoomsReady] = createSignal(false);
  const [pendingRoom, setPendingRoom] = createSignal<string | null>(null);

  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  // ルームごとの復号済みメッセージキャッシュ（再選択時の再復号を回避）
  const [messagesByRoom, setMessagesByRoom] = createSignal<
    Record<string, ChatMessage[]>
  >({});
  const roomCacheKey = (roomId: string): string => {
    const user = account();
    return user ? `${user.id}:${roomId}` : roomId;
  };
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
  // group creation UI removed; server-driven rooms only
  const [segment, setSegment] = createSignal<"all" | "people" | "groups">(
    "all",
  );
  // 設定オーバーレイ表示状態
  const [showSettings, setShowSettings] = createSignal(false);
  const [showCreateDialog, setShowCreateDialog] = createSignal(false);
  const [createDialogType, setCreateDialogType] = createSignal<"dm" | "group">(
    "dm",
  );
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

  // derive participants directly from room.members when needed

  // 受信メッセージの送信者ハンドルから、メンバーIDをフルハンドル形式に補正
  const updatePeerHandle = (roomId: string, fromHandle: string) => {
    const user = account();
    if (!user) return;
    const selfHandle = `${user.userName}@${getDomain()}`;
    const fullFrom = normalizeHandle(fromHandle as ActorID) ?? fromHandle;
    if (fromHandle === selfHandle) return;
    const [fromUser] = splitActor(fromHandle as ActorID);
    setChatRooms((prev) =>
      prev.map((r) => {
        if (r.id !== roomId) return r;
        const members = (r.members ?? []).map((m) => {
          if (typeof m === "string" && !m.includes("@")) {
            // ユーザー名だけ一致している場合はフルハンドルに置き換え
            const [mu] = splitActor(m as ActorID);
            if (mu === fromUser) return fullFrom as ActorID;
          }
          return m;
        });
        // 1対1 (dm) のときは explicit な type を確認して補正
        const isDm = r.type === "dm";
        let displayName = r.displayName;
        if (
          isDm &&
          (!displayName || displayName === user.displayName ||
            displayName === user.userName || displayName === selfHandle)
        ) {
          displayName = fullFrom;
        }
        return { ...r, displayName, members };
      })
    );
  };
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

  // 1対1ルームで、選択時に相手の情報と members を補正する
  const ensureDmPartnerInfo = async (room: Room) => {
    const user = account();
    if (!user || room.type === "memo" || room.type === "group") return;
    const selfHandle = `${user.userName}@${getDomain()}`;
    // UUID のルームはグループとみなし、DM用の名称/アイコン補完は行わない
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const isUuidRoom = uuidRe.test(room.id);
    // determine partner from room.members (server-provided) or fallback to first member
    const partner = (room.members ?? []).find((m) => m !== selfHandle) ??
      (room.members ?? [])[0];
    if (!partner) return;

    // 画面表示用に client 側で members を補完（サーバーから返らない想定）
    setChatRooms((prev) =>
      prev.map((r) => {
        if (r.id !== room.id) return r;
        const cur = r.members ?? [];
        const norm = normalizeHandle(partner as string) as string | undefined;
        if (!norm) return r;
        if (cur.length === 1 && cur[0] === norm) return r;
        return { ...r, members: [norm] };
      })
    );

    // 名前が未設定/自分名に見える場合は相手の displayName を取得して補完
    if (
      !isUuidRoom &&
      !(room.hasName || room.hasIcon) &&
      ((room.displayName ?? room.name) === "" ||
        (room.displayName ?? room.name) === user.displayName ||
        (room.displayName ?? room.name) === user.userName ||
        (room.displayName ?? room.name) === selfHandle)
    ) {
      try {
        const info = await fetchUserInfo(partner as ActorID);
        if (info) {
          // displayName を補完するが、avatar は相手の authorAvatar を流用しない
          setChatRooms((prev) =>
            prev.map((r) =>
              r.id === room.id
                ? {
                  ...r,
                  displayName: info.displayName || info.userName,
                }
                : r
            )
          );
        }
      } catch (err) {
        // ネットワークエラーや404は致命的ではないので無視
        console.warn("相手情報の取得に失敗しました", err);
      }
    }
  };
  let textareaRef: HTMLTextAreaElement | undefined;
  let wsCleanup: (() => void) | undefined;
  let acceptCleanup: (() => void) | undefined;

  // group state persistence removed

  // group initialization removed

  const fetchMessagesForRoom = async (
    room: Room,
    params?: {
      limit?: number;
      before?: string;
      after?: string;
      dryRun?: boolean;
    },
  ): Promise<ChatMessage[]> => {
    const user = account();
    if (!user) return [];

    if (room.type !== "dm" && room.type !== "memo" && room.type !== "group") {
      return [];
    }

    // サーバーの API を用いてメッセージを取得する
    try {
      const selfHandle = `${user.userName}@${getDomain()}`;
      const raw: unknown[] = [];
      if (room.type === "memo") {
        const list = await fetchMemoMessages(selfHandle, params);
        if (Array.isArray(list)) raw.push(...list);
      } else if (room.type === "group") {
        try {
          const qs = new URLSearchParams();
          if (typeof params?.limit === "number") {
            qs.set("limit", String(params.limit));
          }
          if (params?.before) qs.set("before", params.before);
          if (params?.after) qs.set("after", params.after);
          const res = await apiFetch(
            `/api/groups/${encodeURIComponent(room.name)}/messages?${qs}`,
          );
          if (res.ok) {
            const list = await res.json();
            if (Array.isArray(list)) raw.push(...list);
          }
        } catch {
          /* ignore */
        }
      } else {
        const members = (room.members ?? []).filter((m) =>
          !!m && m !== selfHandle
        );
        // メンバーごとに /api/dm?user1=<self>&user2=<member> を呼び出して集約
        for (const m of members) {
          try {
            const qs = new URLSearchParams({ user1: selfHandle, user2: m });
            if (typeof params?.limit === "number") {
              qs.set("limit", String(params.limit));
            }
            if (params?.before) qs.set("before", params.before);
            if (params?.after) qs.set("after", params.after);
            const res = await apiFetch(`/api/dm?${qs}`);
            if (!res.ok) continue;
            const list = await res.json();
            if (Array.isArray(list)) raw.push(...list);
          } catch {
            // ignore per-peer failures
          }
        }
      }

      // 重複を除き作成時刻順に並べ替え、ChatMessage に変換
      const map = new Map<string, Record<string, unknown>>();
      for (const it of raw) {
        const obj = it as Record<string, unknown>;
        const id = String(obj._id ?? obj.id ?? `${obj.from}:${obj.createdAt}`);
        if (!map.has(id)) map.set(id, obj);
      }
      const ordered = Array.from(map.values()).sort((a, b) => {
        const aTs = String(a.createdAt ?? a.created_at ?? 0);
        const bTs = String(b.createdAt ?? b.created_at ?? 0);
        return new Date(aTs).getTime() - new Date(bTs).getTime();
      });

      const msgs: ChatMessage[] = ordered.map((m) => {
        const created = m.createdAt ?? m.created_at ?? Date.now();
        const ts = new Date(created as string | number | Date);
        const from = String(m.from ?? "");
        // 正規化されたハンドルを使って自分/他者判定を安定化する
        const normalizedFrom = normalizeActor(from) || from;
        // attachments/attachment の両方に対応し、URL がない場合は
        // /api/files/messages/:messageId/:index をフォールバックとして構築
        const messageId = String(
          m._id ?? m.id ?? `${normalizedFrom}:${created}`,
        );
        const rawAtt = (m as { attachments?: unknown; attachment?: unknown })
          .attachments ?? (m as { attachment?: unknown }).attachment;
        const attachments = Array.isArray(rawAtt)
          ? rawAtt
            .map((a, idx) => {
              if (!a || typeof a !== "object") return null;
              const url = typeof (a as { url?: unknown }).url === "string"
                ? (a as { url: string }).url
                : undefined;
              const data = typeof (a as { data?: unknown }).data === "string"
                ? (a as { data: string }).data
                : undefined;
              const mediaType =
                typeof (a as { mediaType?: unknown }).mediaType === "string"
                  ? (a as { mediaType: string }).mediaType
                  : "application/octet-stream";
              const rawPrev = (a as { preview?: unknown }).preview;
              let preview:
                | { url?: string; data?: string; mediaType?: string }
                | undefined;
              if (rawPrev && typeof rawPrev === "object") {
                const pUrl =
                  typeof (rawPrev as { url?: unknown }).url === "string"
                    ? (rawPrev as { url: string }).url
                    : undefined;
                const pData =
                  typeof (rawPrev as { data?: unknown }).data === "string"
                    ? (rawPrev as { data: string }).data
                    : undefined;
                const pMediaType =
                  typeof (rawPrev as { mediaType?: unknown }).mediaType ===
                      "string"
                    ? (rawPrev as { mediaType: string }).mediaType
                    : undefined;
                if (pUrl || pData) {
                  preview = { url: pUrl, data: pData, mediaType: pMediaType };
                }
              }
              // URL がない場合のフォールバック
              const fallbackUrl = url || (data
                ? undefined
                : `/api/files/messages/${
                  encodeURIComponent(messageId)
                }/${idx}`);
              if (fallbackUrl || data) {
                return { url: fallbackUrl, data, mediaType, preview };
              }
              return null;
            })
            .filter((a): a is {
              url: string | undefined;
              data: string | undefined;
              mediaType: string;
              preview:
                | { url?: string; data?: string; mediaType?: string }
                | undefined;
            } => !!a)
          : [];
        if (attachments.length === 0) {
          const url = typeof (m as { url?: unknown }).url === "string"
            ? (m as { url: string }).url
            : undefined;
          const mediaType = typeof (m as { mediaType?: unknown }).mediaType ===
              "string"
            ? (m as { mediaType: string }).mediaType
            : undefined;
          if (url && mediaType) {
            const key = typeof (m as { key?: unknown }).key === "string"
              ? (m as { key: string }).key
              : undefined;
            const iv = typeof (m as { iv?: unknown }).iv === "string"
              ? (m as { iv: string }).iv
              : undefined;
            const rawPrev = (m as { preview?: unknown }).preview;
            let preview:
              | { url?: string; data?: string; mediaType?: string }
              | undefined;
            if (rawPrev && typeof rawPrev === "object") {
              const pUrl =
                typeof (rawPrev as { url?: unknown }).url === "string"
                  ? (rawPrev as { url: string }).url
                  : undefined;
              const pData =
                typeof (rawPrev as { data?: unknown }).data === "string"
                  ? (rawPrev as { data: string }).data
                  : undefined;
              const pMediaType =
                typeof (rawPrev as { mediaType?: unknown }).mediaType ===
                    "string"
                  ? (rawPrev as { mediaType: string }).mediaType
                  : undefined;
              if (pUrl || pData) {
                preview = { url: pUrl, data: pData, mediaType: pMediaType };
              }
            }
            attachments.push({ url, data: undefined, mediaType, preview });
            // 暗号化情報は preview に含めていないため、ダウンロード時に別途参照
            if (key) (attachments[0] as Record<string, unknown>).key = key;
            if (iv) (attachments[0] as Record<string, unknown>).iv = iv;
          }
        }
        return {
          id: String(m._id ?? m.id ?? `${normalizedFrom}:${created}`),
          author: normalizedFrom,
          displayName: normalizedFrom.split("/").pop() ?? normalizedFrom,
          address: from,
          content: String(m.content ?? ""),
          attachments,
          timestamp: isNaN(ts.getTime()) ? new Date() : ts,
          type: attachments.length > 0
            ? (((attachments[0].mediaType || "").startsWith("image/"))
              ? "image"
              : "file")
            : (() => {
              const t = String(m.type ?? "").toLowerCase();
              if (
                t === "note" || t === "image" || t === "video" || t === "file"
              ) return t as typeof t;
              if (attachments.length > 0) {
                const mt = (attachments[0]?.mediaType || "").toLowerCase();
                if (mt.startsWith("image/")) return "image" as const;
                if (mt.startsWith("video/")) return "video" as const;
                return "file" as const;
              }
              // 既定は Note
              return "note" as const;
            })(),
          isMe: normalizedFrom === selfHandle,
          avatar: room.avatar,
        } as ChatMessage;
      });

      return msgs;
    } catch (err) {
      console.error("fetchMessagesForRoom (DM) error:", err);
      return [];
    }
  };

  const loadMessages = async (room: Room, _isSelectedRoom: boolean) => {
    const user = account();
    const cached = messagesByRoom()[roomCacheKey(room.id)] ??
      (user
        ? (await loadDecryptedMessages(user.id, room.id)) ?? undefined
        : undefined);
    if (cached && selectedRoom() === room.id) {
      setMessages(cached);
      if (cached.length > 0) {
        setCursor(cached[0].timestamp.toISOString());
        updateRoomLast(room.id, cached[cached.length - 1]);
      } else {
        setCursor(null);
      }
      // 差分のみ取得（最新のタイムスタンプ以降）
      const lastTs = cached.length > 0
        ? cached[cached.length - 1].timestamp.toISOString()
        : undefined;
      const fetched = await fetchMessagesForRoom(
        room,
        lastTs ? { after: lastTs } : { limit: messageLimit },
      );
      if (fetched.length > 0) {
        const ids = new Set(cached.map((m) => m.id));
        const add = fetched.filter((m) => !ids.has(m.id));
        if (add.length > 0) {
          const next = [...cached, ...add];
          setMessages(next);
          setMessagesByRoom({
            ...messagesByRoom(),
            [roomCacheKey(room.id)]: next,
          });
          if (user) await saveDecryptedMessages(user.id, room.id, next);
          updateRoomLast(room.id, next[next.length - 1]);
        }
      }
      setHasMore(cached.length >= messageLimit);
      return;
    }
    const msgs = await fetchMessagesForRoom(room, { limit: messageLimit });
    setMessagesByRoom({ ...messagesByRoom(), [roomCacheKey(room.id)]: msgs });
    if (user) await saveDecryptedMessages(user.id, room.id, msgs);
    if (msgs.length > 0) {
      setCursor(msgs[0].timestamp.toISOString());
    } else {
      setCursor(null);
    }
    setHasMore(msgs.length === messageLimit);
    if (selectedRoom() === room.id) {
      setMessages(msgs);
    }
    const lastMessage = msgs.length > 0 ? msgs[msgs.length - 1] : undefined;
    updateRoomLast(room.id, lastMessage);
    // 招待のみで未参加なら送信を抑止（参加後に自動解除）
  };

  const loadOlderMessages = async (room: Room) => {
    if (!hasMore() || loadingOlder()) return;
    setLoadingOlder(true);
    const msgs = await fetchMessagesForRoom(room, {
      limit: messageLimit,
      before: cursor() ?? undefined,
    });
    if (msgs.length > 0 && selectedRoom() === room.id) {
      setCursor(msgs[0].timestamp.toISOString());
      setMessages((prev) => {
        const next = [...msgs, ...prev];
        setMessagesByRoom({
          ...messagesByRoom(),
          [roomCacheKey(room.id)]: next,
        });
        const user = account();
        if (user) void saveDecryptedMessages(user.id, room.id, next);
        return next;
      });
    }
    setHasMore(msgs.length === messageLimit);
    setLoadingOlder(false);
  };

  const loadRooms = async () => {
    const user = account();
    if (!user) return;
    setRoomsReady(false);
    const rooms: Room[] = [
      {
        id: "memo",
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
    const handle = `${user.userName}@${getDomain()}` as ActorID;
    // 暗黙のルーム（メッセージ由来）は除外して、明示的に作成されたもののみ取得
    const serverRooms = await searchRooms(handle, {
      implicit: "include",
      type: "group",
    });
    for (const item of serverRooms) {
      const name = item.name ?? "";
      const icon = item.icon ?? "";
      // server may not populate members fully; use pending invites as fallback
      let members = item.members ?? [] as string[];
      if (members.length === 0) {
        try {
          const pend = await readPending(user.id, item.id, "group");
          const others = (pend || []).filter((m: string | undefined) =>
            !!m && m !== handle
          ) as string[];
          if (others.length > 0) members = others;
        } catch {
          /* ignore */
        }
      }
      rooms.push({
        id: item.id,
        name,
        userName: user.userName,
        domain: getDomain(),
        // normalize via String() to avoid 'never' typing and safely compute initial
        avatar: icon ||
          (String(name).length > 0
            ? String(name).charAt(0).toUpperCase()
            : "👥"),
        unreadCount: 0,
        type: "group",
        members,
        hasName: name !== "",
        hasIcon: icon !== "",
        lastMessage: "...",
        lastMessageTime: undefined,
      });
    }

    // DMルームをサーバーから取得して追加
    const dmRooms = await searchRooms(handle, { type: "dm" });
    for (const item of dmRooms) {
      const name = item.name ?? "";
      const icon = item.icon ?? "";
      // members が不足している場合は pending を参照
      let members = item.members ?? [] as string[];
      if (members.length === 0) {
        try {
          const pend = await readPending(user.id, item.id, "dm");
          const others = (pend || []).filter((m: string | undefined) =>
            !!m && m !== handle
          ) as string[];
          if (others.length > 0) members = others;
        } catch {
          /* ignore */
        }
      }
      rooms.push({
        id: item.id,
        name,
        userName: user.userName,
        domain: getDomain(),
        avatar: icon ||
          (String(name).length > 0
            ? String(name).charAt(0).toUpperCase()
            : "👤"),
        unreadCount: 0,
        type: "dm",
        members,
        hasName: name !== "",
        hasIcon: icon !== "",
        lastMessage: "...",
        lastMessageTime: undefined,
      });
    }

    // 招待中（通知ベース）のグループを補完表示
    try {
      const nres = await apiFetch(`/api/notifications?owner=${encodeURIComponent(user.id)}`);
      if (nres.ok) {
        const list = await nres.json();
        const invites = Array.isArray(list)
          ? list.filter((n: Record<string, unknown>) => n.type === "group-invite")
          : [];
        const existing = new Set(rooms.map((r) => r.id));
        const domain = getDomain();
        for (const n of invites) {
          let info: { groupName?: string; groupId?: string; displayName?: string } = {};
          try {
            const obj = JSON.parse(String((n as { message?: string }).message || "{}"));
            if (obj && typeof obj === "object") info = obj;
          } catch { /* ignore */ }
          const gname = info.groupName || "";
          const gid = info.groupId || (gname ? `https://${domain}/groups/${gname}` : "");
          if (!gid) continue;
          const rid = normalizeActor(gid as unknown as ActorID);
          if (existing.has(rid)) continue;
          rooms.push({
            id: rid,
            name: gname,
            displayName: info.displayName || gname,
            userName: user.userName,
            domain,
            avatar: "👥",
            unreadCount: 0,
            type: "group",
            members: [],
            hasName: !!info.displayName,
            hasIcon: false,
            lastMessage: "グループ招待: 参加しますか？",
            lastMessageTime: undefined,
            pendingInvite: true,
            meta: { notificationId: String((n as { id?: string }).id || ""), groupName: gname, groupId: gid },
          });
          existing.add(rid);
        }
      }
    } catch { /* ignore */ }

    await applyDisplayFallback(rooms);

    const unique = rooms.filter(
      (room, idx, arr) => arr.findIndex((r) => r.id === room.id) === idx,
    );
    upsertRooms(unique);
    // mark rooms as loaded so URL-selected room can be validated
    setRoomsReady(true);
    // 初期表示のため、各ルームの最新メッセージをバックグラウンドで取得し一覧のプレビューを更新
    // （選択中ルーム以外は本文状態には反映せず、lastMessage/lastMessageTime のみ更新）
    void (async () => {
      for (const r of unique) {
        try {
          const msgs = await fetchMessagesForRoom(r, {
            limit: 1,
            dryRun: true,
          });
          if (msgs.length > 0) {
            updateRoomLast(r.id, msgs[msgs.length - 1]);
          }
        } catch (e) {
          // ネットワーク不通や復号不可などは致命的ではないため一覧更新のみ諦める
          console.warn("最新メッセージの事前取得に失敗しました", r.id, e);
        }
      }
    })();
  };

  const applyDisplayFallback = async (rooms: Room[]) => {
    const user = account();
    if (!user) return;
    const selfHandle = `${user.userName}@${getDomain()}` as ActorID;
    // 参加者は server の room.members を優先し、pending を補完として利用
    const uniqueOthers = (r: Room): string[] =>
      (r.members ?? []).filter((m) => m && m !== selfHandle);

    // 暫定表示: members が空のグループルームは pending 招待から1名だけでも補完
    for (const r of rooms) {
      try {
        if ((r.members?.length ?? 0) === 0 && r.type === "group") {
          const pend = await readPending(user.id, r.id, "group");
          const cand = (pend || []).filter((m: string | undefined) =>
            !!m && m !== selfHandle
          ) as string[];
          if (cand.length > 0) {
            r.members = [cand[0]];
          }
        }
      } catch {
        // ignore
      }
    }
    const totalMembers = (r: Room) => 1 + uniqueOthers(r).length; // 自分+その他
    // 事前補正: 2人想定で名前が自分の表示名/ユーザー名のときは未命名として扱う
    for (const r of rooms) {
      if (r.type === "memo") continue;
      if (r.type === "dm") {
        const others = uniqueOthers(r);
        // 自分の名前がタイトルに入ってしまう誤表示を防止
        if (
          others.length <= 1 &&
          (r.name === user.displayName || r.name === user.userName)
        ) {
          r.displayName = "";
          r.hasName = false;
          // アバターが自分の頭文字（1文字）なら一旦消して再計算に委ねる
          const selfInitial = (user.displayName || user.userName || "").charAt(
            0,
          )
            .toUpperCase();
          if (
            typeof r.avatar === "string" && r.avatar.length === 1 &&
            r.avatar.toUpperCase() === selfInitial
          ) {
            r.avatar = "";
          }
        }
      }
    }
    const multi = rooms.filter((r) =>
      r.type !== "memo" && totalMembers(r) >= 3 && !(r.hasName)
    );
    const needIds = Array.from(new Set(multi.flatMap((r) => uniqueOthers(r))));
    if (needIds.length > 0) {
      const infos = await fetchUserInfoBatch(needIds, user.id);
      const map = new Map<string, typeof infos[number]>();
      for (let i = 0; i < needIds.length; i++) map.set(needIds[i], infos[i]);
      for (const r of multi) {
        const names = uniqueOthers(r).map((m) =>
          map.get(m)?.displayName || map.get(m)?.userName
        ).filter(Boolean) as string[];
        const top = names.slice(0, 2);
        const rest = Math.max(0, names.length + 1 - top.length - 1); // +1 = 自分
        r.displayName = top.length > 0
          ? `${top.join("、")}${rest > 0 ? ` ほか${rest}名` : ""}`
          : r.displayName ?? r.name;
        r.avatar = r.avatar || "👥";
      }
    }
  };

  // room creation should be done via server APIs / sidebar controls

  const sendMessage = async () => {
    const text = newMessage().trim();
    const roomId = selectedRoom();
    const user = account();
    if ((!text && mediaFiles().length === 0) || !roomId || !user) return;
    const room = chatRooms().find((r) => r.id === roomId);
    if (!room) return;
    if (room.type === "memo") {
      let attachmentsParam: Record<string, unknown>[] | undefined;
      if (mediaFiles().length > 0) {
        const built: Record<string, unknown>[] = [];
        for (const f of mediaFiles()) {
          try {
            const att = await buildAttachment(f);
            if (att && typeof att.url === "string") built.push(att);
          } catch {
            // 個別失敗は無視して続行
          }
        }
        if (built.length > 0) attachmentsParam = built;
      }
      const res = await sendMemoMessage(
        `${user.userName}@${getDomain()}`,
        text,
        attachmentsParam,
      );
      if (!res) {
        globalThis.dispatchEvent(
          new CustomEvent("app:toast", {
            detail: {
              type: "error",
              title: "保存エラー",
              description: "メモの保存に失敗しました",
            },
          }),
        );
        return;
      }
      const msg: ChatMessage = {
        id: res.id,
        author: `${user.userName}@${getDomain()}`,
        displayName: user.displayName || user.userName,
        address: `${user.userName}@${getDomain()}`,
        content: res.content,
        attachments: Array.isArray(res.attachments) ? res.attachments : [],
        timestamp: new Date(res.createdAt),
        type: (Array.isArray(res.attachments) && res.attachments.length > 0)
          ? (((res.attachments[0]?.mediaType || "").startsWith("image/"))
            ? "image"
            : ((res.attachments[0]?.mediaType || "").startsWith("video/")
              ? "video"
              : "file"))
          : "note",
        isMe: true,
        avatar: room.avatar,
      };
      // まだメモが選択中かを確認してからUIに反映
      if (selectedRoom() === room.id) {
        setMessages((prev) => [...prev, msg]);
      }
      // 部屋ごとのキャッシュと永続化を更新
      setMessagesByRoom((prev) => {
        const key = roomCacheKey(room.id);
        const list = (prev[key] ?? []).concat(msg);
        const next = { ...prev, [key]: list };
        const user2 = account();
        if (user2) void saveDecryptedMessages(user2.id, room.id, list);
        return next;
      });
      setNewMessage("");
      setMediaFiles([]);
      setMediaPreviews([]);
      return;
    }

    if (room.type === "group") {
      // --- グループ送信 ---
      try {
        // 添付の組み立て
        let attachmentsParam: Record<string, unknown>[] | undefined;
        if (mediaFiles().length > 0) {
          const built: Record<string, unknown>[] = [];
          for (const f of mediaFiles()) {
            try {
              const att = await buildAttachment(f);
              if (att && typeof att.url === "string") built.push(att);
            } catch {
              // 個別失敗は無視
            }
          }
          if (built.length > 0) attachmentsParam = built;
        }

        // ActivityPub の type 推定
        let apType: "note" | "image" | "video" | "file" = "note";
        const hasText = text.length > 0;
        const firstMediaType =
          Array.isArray(attachmentsParam) && attachmentsParam.length > 0
            ? String((attachmentsParam[0] as { mediaType?: string }).mediaType || "")
            : "";
        if (!hasText && firstMediaType) {
          if (firstMediaType.startsWith("image/")) apType = "image";
          else if (firstMediaType.startsWith("video/")) apType = "video";
          else apType = "file";
        }

        const res = await apiFetch(
          `/api/groups/${encodeURIComponent(room.name)}/messages`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              from: `${user.userName}@${getDomain()}`,
              type: apType,
              content: text,
              attachments: attachmentsParam,
              // 画像・動画単体送信のときの互換フィールド（サーバー側で参照）
              url: (attachmentsParam && attachmentsParam.length > 0)
                ? (attachmentsParam[0] as { url?: string }).url
                : undefined,
              mediaType: (attachmentsParam && attachmentsParam.length > 0)
                ? (attachmentsParam[0] as { mediaType?: string }).mediaType
                : undefined,
              key: (attachmentsParam && attachmentsParam.length > 0)
                ? (attachmentsParam[0] as { key?: string }).key
                : undefined,
              iv: (attachmentsParam && attachmentsParam.length > 0)
                ? (attachmentsParam[0] as { iv?: string }).iv
                : undefined,
              preview: (attachmentsParam && attachmentsParam.length > 0)
                ? (attachmentsParam[0] as { preview?: unknown }).preview
                : undefined,
            }),
          },
        );
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "送信に失敗しました" }));
          globalThis.dispatchEvent(new CustomEvent("app:toast", {
            detail: { type: "error", title: "送信エラー", description: String(err.error ?? "送信に失敗しました") },
          }));
          return;
        }
        const j = await res.json();
        const msg: ChatMessage = {
          id: String(j.id ?? crypto.randomUUID()),
          author: `${user.userName}@${getDomain()}`,
          displayName: user.displayName || user.userName,
          address: `${user.userName}@${getDomain()}`,
          content: String(j.content ?? text),
          attachments: Array.isArray(j.attachments) ? j.attachments : undefined,
          timestamp: new Date(String(j.createdAt ?? new Date())),
          type: apType === "note"
            ? (Array.isArray(j.attachments) && j.attachments.length > 0
              ? (((j.attachments[0]?.mediaType || "").startsWith("image/"))
                ? "image"
                : ((j.attachments[0]?.mediaType || "").startsWith("video/") ? "video" : "file"))
              : "note")
            : (apType === "image" ? "image" : apType === "video" ? "video" : "file"),
          isMe: true,
          avatar: room.avatar,
        };
        if (selectedRoom() === room.id) {
          setMessages((prev) => [...prev, msg]);
        }
        setMessagesByRoom((prev) => {
          const key = roomCacheKey(room.id);
          const list = (prev[key] ?? []).concat(msg);
          const next = { ...prev, [key]: list };
          const user2 = account();
          if (user2) void saveDecryptedMessages(user2.id, room.id, list);
          return next;
        });
        updateRoomLast(room.id, msg);
        setNewMessage("");
        setMediaFiles([]);
        setMediaPreviews([]);
      } catch {
        globalThis.dispatchEvent(new CustomEvent("app:toast", {
          detail: { type: "error", title: "送信エラー", description: "送信に失敗しました" },
        }));
      }
      return;
    }
    // --- DM 送信 ---
    try {
      const selfHandle = `${user.userName}@${getDomain()}`;
      const others = (room.members ?? []).filter((m) => m && m !== selfHandle);
      const fallbackPeer = room.id.includes("@")
        ? normalizeActor(room.id as unknown as ActorID)
        : undefined;
      const targets = others.length > 0
        ? others
        : (fallbackPeer ? [fallbackPeer] : []);
      if (targets.length > 0) {
        let attachmentsParam: Record<string, unknown>[] | undefined;
        if (mediaFiles().length > 0) {
          const built: Record<string, unknown>[] = [];
          for (const f of mediaFiles()) {
            try {
              const att = await buildAttachment(f);
              if (att && typeof att.url === "string") built.push(att);
            } catch {
              // ignore individual failures
            }
          }
          if (built.length > 0) attachmentsParam = built;
        }
        const ok = await sendDirectMessage(
          selfHandle,
          targets,
          text,
          attachmentsParam,
        );
        if (!ok) {
          alert("メッセージの送信に失敗しました");
          return;
        }
        setNewMessage("");
        setMediaFiles([]);
        setMediaPreviews([]);
        const fetched = await fetchMessagesForRoom(room, {
          limit: 1,
          dryRun: true,
        });
        if (fetched.length > 0) {
          const last = fetched[fetched.length - 1];
          if (selectedRoom() === room.id) {
            setMessages((old) => {
              if (old.some((x) => x.id === last.id)) return old;
              const next = [...old, last];
              setMessagesByRoom({
                ...messagesByRoom(),
                [roomCacheKey(room.id)]: next,
              });
              const user2 = account();
              if (user2) void saveDecryptedMessages(user2.id, room.id, next);
              return next;
            });
          }
          updateRoomLast(room.id, last);
        }
        return;
      }
    } catch { /* fallback to legacy path if needed */ }
    // DMのみ対応。ここには通常到達しません。
    return;
  };

  // 画面サイズ検出
  const checkMobile = () => {
    setIsMobile(globalThis.innerWidth < 768);
  };

  // モバイルでの部屋選択時の動作
  const selectRoom = (roomId: string) => {
    console.log("selected room:", roomId); // for debug
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
    // DM はサーバー経由で扱う

    // WebSocket からのメッセージを安全に型ガードして処理する
    interface IncomingAttachment {
      url: string;
      mediaType: string;
      key?: string;
      iv?: string;
      preview?: { url?: string; data?: string; mediaType?: string };
    }
    // WS はトリガー用: 本文は含まれない想定
    interface IncomingPayload {
      id: string;
      roomId?: string;
      from: string;
      to: string[];
      createdAt: string;
      // 旧仕様互換のため任意に残す（存在しても使わない）
      content?: string;
      mediaType?: string;
      encoding?: string;
      attachments?: IncomingAttachment[];
    }
    interface HandshakePayload {
      id: string;
      roomId: string;
      sender: string;
      recipients: string[];
      createdAt: string;
    }
    type IncomingMessage =
      | { type: "handshake"; payload: HandshakePayload }
      | {
        type: "encryptedMessage" | "publicMessage";
        payload: IncomingPayload;
      };
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
        typeof o.createdAt === "string";
      if (!base) return false;
      if (typeof o.attachments === "undefined") return true;
      return Array.isArray(o.attachments) && o.attachments.every(isAttachment);
    };

    const isHandshakePayload = (v: unknown): v is HandshakePayload => {
      if (typeof v !== "object" || v === null) return false;
      const o = v as Record<string, unknown>;
      return typeof o.id === "string" &&
        typeof o.roomId === "string" &&
        typeof o.sender === "string" &&
        isStringArray(o.recipients) &&
        typeof o.createdAt === "string";
    };

    const isIncomingMessage = (v: unknown): v is IncomingMessage => {
      if (typeof v !== "object" || v === null) return false;
      const o = v as Record<string, unknown>;
      const t = o.type;
      if (t === "handshake") return isHandshakePayload(o.payload);
      if (t !== "encryptedMessage" && t !== "publicMessage") return false;
      return isPayload(o.payload);
    };

    const handler = async (msg: unknown) => {
      try {
        if (typeof msg === "object" && msg !== null) {
          const m = msg as Record<string, unknown>;
          // DM 通知（/api/dm 経由）を先に処理
          if (typeof m.type === "string" && m.type === "dm") {
            const p = m.payload as Record<string, unknown> | undefined;
            if (!p) return;
            const user = account();
            if (!user) return;
            const self = `${user.userName}@${getDomain()}`;
            const from = typeof p.from === "string" ? p.from : "";
            const to = typeof p.to === "string"
              ? [p.to]
              : Array.isArray(p.to)
              ? (p.to as string[])
              : [];
            // normalize handles for reliable comparison
            const normTo = to.map((t) => normalizeActor(t) ?? t);
            const normFrom = normalizeActor(from) ?? from;
            const normSelf = normalizeActor(self) ?? self;
            if (!(normTo.includes(normSelf) || normFrom === normSelf)) return;
            const partnerId = normFrom === normSelf
              ? (normTo.find((v) => v !== normSelf) ?? normTo[0])
              : normFrom;
            if (!partnerId) return;
            const normPartner = normalizeActor(partnerId as ActorID);
            let room = chatRooms().find((r) =>
              r.type === "dm" &&
              ((r.members ?? []).includes(normPartner) || r.id === normPartner)
            );
            if (!room) {
              room = {
                id: normPartner,
                name: "",
                displayName: normPartner.split("@")[0],
                userName: user.userName,
                domain: getDomain(),
                avatar: (normPartner.split("@")[0] || "?").charAt(0)
                  .toUpperCase(),
                unreadCount: 0,
                type: "dm",
                members: [normPartner],
                lastMessage: "...",
                lastMessageTime: undefined,
              };
              upsertRoom(room);
              try {
                await applyDisplayFallback([room]);
              } catch { /* ignore */ }
            }
            if (!room) return;
            // 選択中なら差分取得して追記、未選択ならプレビュー更新のみ
            if (selectedRoom() === room.id) {
              const fetched = await fetchMessagesForRoom(room, {
                limit: 1,
                dryRun: true,
              });
              if (fetched.length > 0) {
                const last = fetched[fetched.length - 1];
                setMessages((prev) => {
                  if (prev.some((x) => x.id === last.id)) return prev;
                  const next = [...prev, last];
                  setMessagesByRoom({
                    ...messagesByRoom(),
                    [roomCacheKey(room!.id)]: next,
                  });
                  const u2 = account();
                  if (u2) void saveDecryptedMessages(u2.id, room!.id, next);
                  return next;
                });
                updateRoomLast(room.id, last);
              }
            } else {
              const fetched = await fetchMessagesForRoom(room, {
                limit: 1,
                dryRun: true,
              });
              if (fetched.length > 0) {
                updateRoomLast(room.id, fetched[fetched.length - 1]);
              }
            }
            return;
          }
        }
      } catch (e) {
        console.warn("failed to handle message", e);
      }

      if (!isIncomingMessage(msg)) {
        // 想定外のメッセージは無視
        return;
      }
      const user = account();
      if (!user) return;
      const self = `${user.userName}@${getDomain()}`;

      if (msg.type === "handshake") {
        // ハンドシェイク通知は無視
        return;
      }

      const data = msg.payload;
      // フィルタ: 自分宛て/自分発でないメッセージは無視
      // normalize to/from for stable comparison
      const normTo2 = data.to.map((t) => normalizeActor(t) ?? t);
      const normFrom2 = normalizeActor(data.from) ?? data.from;
      const normSelf2 = normalizeActor(self) ?? self;
      if (!(normTo2.includes(normSelf2) || normFrom2 === normSelf2)) {
        return;
      }

      // まず roomId が来ていればそれで特定する（UUIDグループ等に強い）
      let room = data.roomId
        ? chatRooms().find((r) => r.type === "group" && r.id === data.roomId)
        : undefined;

      const partnerId = normFrom2 === normSelf2
        ? (normTo2.find((v) => v !== normSelf2) ?? normTo2[0])
        : normFrom2;

      const normalizedPartner = normalizeActor(partnerId);
      const [partnerName] = splitActor(normalizedPartner);
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

      // 優先: 明示的に type === 'dm' のルームを探す（ID一致または members に含まれる）
      if (!room && normalizedPartner) {
        room = chatRooms().find((r) =>
          r.type === "dm" &&
          (r.id === normalizedPartner ||
            (r.members ?? []).includes(normalizedPartner))
        );
      }

      // それ以外は既存のグループ/名前ベース検索にフォールバック
      if (!room) {
        room = chatRooms().find((r) =>
          r.type === "group" && r.id === partnerName
        );
      }
      if (!room) {
        for (const t of data.to) {
          const normalized = normalizeActor(t);
          const [toName] = splitActor(normalized);
          const g = chatRooms().find((r) =>
            r.type === "group" && r.id === toName
          );
          if (g) {
            room = g;
            break;
          }
        }
      }
      // 名前付き1:1ルーム（members に normalizedPartner を含む dm を探す）
      if (!room) {
        room = chatRooms().find((r) =>
          r.type === "dm" && (r.members ?? []).includes(normalizedPartner)
        );
      }
      if (!room && uuidRe.test(partnerName)) {
        // グループIDと推測されるがまだ一覧に存在しない場合はルームを作成しない
        return;
      }
      if (!room) {
        room = chatRooms().find((r) =>
          r.type === "group" && r.id === normalizedPartner
        );
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
                name: "",
                displayName: info.displayName || info.userName,
                userName: info.userName,
                domain: info.domain,
                // avatar は外部の authorAvatar を直接流用しない。既存の方式に任せる
                avatar: info.userName.charAt(0).toUpperCase(),
                unreadCount: 0,
                type: "group" as const,
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

      const isMe = normFrom2 === normSelf2;
      if (!isMe) updatePeerHandle(room.id, data.from);
      const selfH3 = `${user.userName}@${getDomain()}`;
      const baseName3 = room.displayName ?? room.name;
      const otherName = (!baseName3 || baseName3 === user.displayName ||
          baseName3 === user.userName || baseName3 === selfH3)
        ? data.from
        : baseName3;
      const _displayName = isMe
        ? (user.displayName || user.userName)
        : otherName;
      const _text: string = "";
      const _attachments:
        | {
          data?: string;
          url?: string;
          mediaType: string;
          preview?: { url?: string; data?: string; mediaType?: string };
        }[]
        | undefined = undefined;
      const _localId: string | undefined = undefined;

      // WSは通知のみ: RESTから取得して反映
      if (msg.type === "encryptedMessage") {
        // 自分が送信した直後の通知は再取得せず無視（ラチェット巻き戻り防止）
        if (msg.payload.from === self) {
          return;
        }
        const _isSelected = selectedRoom() === room.id;
        if (room.type !== "dm") return; // DM 以外はWS対象外
        if (selectedRoom() === room.id) {
          const prev = messages();
          const lastTs = prev.length > 0
            ? prev[prev.length - 1].timestamp.toISOString()
            : undefined;
          const fetched = await fetchMessagesForRoom(
            room,
            lastTs ? { after: lastTs } : { limit: 1 },
          );
          if (fetched.length > 0 && selectedRoom() === room.id) {
            setMessages((old) => {
              const ids = new Set(old.map((m) => m.id));
              const add = fetched.filter((m) => !ids.has(m.id));
              const next = [...old, ...add];
              setMessagesByRoom({
                ...messagesByRoom(),
                [roomCacheKey(room.id)]: next,
              });
              const user = account();
              if (user) void saveDecryptedMessages(user.id, room.id, next);
              return next;
            });
            const last = fetched[fetched.length - 1];
            updateRoomLast(room.id, last);
          }
        } else {
          // 一覧のみ更新（最新1件を取得してプレビュー）
          const fetched = await fetchMessagesForRoom(room, {
            limit: 1,
            dryRun: true,
          });
          if (fetched.length > 0) {
            updateRoomLast(room.id, fetched[fetched.length - 1]);
          }
        }
        return;
      }

      // publicMessage 等の将来拡張が来た場合はRESTで取得する
      if (room.type !== "dm") return; // DM 以外はWS対象外
      const fetched = await fetchMessagesForRoom(room, {
        limit: 1,
        dryRun: true,
      });
      if (fetched.length > 0) {
        const last = fetched[fetched.length - 1];
        if (selectedRoom() === room.id) {
          setMessages((prev) => {
            if (prev.some((x) => x.id === last.id)) return prev;
            const next = [...prev, last];
            setMessagesByRoom({
              ...messagesByRoom(),
              [roomCacheKey(room.id)]: next,
            });
            const user = account();
            if (user) void saveDecryptedMessages(user.id, room.id, next);
            return next;
          });
        }
        updateRoomLast(room.id, last);
      }
    };
    acceptCleanup = () => {};

    addMessageHandler(handler);
    wsCleanup = () => removeMessageHandler(handler);
    // 初期表示時のメッセージ読み込みも
    // selectedRoom 監視の createEffect に任せる
    adjustHeight(textareaRef);
  });

  onMount(() => {
    void loadRooms();
  });
  createEffect(
    on(
      () => account(),
      () => {
        void loadRooms();
      },
    ),
  );

  createEffect(
    on(
      () => selectedRoom(),
      async (roomId) => {
        const selfRoomId = getSelfRoomId(account());
        if (!roomId) {
          setMessages([]);
          setPendingRoom(null);
          return;
        }

        // If rooms are not loaded yet, defer handling until load completes
        if (!roomsReady()) {
          setPendingRoom(roomId);
          return;
        }

        // rooms are loaded; clear pending
        setPendingRoom(null);

        const normalizedRoomId = normalizeActor(roomId);
        const room = chatRooms().find((r) => r.id === normalizedRoomId);

        // If room not found and it's not the self-room, redirect to chat list
        if (!room) {
          if (normalizedRoomId === selfRoomId) {
            // self room is allowed
            setMessages([]);
            return;
          }
          // unknown room from URL: go back to chat list
          setSelectedRoom(null);
          navigate("/chat");
          return;
        }

        // Found: proceed as before
        await ensureDmPartnerInfo(room);
        await loadMessages(room, true);
      },
    ),
  );

  // when rooms become ready and there was a pending room from the URL,
  // validate it now (createEffect ensures account/chatRooms are current)
  createEffect(
    on(
      () => roomsReady(),
      async (ready) => {
        if (!ready) return;
        const p = pendingRoom();
        if (!p) return;
        const normalized = normalizeActor(p);
        const room = chatRooms().find((r) => r.id === normalized);
        const selfRoomId = getSelfRoomId(account());
        if (room) {
          // load messages for the pending room
          await ensureDmPartnerInfo(room);
          await loadMessages(room, true);
          return;
        }
        if (normalized === selfRoomId) {
          setMessages([]);
          return;
        }
        // not found -> redirect
        setSelectedRoom(null);
        navigate("/chat");
      },
    ),
  );
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
  });
  createEffect(() => {
    newMessage();
    adjustHeight(textareaRef);
  });
  onCleanup(() => {
    globalThis.removeEventListener("resize", checkMobile);
    wsCleanup?.();
    acceptCleanup?.();
    // no-op: preview poller removed in favor of WS-driven updates
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
              showAds={showAds()}
              onCreateRoom={() => setShowCreateDialog(true)}
              onCreateDM={() => {
                setCreateDialogType("dm");
                setShowCreateDialog(true);
              }}
              onCreateGroup={() => {
                setCreateDialogType("group");
                setShowCreateDialog(true);
              }}
              segment={segment()}
              onSegmentChange={setSegment}
              onCreateFriendRoom={(friendId: string) => {
                const normalized = normalizeActor(friendId as ActorID);
                selectRoom(normalized);
              }}
              onAcceptInvite={async (room) => {
                try {
                  const user = account();
                  if (!user) return;
                  const gname = room.meta?.groupName || room.name;
                  const handle = `${user.userName}@${getDomain()}`;
                  const res = await apiFetch(
                    `/api/groups/${encodeURIComponent(gname)}/join`,
                    {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ member: handle }),
                    },
                  );
                  if (res.ok) {
                    if (room.meta?.notificationId) {
                      await apiFetch(
                        `/api/notifications/${room.meta.notificationId}`,
                        { method: "DELETE" },
                      ).catch(() => {});
                    }
                    setChatRooms((prev) => prev.map((r) => r.id === room.id
                      ? { ...r, pendingInvite: false, lastMessage: "..." }
                      : r));
                    globalThis.dispatchEvent(new CustomEvent("app:toast", {
                      detail: { type: "success", title: "グループ", description: "参加しました" },
                    }));
                  } else {
                    globalThis.dispatchEvent(new CustomEvent("app:toast", {
                      detail: { type: "error", title: "グループ", description: "参加に失敗しました" },
                    }));
                  }
                } catch {
                  globalThis.dispatchEvent(new CustomEvent("app:toast", {
                    detail: { type: "error", title: "グループ", description: "参加に失敗しました" },
                  }));
                }
              }}
              onIgnoreInvite={async (room) => {
                try {
                  if (room.meta?.notificationId) {
                    await apiFetch(
                      `/api/notifications/${room.meta.notificationId}`,
                      { method: "DELETE" },
                    ).catch(() => {});
                  }
                } finally {
                  setChatRooms((prev) => prev.filter((r) => r.id !== room.id));
                }
              }}
            />
          </div>
          <div
            class={isMobile()
              ? "w-[100vw] flex-shrink-0 min-w-0"
              : "flex-grow w-full min-w-0"}
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
              <div class="relative flex flex-col bg-[#1e1e1e] h-full w-full min-w-0 overflow-hidden chat-container">
                <ChatTitleBar
                  isMobile={isMobile()}
                  selectedRoom={(function () {
                    const r = selectedRoomInfo();
                    const me = account();
                    if (!r) return r;
                    const isDm = r.type === "dm";
                    const looksLikeSelf = me &&
                      (r.name === me.displayName || r.name === me.userName);
                    if (isDm || looksLikeSelf) {
                      // 選択時に相手ハンドルや自分の名前で上書きしない。
                      // 表示名が明示的にある場合はそれを使い、なければ空文字にしてタイトルを非表示にする。
                      return { ...r, name: r.displayName || "" };
                    }
                    return r;
                  })()}
                  onBack={backToRoomList}
                  onOpenSettings={() => setShowSettings(true)}
                  showSettings={(function () {
                    const r = selectedRoomInfo();
                    return r ? r.type !== "memo" : true;
                  })()}
                />
                {/* 旧 group 操作UIは削除（イベントソース派生に移行） */}
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
                {/* Welcomeバナーは削除 */}
                <ChatSendForm
                  newMessage={newMessage()}
                  setNewMessage={setNewMessage}
                  mediaFiles={mediaFiles()}
                  setMediaFiles={setMediaFiles}
                  mediaPreviews={mediaPreviews()}
                  setMediaPreviews={setMediaPreviews}
                  sendMessage={sendMessage}
                  // TAKO KEEP（memo）でも画像・ファイル送信を許可
                  allowMedia
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
      {/* GroupCreateDialog removed; room creation handled through sidebar */}
      <ChatCreateDMDialog
        isOpen={showCreateDialog() && createDialogType() === "dm"}
        onClose={() => setShowCreateDialog(false)}
        onCreate={(handle) => {
          selectRoom(normalizeActor(handle as ActorID));
        }}
      />

      <GroupCreateDialog
        isOpen={showCreateDialog() && createDialogType() === "group"}
        mode="create"
        onClose={() => setShowCreateDialog(false)}
        onCreate={async (name: string, membersStr: string) => {
          const user = account();
          if (!user) return;
          const handle = `${user.userName}@${getDomain()}`;
          // membersStr is comma-separated list
          const members = membersStr.split(",").map((s) => s.trim()).filter(
            Boolean,
          );
          try {
            const id = await _addRoom(handle, { name, members, type: "group" });
            if (!id) return;
            selectRoom(id);
            upsertRooms([
              {
                id,
                name,
                displayName: name,
                userName: user.userName,
                domain: getDomain(),
                avatar: name ? name.charAt(0).toUpperCase() : "👥",
                unreadCount: 0,
                type: "group",
                members,
                hasName: name !== "",
                hasIcon: false,
                lastMessage: "...",
                lastMessageTime: undefined,
              },
            ]);
          } catch {
            /* ignore */
          }
        }}
      />

      <ChatSettingsOverlay
        isOpen={showSettings()}
        room={selectedRoomInfo()}
        onClose={() => setShowSettings(false)}
        onRoomUpdated={(partial) => {
          const id = selectedRoom();
          if (!id) return;
          setChatRooms((prev) =>
            prev.map((r) => r.id === id ? { ...r, ...partial } : r)
          );
        }}
        onRoomDeleted={(id) => {
          setChatRooms((prev) => prev.filter((r) => r.id !== id));
          if (selectedRoom() === id) setSelectedRoom(null);
        }}
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
// --- ローカル補助関数 ---
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
  return undefined;
}

async function fetchMemoMessages(
  handle: string,
  params?: { limit?: number; before?: string; after?: string },
) {
  try {
    const qs = new URLSearchParams({ user1: handle, user2: handle });
    if (typeof params?.limit === "number") {
      qs.set("limit", String(params.limit));
    }
    if (params?.before) qs.set("before", params.before);
    if (params?.after) qs.set("after", params.after);
    const res = await apiFetch(`/api/dm?${qs}`);
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

async function searchRooms(
  _handle: string,
  _opts?: { type?: Room["type"]; [key: string]: unknown },
) {
  try {
    const roomType = _opts?.type;
    if (roomType === "group") {
      const gres = await apiFetch(
        `/api/groups?member=${encodeURIComponent(_handle)}`,
      );
      if (!gres.ok) return [];
      const j = await gres.json();
      if (!Array.isArray(j)) return [];
      return j.map((r) => ({
        id: normalizeActor(String(r.id ?? "")),
        name: String(r.name ?? ""),
        icon: typeof r.icon === "string" ? r.icon : undefined,
        members: Array.isArray(r.members)
          ? r.members.map((m: unknown) => normalizeActor(String(m)))
          : [],
      }));
    }
    if (roomType === "dm" || roomType === undefined) {
      const dres = await apiFetch(
        `/api/dms?owner=${encodeURIComponent(_handle)}`,
      );
      if (!dres.ok) return [];
      const j = await dres.json();
      if (!Array.isArray(j)) return [];
      return j.map((r) => ({
        id: normalizeActor(String(r.id ?? "")),
        name: String(r.name ?? ""),
        icon: typeof r.icon === "string" ? r.icon : undefined,
        members: Array.isArray(r.members)
          ? r.members.map((m: unknown) => normalizeActor(String(m)))
          : [],
      }));
    }
    return [];
  } catch {
    return [];
  }
}

// try to read pending invites for a given room or user
async function readPending(
  userId: string,
  roomId: string,
  type: Room["type"],
): Promise<string[] | undefined> {
  try {
    if (type === "group") {
      try {
        const rres = await apiFetch(
          `/api/rooms/${encodeURIComponent(roomId)}/pendingInvites`,
        );
        if (rres.ok) {
          const jr = await rres.json();
          if (Array.isArray(jr)) return jr.map(String).filter(Boolean);
        }
      } catch {
        /* ignore */
      }
    } else if (type === "dm") {
      try {
        const dres = await apiFetch(
          `/api/dms/${encodeURIComponent(roomId)}/pendingInvites`,
        );
        if (dres.ok) {
          const jd = await dres.json();
          if (Array.isArray(jd)) return jd.map(String).filter(Boolean);
        }
      } catch {
        /* ignore */
      }
    }
    try {
      const ures = await apiFetch(
        `/api/users/${encodeURIComponent(userId)}/pendingInvites`,
      );
      if (!ures.ok) return undefined;
      const ju = await ures.json();
      if (Array.isArray(ju)) return ju.map(String).filter(Boolean);
    } catch {
      /* ignore */
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

async function _addRoom(
  _handle: string,
  _room: {
    id?: string;
    name: string;
    members: string[];
    type: Room["type"];
  },
  _meta?: unknown,
): Promise<string | undefined> {
  try {
    if (_room.type === "dm") {
      await apiFetch(`/api/dms`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ owner: _handle, ..._room }),
      });
      return _room.id;
    } else if (_room.type === "group") {
      const res = await apiFetch(`/api/groups`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          groupName: _room.name,
          displayName: _room.name,
          member: _handle,
          invites: _room.members || [],
        }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => undefined);
        if (j && typeof j === "object" && "id" in j) {
          return String((j as { id: string }).id);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

// event cursor state (local only)
const _eventsCursor = createSignal<string | null>(null);
