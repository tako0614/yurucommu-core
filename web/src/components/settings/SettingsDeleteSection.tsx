import type { Actor } from "../../types/index.ts";
import type { Translate } from "../../lib/i18n.tsx";
import { SettingsSectionHeader } from "./SettingsSectionHeader.tsx";

interface SettingsDeleteSectionProps {
  actor: Actor;
  deleteConfirm: string;
  // True while the delete request is in flight.
  deleting?: boolean;
  onChangeConfirm: (value: string) => void;
  onDelete: () => void;
  onBack: () => void;
  t: Translate;
}

export function SettingsDeleteSection(props: SettingsDeleteSectionProps) {
  return (
    <div class="flex flex-col h-full">
      <SettingsSectionHeader
        title={props.t("settings.deleteAccountButton")}
        accent="danger"
        onBack={props.onBack}
      />
      <div class="p-4 space-y-4">
        <div class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p class="text-red-400 text-sm">
            {props.t("settings.deleteAccountWarning")}
          </p>
        </div>
        <div>
          <label class="block text-sm text-neutral-400 mb-2">
            {props
              .t("settings.deleteAccountConfirmLabel")
              .replace("{username}", props.actor.preferred_username)}
          </label>
          <input
            type="text"
            value={props.deleteConfirm}
            onInput={(e) => props.onChangeConfirm(e.currentTarget.value)}
            placeholder={props.t("settings.deleteAccountConfirmPlaceholder")}
            class="w-full bg-neutral-900 rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        <button
          onClick={props.onDelete}
          disabled={
            props.deleting ||
            props.deleteConfirm !== props.actor.preferred_username
          }
          class="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-lg font-bold"
        >
          {props.deleting
            ? props.t("settings.deletingAccount")
            : props.t("settings.deleteAccountButton")}
        </button>
      </div>
    </div>
  );
}
