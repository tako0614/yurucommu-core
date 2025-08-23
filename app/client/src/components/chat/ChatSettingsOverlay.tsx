import { createEffect, createSignal, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";
import { apiFetch, getDomain } from "../../utils/config.ts";
import type { Room } from "./types.ts";
import { fetchUserInfo } from "../microblog/api.ts";

interface ChatSettingsOverlayProps {
  isOpen: boolean;
  room: Room | null;
  onClose: () => void;
  onRoomUpdated?: (partial: Partial<Room>) => void;
  bindingStatus?: string | null;
  bindingInfo?: { label: string; caution?: string } | null;
  ktInfo?: { included: boolean } | null;
  onRemoveMember?: (id: string) => Promise<boolean>;
  // 親(Chat)から渡される現在のグループ状態（ブラウザでは保存されないため）
  groupState?: unknown | null;
}

interface MemberItem {
  id: string; // actor id (@user@domain) または識別子
  display: string;
  avatar?: string;
  actor?: string;
  leafSignatureKeyFpr?: string;
  bindingStatus: string;
  bindingInfo: { label: string; caution?: string };
  ktIncluded: boolean;
}

export function ChatSettingsOverlay(props: ChatSettingsOverlayProps) {
  const [accountValue] = useAtom(activeAccount);
  // E2EE removed: use lightweight evaluator that returns neutral values
  const assessMemberBinding = async (
    _accountId?: string,
    _roomId?: string,
    _handle?: string,
    _s?: string,
  ) => {
    return { status: "Unknown", info: { label: "N/A" }, kt: { included: false } };
  };
  const [tab, setTab] = createSignal<"general" | "members" | "appearance">(
    "general",
  );
  const [roomName, setRoomName] = createSignal("");
  const [roomIcon, setRoomIcon] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [members, setMembers] = createSignal<MemberItem[]>([]);
  const [pending, setPending] = createSignal<MemberItem[]>([]);
  const [newMember, setNewMember] = createSignal("");
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (props.isOpen && props.room) {
      setRoomName(props.room.name ?? "");
      setRoomIcon(props.room.avatar || null);
      void loadMembers();
    }
  });

  const loadMembers = async () => {
    const r = props.room;
    const user = accountValue();
    if (!r || !user) return;
    try {
      // サーバーのメンバーAPIは使用しない。MLS 由来で取得
      await loadMembersFromMLS(r.id, props.groupState ?? undefined);
      await loadPendingFromStorage(r.id);
    } catch (e) {
      console.warn("loadMembers failed", e);
      await loadMembersFromMLS(r.id, props.groupState ?? undefined);
      await loadPendingFromStorage(r.id);
    }
  };
  // 招待中リストの保存・読込（アカウント/ルーム単位でlocalStorage保持）
  const cacheKey = (roomId: string) =>
    `pendingInvites:${accountValue()?.id ?? "anon"}:${roomId}`;
  const readPending = async (roomId: string): Promise<string[]> => {
    try {
      const raw = localStorage.getItem(cacheKey(roomId));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((v) => typeof v === "string") : [];
    } catch {
      return [];
    }
  };
  const writePending = async (roomId: string, ids: string[]) => {
    try {
      const uniq = Array.from(new Set(ids));
      localStorage.setItem(cacheKey(roomId), JSON.stringify(uniq));
    } catch {
      /* ignore */
    }
  };
  const addPending = async (roomId: string, ids: string[]) => {
    const cur = await readPending(roomId);
    await writePending(roomId, [...cur, ...ids]);
  };
  const _removePending = async (roomId: string, id: string) => {
    const cur = (await readPending(roomId)).filter((v) => v !== id);
    await writePending(roomId, cur);
  };
  const loadPendingFromStorage = async (
    roomId: string,
    presentIds?: string[],
  ) => {
    const user = accountValue();
    if (!user) return setPending([]);
    const present = new Set(presentIds ?? members().map((m) => m.id));
    const rawIds = await readPending(roomId);
    const list: MemberItem[] = [];
    for (const raw of rawIds) {
      const handle = normalizeHandle(raw);
      if (handle && present.has(handle)) continue; // 既にメンバー
      if (handle) {
        try {
          const info = await fetchUserInfo(handle);
          const resEval = await assessMemberBinding(
            user.id,
            roomId,
            handle,
            "",
          );
          list.push({
            id: handle,
            display: info?.displayName || info?.userName || handle,
            avatar: info?.authorAvatar,
            actor: handle,
            leafSignatureKeyFpr: "",
            bindingStatus: resEval.status,
            bindingInfo: resEval.info,
            ktIncluded: resEval.kt.included,
          });
          continue;
        } catch {
          console.error("ユーザー情報の取得に失敗しました");
        }
      }
      const resEval = await assessMemberBinding(user.id, roomId, undefined, "");
      list.push({
        id: raw,
        display: "不明",
        avatar: undefined,
        actor: undefined,
        leafSignatureKeyFpr: "",
        bindingStatus: resEval.status,
        bindingInfo: resEval.info,
        ktIncluded: resEval.kt.included,
      });
    }
    setPending(list);
  };

  const loadMembersFromMLS = async (roomId: string, _stateFromParent?: unknown) => {
    const user = accountValue();
    if (!user) return setMembers([]);
    try {
      // Simplified fallback: use server-provided members list or recent messages.
      const self = `${user.userName}@${getDomain()}`;
      const fallback = (props.room?.members ?? [])
        .map((id) => normalizeHandle(id))
        .filter((id): id is string => !!id)
        .filter((id) => id !== self);
      const derived = deriveIdsFromRoom(self);
      const ids = Array.from(new Set([...(fallback ?? []), ...derived]));
      if (ids.length > 0) {
        const list = await Promise.all(ids.map(async (id) => {
          const info = await fetchUserInfo(id);
          const resEval = await assessMemberBinding(user.id, roomId, id, "");
          return {
            id,
            display: info?.displayName || info?.userName || id,
            avatar: info?.authorAvatar,
            actor: id,
            leafSignatureKeyFpr: "",
            bindingStatus: resEval.status,
            bindingInfo: resEval.info,
            ktIncluded: resEval.kt.included,
          } as MemberItem;
        }));
        setMembers(list);
        await loadPendingFromStorage(roomId, list.map((m) => m.id));
        return;
      }
      // Fallback: derive from recent messages
      return await loadMembersFromMessages(roomId);
    } catch (err) {
      console.warn("loadMembersFromMLS failed", err);
      return await loadMembersFromMessages(roomId);
    }
  };

  const loadMembersFromMessages = async (roomId: string) => {
    const user = accountValue();
    if (!user) return setMembers([]);
    try {
      const self = `${user.userName}@${getDomain()}`;
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(roomId)}/messages?limit=100`,
      );
      const msgs = res.ok ? await res.json() : [];
      const setIds = new Set<string>();
      for (const m of msgs) {
        if (typeof m.from === "string") {
          const h = normalizeHandle(m.from);
          if (h && h !== self) setIds.add(h);
        }
        if (Array.isArray(m.to)) {
          for (const t of m.to) {
            if (typeof t === "string") {
              const h = normalizeHandle(t);
              if (h && h !== self) setIds.add(h);
            }
          }
        }
      }
      const ids = Array.from(setIds);
      const list = await Promise.all(ids.map(async (id) => {
        const info = await fetchUserInfo(id);
        const resEval = await assessMemberBinding(user.id, roomId, id, "");
        return {
          id,
          display: info?.displayName || info?.userName || id,
          avatar: info?.authorAvatar,
          actor: id,
          leafSignatureKeyFpr: "",
          bindingStatus: resEval.status,
          bindingInfo: resEval.info,
          ktIncluded: resEval.kt.included,
        } as MemberItem;
      }));
      setMembers(list);
    } catch (err) {
      console.warn("loadMembersFromMessages failed", err);
      setMembers([]);
    }
  };

  const extractIdentities = (state: any): string[] => {
    try {
      const out: string[] = [];
      const tree = (state && state.ratchetTree) || [];
      for (const node of tree) {
        if (node && node.nodeType === "leaf") {
          const id = node.leaf?.credential?.identity;
          if (id) out.push(new TextDecoder().decode(id));
        }
      }
      return out;
    } catch {
      return [];
    }
  };

  const deriveIdsFromRoom = (self: string): string[] => {
    const out = new Set<string>();
    const id = normalizeHandle(props.room?.id);
    if (id && id !== self) out.add(id);
    const name = normalizeHandle(props.room?.name || "");
    if (name && name !== self) out.add(name);
    return Array.from(out);
  };

  const normalizeHandle = (id?: string): string | undefined => {
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
  };

  const normalizeActor = (
    input: string,
  ): { user: string; domain?: string } | null => {
    let v = input.trim();
    if (!v) return null;
    if (v.startsWith("http")) {
      try {
        const url = new URL(v);
        const name = url.pathname.split("/").pop() || "";
        if (!name) return null;
        return { user: `${name}@${url.hostname}` } as {
          user: string;
          domain?: string;
        };
      } catch {
        return null;
      }
    }
    if (v.startsWith("@")) v = v.slice(1);
    if (v.includes("@")) {
      return { user: v } as { user: string; domain?: string };
    }
    // ドメイン省略時はローカル扱い
    return { user: v, domain: getDomain() };
  };

  const handleAddMember = async () => {
    const value = newMember().trim();
    if (!value || !props.room) return;
    const user = accountValue();
    if (!user) return;
    try {
      setSaving(true);
      const ident = normalizeActor(value);
      if (!ident) throw new Error("メンバーIDの形式が不正です");
      const target = ident.user.includes("@") ? ident.user : `${ident.user}@${ident.domain}`;
      // Fallback: tell server to create an invite (simple server API)
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(props.room.id)}/invites`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ members: [target] }),
        },
      );
      if (!res.ok) throw new Error("招待の送信に失敗しました");
      // local pending store
      await addPending(props.room.id, [target]);
      await loadMembers();
      setNewMember("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveMember = async (id: string) => {
    if (!confirm(`${id} を削除しますか?`)) return;
    try {
      setSaving(true);
      if (props.onRemoveMember) {
        const ok = await props.onRemoveMember(id);
        if (!ok) throw new Error("remove failed");
      } else if (props.room) {
        // Fallback server API
        await apiFetch(`/api/rooms/${encodeURIComponent(props.room.id)}/members`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "Remove", object: id }),
        });
      }
      await loadMembers();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleIconChange = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(props.room!.id)}/icon`,
        { method: "POST", body: form },
      );
      if (!res.ok) throw new Error("icon upload failed");
      const data = await res.json();
      setRoomIcon(data.url || null);
      props.onRoomUpdated?.({ avatar: data.url });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  const handleSaveGeneral = async () => {
    if (!props.room) return;
    if (!roomName().trim()) {
      setError("名前を入力してください");
      return;
    }
    try {
      setSaving(true);
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(props.room.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: roomName() }),
        },
      );
      if (!res.ok) throw new Error("update failed");
      props.onRoomUpdated?.({ name: roomName() });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    setError(null);
    setNewMember("");
    props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50">
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={close}
        />
        <div class="absolute inset-0 overflow-y-auto p-6 flex flex-col">
          <div class="max-w-4xl w-full mx-auto bg-[#1f1f1f] rounded-xl shadow-2xl border border-[#333] flex flex-col min-h-[80vh]">
            <div class="flex items-center justify-between px-6 h-14 border-b border-[#333]">
              <div class="flex items-center gap-4">
                <h2 class="text-xl font-bold text-white">設定</h2>
                <nav class="flex gap-2 text-sm">
                  <button
                    type="button"
                    onClick={() => setTab("general")}
                    class={`px-3 py-1 rounded ${
                      tab() === "general"
                        ? "bg-blue-600 text-white"
                        : "text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    一般
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("members")}
                    class={`px-3 py-1 rounded ${
                      tab() === "members"
                        ? "bg-blue-600 text-white"
                        : "text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    メンバー
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("appearance")}
                    class={`px-3 py-1 rounded ${
                      tab() === "appearance"
                        ? "bg-blue-600 text-white"
                        : "text-gray-300 hover:bg-white/10"
                    }`}
                  >
                    外観
                  </button>
                </nav>
              </div>
              <button
                type="button"
                onClick={close}
                class="text-gray-400 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>
            <Show when={error()}>
              <div class="px-6 py-3 bg-red-900/40 text-red-300 text-sm border-b border-red-800">
                {error()}
              </div>
            </Show>
            <div class="flex-1 flex flex-col p-6 gap-6">
                <Show when={tab() === "general"}>
                  <section class="space-y-6">
                  <div>
                    <label class="block text-sm text-gray-400 mb-1">
                    ルーム名
                    </label>
                    <input
                    value={roomName()}
                    onInput={(e) => setRoomName(e.currentTarget.value)}
                    class="w-full bg-[#2b2b2b] border border-[#3a3a3a] rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    placeholder="ルーム名"
                    />
                  </div>
                  <div>
                    <label class="block text-sm text-gray-400 mb-1">
                    アイコン
                    </label>
                    <div class="flex items-center gap-4">
                    <div class="w-16 h-16 rounded-lg bg-[#2b2b2b] flex items-center justify-center overflow-hidden border border-[#3a3a3a]">
                      {roomIcon()
                      ? (
                        <img
                        src={roomIcon()!}
                        alt="room icon"
                        class="w-full h-full object-cover"
                        />
                      )
                      : <span class="text-gray-500 text-xs">なし</span>}
                    </div>
                    <label class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded cursor-pointer text-sm">
                      <input
                      type="file"
                      accept="image/*"
                      class="hidden"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const f = e.currentTarget.files?.[0];
                        if (f) handleIconChange(f);
                      }}
                      />
                      {uploading() ? "アップロード中..." : "画像を選択"}
                    </label>
                    </div>
                  </div>
                  <div>
                    <button
                    type="button"
                    disabled={saving()}
                    onClick={handleSaveGeneral}
                    class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded text-sm font-medium"
                    >
                    保存
                    </button>
                  </div>
                  </section>
                </Show>
              <Show when={tab() === "members"}>
                <section class="space-y-6">
                  <Show when={props.bindingInfo}>
                    <div class="text-sm text-gray-300">
                      <span>状態: {props.bindingInfo!.label}</span>
                      <Show when={props.bindingInfo!.caution}>
                        <p class="text-xs text-yellow-400 mt-1">
                          {props.bindingInfo!.caution}
                        </p>
                      </Show>
                      <Show when={props.ktInfo && !props.ktInfo.included}>
                        <p class="text-xs text-yellow-400 mt-1">監査未検証</p>
                      </Show>
                      <Show when={props.bindingStatus !== "Verified"}>
                        <button
                          type="button"
                          class="mt-2 px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700"
                        >
                          指紋確認
                        </button>
                      </Show>
                    </div>
                  </Show>
                  <div class="flex gap-2 items-end">
                    <div class="flex-1">
                      <label class="block text-sm text-gray-400 mb-1">
                        メンバー追加 (@user@domain)
                      </label>
                      <input
                        value={newMember()}
                        onInput={(e) => setNewMember(e.currentTarget.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleAddMember();
                          }
                        }}
                        placeholder="@alice@example.com"
                        class="w-full bg-[#2b2b2b] border border-[#3a3a3a] rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500 text-sm"
                      />
                    </div>
                    <button
                      type="button"
                      disabled={!newMember().trim() || saving()}
                      onClick={handleAddMember}
                      class="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded text-sm font-medium"
                    >
                      追加
                    </button>
                  </div>
                  <div>
                    <h3 class="text-sm font-semibold text-gray-300 mb-2">
                      メンバー一覧
                    </h3>
                    <div class="space-y-3 max-h-72 overflow-y-auto pr-1">
                      <Show when={members().length > 0}>
                        <div>
                          <p class="text-xs text-gray-400 mb-1">メンバー</p>
                          <div class="space-y-2">
                            <For each={members()}>
                              {(m) => (
                                <div class="flex items-center gap-3 bg-[#2b2b2b] rounded px-3 py-2 border border-[#343434]">
                                  <div class="w-8 h-8 rounded-full bg-[#3a3a3a] overflow-hidden flex items-center justify-center text-xs text-gray-400">
                                    {m.avatar
                                      ? (
                                        <img
                                          src={m.avatar}
                                          alt={m.display}
                                          class="w-full h-full object-cover"
                                        />
                                      )
                                      : m.display[0]}
                                  </div>
                                  <div class="flex-1 min-w-0">
                                    <p class="text-sm text-white font-medium truncate">
                                      {m.display}
                                    </p>
                                    <p class="text-xs text-gray-500 truncate">
                                      {m.actor ?? m.id}
                                    </p>
                                    <p class="text-xs text-gray-300 mt-1">
                                      {m.bindingInfo.label}
                                      <Show when={m.bindingInfo.caution}>
                                        <span class="ml-2 text-yellow-400">
                                          {m.bindingInfo.caution}
                                        </span>
                                      </Show>
                                      <Show when={!m.ktIncluded}>
                                        <span class="ml-2 text-yellow-400">
                                          監査未検証
                                        </span>
                                      </Show>
                                    </p>
                                  </div>
                                  <div class="flex items-center gap-2">
                                    <Show when={m.bindingStatus !== "Verified"}>
                                      <button
                                        type="button"
                                        class="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-700 text-white"
                                      >
                                        指紋確認
                                      </button>
                                    </Show>
                                    <Show
                                      when={accountValue() &&
                                        `${
                                            accountValue()!.userName
                                          }@${getDomain()}` !== m.id}
                                    >
                                      <button
                                        type="button"
                                        disabled={saving()}
                                        onClick={() => handleRemoveMember(m.id)}
                                        class="px-2 py-1 text-xs rounded bg-red-600 hover:bg-red-700 text-white"
                                      >
                                        削除
                                      </button>
                                    </Show>
                                  </div>
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                      <Show when={pending().length > 0}>
                        <div>
                          <div class="space-y-2 mt-2">
                            <For each={pending()}>
                              {(m) => (
                                <div class="flex items-center gap-3 bg-[#252525] rounded px-3 py-2 border border-dashed border-[#3a3a3a]">
                                  <div class="w-8 h-8 rounded-full bg-[#3a3a3a] overflow-hidden flex items-center justify-center text-xs text-gray-400">
                                    {m.avatar
                                      ? (
                                        <img
                                          src={m.avatar}
                                          alt={m.display}
                                          class="w-full h-full object-cover"
                                        />
                                      )
                                      : m.display[0]}
                                  </div>
                                  <div class="flex-1 min-w-0">
                                    <p class="text-sm text-white font-medium truncate">
                                      {m.display}
                                    </p>
                                    <p class="text-xs text-gray-500 truncate">
                                      {m.actor ?? m.id}
                                    </p>
                                  </div>
                                  {/* pending badge intentionally hidden */}
                                </div>
                              )}
                            </For>
                          </div>
                        </div>
                      </Show>
                      <Show
                        when={members().length === 0 && pending().length === 0}
                      >
                        <div class="text-xs text-gray-500">メンバー無し</div>
                      </Show>
                    </div>
                  </div>
                </section>
              </Show>
              <Show when={tab() === "appearance"}>
                <section class="space-y-6">
                  <p class="text-sm text-gray-400">
                    外観設定（テーマ / 色 / 通知音 など）は今後拡張予定です。
                  </p>
                </section>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
