import { Show } from "solid-js";
import { Portal } from "solid-js/web";
import { useI18n } from "../lib/i18n.tsx";
import { useDialog } from "../lib/useDialog.ts";

interface ConfirmSheetProps {
  open: boolean;
  title: string;
  body?: string;
  // Defaults to the shared confirm/cancel labels when omitted.
  confirmLabel?: string;
  cancelLabel?: string;
  // Red destructive styling for delete/remove flows.
  destructive?: boolean;
  // Disables the confirm button (e.g. while the action is in flight).
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared confirmation surface. Renders as a centered card on desktop and a
 * bottom sheet on mobile. Dark-only; the destructive variant tints the confirm
 * button red. Backdrop click and the cancel button both dismiss.
 */
export function ConfirmSheet(props: ConfirmSheetProps) {
  const { t } = useI18n();
  let dialogRef: HTMLDivElement | undefined;

  useDialog({
    isOpen: () => props.open,
    onClose: () => props.onCancel(),
    container: () => dialogRef,
  });

  return (
    <Show when={props.open}>
      <Portal>
        <div
          class="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) props.onCancel();
          }}
        >
          <div
            ref={dialogRef}
            role="alertdialog"
            aria-modal="true"
            aria-label={props.title}
            class="w-full max-w-sm rounded-t-2xl border border-neutral-800 bg-neutral-900 p-5 shadow-2xl sm:rounded-2xl"
          >
            <h2 class="text-base font-bold text-white">{props.title}</h2>
            <Show when={props.body}>
              <p class="mt-2 text-sm text-neutral-400">{props.body}</p>
            </Show>
            <div class="mt-5 flex gap-2">
              <button
                type="button"
                onClick={props.onCancel}
                class="flex-1 rounded-full bg-neutral-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-700"
              >
                {props.cancelLabel ?? t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={props.onConfirm}
                disabled={props.busy}
                class={`flex-1 rounded-full px-4 py-2.5 text-sm font-bold text-white transition-colors disabled:opacity-50 ${
                  props.destructive
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-[var(--accent)] hover:brightness-110"
                }`}
              >
                {props.confirmLabel ?? t("common.confirm")}
              </button>
            </div>
          </div>
        </div>
      </Portal>
    </Show>
  );
}
