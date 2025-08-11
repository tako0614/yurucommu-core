import { JSX, onCleanup, onMount, Show, splitProps } from "solid-js";

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: JSX.Element;
}

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

  const onBackdrop = (e: MouseEvent) => {
    if (e.target === dialogRef) props.onClose();
  };

  return (
    <Show when={props.open}>
      <div
        ref={dialogRef}
        class="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={props.title ?? "ダイアログ"}
        onMouseDown={onBackdrop}
      >
        <div class="surface w-full max-w-lg p-5" role="document">
          {props.title && (
            <h2 class="text-xl font-semibold mb-3">{props.title}</h2>
          )}
          {props.children}
        </div>
      </div>
    </Show>
  );
}

export default Modal;

