import { createSignal, Show, createEffect } from "solid-js";
import { getDomain } from "../../utils/config.ts";
import { Button } from "../ui/index.ts";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, members: string[]) => void;
}

export function ChatCreateGroupDialog(props: Props) {
  const [name, setName] = createSignal("");
  const [members, setMembers] = createSignal("");

  const submit = () => {
    const n = name().trim();
    if (!n) return;
    const m = members()
      .split(/[\n,;\s]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => (s.includes("@") || s.startsWith("http") ? s : `${s}@${getDomain()}`));
    if (m.length === 0) return;
    props.onCreate(n, m);
    props.onClose();
  };

  createEffect(() => {
    if (props.isOpen) {
      setName("");
      setMembers("");
    }
  });

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center">
        <div class="absolute inset-0 bg-black/60" onClick={props.onClose} />
        <div class="relative w-[min(720px,95%)] bg-[#141414] rounded-lg p-4 border border-[#333] z-10">
          <h3 class="text-lg font-semibold text-white mb-3">新しいグループを作成</h3>
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
          <div class="flex justify-end gap-2">
            <Button size="sm" onClick={props.onClose}>キャンセル</Button>
            <Button size="sm" onClick={submit}>作成</Button>
          </div>
        </div>
      </div>
    </Show>
  );
}

export default ChatCreateGroupDialog;
