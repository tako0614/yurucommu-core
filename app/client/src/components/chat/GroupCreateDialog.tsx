import { createSignal, Show } from "solid-js";

interface GroupCreateDialogProps {
  isOpen: boolean;
  mode: "create" | "invite";
  onClose: () => void;
  onCreate?: (name: string, members: string) => void;
  onInvite?: (members: string) => void;
}

export function GroupCreateDialog(props: GroupCreateDialogProps) {
  const [name, setName] = createSignal("");
  const [members, setMembers] = createSignal("");

  const handleSubmit = async (e: Event) => {
    e.preventDefault();
    const mem = members().trim();
    if (props.mode === "create" && props.onCreate) {
      await props.onCreate(name().trim(), mem);
    } else if (props.mode === "invite" && props.onInvite) {
      await props.onInvite(mem);
    }
    setName("");
    setMembers("");
  };

  const handleClose = () => {
    setName("");
    setMembers("");
    props.onClose();
  };

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80">
        <div class="bg-[#1e1e1e] p-4 rounded-lg w-80">
          <h2 class="text-white text-lg mb-4">
            {props.mode === "create" ? "グループ作成" : "メンバー招待"}
          </h2>
          <form onSubmit={handleSubmit}>
            <Show when={props.mode === "create"}>
              <input
                type="text"
                placeholder="グループ名"
                class="w-full p-2 mb-3 rounded bg-[#3c3c3c] text-white placeholder-[#aaaaaa] outline-none border-none"
                value={name()}
                onInput={(e) => setName(e.currentTarget.value)}
              />
            </Show>
            <input
              type="text"
              placeholder={props.mode === "create"
                ? "メンバーのハンドルをカンマ区切りで入力"
                : "招待するメンバーのハンドルをカンマ区切りで入力"}
              class="w-full p-2 mb-4 rounded bg-[#3c3c3c] text-white placeholder-[#aaaaaa] outline-none border-none"
              value={members()}
              onInput={(e) => setMembers(e.currentTarget.value)}
            />
            <div class="flex justify-end">
              <button
                type="button"
                class="px-3 py-1 rounded bg-[#555] text-white"
                onClick={handleClose}
              >
                キャンセル
              </button>
              <button
                type="submit"
                class="ml-2 px-3 py-1 rounded bg-blue-600 text-white"
              >
                {props.mode === "create" ? "作成" : "招待"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </Show>
  );
}
