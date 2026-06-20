import { BackIcon } from "./CommunityIcons.tsx";
import { useI18n } from "../../lib/i18n.tsx";

interface CommunityProfileHeaderProps {
  title: string;
  subtitle: string;
  onBack: () => void;
}

export function CommunityProfileHeader(props: CommunityProfileHeaderProps) {
  const { t } = useI18n();
  return (
    <header class="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
      <div class="flex items-center gap-4 px-4 py-3">
        <button
          onClick={props.onBack}
          aria-label={t("common.back")}
          class="p-2 -ml-2 hover:bg-neutral-900 rounded-full"
        >
          <BackIcon />
        </button>
        <div>
          <h1 class="text-xl font-bold">{props.title}</h1>
          <p class="text-sm text-neutral-500">{props.subtitle}</p>
        </div>
      </div>
    </header>
  );
}
