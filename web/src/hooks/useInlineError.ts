import { createSignal } from "solid-js";

export function useInlineError() {
  const [error, setError] = createSignal<string | null>(null);

  const clearError = () => {
    setError(null);
  };

  return { error, setError, clearError };
}
