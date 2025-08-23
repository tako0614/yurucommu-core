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
  fetchFollowing,
  fetchUserInfo,
  fetchUserInfoBatch,
} from "./microblog/api.ts";
import { apiFetch, getDomain } from "../utils/config.ts";
import { addMessageHandler, removeMessageHandler } from "../utils/ws.ts";
import { isAdsenseEnabled, loadAdsenseConfig } from "../utils/adsense.ts";
import { ChatRoomList } from "./chat/ChatRoomList.tsx";
import { ChatTitleBar } from "./chat/ChatTitleBar.tsx";
import { ChatSettingsOverlay } from "./chat/ChatSettingsOverlay.tsx";
import { ChatMessageList } from "./chat/ChatMessageList.tsx";
import { ChatSendForm } from "./chat/ChatSendForm.tsx";
import { GroupCreateDialog } from "./chat/GroupCreateDialog.tsx";
import type { ActorID, ChatMessage, Room } from "./chat/types.ts";
import { b64ToBuf, bufToB64 } from "../../../shared/buffer.ts";

/* E2EE removed — provide lightweight stubs to keep UI functional without MLS/E2EE */

/* types */
type RosterEvidence = any;
type StoredGroupState = any;
type GeneratedKeyPair = any;

/* minimal eventsCursor shim (used like a signal) */
let __eventsCursor: string | null = null;
function eventsCursor() {
  return __eventsCursor;
}
function setEventsCursor(v: string | null) {
  __eventsCursor = v;
}

/* simple useMLS stub (match expected call signature) */
function useMLS(_userName: string) {
  const bindingStatus = () => null as string | null;
  const bindingInfo = () => null as any;
  const ktInfo = () => ({ included: false } as { included: boolean });
  const assessBinding = async (
    _userId?: string,
    _roomId?: string,
    _actor?: string,
    _credentialFingerprint?: string,
    _ktIncluded?: boolean,
  ) =>
    ({ status: "Unknown", info: { label: "N/A" }, kt: { included: false } } as {
      status: string;
      info: any;
      kt: { included: boolean };
    });
  const generateKeys = async (_actor?: string) => {
    return { public: "", private: "", encoded: "" } as GeneratedKeyPair;
  };
  return { bindingStatus, bindingInfo, ktInfo, assessBinding, generateKeys };
}

/* storage stubs */
async function getCacheItem(_accountId: string, _key: string) {
  return undefined;
}
async function setCacheItem(_accountId: string, _key: string, _val: unknown) {
  return;
}
async function loadDecryptedMessages(_accountId: string, _roomId: string) {
  return undefined;
}
async function saveDecryptedMessages(_accountId: string, _roomId: string, _v: unknown) {
  return;
}
async function loadMLSGroupStates(_accountId: string) {
  return {} as Record<string, StoredGroupState>;
}
async function saveMLSGroupStates(_accountId: string, _v: Record<string, StoredGroupState>) {
  return;
}
async function loadKeyPackageRecords(_accountId: string, _roomId: string) {
  return [] as unknown[];
}
async function loadMLSKeyPair(_accountId: string) {
  return null as GeneratedKeyPair | null;
}
async function saveMLSKeyPair(_accountId: string, _kp: GeneratedKeyPair) {
  return;
}
async function loadAllMLSKeyPairs(_accountId: string) {
  return [] as GeneratedKeyPair[];
}

/* helper stubs for MLS/E2EE operations referenced across the file
   Implementations are intentionally simplistic: they preserve call/return shapes
   so UI code can continue to run without MLS. */
async function createMLSGroup(_actor: string) {
  return { state: {} as StoredGroupState };
}
async function generateKeyPair(_actor?: string) {
  return { public: "", private: "", encoded: "" };
}
function decodePublicMessage(m: unknown): Uint8Array | null {
  try {
    if (typeof m === "string") return b64ToBuf(m);
    if (m instanceof ArrayBuffer) return new Uint8Array(m);
    if (m instanceof Uint8Array) return m;
  } catch {
    /* ignore */
  }
  return null;
}
function decodeMlsMessage(_data: ArrayBuffer | Uint8Array, _offset = 0) {
  // return undefined to indicate "not an MLS envelope" — callers handle gracefully
  return undefined as unknown as any;
}
async function processCommit(group: StoredGroupState, _publicMessage: unknown) {
  // no-op: return same group
  return group;
}
async function processProposal(group: StoredGroupState, _publicMessage: unknown) {
  return group;
}
async function verifyWelcome(_wBytes: Uint8Array) {
  return true;
}
async function importRosterEvidence(_userId: string, _roomId: string, _ev: RosterEvidence) {
  return true;
}
async function appendRosterEvidence(_userId: string, _roomId: string, _evs: RosterEvidence[] = []) {
  return;
}
async function decryptMessage(group: StoredGroupState, data: ArrayBuffer | Uint8Array) {
  // best-effort: treat message as plaintext JSON for UI display
  let arr: Uint8Array;
  if (data instanceof Uint8Array) arr = data;
  else arr = new Uint8Array(data);
  return { plaintext: arr, state: group } as { plaintext: Uint8Array; state: StoredGroupState };
}
async function createCommitAndWelcomes(group: StoredGroupState, _kpInputs: any[]) {
  return {
    commit: { dummy: true },
    welcomes: [],
    state: group,
  } as { commit: unknown; welcomes: { data?: unknown }[]; state: StoredGroupState };
}
function encodePublicMessage(obj: unknown): Uint8Array {
  try {
    return new TextEncoder().encode(JSON.stringify(obj));
  } catch {
    return new Uint8Array();
  }
}
async function removeMembers(group: StoredGroupState, _indices: number[]) {
  return { commit: { dummy: true }, state: group } as { commit: unknown; state: StoredGroupState };
}
async function joinWithWelcome(_w: Uint8Array, _kp: GeneratedKeyPair) {
  return {} as StoredGroupState;
}
async function encryptMessage(group: StoredGroupState, body: string) {
  const message = new TextEncoder().encode(body);
  return { message, state: group } as { message: Uint8Array; state: StoredGroupState };
}

/* network-side fallbacks: signatures match usage in the file
   Extended with upload / fetch / room management stubs so callers compile. */
async function sendEncryptedMessage(
  _roomId: string,
  _sender: string,
  _recipients: string[] | string,
  _content: { content: string; mediaType?: string; encoding?: string },
) {
  // Best-effort: try server API to post a message; otherwise succeed silently.
  try {
    await apiFetch(`/api/rooms/${encodeURIComponent(String(_roomId))}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sender: _sender,
        recipients: Array.isArray(_recipients) ? _recipients : [_recipients],
        content: _content,
      }),
    });
  } catch {
    /* ignore */
  }
  return true;
}

/* sendHandshake: accept string / Uint8Array / ArrayBuffer and normalize safely */
async function sendHandshake(
  _roomId: string,
  _sender: string,
  _content: string | Uint8Array | ArrayBuffer,
  _recipients: string[] = [],
) {
  try {
    const toUint8 = (c: string | Uint8Array | ArrayBuffer): Uint8Array => {
      if (typeof c === "string") return new TextEncoder().encode(c);
      if (c instanceof Uint8Array) return c;
      return new Uint8Array(c as ArrayBuffer);
    };
    // produce a Uint8Array and pass that to bufToB64 to avoid ArrayBufferLike typing issues
    const normalized = typeof _content === "string"
      ? _content
      : bufToB64(toUint8(_content));
    await apiFetch(`/api/rooms/${encodeURIComponent(String(_roomId))}/handshakes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sender: _sender,
        recipients: _recipients,
        content: normalized,
      }),
    });
  } catch {
    /* ignore */
  }
  return true;
}

async function sendGroupMetadata(
  _roomId?: string,
  _sender?: string,
  _gstate?: StoredGroupState,
  _recipients?: string[],
  _meta?: { name?: string; icon?: string },
) {
  // best-effort noop
  return true;
}
async function addKeyPackage(_userName?: string, _kp?: { content: string }) {
  return true;
}

