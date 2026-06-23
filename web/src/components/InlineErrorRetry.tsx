interface InlineErrorRetryProps {
  /** Localized error message. */
  message: string;
  /** Localized label for the retry button. */
  retryLabel: string;
  /** Re-trigger the failed load. */
  onRetry: () => void;
}

/**
 * Inline error block shown when a primary list load fails, with a Retry
 * button wired to re-trigger the load. Distinct from InlineErrorBanner,
 * which is a dismissable toast for transient action errors.
 */
export function InlineErrorRetry(props: InlineErrorRetryProps) {
  return (
    <div
      role="alert"
      class="flex flex-col items-center justify-center p-8 text-center min-h-[40vh]"
    >
      <div class="w-16 h-16 mb-4 rounded-full bg-red-500/10 flex items-center justify-center text-red-400">
        <svg
          class="w-8 h-8"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width={1.5}
            d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
          />
        </svg>
      </div>
      <p class="text-neutral-300 text-base font-medium mb-4">{props.message}</p>
      <button
        onClick={() => props.onRetry()}
        class="px-5 py-2 bg-white text-black text-sm font-medium rounded-full hover:bg-neutral-200 transition-colors"
      >
        {props.retryLabel}
      </button>
    </div>
  );
}

export default InlineErrorRetry;
