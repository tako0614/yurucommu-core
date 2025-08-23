import { createSignal, Show, createEffect } from "solid-js";
import { getDomain } from "../../utils/config.ts";
import { Button } from "../ui/index.ts";

interface Props {
  isOpen: boolean;
  initialType?: "dm" | "group";
  onClose: () => void;
  onCreateDM: (handle: string) => void;
  onCreateGroup: (name: string, members: string[]) => void;
}

export function ChatCreateDialog(props: Props) {
  const [type, setType] = createSignal<"dm" | "group">("dm");
  const [handle, setHandle] = createSignal("");
  const [name, setName] = createSignal("");
  const [members, setMembers] = createSignal("");

  const submit = () => {
    if (type() === "dm") {
      const h = handle().trim();
      if (!h) return;
      // normalize simple local handle by adding domain if missing
      const normalized = h.includes("@") || h.startsWith("http")
        ? h
        : `${h}@${getDomain()}`;
      props.onCreateDM(normalized);
      props.onClose();
      return;
    }
    // group
    const m = members()
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => (s.includes("@") || s.startsWith("http") ? s : `${s}@${getDomain()}`));
    if (!name().trim() || m.length === 0) return;
    props.onCreateGroup(name().trim(), m);
    props.onClose();
  };

  createEffect(() => {
    if (props.isOpen) {
      setType(props.initialType ?? "dm");
      setHandle("");
      setName("");
      setMembers("");
    }
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/60" onClick={props.onClose} />
        <div class="relative w-[min(720px,95%)] bg-[#141414] rounded-lg p-4 border border-[#333] z-10">
          <h3 class="text-lg font-semibold text-white mb-3">新しいトークを作成</h3>
          <div class="flex gap-2 mb-3">
            <button
              type="button"
              class={`px-3 py-1 rounded ${type() === "dm" ? "bg-blue-600 text-white" : "bg-[#2b2b2b] text-gray-300"}`}
              onClick={() => setType("dm")}
            >
              DM
            </button>
            <button
              type="button"
              class={`px-3 py-1 rounded ${type() === "group" ? "bg-blue-600 text-white" : "bg-[#2b2b2b] text-gray-300"}`}
              onClick={() => setType("group")}
            >
              グループ
            </button>
          </div>

          <Show when={type() === "dm"}>
            <div class="mb-3">
              <label class="text-sm text-gray-300">相手のハンドル（例: alice@example.com）</label>
              <input
                type="text"
                class="w-full mt-1 p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
                value={handle()}
                onInput={(e) => setHandle(e.currentTarget.value)}
                placeholder="alice@example.com または alice"
              />
            </div>
          </Show>

          <Show when={type() === "group"}>
            <div class="mb-3">
              <label class="text-sm text-gray-300">グループ名</label>
              <input
                type="text"
                class="w-full mt-1 p-2 rounded bg-[#1e1e1e] text-white border border-[#333]"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
                placeholder="グループ名"
              />
            </div>
            <div class="mb-3">
              <label class="text-sm text-gray-300">メンバー（改行・カンマで複数）</label>
              <textarea
                class="w-full mt-1 p-2 rounded bg-[#1e1e1e] text-white border border-[#333] h-24"
                value={members()}
                onInput={(e) => setMembers(e.currentTarget.value)}
                placeholder="alice@example.com\nbob@example.com または alice, bob"
              />
            </div>
          </Show>

          <div class="flex justify-end gap-2">
            <Button size="sm" onClick={props.onClose}>キャンセル</Button>
            <Button size="sm" onClick={submit}>作成</Button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default ChatCreateDialog;
