import {
  createContext,
  createSignal,
  JSX,
  ParentProps,
  useContext,
} from "solid-js";

type ToastType = "info" | "success" | "warning" | "error";

export type Toast = {
  id: number;
  title?: string;
  description?: string;
  type?: ToastType;
  duration?: number; // ms
};

type ToastContextValue = {
  toasts: () => Toast[];
  show: (t: Omit<Toast, "id">) => number;
  dismiss: (id: number) => void;
  clear: () => void;
};

const ToastContext = createContext<ToastContextValue>();

export function ToastProvider(props: ParentProps) {
  const [toasts, setToasts] = createSignal<Toast[]>([]);
  let counter = 0;

  const dismiss = (id: number) =>
    setToasts((list) => list.filter((t) => t.id !== id));
  const clear = () => setToasts([]);
  const show = (t: Omit<Toast, "id">) => {
    const id = ++counter;
    const toast: Toast = { id, duration: 3500, type: "info", ...t };
    setToasts((list) => [toast, ...list].slice(0, 5));
    if (toast.duration && toast.duration > 0) {
      setTimeout(() => dismiss(id), toast.duration);
    }
    return id;
  };

  // グローバルイベントで通知を受け付ける（例: fetchの失敗など）
  globalThis.addEventListener("app:toast", (e) => {
    const detail = (e as CustomEvent).detail as Omit<Toast, "id"> | undefined;
    if (detail) show(detail);
  });

  return (
    <ToastContext.Provider value={{ toasts, show, dismiss, clear }}>
      {props.children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

function typeClasses(type?: ToastType) {
  switch (type) {
    case "success":
      return "border-emerald-500/60 bg-emerald-900/40 text-emerald-200";
    case "warning":
      return "border-amber-500/60 bg-amber-900/40 text-amber-100";
    case "error":
      return "border-rose-500/60 bg-rose-900/40 text-rose-100";
    default:
      return "border-cyan-500/50 bg-cyan-900/35 text-cyan-100";
  }
}

export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      class="pointer-events-none fixed inset-0 z-[1000] flex flex-col items-end gap-3 p-4 sm:p-6"
    >
      {toasts().map((t) => (
        <div
          role="status"
          class={`pointer-events-auto w-full max-w-sm rounded-md border px-4 py-3 shadow-lg backdrop-blur-md ${
            typeClasses(t.type)
          } animate-[fadeIn_.2s_ease]`}
        >
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              {t.title && (
                <p class="text-sm font-semibold leading-5 truncate">
                  {t.title}
                </p>
              )}
              {t.description && (
                <p class="mt-0.5 text-sm leading-6 text-gray-200/90 break-words">
                  {t.description}
                </p>
              )}
            </div>
            <button
              type="button"
              aria-label="閉じる"
              class="-m-1.5 rounded p-1.5 text-gray-200/80 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
              onClick={() => dismiss(t.id)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path
                  d="M6 6l12 12M18 6L6 18"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                />
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default Toaster;
