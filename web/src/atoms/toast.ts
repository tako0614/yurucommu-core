import { atom } from "jotai";

export type ToastKind = "success" | "error" | "info";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  // Auto-dismiss delay in ms. 0 keeps the toast until dismissed manually.
  timeout: number;
}

// Live stack of transient feedback messages. Rendered once by <ToastLayer>
// mounted in AppLayout; any code with a jotai setter can push to it.
export const toastsAtom = atom<Toast[]>([]);

export interface PushToastOptions {
  kind?: ToastKind;
  // 0 disables auto-dismiss. Errors default to a longer dwell than successes.
  timeout?: number;
}

const DEFAULT_TIMEOUTS: Record<ToastKind, number> = {
  success: 3000,
  info: 3500,
  error: 5000,
};

let nextToastId = 0;

/**
 * A writer already bound to the toasts atom — exactly the shape returned by
 * solid-jotai's `useSetAtom(toastsAtom)`. Inside a jotai action atom, wrap the
 * writable `set` with {@link toastWriter} to get the same shape.
 */
export type ToastWriter = (
  update: Toast[] | ((prev: Toast[]) => Toast[]),
) => void;

/**
 * Adapt a jotai action-atom `set` into a {@link ToastWriter} bound to the
 * toasts atom. Use from inside `atom(null, (get, set) => ...)`.
 */
export function toastWriter(
  set: (
    atom: typeof toastsAtom,
    update: Toast[] | ((prev: Toast[]) => Toast[]),
  ) => void,
): ToastWriter {
  return (update) => set(toastsAtom, update);
}

/**
 * Push a toast onto the shared stack.
 *
 * - From a component: pass `useSetAtom(toastsAtom)` directly.
 * - From a jotai action atom: pass `toastWriter(set)`.
 *
 * Returns the toast id so callers can dismiss it early if needed.
 */
export function pushToast(
  write: ToastWriter,
  message: string,
  options: PushToastOptions = {},
): number {
  const kind = options.kind ?? "info";
  const timeout = options.timeout ?? DEFAULT_TIMEOUTS[kind];
  const id = ++nextToastId;
  const toast: Toast = { id, kind, message, timeout };
  write((prev) => {
    // Bound the visible stack so a burst of failures can't pile up off-screen.
    const next = [...prev, toast];
    return next.length > 4 ? next.slice(next.length - 4) : next;
  });
  return id;
}

/** Remove a toast by id (used by auto-dismiss timers and manual close). */
export function dismissToast(write: ToastWriter, id: number): void {
  write((prev) => prev.filter((toast) => toast.id !== id));
}