/* uploadFile: accepts an object and tries a JSON POST; returns url or null */
async function uploadFile(opts: {
  content: ArrayBuffer | Uint8Array;
  mediaType?: string;
  key?: string;
  iv?: string;
  name?: string;
}) {
  try {
    // normalize to Uint8Array to avoid SharedArrayBuffer / ArrayBufferLike issues
    const asUint8 = opts.content instanceof Uint8Array
      ? opts.content
      : new Uint8Array(opts.content as ArrayBuffer);
    const payload = {
      data: bufToB64(asUint8),
      mediaType: opts.mediaType,
      key: opts.key,
      iv: opts.iv,
      name: opts.name,
    };
    const res = await apiFetch("/api/files", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
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

/* simple fetch stubs that prefer server endpoints but return safe defaults */
async function fetchHandshakes(_roomId: string, _opts?: any) {
  try {
    const res = await apiFetch(`/api/rooms/${encodeURIComponent(_roomId)}/handshakes`, {
      method: "GET",
    });
    if (res.ok) return (await res.json()) as any[];
  } catch { /* ignore */ }
  return [] as any[];
}
async function fetchKeepMessages(_handle: string, _opts?: any) {
  try {
    const res = await apiFetch(`/api/users/${encodeURIComponent(_handle)}/keeps`, {
      method: "GET",
    });
    if (res.ok) return (await res.json()) as any[];
  } catch {}
  return [] as any[];
}
async function fetchEncryptedMessages(_roomId: string, _userHandle: string, _opts?: any) {
  try {
    const q = _opts && _opts.after ? `?after=${encodeURIComponent(_opts.after)}` : "";
    const res = await apiFetch(`/api/rooms/${encodeURIComponent(_roomId)}/messages${q}`, {
      method: "GET",
    });
    if (res.ok) return (await res.json()) as any[];
  } catch {}
  return [] as any[];
}
async function fetchKeyPackages(_user: string, _domain?: string) {
  try {
    const url = _domain ? `https://${_domain}/.well-known/keypackages/${_user}` : `/api/keypackages/${encodeURIComponent(_user)}`;
    const res = await apiFetch(url, { method: "GET" });
    if (res.ok) return (await res.json()) as any[];
  } catch {}
  return [] as any[];
}
async function searchRooms(_accountId: string, _opts?: any) {
  try {
    const res = await apiFetch(`/api/rooms?accountId=${encodeURIComponent(_accountId)}`, { method: "GET" });
    if (res.ok) return (await res.json()) as any[];
  } catch {}
  return [] as any[];
}
async function addRoom(accountId: string, room: any, _signal?: any) {
  try {
    await apiFetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, ...room }),
    });
  } catch {
    /* ignore */
  }
}
async function fetchPendingInvites(_userName: string) {
  try {
    const res = await apiFetch(`/api/users/${encodeURIComponent(_userName)}/pendingInvites`, { method: "GET" });
    if (res.ok) return (await res.json()) as any[];
  } catch {}
  return [] as any[];
}
async function sendKeepMessage(_handle: string, _content: string) {
  try {
    const res = await apiFetch(`/api/keeps`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle: _handle, content: _content }),
    });
    if (res.ok) return (await res.json());
  } catch {}
  return null;
}

/* simple fallback for fetching events */
async function fetchEvents(_opts?: { since?: string; limit?: number }) {
  return [] as any[];
}

/* helper used elsewhere */
async function fetchKeyPackageRecords() { return []; }

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

