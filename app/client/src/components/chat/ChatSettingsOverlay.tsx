import { createEffect, createSignal, Show } from "solid-js";
import { useAtom } from "solid-jotai";
import { activeAccount } from "../../states/account.ts";
import { apiFetch } from "../../utils/config.ts";
import type { Room } from "./types.ts";

interface ChatSettingsOverlayProps {
  isOpen: boolean;
  room: Room | null;
  onClose: () => void;
  onRoomUpdated?: (partial: Partial<Room>) => void;
}

export function ChatSettingsOverlay(props: ChatSettingsOverlayProps) {
  const [accountValue] = useAtom(activeAccount);
  const [roomName, setRoomName] = createSignal("");
  const [roomIcon, setRoomIcon] = createSignal<string | null>(null);
  const [uploading, setUploading] = createSignal(false);
  const [saving, setSaving] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  createEffect(() => {
    if (props.isOpen && props.room) {
      setRoomName(props.room.name ?? "");
      setRoomIcon(props.room.avatar || null);
    }
  });

  const handleIconChange = async (file: File) => {
    if (!props.room) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await apiFetch(
        `/api/rooms/${encodeURIComponent(props.room.id)}/icon`,
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
                  <label class="block text-sm text-gray-400 mb-1">ルーム名</label>
                  <input
                    value={roomName()}
                    onInput={(e) => setRoomName(e.currentTarget.value)}
                    class="w-full bg-[#2b2b2b] border border-[#3a3a3a] rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                    placeholder="ルーム名"
                  />
                </div>
                <div>
                  <label class="block text-sm text-gray-400 mb-1">アイコン</label>
                  <div class="flex items-center gap-4">
                    <div class="w-16 h-16 rounded-lg bg-[#2b2b2b] flex items-center justify-center overflow-hidden border border-[#3a3a3a]">
                      {roomIcon()
                        ? (
                          <img src={roomIcon()!} alt="room icon" class="w-full h-full object-cover" />
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
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
