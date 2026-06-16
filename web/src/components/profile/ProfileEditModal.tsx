import { Show } from "solid-js";
import { CloseIcon } from "./ProfileIcons.tsx";
import type { Translate } from "../../lib/i18n.tsx";

interface ProfileEditModalProps {
  isOpen: boolean;
  editName: string;
  editSummary: string;
  editIsPrivate: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onChangeName: (
    event: InputEvent & { currentTarget: HTMLInputElement },
  ) => void;
  onChangeSummary: (
    event: InputEvent & { currentTarget: HTMLTextAreaElement },
  ) => void;
  onTogglePrivate: () => void;
  t: Translate;
}

export function ProfileEditModal(props: ProfileEditModalProps) {
  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-edit-title"
          class="bg-neutral-900 rounded-2xl w-full max-w-md"
        >
          <div class="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
            <div class="flex items-center gap-4">
              <button
                onClick={props.onClose}
                aria-label="Close"
                class="p-1 hover:bg-neutral-800 rounded-full transition-colors"
              >
                <CloseIcon />
              </button>
              <h2 id="profile-edit-title" class="text-lg font-bold">
                {props.t("profile.editProfile")}
              </h2>
            </div>
            <button
              onClick={props.onSave}
              disabled={props.saving}
              class="px-4 py-1.5 bg-white text-black rounded-full font-bold text-sm hover:bg-neutral-200 disabled:bg-neutral-600 transition-colors"
            >
              {props.saving
                ? props.t("common.loading")
                : props.t("common.save")}
            </button>
          </div>
          <div class="p-4 space-y-4">
            <div>
              <label
                for="profile-edit-name"
                class="block text-sm text-neutral-400 mb-1"
              >
                Name
              </label>
              <input
                id="profile-edit-name"
                type="text"
                value={props.editName}
                onInput={props.onChangeName}
                placeholder="Display name"
                class="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label
                for="profile-edit-bio"
                class="block text-sm text-neutral-400 mb-1"
              >
                Bio
              </label>
              <textarea
                id="profile-edit-bio"
                value={props.editSummary}
                onInput={props.onChangeSummary}
                placeholder="Tell us about yourself"
                rows={4}
                class="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
            </div>
            <div class="flex items-center justify-between py-2">
              <div>
                <div class="text-white font-medium">
                  {props.t("profile.followApproval")}
                </div>
                <div class="text-sm text-neutral-400">
                  {props.t("profile.followApprovalDesc")}
                </div>
              </div>
              <button
                type="button"
                onClick={props.onTogglePrivate}
                class={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  props.editIsPrivate ? "bg-blue-500" : "bg-neutral-600"
                }`}
              >
                <span
                  class={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    props.editIsPrivate ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </Show>
  );
}