// joinAck シグナル (初回参加確認) を表示用メッセージから除外するための判定
function isJoinAckText(text: string): boolean {
  try {
    const obj = JSON.parse(text);
    return !!obj && typeof obj === "object" &&
      (obj as { type?: unknown }).type === "joinAck";
  } catch {
    return false;
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

function getSelfRoomId(_user: Account | null): string | null {
  // セルフルーム（TAKO Keep）のIDは固定で "memo"
  return _user ? "memo" : null;
}

export function Chat() {
  const [selectedRoom, setSelectedRoom] = useAtom(selectedRoomState); // グローバル状態を使用
  const [account] = useAtom(activeAccount);
  const { bindingStatus, bindingInfo, assessBinding, ktInfo } = useMLS(
    account()?.userName ?? "",
  );
  const [newMessage, setNewMessage] = createSignal("");
  const [mediaFile, setMediaFile] = createSignal<File | null>(null);
  const [mediaPreview, setMediaPreview] = createSignal<string | null>(null);
  const [showRoomList, setShowRoomList] = createSignal(true); // モバイル用: 部屋リスト表示制御
  const [isMobile, setIsMobile] = createSignal(false); // モバイル判定
  const [chatRooms, setChatRooms] = createSignal<Room[]>([]);

  const [messages, setMessages] = createSignal<ChatMessage[]>([]);
  // ルームごとの復号済みメッセージキャッシュ（再選択時の再復号を回避）
  const [messagesByRoom, setMessagesByRoom] = createSignal<
    Record<string, ChatMessage[]>
  >({});
  const roomCacheKey = (roomId: string): string => {
    const user = account();
    return user ? `${user.id}:${roomId}` : roomId;
  };
  const [groups, setGroups] = createSignal<Record<string, StoredGroupState>>(
    {},
  );
  const [keyPair, setKeyPair] = createSignal<GeneratedKeyPair | null>(null);
  const [partnerHasKey, setPartnerHasKey] = createSignal(true);
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
    "create" | "invite"
  >("create");
  const [initialMembers, setInitialMembers] = createSignal<string[]>([]);
  const [segment, setSegment] = createSignal<"all" | "people" | "groups">(
    "all",
  );
  // 設定オーバーレイ表示状態
  const [showSettings, setShowSettings] = createSignal(false);
  // 受信した Welcome を保留し、ユーザーに参加可否を尋ねる
  const [pendingWelcomes, setPendingWelcomes] = createSignal<
    Record<string, Uint8Array>
  >({});

  const actorUrl = createMemo(() => {
    const user = account();
    return user
      ? new URL(`/users/${user.userName}`, globalThis.location.origin).href
      : null;
  });

  createEffect(() => {
    const user = account();
    const roomId = selectedRoom();
    const actor = actorUrl();
    if (!user || !roomId || !actor) return;
    void (async () => {
      const records = await loadKeyPackageRecords(user.id, roomId);
      const last = records[records.length - 1];
      if (last) {
        await assessBinding(
          user.id,
          roomId,
          actor,
          (last as any).credentialFingerprint,
          (last as any).ktIncluded,
        );
      }
    })();
  });

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

  // MLSの状態から参加者（自分以外）を抽出（actor URL / handle を正規化しつつ重複除去）
  const participantsFromState = (roomId: string): string[] => {
    const user = account();
    if (!user) return [];
    const state = groups()[roomId];
    if (!state) return [];
    const selfHandle = `${user.userName}@${getDomain()}` as ActorID;
    try {
      const raws = extractMembers(state);
      const normed = raws
        .map((m) => normalizeHandle(m as ActorID) ?? m)
        .filter((m): m is string => !!m);
      const withoutSelf = normed.filter((m) => {
        const h = normalizeHandle(m as ActorID) ?? m;
        return h !== selfHandle;
      });
      return Array.from(new Set(withoutSelf));
    } catch {
      return [];
    }
  };

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
        // 1対1・未命名のとき、タイトルがローカル名等に上書きされていたらハンドルに補正
        const isDm = r.type !== "memo" && (r.members?.length ?? 0) === 1 &&
          !(r.hasName || r.hasIcon);
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
    if (!user || room.type === "memo") return;
    const selfHandle = `${user.userName}@${getDomain()}`;
    // UUID のルームはグループとみなし、DM用の名称/アイコン補完は行わない
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const isUuidRoom = uuidRe.test(room.id);
    // MLSの状態から相手を特定（自分以外）
    const partner = participantsFromState(room.id)[0];
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
          setChatRooms((prev) =>
            prev.map((r) =>
              r.id === room.id
                ? {
                  ...r,
                  displayName: info.displayName || info.userName,
                  avatar: info.authorAvatar || r.avatar,
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

  const loadGroupStates = async () => {
    const user = account();
    if (!user) return;
    try {
      const stored = await loadMLSGroupStates(user.id);
      setGroups(stored);
    } catch (err) {
      console.error("Failed to load group states", err);
    }
  };

  const saveGroupStates = async () => {
    const user = account();
    if (!user) return;
    try {
      await saveMLSGroupStates(user.id, groups());
    } catch (e) {
      console.error("グループ状態の保存に失敗しました", e);
    }
  };

  // グループ状態が存在しなければ初期化して保存
  const initGroupState = async (roomId: string) => {
    try {
      if (groups()[roomId]) return;
      const user = account();
      if (!user) return;
      // 保存済みの状態があればそれを復元
      try {
        const stored = await loadMLSGroupStates(user.id);
        if (stored[roomId]) {
          setGroups((prev) => ({ ...prev, [roomId]: stored[roomId] }));
          return;
        }
      } catch (err) {
        console.error("グループ状態の読み込みに失敗しました", err);
      }
      const pair = await ensureKeyPair();
      if (!pair) return;
      let initState: StoredGroupState | undefined;
      try {
        // アクターURLを identity に用いた正しい Credential で生成
        const actor =
          new URL(`/users/${user.userName}`, globalThis.location.origin).href;
        const created = await createMLSGroup(actor);
        initState = created.state;
      } catch (e) {
        console.error(
          "グループ初期化時にキーからの初期化に失敗しました",
          e,
        );
      }
      if (initState) {
        setGroups((prev) => ({
          ...prev,
          [roomId]: initState,
        }));
        await saveGroupStates();
      }
    } catch (e) {
      console.error("ローカルグループ初期化に失敗しました", e);
    }
  };

  const [isGeneratingKeyPair, setIsGeneratingKeyPair] = createSignal(false);

  const ensureKeyPair = async (): Promise<GeneratedKeyPair | null> => {
    if (isGeneratingKeyPair()) return null;

    let pair: GeneratedKeyPair | null = keyPair();
    const user = account();
    if (!user) return null;
    if (!pair) {
      setIsGeneratingKeyPair(true);
      try {
        pair = await loadMLSKeyPair(user.id);
      } catch (err) {
        console.error("鍵ペアの読み込みに失敗しました", err);
        pair = null;
      }
      if (!pair) {
        // MLS の identity はアクターURLを用いる（外部連合との整合性維持）
        const actor =
          new URL(`/users/${user.userName}`, globalThis.location.origin).href;
        const kp = await generateKeyPair(actor);
        pair = { public: kp.public, private: kp.private, encoded: kp.encoded };
        try {
          await saveMLSKeyPair(user.id, pair);
          await addKeyPackage(user.userName, { content: kp.encoded });
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

  // Handshake の再取得カーソルは ID ではなく時刻ベースで管理（APIが createdAt を after に使うため）
  const lastHandshakeId = new Map<string, string>();

  async function syncHandshakes(room: Room) {
    const user = account();
    if (!user) return;
    let group = groups()[room.id];
    if (!group) {
      await initGroupState(room.id);
      group = groups()[room.id];
      if (!group) return;
    }
    const after = lastHandshakeId.get(room.id);
    const hs = await fetchHandshakes(
      room.id,
      after ? { limit: 100, after } : { limit: 100 },
    );
    if (hs.length === 0) return;
    const ordered = [...hs].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    let updated = false;
    for (const h of ordered) {
      const body = decodePublicMessage(h.message);
      if (!body) continue;
      try {
        try {
          const dec = decodeMlsMessage(body, 0)?.[0];
          if (dec && dec.wireformat === "mls_public_message") {
            group = await processCommit(
              group,
              dec.publicMessage as unknown as never,
            );
            updated = true;
            lastHandshakeId.set(room.id, String(h.createdAt));
            continue;
          }
        } catch {
          /* not a commit */
        }
        try {
          const dec = decodeMlsMessage(body, 0)?.[0];
          if (dec && dec.wireformat === "mls_public_message") {
            group = await processProposal(
              group,
              dec.publicMessage as unknown as never,
            );
            updated = true;
            lastHandshakeId.set(room.id, String(h.createdAt));
            continue;
          }
        } catch {
          /* not a proposal */
        }
        try {
          const obj = JSON.parse(new TextDecoder().decode(body));
          if (obj?.type === "welcome" && Array.isArray(obj.data)) {
            const wBytes = new Uint8Array(obj.data as number[]);
            const ok = await verifyWelcome(wBytes);
            if (!ok) {
              globalThis.dispatchEvent(
                new CustomEvent("app:toast", {
                  detail: {
                    type: "warning",
                    title: "無視しました",
                    description:
                      "不正なWelcomeメッセージを受信したため無視しました",
                  },
                }),
              );
            } else {
              // 参加はユーザーの同意後に行うため保留に入れる
              setPendingWelcomes((prev) => ({ ...prev, [room.id]: wBytes }));
            }
            lastHandshakeId.set(room.id, String(h.createdAt));
            continue;
          }
          if (obj?.type === "RosterEvidence") {
            const ev = obj as RosterEvidence;
            const okEv = await importRosterEvidence(
              user.id,
              room.id,
              ev,
            );
            if (okEv) {
              await appendRosterEvidence(user.id, room.id, [ev]);
              const actor = actorUrl();
              if (actor && ev.actor === actor) {
                await assessBinding(
                  user.id,
                  room.id,
                  actor,
                  ev.leafSignatureKeyFpr,
                );
              }
            }
            lastHandshakeId.set(room.id, String(h.createdAt));
            continue;
          }
        } catch {
          /* not a JSON handshake */
        }
      } catch (e) {
        console.warn("handshake apply failed", e);
      }
    }
    if (updated) {
      setGroups({ ...groups(), [room.id]: group });
      await saveGroupStates();
    }
  }

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
        type: "text" as const,
        isMe: true,
        avatar: room.avatar,
      }));
      return msgs.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    }
    const encryptedMsgs: ChatMessage[] = [];
    const isDryRun = Boolean(params?.dryRun);
    let group = groups()[room.id];
    if (!group) {
      await initGroupState(room.id);
      group = groups()[room.id];
      if (!group) return [];
    }
    await syncHandshakes(room);
    group = groups()[room.id];
    const selfHandle = `${user.userName}@${getDomain()}`;
    const participantsNow = extractMembers(group)
      .map((x) => normalizeHandle(x) ?? x)
      .filter((v): v is string => !!v);
    const isJoined = participantsNow.includes(selfHandle);
    // cast room.type to string to avoid narrow literal union comparison warning
    if (!isJoined && (room.type as string) !== "memo") {
      // 未参加（招待のみ）の場合は復号を試みず空で返す（UI側で招待状態を表示）
      return [];
    }
    const list = await fetchEncryptedMessages(
      room.id,
      `${user.userName}@${getDomain()}`,
      params,
    );
    // 復号は古い順に処理しないとラチェットが進まず失敗するため昇順で処理
    const ordered = [...list].sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    for (const m of ordered) {
      const data = b64ToBuf(m.content);
      let res: { plaintext: Uint8Array; state: StoredGroupState } | null = null;
      try {
        console.debug("[decrypt] attempt", {
          id: m.id,
          room: room.id,
          from: m.from,
          mediaType: m.mediaType,
          encoding: m.encoding,
          contentLen: m.content ? m.content.length : 0,
        });
        try {
          const peek = decodeMlsMessage(data, 0)?.[0];
          console.debug("[decrypt] peekWireformat", {
            id: m.id,
            wireformat: peek?.wireformat,
          });
        } catch (e) {
          console.debug("[decrypt] peek failed", { id: m.id, err: e });
        }
        res = await decryptMessage(group, data);
        console.debug("[decrypt] result", {
          id: m.id,
          ok: !!res,
          updatedState: !!res?.state,
        });
      } catch (err) {
        if (err instanceof DOMException && err.name === "OperationError") {
          // DOMException(OperationError) は対象メッセージをスキップ
          console.error("decryptMessage OperationError", err, {
            id: m.id,
            room: room.id,
            message: err.message,
          });
          continue;
        }
        console.error("decryptMessage failed", err, {
          id: m.id,
          room: room.id,
        });
      }
      if (!res) {
        const isMe = m.from === `${user.userName}@${getDomain()}`;
        // 自分発の暗号文で復号に失敗した場合はプレースホルダを表示せずスキップ
        // （送信直後の世代ズレなど一時的要因で発生し得るが、後続の差分取得で解消される）
        if (isMe) {
          continue;
        }
        try {
          const peek2 = decodeMlsMessage(b64ToBuf(m.content), 0)?.[0];
          console.warn("[decrypt] failed -> placeholder", {
            id: m.id,
            room: room.id,
            from: m.from,
            mediaType: m.mediaType,
            encoding: m.encoding,
            contentLen: m.content ? m.content.length : 0,
            peekWireformat: peek2?.wireformat,
          });
        } catch (e) {
          console.warn("[decrypt] failed -> placeholder (peek failed)", {
            id: m.id,
            room: room.id,
            err: e,
          });
        }
        if (!isMe) updatePeerHandle(room.id, m.from);
        const selfH = `${user.userName}@${getDomain()}`;
        const baseName = room.displayName ?? room.name;
        const otherName = (!baseName || baseName === user.displayName ||
            baseName === user.userName || baseName === selfH)
          ? m.from
          : baseName;
        const displayName = isMe
          ? (user.displayName || user.userName)
          : otherName;
        // 復号できない暗号文はプレースホルダ表示 (後で再同期時に再取得対象)
        encryptedMsgs.push({
          id: m.id,
          author: m.from,
          displayName,
          address: m.from,
          content: "[未復号]", // m.content そのまま出さない
          timestamp: new Date(m.createdAt),
          type: "text",
          isMe,
          avatar: room.avatar,
        });
        continue;
      }
      group = res.state;
      const plaintextStr = new TextDecoder().decode(res.plaintext);
      // joinAck は UI に表示しない
      if (isJoinAckText(plaintextStr)) {
        continue;
      }
      const note = parseActivityPubNote(plaintextStr);
      const text = note.content;
      const listAtt = Array.isArray(m.attachments)
        ? m.attachments
        : note.attachments;
      let attachments:
        | {
          data?: string;
          url?: string;
          mediaType: string;
          preview?: {
            url?: string;
            data?: string;
            mediaType?: string;
            key?: string;
            iv?: string;
          };
        }[]
        | undefined;
      if (Array.isArray(listAtt)) {
        attachments = [];
        for (const at of listAtt) {
          if (typeof at.url === "string") {
            const attachmentItem = at as typeof at & {
              preview?: ActivityPubPreview;
            };
            const mt = typeof attachmentItem.mediaType === "string"
              ? attachmentItem.mediaType
              : "application/octet-stream";
            let preview;
            if (
              attachmentItem.preview &&
              typeof attachmentItem.preview.url === "string"
            ) {
              const previewItem = attachmentItem.preview;
              const pmt = typeof previewItem.mediaType === "string"
                ? previewItem.mediaType
                : "image/jpeg";
              try {
                const pres = await fetch(previewItem.url);
                let pbuf = await pres.arrayBuffer();
                if (
                  typeof previewItem.key === "string" &&
                  typeof previewItem.iv === "string"
                ) {
                  pbuf = await decryptFile(
                    pbuf,
                    previewItem.key,
                    previewItem.iv,
                  );
                }
                preview = { url: bufToUrl(pbuf, pmt), mediaType: pmt };
              } catch {
                preview = { url: previewItem.url, mediaType: pmt };
              }
            }
            try {
              const res = await fetch(attachmentItem.url);
              let buf = await res.arrayBuffer();
              if (
                typeof attachmentItem.key === "string" &&
                typeof attachmentItem.iv === "string"
              ) {
                buf = await decryptFile(
                  buf,
                  attachmentItem.key,
                  attachmentItem.iv,
                );
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
              attachments.push({
                url: attachmentItem.url,
                mediaType: mt,
                preview,
              });
            }
          }
        }
      }
      const fullId = `${user.userName}@${getDomain()}`;
      const isMe = m.from === fullId;
      if (!isMe) updatePeerHandle(room.id, m.from);
      const selfH2 = `${user.userName}@${getDomain()}`;
      const baseName2 = room.displayName ?? room.name;
      const otherName = (!baseName2 || baseName2 === user.displayName ||
          baseName2 === user.userName || baseName2 === selfH2)
        ? m.from
        : baseName2;
      const displayName = isMe
        ? (user.displayName || user.userName)
        : otherName;
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
    if (!isDryRun) {
      setGroups({ ...groups(), [room.id]: group });
      saveGroupStates();
      // 参加メンバーに合わせて招待中を整流化
      try {
        const acc = account();
        if (acc) {
          const participants = extractMembers(group).map((x) =>
            normalizeHandle(x) ?? x
          ).filter((v): v is string => !!v);
          await syncPendingWithParticipants(acc.id, room.id, participants);
        }
      } catch {
        console.error("参加メンバーの同期に失敗しました");
      }
    }
    return msgs;
  };

  const loadMessages = async (room: Room, _isSelectedRoom: boolean) => {
    const user = account();
    const cached = messagesByRoom()[roomCacheKey(room.id)] ?? (
      user
        ? (await loadDecryptedMessages(user.id, room.id)) ?? undefined
        : undefined
    );
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
    try {
      const g = groups()[room.id];
      if (g && user) {
        const selfHandle = `${user.userName}@${getDomain()}`;
        const members = extractMembers(g).map((x) => normalizeHandle(x) ?? x)
          .filter((v): v is string => !!v);
        setPartnerHasKey(members.includes(selfHandle));
      }
    } catch { /* ignore */ }
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

  const extractMembers = (state: StoredGroupState): string[] => {
    const list: string[] = [];
    const tree = state.ratchetTree as unknown as {
      nodeType: string;
      leaf?: { credential?: { identity?: Uint8Array } };
    }[];
    for (const node of tree) {
      if (node?.nodeType === "leaf") {
        const id = node.leaf?.credential?.identity;
        if (id) list.push(new TextDecoder().decode(id));
      }
    }
    return list;
  };

  const loadRooms = async () => {
    const user = account();
    if (!user) return;
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
    const serverRooms = await searchRooms(user.id, { implicit: "include" });
    for (const item of serverRooms) {
      const state = groups()[item.id];
      const name = "";
      const icon = "";
      // 参加者は MLS の leaf から導出。MLS が未同期の場合は pending 招待から暫定的に補完（UI表示用）
      let members = state
        ? extractMembers(state)
          .map((m) => normalizeHandle(m as ActorID) ?? m)
          .filter((m) => (normalizeHandle(m as ActorID) ?? m) !== handle)
        : [] as string[];
      if (members.length === 0) {
        try {
          const pend = await readPending(user.id, item.id);
          const others = (pend || []).filter((m) => m && m !== handle);
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
        avatar: icon || (String(name).length > 0 ? String(name).charAt(0).toUpperCase() : "👥"),
        unreadCount: 0,
        type: "group",
        members,
        hasName: false,
        hasIcon: false,
        lastMessage: "...",
        lastMessageTime: undefined,
      });
    }

    await applyDisplayFallback(rooms);

    const unique = rooms.filter(
      (room, idx, arr) => arr.findIndex((r) => r.id === room.id) === idx,
    );
    setChatRooms(unique);
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
    // 参加者は MLS の leaf から導出済みの room.members のみを信頼（APIやpendingは使わない）
    const uniqueOthers = (r: Room): string[] =>
      (r.members ?? []).filter((m) => m && m !== selfHandle);

    // MLS 同期前の暫定表示: members が空のルームは pending 招待から1名だけでも補完
    for (const r of rooms) {
      try {
        if ((r.members?.length ?? 0) === 0 && r.type !== "memo") {
          const pend = await readPending(user.id, r.id);
          const cand = (pend || []).filter((m) => m && m !== selfHandle);
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
      const others = uniqueOthers(r);
      // 自分の名前がタイトルに入ってしまう誤表示を防止（相手1人または未確定0人のとき）
      if (
        others.length <= 1 &&
        (r.name === user.displayName || r.name === user.userName)
      ) {
        r.displayName = "";
        r.hasName = false;
        // アバターが自分の頭文字（1文字）なら一旦消して再計算に委ねる
        const selfInitial = (user.displayName || user.userName || "").charAt(0)
          .toUpperCase();
        if (
          typeof r.avatar === "string" && r.avatar.length === 1 &&
          r.avatar.toUpperCase() === selfInitial
        ) {
          r.avatar = "";
        }
      }
    }

    const twoNoName = rooms.filter((r) =>
      r.type !== "memo" && totalMembers(r) === 2 && !(r.hasName || r.hasIcon)
    );
    const ids = twoNoName
      .map((r) => uniqueOthers(r)[0])
      .filter((v): v is string => !!v);
    if (ids.length > 0) {
      const infos = await fetchUserInfoBatch(ids, user.id);
      for (let i = 0; i < twoNoName.length; i++) {
        const info = infos[i];
        const r = twoNoName[i];
        if (info) {
          r.displayName = info.displayName || info.userName;
          r.avatar = info.authorAvatar || r.avatar;
          // 参加者リストは MLS 由来を保持する（表示名のみ補完）
        }
      }
    }
    // 3人以上の自動生成（簡易）
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

  const openRoomDialog = (friendId?: string) => {
    setGroupDialogMode("create");
    setInitialMembers(friendId ? [friendId] : []);
    setShowGroupDialog(true);
  };

  const createRoom = async (
    name: string,
    membersInput: string,
    autoOpen = true,
  ) => {
    const user = account();
    if (!user) return;
    const members = membersInput
      .split(",")
      .map((m) => normalizeActor(m.trim() as ActorID))
      .filter((m): m is string => !!m);
    if (members.length === 0) return;
    const me = `${user.userName}@${getDomain()}`;
    if (!members.includes(me)) members.push(me);
    const others = members.filter((m) => m !== me);
    // すべてのトークは同等。毎回新規作成してサーバ保存する
    const finalName = (name ?? "").trim();

    const newId = crypto.randomUUID();
    const room: Room = {
      id: newId,
      name: finalName || "",
      userName: user.userName,
      domain: getDomain(),
      avatar: "",
      unreadCount: 0,
      type: "group",
      // UI表示用に招待先を入れておく（MLS同期後は state 由来に上書きされる）
      members: others,
      hasName: Boolean(finalName),
      hasIcon: false,
      lastMessage: "...",
      lastMessageTime: undefined,
    };
    try {
      await applyDisplayFallback([room]);
    } catch (e) {
      console.error("相手の表示情報取得に失敗しました", e);
    }
    upsertRoom(room);
    await initGroupState(room.id);
    try {
      await addRoom(
        user.id,
        { id: room.id, name: room.name, members },
        { from: me, content: "hi", to: members },
      );
    } catch (e) {
      console.error("ルーム作成に失敗しました", e);
    }
    // MLS 即時開始: 可能なら相手の KeyPackage を取得して Add→Commit→Welcome を送信
    try {
      const group = groups()[room.id];
      if (group) {
        const kpInputs: {
          content: string;
          actor?: string;
          deviceId?: string;
        }[] = [];
        for (const h of others) {
          const [uname, dom] = splitActor(h as ActorID);
          const kps = await fetchKeyPackages(uname, dom);
          if (kps && kps.length > 0) {
            const kp = pickUsableKeyPackage(
              kps as unknown as {
                content: string;
                expiresAt?: string;
                used?: boolean;
                deviceId?: string;
              }[],
            );
            if (!kp) continue;
            const actor = dom ? `https://${dom}/users/${uname}` : undefined;
            kpInputs.push({
              content: kp.content,
              actor,
              deviceId: kp.deviceId,
            });
          }
        }
        if (kpInputs.length > 0) {
          const resAdd = await createCommitAndWelcomes(group, kpInputs);
          const commitContent = encodePublicMessage(resAdd.commit);
          const ok = await sendHandshake(
            room.id,
            `${user.userName}@${getDomain()}`,
            commitContent,
            // ルーム作成時は members が最新のロスター
            members,
          );
          if (ok) {
            for (const w of resAdd.welcomes) {
              const wContent = encodePublicMessage(w.data);
              const wk = await sendHandshake(
                room.id,
                `${user.userName}@${getDomain()}`,
                wContent,
                members,
              );
              if (!wk) break;
            }
            let gstate: StoredGroupState = resAdd.state;
            const meta = await sendGroupMetadata(
              room.id,
              `${user.userName}@${getDomain()}`,
              gstate,
              members,
              { name: room.name, icon: room.avatar },
            );
            if (meta) gstate = meta;
            setGroups({ ...groups(), [room.id]: gstate });
            saveGroupStates();
            // 招待中として登録（Join後に設定画面で自動的にメンバー側へ移動）
            await addPendingInvites(user.id, room.id, others);
          }
        }
        // UI上は常に招待中として表示（Joinしたら自動的にメンバーへ移動）
        await addPendingInvites(user.id, room.id, others);
      }
    } catch (e) {
      console.warn("作成時のAdd/Welcome送信に失敗しました", e);
    }
    if (autoOpen) setSelectedRoom(room.id);
    setShowGroupDialog(false);
  };

  const removeActorLeaves = async (actorId: string): Promise<boolean> => {
    const roomId = selectedRoom();
    const user = account();
    if (!roomId || !user) return false;
    const group = groups()[roomId];
    if (!group) return false;
    try {
      const records = await loadKeyPackageRecords(user.id, roomId);
      const indices = Array.from(
        new Set(
          records.filter((r: any) => r.actorId === actorId).map((r: any) => r.leafIndex),
        ),
      );
      if (indices.length === 0) return false;
      const res = await removeMembers(group, indices);
      const content = encodePublicMessage(res.commit);
      const room = chatRooms().find((r) => r.id === roomId);
      const toList = participantsFromState(roomId).length > 0
        ? participantsFromState(roomId)
        : (room?.members ?? []).filter((m) => !!m);
      const ok = await sendHandshake(
        roomId,
        `${user.userName}@${getDomain()}`,
        content,
        toList,
      );
      if (!ok) return false;
      setGroups({ ...groups(), [roomId]: res.state });
      await saveGroupStates();
      await apiFetch(`/ap/rooms/${encodeURIComponent(roomId)}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "Remove", object: actorId }),
      });
      return true;
    } catch (e) {
      console.error("メンバー削除に失敗しました", e);
      return false;
    }
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
        timestamp: new Date(res.createdAt),
        type: "text",
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
      setMediaFile(null);
      setMediaPreview(null);
      return;
    }
    if (!partnerHasKey()) {
      alert("このユーザーは暗号化された会話に対応していません。");
      return;
    }
    // クライアント側で仮のメッセージIDを生成しておく
    const localId = crypto.randomUUID();
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
    let group = groups()[roomId];
    if (!group) {
      await initGroupState(roomId);
      group = groups()[roomId];
      if (!group) {
        alert("グループ初期化に失敗したため送信できません");
        return;
      }
    }
    // 必要であれば、相手の KeyPackage を使って Add→Commit→Welcome を先行送信
    try {
      const self = `${user.userName}@${getDomain()}`;
      const current = participantsFromState(roomId);
      const targets = (room.members ?? []).filter((m) => m && m !== self);
      const need = targets.filter((t) => !current.includes(t));
      if (need.length > 0) {
        const kpInputs: {
          content: string;
          actor?: string;
          deviceId?: string;
        }[] = [];
        for (const h of need) {
          const [uname, dom] = splitActor(h as ActorID);
          const kps = await fetchKeyPackages(uname, dom);
          if (kps && kps.length > 0) {
            const kp = pickUsableKeyPackage(
              kps as unknown as {
                content: string;
                expiresAt?: string;
                used?: boolean;
                deviceId?: string;
              }[],
            );
            if (!kp) continue;
            const actor = dom ? `https://${dom}/users/${uname}` : undefined;
            kpInputs.push({
              content: kp.content,
              actor,
              deviceId: kp.deviceId,
            });
          }
        }
        if (kpInputs.length > 0) {
          const resAdd = await createCommitAndWelcomes(group, kpInputs);
          const commitContent = encodePublicMessage(resAdd.commit);
          const toList = Array.from(
            new Set([
              ...current,
              ...need,
              self,
            ]),
          );
          const ok = await sendHandshake(
            roomId,
            `${user.userName}@${getDomain()}`,
            commitContent,
            toList,
          );
          if (!ok) throw new Error("Commit送信に失敗しました");
          for (const w of resAdd.welcomes) {
            const wContent = encodePublicMessage(w.data);
            const wk = await sendHandshake(
              roomId,
              `${user.userName}@${getDomain()}`,
              wContent,
              toList,
            );
            if (!wk) throw new Error("Welcome送信に失敗しました");
          }
          let gstate: StoredGroupState = resAdd.state;
          const meta = await sendGroupMetadata(
            roomId,
            `${user.userName}@${getDomain()}`,
            gstate,
            toList,
            { name: room.name, icon: room.avatar },
          );
          if (meta) gstate = meta;
          group = gstate;
          setGroups({ ...groups(), [roomId]: group });
          saveGroupStates();
          try {
            const acc = account();
            if (acc) {
              const participants = extractMembers(group).map((x) =>
                normalizeHandle(x) ?? x
              ).filter((v): v is string => !!v);
              await syncPendingWithParticipants(acc.id, roomId, participants);
            }
          } catch {
            console.error("参加メンバーの同期に失敗しました");
          }
          // 招待中に登録
          await addPendingInvites(user.id, roomId, need);
        }
        // UI上は常に招待中として表示
        await addPendingInvites(user.id, roomId, need);
      }
    } catch (e) {
      console.warn("初回Add/Welcome処理に失敗しました", e);
    }
    // joinAck をルーム/端末ごとに一度だけ送る（永続化して再送を防止）
    const ackCacheKey = `ackSent:${roomId}`;
    try {
      const sent = await getCacheItem(user.id, ackCacheKey);
      if (!sent) {
        const ackBody = JSON.stringify({
          type: "joinAck",
          roomId,
          deviceId: user.id,
        });
        const ack = await encryptMessage(group, ackBody);
        const ok = await sendEncryptedMessage(
          roomId,
          `${user.userName}@${getDomain()}`,
          participantsFromState(roomId).length > 0
            ? participantsFromState(roomId)
            : (room.members ?? []).map((m) => m || "").filter((v) => !!v),
          {
            content: bufToB64(ack.message),
            mediaType: "message/mls",
            encoding: "base64",
          },
        );
        if (ok) {
          group = ack.state;
          setGroups({ ...groups(), [roomId]: group });
          saveGroupStates();
          await setCacheItem(user.id, ackCacheKey, true);
        }
      }
    } catch (e) {
      console.warn("joinAck の送信または永続化に失敗しました", e);
    }
    const msgEnc = await encryptMessage(group, JSON.stringify(note));
    let success = true;
    {
      const ok = await sendEncryptedMessage(
        roomId,
        `${user.userName}@${getDomain()}`,
        participantsFromState(roomId).length > 0
          ? participantsFromState(roomId)
          : (room.members ?? []).map((m) => m || "").filter((v) => !!v),
        {
          content: bufToB64(msgEnc.message),
          mediaType: "message/mls",
          encoding: "base64",
        },
      );
      if (!ok) success = false;
    }
    if (!success) {
      alert("メッセージの送信に失敗しました");
      return;
    }
    setGroups({ ...groups(), [roomId]: msgEnc.state });
    saveGroupStates();

    // 楽観的に自分の送信メッセージをUIへ即時反映（再取得は行わない）
    try {
      const meHandle = `${user.userName}@${getDomain()}`;
      const dispName = user.displayName || user.userName;
      let attachmentsUi: {
        data?: string;
        url?: string;
        mediaType: string;
        preview?: { url?: string; data?: string; mediaType?: string };
      }[] | undefined;
      if (mediaFile()) {
        const file = mediaFile()!;
        const purl = mediaPreview();
        attachmentsUi = [{
          mediaType: file.type || "application/octet-stream",
          ...(purl ? { url: purl } : {}),
        }];
      }
      const optimistic: ChatMessage = {
        id: localId,
        author: meHandle,
        displayName: dispName,
        address: meHandle,
        content: text,
        attachments: attachmentsUi,
        timestamp: new Date(),
        type: attachmentsUi && attachmentsUi.length > 0
          ? attachmentsUi[0].mediaType.startsWith("image/") ? "image" : "file"
          : "text",
        isMe: true,
        avatar: room.avatar,
      };
      setMessages((old) => {
        const next = [...old, optimistic];
        setMessagesByRoom({
          ...messagesByRoom(),
          [roomCacheKey(roomId)]: next,
        });
        const user2 = account();
        if (user2) void saveDecryptedMessages(user2.id, roomId, next);
        return next;
      });
      updateRoomLast(roomId, optimistic);
    } catch (e) {
      console.warn("楽観表示の反映に失敗しました", e);
    }

    // 入力欄と選択中のメディアをクリア
    setNewMessage("");
    setMediaFile(null);
    setMediaPreview(null);
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
    loadGroupStates();
    ensureKeyPair();

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
      // WS 経由で送られる pendingInvite は isIncomingMessage に含まれないため
      // 先に専用に処理する（チャット一覧へプレースホルダを作成して同期する）
      try {
        if (typeof msg === "object" && msg !== null) {
          const m = msg as Record<string, unknown>;
          if (typeof m.type === "string" && m.type === "pendingInvite") {
            const payload = m.payload as Record<string, unknown> | undefined;
            if (payload && typeof payload.roomId === "string") {
              const user = account();
              if (!user) return;
              const self = `${user.userName}@${getDomain()}`;
              // 既に一覧にあれば同期処理だけ行う
              let room = chatRooms().find((r) => r.id === payload.roomId);
              if (!room) {
                const maybeFrom = typeof payload.from === "string"
                  ? payload.from
                  : undefined;
                const others = Array.from(
                  new Set(
                    [maybeFrom].filter((m): m is string =>
                      typeof m === "string" && m !== self
                    ),
                  ),
                );
                const newRoom = {
                  id: payload.roomId,
                  name: "",
                  userName: user.userName,
                  domain: getDomain(),
                  avatar: "",
                  unreadCount: 0,
                  type: "group",
                  members: others,
                  lastMessage: "...",
                  lastMessageTime: undefined,
                };
                upsertRoom(newRoom as unknown as Room);
                try {
                  await applyDisplayFallback([newRoom as unknown as Room]);
                } catch { /* ignore */ }
                await initGroupState(newRoom.id);
                room = newRoom as unknown as Room;
              }
              if (room) await syncHandshakes(room);
            }
            return;
          }
        }
      } catch (e) {
        console.warn("failed to handle pendingInvite message", e);
      }

      if (!isIncomingMessage(msg)) {
        // 想定外のメッセージは無視
        return;
      }
      const user = account();
      if (!user) return;
      const self = `${user.userName}@${getDomain()}`;

      if (msg.type === "handshake") {
        const data = msg.payload;
        if (!(data.recipients.includes(self) || data.sender === self)) {
          return;
        }

        // 招待元がフォロー中かどうかを先に判定
        let isFollowing = false;
        try {
          const me = account();
          if (me) {
            const following = await fetchFollowing(me.userName);
            isFollowing = Array.isArray(following)
              ? following.some((u: string) =>
                u === data.sender || u === normalizeActor(data.sender)
              )
              : false;
          }
        } catch {
          // 判定失敗時はフォロー外として扱う
          isFollowing = false;
        }
        // 自分が送信者（招待した側）の場合は通知しない
        if (data.sender === self) {
          isFollowing = true;
        }

        if (!isFollowing) {
          // フォロー外の招待はサーバー側で通知化（ここでは案内のみ）
          globalThis.dispatchEvent(
            new CustomEvent("app:toast", {
              detail: {
                type: "info",
                title: "会話招待",
                description:
                  `${data.sender} から会話招待が届きました（フォロー外）。通知に表示します。`,
                duration: 5000,
              },
            }),
          );
          // フォロー外の場合は自動参加・同期しない
          return;
        }

        // フォロー中ならチャット一覧にプレースホルダを作成して同期
        let room = chatRooms().find((r) => r.id === data.roomId);
        if (!room) {
          const others = Array.from(
            new Set([
              ...data.recipients,
              data.sender,
            ].filter((m) => m && m !== self)),
          );
          room = {
            id: data.roomId,
            name: "",
            userName: user.userName,
            domain: getDomain(),
            avatar: "",
            unreadCount: 0,
            type: "group",
            members: others,
            lastMessage: "...",
            lastMessageTime: undefined,
          };
          upsertRoom(room);
          try {
            await applyDisplayFallback([room]);
          } catch { /* ignore */ }
          await initGroupState(room.id);
        }
        if (room) await syncHandshakes(room);
        return;
      }

      const data = msg.payload;
      // フィルタ: 自分宛て/自分発でないメッセージは無視
      if (!(data.to.includes(self) || data.from === self)) {
        return;
      }

      // まず roomId が来ていればそれで特定する（UUIDグループ等に強い）
      let room = data.roomId
        ? chatRooms().find((r) => r.id === data.roomId)
        : undefined;

      const partnerId = data.from === self
        ? (data.to.find((v) => v !== self) ?? data.to[0])
        : data.from;

      const normalizedPartner = normalizeActor(partnerId);
      const [partnerName] = splitActor(normalizedPartner);
      const uuidRe =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      if (!room) room = chatRooms().find((r) => r.id === partnerName);
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
      // 名前付き1:1ルームなど、IDがパートナーと一致しない場合のフォールバック
      if (!room) {
        room = chatRooms().find((r) =>
          (r.members?.length ?? 0) === 1 &&
          r.members.includes(normalizedPartner)
        );
      }
      if (!room && uuidRe.test(partnerName)) {
        // グループIDと推測されるがまだ一覧に存在しない場合はルームを作成しない
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
                name: "",
                displayName: info.displayName || info.userName,
                userName: info.userName,
                domain: info.domain,
                avatar: info.authorAvatar ||
                  info.userName.charAt(0).toUpperCase(),
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

      const isMe = data.from === self;
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
        if (room.type === "memo") return; // メモはWS対象外
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
      if (room.type === "memo") return; // メモはWS対象外
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
    // 通知画面からの「参加する」操作を受信して処理
    const onAcceptInvite = async (ev: Event) => {
      const e = ev as CustomEvent<{ roomId: string; sender?: string }>;
      const targetRoomId = e.detail?.roomId;
      if (!targetRoomId) return;
      const user = account();
      if (!user) return;
      // 一覧になければプレースホルダを作成
      let room = chatRooms().find((r) => r.id === targetRoomId);
      if (!room) {
        room = {
          id: targetRoomId,
          name: "",
          userName: user.userName,
          domain: getDomain(),
          avatar: "",
          unreadCount: 0,
          type: "group",
          members: [],
          lastMessage: "...",
          lastMessageTime: undefined,
        };
        upsertRoom(room);
        await initGroupState(room.id);
      }
      try {
        await syncHandshakes(room);
        const w = pendingWelcomes()[room.id];
        if (w) {
          const pairs = await loadAllMLSKeyPairs(user.id);
          let joined: StoredGroupState | null = null;
          const list = pairs.length > 0
            ? pairs
            : (await ensureKeyPair() ? [await ensureKeyPair()!] : []);
          for (const p of list) {
            try {
              if (!p) throw new Error("key pair not prepared");
              const st = await joinWithWelcome(w, p);
              joined = st;
              break;
            } catch { /* try next */ }
          }
          if (joined) {
            // 参加成功: 自分の chatrooms に登録
            try {
              await addRoom(user.id, { id: room.id });
            } catch { /* ignore */ }
            setGroups({ ...groups(), [room.id]: joined });
            await saveGroupStates();
            setPendingWelcomes((prev) => {
              const n = { ...prev };
              delete n[room!.id];
              return n;
            });
            await loadMessages(room, true);
            setSelectedRoom(room.id);
            // 招待のACK（任意）
            try {
              await apiFetch(
                `/api/users/${
                  encodeURIComponent(user.userName)
                }/pendingInvites/ack`,
                {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ roomId: room.id, deviceId: "" }),
                },
              );
            } catch { /* ignore */ }
            // サーバー側の chatrooms 登録反映を一覧に再取得
            try {
              await loadRooms();
            } catch { /* ignore */ }
            globalThis.dispatchEvent(
              new CustomEvent("app:toast", {
                detail: {
                  type: "success",
                  title: "参加しました",
                  description: "会話に参加しました",
                },
              }),
            );
          } else {
            globalThis.dispatchEvent(
              new CustomEvent("app:toast", {
                detail: {
                  type: "error",
                  title: "参加に失敗",
                  description: "Welcomeの適用に失敗しました",
                },
              }),
            );
          }
        } else {
          // Welcome がまだ無い場合はルームを開いて手動参加に委ねる
          setSelectedRoom(room.id);
        }
      } catch (err) {
        globalThis.dispatchEvent(
          new CustomEvent("app:toast", {
            detail: {
              type: "error",
              title: "参加に失敗",
              description: String(err),
            },
          }),
        );
      }
    };

    globalThis.addEventListener(
      "app:accept-invite",
      onAcceptInvite as EventListener,
    );
    acceptCleanup = () =>
      globalThis.removeEventListener(
        "app:accept-invite",
        onAcceptInvite as EventListener,
      );

    addMessageHandler(handler);
    wsCleanup = () => removeMessageHandler(handler);
    // 初期表示時のメッセージ読み込みも
    // selectedRoom 監視の createEffect に任せる
    adjustHeight(textareaRef);
  });

  // 保留中招待の同期: 初期ロード時に取得し、その後は WS 通知に任せる
  createEffect(() => {
    const user = account();
    if (!user) return;
    void (async () => {
      try {
        const list = await fetchPendingInvites(user.userName);
        for (const it of list) {
          const rid = it.roomId;
          if (!rid) continue;
          let room = chatRooms().find((r) => r.id === rid);
          if (!room) {
            room = {
              id: rid,
              name: "",
              userName: user.userName,
              domain: getDomain(),
              avatar: "",
              unreadCount: 0,
              type: "group",
              members: [],
              lastMessage: "...",
              lastMessageTime: undefined,
            };
            upsertRoom(room);
            await initGroupState(room.id);
          }
          await syncHandshakes(room);
        }
      } catch { /* ignore */ }
    })();
  });

  // 一覧のプレビュー更新を緩やかにポーリング（最大10件）
  let previewPoller: number | undefined;
  createEffect(() => {
    const user = account();
    if (!user) return;
    if (previewPoller) clearInterval(previewPoller);
    previewPoller = setInterval(async () => {
      try {
        const rooms = chatRooms();
        const targets = rooms
          .filter((r) => r.type !== "memo")
          .slice(0, 10);
        for (const r of targets) {
          try {
            const msgs = await fetchMessagesForRoom(r, {
              limit: 1,
              dryRun: true,
            });
            if (msgs.length > 0) updateRoomLast(r.id, msgs[msgs.length - 1]);
          } catch { /* ignore one */ }
        }
      } catch { /* ignore all */ }
    }, 60_000) as unknown as number;
  });

  // ルーム一覧の読み込みはアカウント変更時と初期表示時のみ実行
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

  // MLS グループ状態の更新に合わせてメンバー/表示名を補正
  createEffect(
    on(
      () => groups(),
      async () => {
        const user = account();
        if (!user) return;
        const list = chatRooms();
        if (list.length === 0) return;

        // members を MLS 由来に同期（変更がある場合のみ更新）
        let changed = false;
        const nextA = list.map((r) => {
          if (r.type === "memo") return r;
          const parts = participantsFromState(r.id);
          if (parts.length === 0) return r;
          const cur = r.members ?? [];
          const equals = cur.length === parts.length &&
            cur.every((v, i) => v === parts[i]);
          if (!equals) {
            changed = true;
            return { ...r, members: parts };
          }
          return r;
        });
        if (changed) setChatRooms(nextA);

        // 1対1・未命名の表示名補完（変更がある場合のみ更新）
        // ただし UUID などグループIDのルームは対象外（誤ってDM扱いしない）
        const base = changed ? nextA : list;
        const uuidRe =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        const candidates = base.filter((r) =>
          r.type !== "memo" && (r.members?.length ?? 0) === 1 &&
          !(r.hasName || r.hasIcon) && !uuidRe.test(r.id)
        );
        const ids = candidates.map((r) => r.members[0]).filter((
          v,
        ): v is string => !!v);
        if (ids.length === 0) return;
        try {
          const infos = await fetchUserInfoBatch(ids, user.id);
          const map = new Map<string, typeof infos[number]>();
          for (let i = 0; i < ids.length; i++) map.set(ids[i], infos[i]);
          let nameChanged = false;
          const nextB = base.map((r) => {
            if (
              r.type === "memo" || !(r.members?.length === 1) ||
              (r.hasName || r.hasIcon)
            ) return r;
            const info = map.get(r.members[0]);
            if (!info) return r;
            const newName = info.displayName || info.userName;
            const newAvatar = info.authorAvatar || r.avatar;
            if (
              (r.displayName ?? r.name) !== newName || r.avatar !== newAvatar
            ) {
              nameChanged = true;
              return { ...r, displayName: newName, avatar: newAvatar };
            }
            return r;
          });
          if (nameChanged) setChatRooms(nextB);
        } catch {
          // ignore
        }
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
              name: "",
              displayName: info.displayName || info.userName,
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
          }
        }

        // ルームが見つかった場合は相手情報を補正した上でメッセージを読み込み
        if (room) {
          await ensureDmPartnerInfo(room);
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

  // WS通知に反応して差分取得する方式へ移行（定期ポーリングは廃止）

  // 非選択ルームのプレビュー更新もWS通知時のみ（定期ポーリングは廃止）

  // 新規ルーム検出はWS handshake通知時と手動同期に限定（定期サーチは廃止）

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
    if (!partnerHasKey()) {
      alert("このユーザーは暗号化された会話に対応していません。");
    }
  });

  onCleanup(() => {
    globalThis.removeEventListener("resize", checkMobile);
    wsCleanup?.();
    acceptCleanup?.();
    if (previewPoller) clearInterval(previewPoller);
  });

  // APIベースのイベントで更新（WS不要運用向け）
  onMount(async () => {
    try {
      const user = account();
      if (user) {
        const cur = await getCacheItem(user.id, "eventsCursor");
        if (typeof cur === "string") setEventsCursor(cur);
      }
    } catch { /* ignore */ }

    const processEvents = async (
      evs: {
        id: string;
        type: string;
        roomId?: string;
        from?: string;
        to?: string[];
        createdAt?: string;
      }[],
    ) => {
      const user = account();
      if (!user) return;
      let maxTs = eventsCursor();
      const byRoom = new Map<
        string,
        { handshake: boolean; message: boolean }
      >();
      for (const ev of evs) {
        const rid = ev.roomId;
        if (!rid) continue;
        const cur = byRoom.get(rid) || { handshake: false, message: false };
        if (ev.type === "handshake") cur.handshake = true;
        if (ev.type === "encryptedMessage" || ev.type === "publicMessage") {
          cur.message = true;
        }
        byRoom.set(rid, cur);
        if (ev.createdAt && (!maxTs || ev.createdAt > maxTs)) {
          maxTs = ev.createdAt;
        }
      }
      for (const [rid, flg] of byRoom) {
        let room = chatRooms().find((r) => r.id === rid);
        if (!room) {
          room = {
            id: rid,
            name: "",
            userName: account()?.userName || "",
            domain: getDomain(),
            avatar: "",
            unreadCount: 0,
            type: "group",
            members: [],
            lastMessage: "...",
            lastMessageTime: undefined,
          };
          upsertRoom(room);
          try {
            await applyDisplayFallback([room]);
          } catch { /* ignore */ }
          await initGroupState(rid);
        }
        if (room && flg.handshake) await syncHandshakes(room);
        if (room && flg.message) {
          const isSel = selectedRoom() === rid;
          if (isSel) {
            const prev = messages();
            const lastTs = prev.length > 0
              ? prev[prev.length - 1].timestamp.toISOString()
              : undefined;
            const fetched = await fetchMessagesForRoom(
              room,
              lastTs ? { after: lastTs } : { limit: 1 },
            );
            if (fetched.length > 0) {
              setMessages((old) => {
                const ids = new Set(old.map((m) => m.id));
                const add = fetched.filter((m) => !ids.has(m.id));
                const next = [...old, ...add];
                setMessagesByRoom({
                  ...messagesByRoom(),
                  [roomCacheKey(rid)]: next,
                });
                const user2 = account();
                if (user2) void saveDecryptedMessages(user2.id, rid, next);
                return next;
              });
              updateRoomLast(rid, fetched[fetched.length - 1]);
            }
          } else {
            const fetched = await fetchMessagesForRoom(room, {
              limit: 1,
              dryRun: true,
            });
            if (fetched.length > 0) {
              updateRoomLast(rid, fetched[fetched.length - 1]);
            }
          }
        }
      }
      if (maxTs) {
        setEventsCursor(maxTs);
        try {
          const user2 = account();
          if (user2) await setCacheItem(user2.id, "eventsCursor", maxTs);
        } catch { /* ignore */ }
      }
    };

    const syncOnce = async () => {
      try {
        const evs = await fetchEvents({
          since: eventsCursor() ?? undefined,
          limit: 100,
        });
        if (evs.length > 0) await processEvents(evs);
      } catch { /* ignore */ }
    };

    await syncOnce();
    const onFocus = () => void syncOnce();
    globalThis.addEventListener("focus", onFocus);
    globalThis.addEventListener("online", onFocus);
    globalThis.addEventListener("visibilitychange", () => {
      if (!document.hidden) void syncOnce();
    });
    onCleanup(() => {
      globalThis.removeEventListener("focus", onFocus);
      globalThis.removeEventListener("online", onFocus);
    });
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
              onCreateRoom={() => openRoomDialog()}
              segment={segment()}
              onSegmentChange={setSegment}
              onCreateFriendRoom={(friendId: string) => {
                openRoomDialog(friendId);
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
                    const selfHandle = me
                      ? `${me.userName}@${getDomain()}`
                      : undefined;
                    const rawOther = r.members.find((m) => m !== selfHandle) ??
                      r.members[0];
                    const isDm = r.type !== "memo" &&
                      (r.members?.length ?? 0) === 1 &&
                      !(r.hasName || r.hasIcon);
                    const looksLikeSelf = me &&
                      (r.name === me.displayName || r.name === me.userName);
                    if (isDm || looksLikeSelf) {
                      const other = rawOther && rawOther !== selfHandle
                        ? (normalizeHandle(rawOther) ?? null)
                        : null;
                      return { ...r, name: other ?? (r.name || "不明") };
                    }
                    return r;
                  })()}
                  onBack={backToRoomList}
                  onOpenSettings={() => setShowSettings(true)}
                  showSettings={(function () {
                    const r = selectedRoomInfo();
                    return r ? r.type !== "memo" : true;
                  })()}
                  bindingStatus={(function () {
                    const r = selectedRoomInfo();
                    return r && r.type !== "memo" ? bindingStatus() : null;
                  })()}
                  bindingInfo={(function () {
                    const r = selectedRoomInfo();
                    return r && r.type !== "memo" ? bindingInfo() : null;
                  })()}
                  ktInfo={(function () {
                    const r = selectedRoomInfo();
                    return r && r.type !== "memo" ? ktInfo() : null;
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
                {/* Welcome 受信時の参加確認バナー */}
                <Show
                  when={(function () {
                    const id = selectedRoom();
                    return id ? pendingWelcomes()[id] : undefined;
                  })()}
                >
                  <div class="px-3 py-2 bg-amber-900/40 border-t border-amber-600/40 text-amber-100 flex items-center justify-between">
                    <div class="text-sm">
                      この会話に招待されています。参加しますか？
                    </div>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="px-3 py-1 rounded bg-amber-600/80 hover:bg-amber-600 text-white text-sm"
                        onClick={async () => {
                          const id = selectedRoom();
                          const user = account();
                          if (!id || !user) return;
                          const w = pendingWelcomes()[id];
                          if (!w) return;
                          try {
                            const pairs = await loadAllMLSKeyPairs(user.id);
                            let joined: StoredGroupState | null = null;
                            const list = pairs.length > 0
                              ? pairs
                              : (await ensureKeyPair()
                                ? [await ensureKeyPair()!]
                                : []);
                            for (const p of list) {
                              try {
                                if (!p) {
                                  throw new Error("key pair not prepared");
                                }
                                const st = await joinWithWelcome(w, p);
                                joined = st;
                                break;
                              } catch { /* try next */ }
                            }
                            if (joined) {
                              try {
                                await addRoom(user.id, { id });
                              } catch { /* ignore */ }
                              setGroups({ ...groups(), [id]: joined });
                              await saveGroupStates();
                              setPendingWelcomes((prev) => {
                                const n = { ...prev };
                                delete n[id];
                                return n;
                              });
                              const room = chatRooms().find((r) => r.id === id);
                              if (room) await loadMessages(room, true);
                              try {
                                await apiFetch(
                                  `/api/users/${
                                    encodeURIComponent(user.userName)
                                  }/pendingInvites/ack`,
                                  {
                                    method: "POST",
                                    headers: {
                                      "content-type": "application/json",
                                    },
                                    body: JSON.stringify({
                                      roomId: id,
                                      deviceId: "",
                                    }),
                                  },
                                );
                              } catch { /* ignore */ }
                              try {
                                await loadRooms();
                              } catch { /* ignore */ }
                            } else {
                              globalThis.dispatchEvent(
                                new CustomEvent("app:toast", {
                                  detail: {
                                    type: "error",
                                    title: "参加に失敗",
                                    description: "Welcomeの適用に失敗しました",
                                  },
                                }),
                              );
                            }
                          } catch (e) {
                            globalThis.dispatchEvent(
                              new CustomEvent("app:toast", {
                                detail: {
                                  type: "error",
                                  title: "参加に失敗",
                                  description: String(e),
                                },
                              }),
                            );
                          }
                        }}
                      >
                        参加する
                      </button>
                      <button
                        type="button"
                        class="px-3 py-1 rounded bg-transparent border border-amber-500/60 text-amber-100 text-sm hover:bg-amber-500/20"
                        onClick={() => {
                          const id = selectedRoom();
                          if (!id) return;
                          setPendingWelcomes((prev) => {
                            const n = { ...prev };
                            delete n[id];
                            return n;
                          });
                        }}
                      >
                        後で
                      </button>
                    </div>
                  </div>
                </Show>
                <ChatSendForm
                  newMessage={newMessage()}
                  setNewMessage={setNewMessage}
                  mediaFile={mediaFile()}
                  setMediaFile={setMediaFile}
                  mediaPreview={mediaPreview()}
                  setMediaPreview={setMediaPreview}
                  sendMessage={sendMessage}
                  allowMedia={(function () {
                    const r = selectedRoomInfo();
                    return r ? r.type !== "memo" : true;
                  })()}
                />
              </div>
            </Show>
          </div>
        </div>
      </div>
      <GroupCreateDialog
        isOpen={showGroupDialog()}
        mode={groupDialogMode()}
        onClose={() => {
          setShowGroupDialog(false);
        }}
        onCreate={createRoom}
        initialMembers={initialMembers()}
      />
      <ChatSettingsOverlay
        isOpen={showSettings()}
        room={selectedRoomInfo()}
        groupState={(function () {
          const id = selectedRoom();
          if (!id) return null;
          return groups()[id] ?? null;
        })()}
        onClose={() => setShowSettings(false)}
        onRoomUpdated={(partial) => {
          const id = selectedRoom();
          if (!id) return;
          setChatRooms((prev) =>
            prev.map((r) => r.id === id ? { ...r, ...partial } : r)
          );
        }}
        bindingStatus={bindingStatus()}
        bindingInfo={bindingInfo()}
        ktInfo={ktInfo()}
        onRemoveMember={removeActorLeaves}
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

// 招待中のローカル管理（設定オーバーレイが参照）
const cacheKeyPending = (roomId: string) => `pendingInvites:${roomId}`;
async function readPending(
  accountId: string,
  roomId: string,
): Promise<string[]> {
  const raw = await getCacheItem(accountId, cacheKeyPending(roomId));
  return Array.isArray(raw)
    ? (raw as unknown[]).filter((v) => typeof v === "string") as string[]
    : [];
}
async function writePending(accountId: string, roomId: string, ids: string[]) {
  const uniq = Array.from(new Set(ids));
  await setCacheItem(accountId, cacheKeyPending(roomId), uniq);
}
async function addPendingInvites(
  accountId: string,
  roomId: string,
  ids: string[],
) {
  const cur = await readPending(accountId, roomId);
  await writePending(accountId, roomId, [...cur, ...ids]);
}
async function _removePendingInvite(
  accountId: string,
  roomId: string,
  id: string,
) {
  const cur = (await readPending(accountId, roomId)).filter((v) => v !== id);
  await writePending(accountId, roomId, cur);
}
async function syncPendingWithParticipants(
  accountId: string,
  roomId: string,
  participants: string[],
) {
  const present = new Set(participants);
  const cur = await readPending(accountId, roomId);
  const next = cur.filter((v) => !present.has(v));
  await writePending(accountId, roomId, next);
}

function pickUsableKeyPackage(
  list: {
    content: string;
    expiresAt?: string;
    used?: boolean;
    deviceId?: string;
    lastResort?: boolean;
  }[],
):
  | {
    content: string;
    expiresAt?: string;
    used?: boolean;
    deviceId?: string;
    lastResort?: boolean;
  }
  | null {
  const now = Date.now();
  const normal = list.filter((k) => !k.lastResort);
  const lastResort = list.filter((k) => k.lastResort);
  const usableNormal = normal.filter((k) =>
    !k.used && (!k.expiresAt || Date.parse(k.expiresAt) > now)
  );
  if (usableNormal.length > 0) return usableNormal[0];
  // 通常キーが無い場合のみ lastResort を候補にする（unused/未期限切れ優先）
  const usableLR = lastResort.filter((k) =>
    !k.used && (!k.expiresAt || Date.parse(k.expiresAt) > now)
  );
  if (usableLR.length > 0) return usableLR[0];
  // それでも無ければ全体から最初
  return list[0] ?? null;
}

function normalizeHandle(actor: ActorID): string | null {
  if (actor.startsWith("http")) {
    try {
      const url = new URL(actor);
      const name = url.pathname.split("/").pop()!;
      return `${name}@${url.hostname}`;
    } catch {
      return null;
    }
  }
  if (actor.includes("@")) return actor;
  // 裸の文字列（displayName/uuid等）はハンドルとみなさない
  return null;
}
