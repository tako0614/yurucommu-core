import { createEffect, createSignal, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";
import { apiFetch, getDomain } from "../../utils/config.ts";
import type { Room } from "./types.ts";
import type { BindingStatus } from "../e2ee/binding.ts";
import { useMLS } from "../e2ee/useMLS.ts";

interface ChatSettingsOverlayProps {
  isOpen: boolean;
  room: Room | null;
  onClose: () => void;
  onRoomUpdated?: (partial: Partial<Room>) => void;
  bindingStatus?: BindingStatus | null;
  bindingInfo?: { label: string; caution?: string } | null;
  ktInfo?: { included: boolean } | null;
  onRemoveMember?: (id: string) => Promise<boolean>;
}

interface MemberItem {
  id: string; // actor id (@user@domain) または識別子
  display: string;
  avatar?: string;
  actor?: string;
  leafSignatureKeyFpr: string;
  bindingStatus: BindingStatus;
  bindingInfo: { label: string; caution?: string };
  ktIncluded: boolean;
}

export function ChatSettingsOverlay(props: ChatSettingsOverlayProps) {
  const [accountValue] = useAtom(activeAccount);
  const { assessMemberBinding } = useMLS(accountValue()?.userName ?? "");
  const [tab, setTab] = createSignal<"general" | "members" | "appearance">(
    "general",
  );
  const [roomName, setRoomName] = createSignal("");
  const [roomIcon, setRoomIcon] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [members, setMembers] = createSignal<MemberItem[]>([]);
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
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(r.id)}/members`,
      );
      if (res.ok) {
        const data = await res.json();
        type RawMember =
          | {
            id?: string;
            displayName?: string;
            avatar?: string;
            actor?: string;
            leafSignatureKeyFpr?: string;
          }
          | string;
        const list = await Promise.all(
          (data.members as RawMember[] || []).map(async (m) => {
            if (typeof m === "string") {
              const resEval = await assessMemberBinding(
                user.id,
                r.id,
                undefined,
                "",
              );
              return {
                id: m,
                display: m,
                actor: undefined,
                avatar: undefined,
                leafSignatureKeyFpr: "",
                bindingStatus: resEval.status,
                bindingInfo: resEval.info,
                ktIncluded: resEval.kt.included,
              } as MemberItem;
            }
            const resEval = await assessMemberBinding(
              user.id,
              r.id,
              m.actor,
              m.leafSignatureKeyFpr ?? "",
            );
            return {
              id: m.id || m.actor || m.displayName || "unknown",
              display: m.displayName || m.id || m.actor || "unknown",
              avatar: m.avatar,
              actor: m.actor,
              leafSignatureKeyFpr: m.leafSignatureKeyFpr ?? "",
              bindingStatus: resEval.status,
              bindingInfo: resEval.info,
              ktIncluded: resEval.kt.included,
            } as MemberItem;
          }),
        );
        const known = list.filter((m) => m.actor);
        const unknown = list.filter((m) => !m.actor);
        setMembers([...known, ...unknown]);
      } else {
        setMembers([]);
      }
    } catch (e) {
      console.warn("loadMembers failed", e);
      setMembers([]);
    }
  };

  const handleAddMember = async () => {
    const value = newMember().trim();
    if (!value) return;
    try {
      setSaving(true);
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(props.room!.id)}/invite`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ members: value }),
        },
      );
      if (!res.ok) throw new Error("invite failed");
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
                    <div class="space-y-2 max-h-72 overflow-y-auto pr-1">
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
                                    }@${getDomain()}` !==
                                    m.id}
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
                      <Show when={members().length === 0}>
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
