import { Show } from "solid-js";

interface StoryViewerDeleteDialogProps {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function StoryViewerDeleteDialog(props: StoryViewerDeleteDialogProps) {
  return (
    <Show when={props.open}>
      <div class="absolute inset-0 z-30 bg-black/80 flex items-center justify-center">
        <div class="bg-neutral-800 rounded-2xl p-6 max-w-xs mx-4">
          <h3 class="text-white font-semibold text-lg mb-2">
            ストーリーを削除
          </h3>
          <p class="text-neutral-400 text-sm mb-4">
            このストーリーを削除しますか？この操作は元に戻せません。
          </p>
          <div class="flex gap-3">
            <button
              onClick={props.onCancel}
              class="flex-1 px-4 py-2 bg-neutral-700 hover:bg-neutral-600 rounded-lg text-white transition-colors"
            >
              キャンセル
            </button>
            <button
              onClick={props.onConfirm}
              class="flex-1 px-4 py-2 bg-red-500 hover:bg-red-600 rounded-lg text-white transition-colors"
            >
              削除
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
}
