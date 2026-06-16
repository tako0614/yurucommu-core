import { BackIcon } from "./SettingsIcons.tsx";
import { useI18n } from "../../lib/i18n.tsx";

interface SettingsSectionHeaderProps {
  title: string;
  onBack: () => void;
  accent?: "danger";
}

export function SettingsSectionHeader(props: SettingsSectionHeaderProps) {
  const { t } = useI18n();
  const titleClass = () => (props.accent === "danger" ? "text-red-500" : "");

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
        <h1 class={`text-xl font-bold ${titleClass()}`}>{props.title}</h1>
      </div>
    </header>
  );
}
