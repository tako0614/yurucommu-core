import { createEffect, createSignal, For, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";
import { apiFetch, getDomain } from "../../utils/config.ts";
import type { Room } from "./types.ts";

interface ChatSettingsOverlayProps {
  isOpen: boolean;
  room: Room | null;
  onClose: () => void;
  onRoomUpdated?: (partial: Partial<Room>) => void;
  onRoomDeleted?: (id: string) => void;
}

export function ChatSettingsOverlay(props: ChatSettingsOverlayProps) {
  const [accountValue] = useAtom(activeAccount);
  const [roomName, setRoomName] = createSignal("");
  const [roomIcon, setRoomIcon] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [_members, setMembers] = createSignal<string[]>([]);
  const [pendingInvites, setPendingInvites] = createSignal<string[]>([]);
  const [inviteActor, setInviteActor] = createSignal("");
  const [inviteMsg, setInviteMsg] = createSignal("");
  const [inviteTTL, setInviteTTL] = createSignal(86400);
  const [inviteUses, setInviteUses] = createSignal(1);
  const [activeTab, setActiveTab] = createSignal<
    "notifications" | "members" | "invites" | "leave"
  >("notifications");
  const isGroup = () => props.room?.type === "group";
  const groupHost = () => {
    const id = props.room?.meta?.groupId || props.room?.id || "";
    try {
      return new URL(id).hostname;
    } catch {
      return "";
    }
  };
  const isLocalGroup = () => isGroup() && groupHost() === getDomain();
  const groupStorageKey = () => {
    const id = props.room?.meta?.groupId || props.room?.id || "";
    return `group:notify:${id}`;
  };
  const [notifyEnabled, setNotifyEnabled] = createSignal(true);

  createEffect(() => {
    if (props.isOpen && props.room) {
      setRoomName(props.room.name ?? "");
      setRoomIcon(props.room.avatar || null);
      setMembers(props.room.members ?? []);
      if (isGroup()) {
        try {
          const raw = localStorage.getItem(groupStorageKey());
          setNotifyEnabled(raw === null ? true : raw === "1");
        } catch {
          // ignore
        }
      }
    }
  });

  // ルームまたはユーザー宛の保留中招待を取得（DM では招待機能を無効化するためグループ時のみ取得）
  const loadPendingInvites = async () => {
    setPendingInvites([]);
    if (!props.room) return;
    try {
      if (props.room.type === "group") {
        try {
          const rres = await apiFetch(
            `/api/rooms/${encodeURIComponent(props.room.id)}/pendingInvites`,
          );
          if (rres.ok) {
            const jr = await rres.json();
            if (Array.isArray(jr)) {
              setPendingInvites(jr.map(String).filter(Boolean));
              return;
            }
          }
        } catch {
          // ignore
        }
      } else if (props.room.type === "dm") {
        // DM の招待は無効（取得もしない）
        return;
      }
      // fallback to user-scoped pending invites
      try {
        const me = accountValue();
        if (!me) return;
        const ures = await apiFetch(
          `/api/users/${
            encodeURIComponent(me.userName + "@" + getDomain())
          }/pendingInvites`,
        );
        if (ures.ok) {
          const ju = await ures.json();
          if (Array.isArray(ju)) {
            setPendingInvites(ju.map(String).filter(Boolean));
          }
        }
      } catch {
        // ignore
      }
    } catch {
      // ignore
    }
  };

  const handleIconChange = async (file: File) => {
    if (!props.room) return;
    if (props.room.type !== "dm") {
      setError("グループのアイコン変更は未対応です");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const owner = accountValue()
        ? `${accountValue()!.userName}@${getDomain()}`
        : "";
      const res = await apiFetch(
        `/api/dms/${encodeURIComponent(props.room.id)}/icon?owner=${
          encodeURIComponent(owner)
        }`,
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
      if (props.room.type === "dm") {
        const owner = accountValue()
          ? `${accountValue()!.userName}@${getDomain()}`
          : "";
        const res = await apiFetch(
          `/api/dms/${encodeURIComponent(props.room.id)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner, name: roomName() }),
          },
        );
        if (!res.ok) throw new Error("update failed");
      } else if (props.room.type === "group") {
        const body = { displayName: roomName() } as Record<string, unknown>;
        const host = (() => { try { return new URL(props.room!.meta?.groupId || props.room!.id).hostname; } catch { return ""; } })();
        if (host === getDomain()) {
          const base = `/api/groups/${encodeURIComponent(props.room.name)}`;
          const res = await apiFetch(base, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error("update failed");
          await apiFetch(`${base}/actor`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }).catch(() => {});
        } else {
          const me = accountValue();
          if (!me) throw new Error("not logged in");
          const handle = `${me.userName}@${getDomain()}`;
          const gid = props.room.meta?.groupId || props.room.id;
          const res = await apiFetch(`/api/groups/overrides`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ member: handle, groupId: gid, displayName: roomName() }),
          });
          if (!res.ok) throw new Error("update failed");
        }
      } else {
        setError("未対応のルーム種別です");
        return;
      }
      props.onRoomUpdated?.({ name: roomName() });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const close = () => {
    setError(null);
    setRoomName("");
    props.onClose();
  };

  const handleDelete = async () => {
    if (!props.room) return;
    if (props.room.type !== "dm") {
      setError("グループの削除は未対応です");
      return;
    }
    try {
      const owner = accountValue()
        ? `${accountValue()!.userName}@${getDomain()}`
        : "";
      const res = await apiFetch(
        `/api/dms/${encodeURIComponent(props.room.id)}?owner=${
          encodeURIComponent(owner)
        }`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error("delete failed");
      props.onRoomDeleted?.(props.room.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const sendInvite = async () => {
    if (!props.room) {
      setInviteMsg("ルームが選択されていません");
      return;
    }
    setInviteMsg("");
    const actor = inviteActor().trim();
    if (!actor) {
      setInviteMsg("招待先 Actor を入力してください");
      return;
    }
    if (props.room.type === "group") {
      try {
        if (props.room.name) {
          const ttl = Number(inviteTTL());
          const uses = Number(inviteUses());
          const gres = await apiFetch(
            `/api/groups/${encodeURIComponent(props.room.name)}/invite`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                acct: actor,
                inviter: accountValue()
                  ? `${accountValue()!.userName}@${getDomain()}`
                  : "",
                ttl,
                uses,
              }),
            },
          );
          if (gres.ok) {
            setInviteMsg("送信しました");
            await loadPendingInvites();
            return;
          }
        }
      } catch {
        // ignore
      }
    }
    setInviteMsg("送信に失敗しました");
  };

  // グループ退会
  const handleLeaveGroup = async () => {
    if (!props.room || props.room.type !== "group") return;
    try {
      const me = accountValue();
      if (!me) return;
      const handle = `${me.userName}@${getDomain()}`;
      const host = (() => {
        try { return new URL(props.room!.meta?.groupId || props.room!.id).hostname; } catch { return ""; }
      })();
      const gname = props.room.meta?.groupName || props.room.name;
      const gid = props.room.meta?.groupId || props.room.id;
      let res: Response | null = null;
      if (host === getDomain() && gname) {
        res = await apiFetch(`/api/groups/${encodeURIComponent(gname)}/leave`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ member: handle }),
        });
      } else {
        res = await apiFetch(`/api/groups/leaveRemote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ member: handle, groupId: gid }),
        });
      }
      if (res && res.ok) {
        close();
      } else {
        setError("退会に失敗しました");
      }
    } catch {
      setError("退会に失敗しました");
    }
  };

  // グループのアイコン変更（DataURL 送信）
  const handleGroupIconChange = async (file: File) => {
    if (!props.room || props.room.type !== "group") return;
    if (!props.room.name) return;
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(new Error("failed to read file"));
        fr.readAsDataURL(file);
      });
      const body = { icon: { url: dataUrl } } as Record<string, unknown>;
      const base = `/api/groups/${encodeURIComponent(props.room.name)}`;
      const res1 = await apiFetch(base, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res1.ok) throw new Error("update failed");
      await apiFetch(`${base}/actor`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => {});
      setRoomIcon(dataUrl);
      props.onRoomUpdated?.({ avatar: dataUrl });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  };

  createEffect(() => {
    if (props.isOpen) loadPendingInvites();
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50">
        <div
          class="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={close}
        />
        <div class="absolute inset-0 overflow-y-auto p-0 sm:p-6 flex flex-col">
          <div class="w-full h-full sm:h-auto sm:max-w-2xl mx-auto bg-[#1f1f1f] rounded-none sm:rounded-xl shadow-2xl border-0 sm:border border-[#333] flex flex-col">
            <div class="flex items-center justify-between px-4 sm:px-6 h-14 border-b border-[#333]">
              <h2 class="text-xl font-bold text-white">
                {props.room?.type === "group" ? "グループ設定" : "トーク設定"}
              </h2>
              <button
                type="button"
                onClick={close}
                class="text-gray-400 hover:text-white text-xl font-bold"
              >
                ×
              </button>
            </div>
            <Show when={error()}>
              <div class="px-4 sm:px-6 py-3 bg-red-900/40 text-red-300 text-sm border-b border-red-800">
                {error()}
              </div>
            </Show>
            <div class="p-4 sm:p-6 space-y-6">
              {/* グループ: タブナビゲーション */}
              <Show when={props.room?.type === "group"}>
                <div class="flex gap-2 border-b border-[#333] pb-2">
                  <button class={`px-3 py-1 rounded ${activeTab() === "notifications" ? "bg-[#2b2b2b] text-white" : "text-gray-300 hover:text-white"}`} onClick={() => setActiveTab("notifications")}>通知</button>
                  <button class={`px-3 py-1 rounded ${activeTab() === "members" ? "bg-[#2b2b2b] text-white" : "text-gray-300 hover:text-white"}`} onClick={() => setActiveTab("members")}>メンバー</button>
                  <Show when={isLocalGroup()}>
                    <button class={`px-3 py-1 rounded ${activeTab() === "invites" ? "bg-[#2b2b2b] text-white" : "text-gray-300 hover:text-white"}`} onClick={() => setActiveTab("invites")}>招待</button>
                  </Show>
                  <button class={`ml-auto px-3 py-1 rounded ${activeTab() === "leave" ? "bg-[#3b0b0b] text-white" : "text-red-400 hover:text-red-300"}`} onClick={() => setActiveTab("leave")}>退会</button>
                </div>
              </Show>

              {/* 通知タブ（グループ）: 通知と基本情報 */}
              <Show when={props.room?.type === "group" && activeTab() === "notifications"}>
                <section class="space-y-6">
                  <div class="flex items-center gap-3">
                    <label class="text-sm text-gray-300">通知</label>
                    <button
                      type="button"
                      class={`px-3 py-1 rounded text-sm ${notifyEnabled() ? "bg-green-700 text-white" : "bg-[#2b2b2b] text-gray-300"}`}
                      onClick={() => {
                        const next = !notifyEnabled();
                        setNotifyEnabled(next);
                        try { localStorage.setItem(groupStorageKey(), next ? "1" : "0"); } catch {/* ignore */}
                      }}
                    >
                      {notifyEnabled() ? "オン" : "オフ"}
                    </button>
                  </div>
                  <div>
                    <label class="block text-sm text-gray-400 mb-1">グループ名</label>
                    <input
                      value={roomName()}
                      onInput={(e) => setRoomName(e.currentTarget.value)}
                      class="w-full bg-[#2b2b2b] border border-[#3a3a3a] rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                      placeholder="グループ名"
                    />
                  </div>
                  <div>
                    <label class="block text-sm text-gray-400 mb-1">アイコン</label>
                    <div class="flex items-center gap-4">
                      <div class="w-16 h-16 rounded-lg bg-[#2b2b2b] flex items-center justify-center overflow-hidden border border-[#3a3a3a]">
                        {roomIcon()
                          ? (<img src={roomIcon()!} alt="group icon" class="w-full h-full object-cover" />)
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
                            if (f) handleGroupIconChange(f);
                          }}
                        />
                        {uploading() ? "アップロード中..." : "画像を選択"}
                      </label>
                    </div>
                  </div>
                  <div class="flex gap-2">
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

              {/* メンバータブ（グループ） */}
              <Show when={props.room?.type === "group" && activeTab() === "members"}>
                <section class="space-y-4">
                  <h3 class="font-bold text-white">メンバー</h3>
                  <div class="bg-[#151515] border border-[#2a2a2a] rounded p-3 text-sm text-gray-300">
                    <Show when={props.room && props.room.members && props.room.members.length > 0}>
                      <ul class="list-disc list-inside">
                        <For each={props.room?.members} fallback={null}>
                          {(m) => <li>{m}</li>}
                        </For>
                      </ul>
                    </Show>
                    <Show when={!props.room || !props.room.members || props.room.members.length === 0}>
                      <div class="text-sm text-gray-500">参加者情報がありません</div>
                    </Show>
                  </div>
                </section>
              </Show>

              {/* 招待タブ（ローカルグループのみ） */}
              <Show when={props.room?.type === "group" && isLocalGroup() && activeTab() === "invites"}>
                <section class="space-y-4">
                  <h3 class="font-bold text-white">招待</h3>
                  <div class="bg-[#151515] border border-[#2a2a2a] rounded p-3 text-sm text-gray-300">
                    <Show when={pendingInvites().length > 0}>
                      <div>
                        <div class="text-xs text-gray-400 mb-1">保留中の招待</div>
                        <ul class="list-disc list-inside text-sm text-yellow-200">
                          <For each={pendingInvites()}>
                            {(p) => <li>{p}</li>}
                          </For>
                        </ul>
                      </div>
                    </Show>
                    <div class="mt-2 flex flex-col gap-2">
                      <input
                        class="bg-[#2b2b2b] border border-[#3a3a3a] rounded px-3 py-2 text-white text-sm"
                        placeholder="招待先 Actor (例: user@host.tld)"
                        value={inviteActor()}
                        onInput={(e) => setInviteActor(e.currentTarget.value)}
                      />
                      <div class="flex gap-2">
                        <input
                          class="w-32 bg-[#2b2b2b] border border-[#3a3a3a] rounded px-3 py-2 text-white text-sm"
                          type="number"
                          placeholder="TTL(秒)"
                          value={inviteTTL()}
                          onInput={(e) => setInviteTTL(Number(e.currentTarget.value))}
                        />
                        <input
                          class="w-24 bg-[#2b2b2b] border border-[#3a3a3a] rounded px-3 py-2 text-white text-sm"
                          type="number"
                          placeholder="使用回数"
                          value={inviteUses()}
                          onInput={(e) => setInviteUses(Number(e.currentTarget.value))}
                        />
                        <button
                          type="button"
                          class="px-3 py-2 bg-blue-600 text-white rounded text-sm"
                          onClick={sendInvite}
                        >
                          招待
                        </button>
                      </div>
                      <Show when={inviteMsg()}>
                        <div class="text-sm text-green-300">{inviteMsg()}</div>
                      </Show>
                    </div>
                  </div>
                </section>
              </Show>

              {/* 退会タブ（グループ） */}
              <Show when={props.room?.type === "group" && activeTab() === "leave"}>
                <section class="space-y-4">
                  <p class="text-sm text-gray-300">このグループを退会します。メッセージ履歴は残ります。</p>
                  <div class="flex gap-2">
                    <button
                      type="button"
                      onClick={handleLeaveGroup}
                      class="px-4 py-2 bg-red-700 hover:bg-red-600 text-white rounded text-sm font-medium"
                    >
                      退会する
                    </button>
                  </div>
                </section>
              </Show>

              {/* DM 専用操作（必要ならここに削除などを配置） */}
              <Show when={props.room?.type === "dm"}>
                <section class="space-y-4">
                  <div class="flex gap-2">
                    <button
                      type="button"
                      onClick={handleDelete}
                      class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
                    >
                      削除
                    </button>
                  </div>
                </section>
              </Show>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
