import { createSignal, Show } from "solid-js";
import { atom } from "solid-jotai";

// 確認モーダルの状態管理
export const pasteImageDataAtom = atom<File | null>(null);
export const pasteImagePreviewAtom = atom<string | null>(null);
export const showPasteConfirmAtom = atom<boolean>(false);

interface ImagePasteConfirmModalProps {
  isOpen: boolean;
  imagePreview: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const ImagePasteConfirmModal = (props: ImagePasteConfirmModalProps) => {
  return (
    <Show when={props.isOpen && props.imagePreview}>
      <div class="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
        <div class="bg-[#333] p-6 rounded-lg shadow-lg max-w-md w-full">
          <h3 class="text-xl mb-3">画像を送信しますか？</h3>

          <div class="my-4 flex justify-center">
            <img
              src={props.imagePreview!}
              alt="プレビュー"
              class="max-h-60 max-w-full rounded-md object-contain bg-[#222]"
            />
          </div>

          <div class="flex justify-end space-x-3 mt-4">
            <button
              class="px-4 py-2 bg-gray-600 hover:bg-gray-700 rounded-md"
              onClick={props.onCancel}
            >
              キャンセル
            </button>
            <button
              class="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-md"
              onClick={props.onConfirm}
            >
              送信
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default ImagePasteConfirmModal;
