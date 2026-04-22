import type { Actor } from "../../types/index.ts";
import { SettingsSectionHeader } from "./SettingsSectionHeader.tsx";

interface SettingsDeleteSectionProps {
  actor: Actor;
  deleteConfirm: string;
  onChangeConfirm: (value: string) => void;
  onDelete: () => void;
  onBack: () => void;
}

export function SettingsDeleteSection(props: SettingsDeleteSectionProps) {
  return (
    <div class="flex flex-col h-full">
      <SettingsSectionHeader
        title="Delete Account"
        accent="danger"
        onBack={props.onBack}
      />
      <div class="p-4 space-y-4">
        <div class="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
          <p class="text-red-400 text-sm">
            This action cannot be undone. All posts, likes, and follows will be
            deleted.
          </p>
        </div>
        <div>
          <label class="block text-sm text-neutral-400 mb-2">
            Enter your username "{props.actor.preferred_username}" to confirm
          </label>
          <input
            type="text"
            value={props.deleteConfirm}
            onInput={(e) => props.onChangeConfirm(e.currentTarget.value)}
            placeholder={props.actor.preferred_username}
            class="w-full bg-neutral-900 rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        <button
          onClick={props.onDelete}
          disabled={props.deleteConfirm !== props.actor.preferred_username}
          class="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-lg font-bold"
        >
          Delete Account
        </button>
      </div>
    </div>
  );
}
