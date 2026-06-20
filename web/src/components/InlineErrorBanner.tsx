import { useI18n } from "../lib/i18n.tsx";

interface InlineErrorBannerProps {
  message: string;
  onClose: () => void;
}

export function InlineErrorBanner(props: InlineErrorBannerProps) {
  const { t } = useI18n();
  return (
    <div class="mx-4 my-3 flex items-start justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
      <span>{props.message}</span>
      <button
        onClick={props.onClose}
        aria-label={t("common.close")}
        class="text-red-200/70 hover:text-red-200"
      >
        x
      </button>
    </div>
  );
}
