import { createSignal, For } from "solid-js";
import { createContext, useContext } from "solid-js";
import type { ParentComponent } from "solid-js";

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  showSuccess: (message: string, duration?: number) => void;
  showError: (message: string, duration?: number) => void;
  showInfo: (message: string, duration?: number) => void;
  showWarning: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue>();

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
};

export const ToastProvider: ParentComponent = (props) => {
  const [toasts, setToasts] = createSignal<Toast[]>([]);

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const showToast = (
    message: string,
    type: ToastType = "info",
    duration: number = 3000,
  ) => {
    const id = `toast-${Date.now()}-${Math.random()}`;
    const toast: Toast = { id, message, type, duration };
    setToasts((prev) => [...prev, toast]);

    if (duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  };

  const value: ToastContextValue = {
    showToast,
    showSuccess: (msg, duration) => showToast(msg, "success", duration),
    showError: (msg, duration) => showToast(msg, "error", duration),
    showInfo: (msg, duration) => showToast(msg, "info", duration),
    showWarning: (msg, duration) => showToast(msg, "warning", duration),
  };

  return (
    <ToastContext.Provider value={value}>
      {props.children}
      <ToastContainer toasts={toasts()} onRemove={removeToast} />
    </ToastContext.Provider>
  );
};

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

const ToastContainer = (props: ToastContainerProps) => {
  return (
    <div
      style={{
        position: "fixed",
        top: "1rem",
        right: "1rem",
        "z-index": "9999",
        display: "flex",
        "flex-direction": "column",
        gap: "0.5rem",
        "max-width": "400px",
      }}
    >
      <For each={props.toasts}>
        {(toast) => <ToastItem toast={toast} onRemove={props.onRemove} />}
      </For>
    </div>
  );
};

interface ToastItemProps {
  toast: Toast;
  onRemove: (id: string) => void;
}

const ToastItem = (props: ToastItemProps) => {
  const [visible, setVisible] = createSignal(false);

  // Trigger animation after mount
  setTimeout(() => setVisible(true), 10);

  const handleClose = () => {
    setVisible(false);
    setTimeout(() => props.onRemove(props.toast.id), 300);
  };

  const getBackgroundColor = () => {
    switch (props.toast.type) {
      case "success":
        return "#10b981";
      case "error":
        return "#ef4444";
      case "warning":
        return "#f59e0b";
      case "info":
      default:
        return "#3b82f6";
    }
  };

  return (
    <div
      style={{
        background: getBackgroundColor(),
        color: "white",
        padding: "0.75rem 1rem",
        "border-radius": "0.5rem",
        "box-shadow": "0 4px 6px rgba(0, 0, 0, 0.1)",
        display: "flex",
        "align-items": "center",
        gap: "0.75rem",
        "min-width": "250px",
        transform: visible() ? "translateX(0)" : "translateX(100%)",
        opacity: visible() ? "1" : "0",
        transition: "all 0.3s ease",
      }}
    >
      <div style={{ flex: "1", "word-break": "break-word" }}>
        {props.toast.message}
      </div>
      <button
        onClick={handleClose}
        style={{
          background: "transparent",
          border: "none",
          color: "white",
          cursor: "pointer",
          "font-size": "1.25rem",
          "line-height": "1",
          padding: "0",
          opacity: "0.7",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
        onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.7")}
      >
        ×
      </button>
    </div>
  );
};
