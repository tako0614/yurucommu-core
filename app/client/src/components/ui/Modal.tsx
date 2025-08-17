import { JSX, onCleanup, onMount, Show } from "solid-js";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
}

// 全画面表示のモーダルコンポーネント
export function Modal(props: ModalProps) {
  let dialogRef: HTMLDivElement | undefined;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") props.onClose();
  };

  onMount(() => {
    document.addEventListener("keydown", onKeyDown);
  });

  onCleanup(() => {
    document.removeEventListener("keydown", onKeyDown);
  });

  return (
    <Show when={props.open}>
      <div
        ref={dialogRef}
        class="fixed inset-0 z-[10000] p-5 overflow-auto"
        style="background: var(--color-elevated)"
        role="dialog"
        aria-modal="true"
        aria-label={props.title ?? "ダイアログ"}
      >
        <button
          type="button"
          class="absolute top-4 right-4 text-2xl"
          aria-label="閉じる"
          onClick={props.onClose}
        >
          ×
        </button>
        {props.title && (
          <h2 class="text-xl font-semibold mb-3">{props.title}</h2>
        )}
        <div class="overflow-auto flex">
          {props.children}
        </div>
      </div>
    </Show>
  );
}

export default Modal;
