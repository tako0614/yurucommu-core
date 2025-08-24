import { createEffect, createSignal, Show, For } from "solid-js";
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

  createEffect(() => {
    if (props.isOpen && props.room) {
      setRoomName(props.room.name ?? "");
      setRoomIcon(props.room.avatar || null);
      setMembers(props.room.members ?? []);
    }
  });

  // ルームまたはユーザー宛の保留中招待を取得
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
        try {
          const dres = await apiFetch(
            `/api/dms/${encodeURIComponent(props.room.id)}/pendingInvites`,
          );
          if (dres.ok) {
            const jd = await dres.json();
            if (Array.isArray(jd)) {
              setPendingInvites(jd.map(String).filter(Boolean));
              return;
            }
          }
        } catch {
          // ignore
        }
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
        const res = await apiFetch(
          `/api/groups/${encodeURIComponent(props.room.name)}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ displayName: roomName() }),
          },
        );
        if (!res.ok) throw new Error("update failed");
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
    if (props.room.type === "dm") {
      try {
        const dres = await apiFetch(`/api/dms`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            owner: accountValue()
              ? `${accountValue()!.userName}@${getDomain()}`
              : "",
            id: props.room.id,
            name: props.room.name || "",
            members: [actor],
          }),
        });
        if (dres.ok) {
          setInviteMsg("送信しました");
          await loadPendingInvites();
          return;
        }
      } catch {
        // ignore
      }
    } else if (props.room.type === "group") {
      try {
        const tryRoom = await apiFetch(
          `/api/rooms/${encodeURIComponent(props.room.id)}/invite`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ actor }),
          },
        );
        if (tryRoom.ok) {
          setInviteMsg("送信しました");
          await loadPendingInvites();
          return;
        }
      } catch {
        // ignore
      }
      try {
        if (props.room.name) {
          const gres = await apiFetch(
            `/api/groups/${encodeURIComponent(props.room.name)}/invite`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ actor }),
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
        <div class="absolute inset-0 overflow-y-auto p-6 flex flex-col">
          <div class="max-w-2xl w-full mx-auto bg-[#1f1f1f] rounded-xl shadow-2xl border border-[#333] flex flex-col">
            <div class="flex items-center justify-between px-6 h-14 border-b border-[#333]">
              <h2 class="text-xl font-bold text-white">設定</h2>
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
            <div class="p-6 space-y-6">
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
                <div class="flex gap-2">
                  <button
                    type="button"
                    disabled={saving()}
                    onClick={handleSaveGeneral}
                    class="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded text-sm font-medium"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={handleDelete}
                    class="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
                  >
                    削除
                  </button>
                </div>
              </section>
              <section class="space-y-4">
                <h3 class="font-bold text-white">メンバー</h3>
                <div class="bg-[#151515] border border-[#2a2a2a] rounded p-3 text-sm text-gray-300">
                  <Show
                    when={(props.room && props.room.members &&
                      props.room.members.length > 0) ||
                      pendingInvites().length > 0}
                  >
                    <div class="space-y-2">
                      <Show
                        when={props.room && props.room.members &&
                          props.room.members.length > 0}
                      >
                        <div>
                          <div class="text-xs text-gray-400 mb-1">参加者</div>
                          <ul class="list-disc list-inside">
                            <For each={props.room?.members} fallback={null}>
                              {(m) => <li>{m}</li>}
                            </For>
                          </ul>
                        </div>
                      </Show>
                      <Show when={pendingInvites().length > 0}>
                        <div>
                          <div class="text-xs text-gray-400 mb-1">
                            保留中の招待
                          </div>
                            <ul class="list-disc list-inside text-sm text-yellow-200">
                              <For each={pendingInvites()}>
                                {(p) => <li>{p}</li>}
                              </For>
                            </ul>
                        </div>
                      </Show>
                      <div class="mt-2 flex gap-2">
                        <input
                          class="flex-1 bg-[#2b2b2b] border border-[#3a3a3a] rounded px-3 py-2 text-white text-sm"
                          placeholder="招待先 Actor (例: user@host.tld)"
                          value={inviteActor()}
                          onInput={(e) => setInviteActor(e.currentTarget.value)}
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
                  </Show>
                  <Show
                    when={!((props.room && props.room.members &&
                      props.room.members.length > 0) ||
                      pendingInvites().length > 0)}
                  >
                    <div class="text-sm text-gray-500">
                      参加者情報がありません
                    </div>
                  </Show>
                </div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
