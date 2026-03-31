interface InlineErrorBannerProps {
  message: string;
  onClose: () => void;
}

export function InlineErrorBanner(props: InlineErrorBannerProps) {
  return (
    <div class="mx-4 my-3 flex items-start justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      <span>{props.message}</span>
      <button
        onClick={props.onClose}
        aria-label="Dismiss error"
        class="text-red-200/70 hover:text-red-200"
      >
        x
      </button>
    </div>
  );
}
