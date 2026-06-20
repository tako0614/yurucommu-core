import { ErrorBoundary as SolidErrorBoundary, Show } from "solid-js";
import type { JSX } from "solid-js";

interface AppErrorBoundaryProps {
  children: JSX.Element;
  fallback?: JSX.Element;
}

/**
 * Error Boundary component to catch and handle errors gracefully
 * Prevents the entire app from crashing when a component throws an error
 */
export function ErrorBoundary(props: AppErrorBoundaryProps) {
  const isDev = Boolean(
    (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV,
  );

  return (
    <SolidErrorBoundary
      fallback={(err, reset) => {
        if (props.fallback) {
          return props.fallback;
        }

        const error = err instanceof Error ? err : new Error(String(err));
        console.error("ErrorBoundary caught an error:", error);

        const handleReload = (): void => {
          window.location.reload();
        };

        return (
          <div class="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
            <div class="max-w-md w-full bg-neutral-900 rounded-xl p-6 text-center">
              <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/10 flex items-center justify-center">
                <svg
                  class="w-8 h-8 text-red-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              </div>

              <h1 class="text-xl font-bold text-white mb-2">
                Something went wrong
              </h1>
              <p class="text-neutral-400 mb-6">
                An unexpected error occurred. Please try again.
              </p>

              {/* Show error message in development */}
              <Show when={isDev && error}>
                <div class="mb-6 p-3 bg-neutral-800 rounded-lg text-left">
                  <p class="text-xs text-neutral-500 mb-1">Error details:</p>
                  <p class="text-sm text-red-400 font-mono break-all">
                    {error.message}
                  </p>
                </div>
              </Show>

              <div class="flex gap-3 justify-center">
                <button
                  onClick={reset}
                  class="px-4 py-2 bg-neutral-800 text-white rounded-lg hover:bg-neutral-700 transition-colors"
                >
                  Try again
                </button>
                <button
                  onClick={handleReload}
                  class="px-4 py-2 bg-accent text-white rounded-lg transition-colors"
                >
                  Reload page
                </button>
              </div>
            </div>
          </div>
        );
      }}
    >
      {props.children}
    </SolidErrorBoundary>
  );
}
