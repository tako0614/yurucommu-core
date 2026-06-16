import { createEffect, For, onCleanup } from "solid-js";
import { Portal } from "solid-js/web";
import { useAtomValue, useSetAtom } from "solid-jotai";
import {
  dismissToast,
  type Toast,
  type ToastKind,
  toastsAtom,
} from "../atoms/toast.ts";
import { useI18n } from "../lib/i18n.tsx";

// Per-kind styling. Dark-only; uses the shared --accent for the info/neutral
// frame and semantic red/green for error/success.
const KIND_CLASS: Record<ToastKind, string> = {
  success: "border-green-500/40 bg-green-500/10 text-green-200",
  error: "border-red-500/40 bg-red-500/10 text-red-200",
  info: "border-neutral-700 bg-neutral-900 text-neutral-100",
};

function KindIcon(props: { kind: ToastKind }) {
  return (
    <svg
      class="mt-0.5 h-4 w-4 shrink-0"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width={2}
      aria-hidden="true"
    >
      {props.kind === "success" ? (
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
      ) : props.kind === "error" ? (
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 9v4m0 4h.01M10.3 3.86l-8.5 14.7A1.5 1.5 0 003.1 21h17.8a1.5 1.5 0 001.3-2.44l-8.5-14.7a1.5 1.5 0 00-2.6 0z"
        />
      ) : (
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
        />
      )}
    </svg>
  );
}

function ToastItem(props: { toast: Toast }) {
  const { t } = useI18n();
  const setToasts = useSetAtom(toastsAtom);

  // Auto-dismiss after the per-toast timeout (0 = sticky).
  createEffect(() => {
    const ms = props.toast.timeout;
    if (ms <= 0) return;
    const id = props.toast.id;
    const handle = setTimeout(() => dismissToast(setToasts, id), ms);
    onCleanup(() => clearTimeout(handle));
  });

  return (
    <div
      role={props.toast.kind === "error" ? "alert" : "status"}
      class={`pointer-events-auto flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm shadow-xl backdrop-blur ${
        KIND_CLASS[props.toast.kind]
      }`}
    >
      <KindIcon kind={props.toast.kind} />
      <span class="min-w-0 flex-1 break-words">{props.toast.message}</span>
      <button
        type="button"
        onClick={() => dismissToast(setToasts, props.toast.id)}
        aria-label={t("common.close")}
        class="-mr-1 shrink-0 text-current/70 hover:text-current"
      >
        <svg
          class="h-4 w-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width={2}
          aria-hidden="true"
        >
          <path stroke-linecap="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Single mount point for the global toast stack. Lives in AppLayout. Positioned
 * bottom-center on mobile (clear of the BottomNav) and bottom-right on desktop.
 * aria-live="polite" announces new messages without stealing focus.
 */
export function ToastLayer() {
  const toasts = useAtomValue(toastsAtom);

  return (
    <Portal>
      <div
        aria-live="polite"
        class="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 md:inset-x-auto md:bottom-6 md:right-6 md:items-end"
      >
        <For each={toasts()}>{(toast) => <ToastItem toast={toast} />}</For>
      </div>
    </Portal>
  );
}
