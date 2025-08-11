import { Show } from "solid-js";

interface FriendDmDialogProps {
  isOpen: boolean;
  friendName: string;
  onClose: () => void;
  onCreate: () => void;
}

export function FriendDmDialog(props: FriendDmDialogProps) {
  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80">
        <div class="bg-[#1e1e1e] rounded-lg w-80 p-4">
          <h2 class="text-white text-lg font-bold mb-2">
            {props.friendName}との新しいトーク
          </h2>
          <p class="text-gray-300 text-sm mb-4">
            2人だけのトークルームを作成しますか？
          </p>
          <div class="flex justify-end gap-2">
            <button
              type="button"
              class="px-3 py-1 rounded bg-[#555] text-white text-sm hover:bg-[#666]"
              onClick={props.onClose}
            >
              キャンセル
            </button>
            <button
              type="button"
              class="px-3 py-1 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
              onClick={props.onCreate}
            >
              作成
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
