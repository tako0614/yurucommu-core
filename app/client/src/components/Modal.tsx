import { JSX } from "solid-js";

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: JSX.Element;
}

export function Modal(props: ModalProps) {
  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      props.onClose();
    }
  };

  return (
    <div
      class={`fixed inset-0 z-50 flex items-center justify-center ${
        props.isOpen ? "block" : "hidden"
      }`}
    >
      {/* 背景オーバーレイ */}
      <div
        class="absolute inset-0 bg-black bg-opacity-50 backdrop-blur-sm"
        onClick={handleBackdropClick}
      />
      
      {/* モーダルコンテンツ */}
      <div class="relative bg-[#1a1a1a] rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-[#333]">
        {/* ヘッダー */}
        <div class="flex items-center justify-between p-6 border-b border-[#333]">
          <h2 class="text-xl font-bold text-white">{props.title}</h2>
          <button
            type="button"
            onClick={props.onClose}
            class="text-gray-400 hover:text-white transition-colors"
          >
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        {/* コンテンツ */}
        <div class="p-6">
          {props.children}
        </div>
      </div>
    </div>
  );
}
