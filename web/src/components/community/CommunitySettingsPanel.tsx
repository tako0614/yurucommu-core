import { Show } from "solid-js";
import type { CommunityDetail, CommunitySettings } from "../../lib/api.ts";
import { useI18n } from "../../lib/i18n.tsx";

interface CommunitySettingsPanelProps {
  community: CommunityDetail;
  settingsForm: CommunitySettings;
  settingsError: string | null;
  savingSettings: boolean;
  uploadingIcon: boolean;
  iconPreview: string | null;
  onChangeSettings: (
    updater: (prev: CommunitySettings) => CommunitySettings,
  ) => void;
  onUploadIcon: (event: Event & { currentTarget: HTMLInputElement }) => void;
  onSaveSettings: () => void;
}

export function CommunitySettingsPanel(props: CommunitySettingsPanelProps) {
  const { t } = useI18n();
  return (
    <div class="p-4 space-y-6">
      <Show when={props.settingsError}>
        <div class="p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-400 text-sm">
          {props.settingsError}
        </div>
      </Show>

      {/* Icon Upload */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          {t("community.icon")}
        </label>
        <div class="flex items-center gap-4">
          <div class="w-20 h-20 rounded-xl overflow-hidden bg-neutral-800 flex items-center justify-center">
            <Show
              when={props.iconPreview || props.community.icon_url}
              fallback={
                <span class="text-2xl font-bold text-white">
                  {(props.community.display_name || props.community.name)
                    .charAt(0)
                    .toUpperCase()}
                </span>
              }
            >
              <img
                src={props.iconPreview || props.community.icon_url || ""}
                alt=""
                class="w-full h-full object-cover"
              />
            </Show>
          </div>
          <label class="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg cursor-pointer transition-colors">
            {props.uploadingIcon
              ? t("common.uploading")
              : t("community.selectImage")}
            <input
              type="file"
              accept="image/*"
              onChange={props.onUploadIcon}
              disabled={props.uploadingIcon}
              class="hidden"
            />
          </label>
        </div>
      </div>

      {/* Display Name */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          {t("settings.displayName")}
        </label>
        <input
          type="text"
          value={props.settingsForm.display_name || ""}
          onInput={(e) =>
            props.onChangeSettings((prev) => ({
              ...prev,
              display_name: e.currentTarget.value,
            }))
          }
          class="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-[var(--accent)] focus:outline-none"
          placeholder={t("community.displayNamePlaceholder")}
        />
      </div>

      {/* Summary */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          {t("groups.description")}
        </label>
        <textarea
          value={props.settingsForm.summary || ""}
          onInput={(e) =>
            props.onChangeSettings((prev) => ({
              ...prev,
              summary: e.currentTarget.value,
            }))
          }
          rows={4}
          class="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-[var(--accent)] focus:outline-none resize-none"
          placeholder={t("groups.descriptionPlaceholder")}
        />
      </div>

      {/* Visibility */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          {t("community.visibility")}
        </label>
        <div class="space-y-2">
          <label class="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="visibility"
              checked={props.settingsForm.visibility === "public"}
              onChange={() =>
                props.onChangeSettings((prev) => ({
                  ...prev,
                  visibility: "public",
                }))
              }
              class="w-4 h-4 text-accent"
            />
            <div>
              <div class="text-white font-medium">{t("community.public")}</div>
              <div class="text-sm text-neutral-500">
                {t("community.publicDesc")}
              </div>
            </div>
          </label>
          <label class="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="visibility"
              checked={props.settingsForm.visibility === "private"}
              onChange={() =>
                props.onChangeSettings((prev) => ({
                  ...prev,
                  visibility: "private",
                }))
              }
              class="w-4 h-4 text-accent"
            />
            <div>
              <div class="text-white font-medium">{t("community.private")}</div>
              <div class="text-sm text-neutral-500">
                {t("community.privateDesc")}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Join Policy */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          {t("community.joinPolicy")}
        </label>
        <div class="space-y-2">
          <label class="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="join_policy"
              checked={props.settingsForm.join_policy === "open"}
              onChange={() =>
                props.onChangeSettings((prev) => ({
                  ...prev,
                  join_policy: "open",
                }))
              }
              class="w-4 h-4 text-accent"
            />
            <div>
              <div class="text-white font-medium">
                {t("community.joinOpen")}
              </div>
              <div class="text-sm text-neutral-500">
                {t("community.joinOpenDesc")}
              </div>
            </div>
          </label>
          <label class="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="join_policy"
              checked={props.settingsForm.join_policy === "approval"}
              onChange={() =>
                props.onChangeSettings((prev) => ({
                  ...prev,
                  join_policy: "approval",
                }))
              }
              class="w-4 h-4 text-accent"
            />
            <div>
              <div class="text-white font-medium">
                {t("community.joinApproval")}
              </div>
              <div class="text-sm text-neutral-500">
                {t("community.joinApprovalDesc")}
              </div>
            </div>
          </label>
          <label class="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="join_policy"
              checked={props.settingsForm.join_policy === "invite"}
              onChange={() =>
                props.onChangeSettings((prev) => ({
                  ...prev,
                  join_policy: "invite",
                }))
              }
              class="w-4 h-4 text-accent"
            />
            <div>
              <div class="text-white font-medium">
                {t("community.joinInvite")}
              </div>
              <div class="text-sm text-neutral-500">
                {t("community.joinInviteDesc")}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Post Policy */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          {t("community.postPolicy")}
        </label>
        <div class="space-y-2">
          <label class="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="post_policy"
              checked={props.settingsForm.post_policy === "anyone"}
              onChange={() =>
                props.onChangeSettings((prev) => ({
                  ...prev,
                  post_policy: "anyone",
                }))
              }
              class="w-4 h-4 text-accent"
            />
            <div>
              <div class="text-white font-medium">
                {t("community.postAnyone")}
              </div>
              <div class="text-sm text-neutral-500">
                {t("community.postAnyoneDesc")}
              </div>
            </div>
          </label>
          <label class="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="post_policy"
              checked={props.settingsForm.post_policy === "members"}
              onChange={() =>
                props.onChangeSettings((prev) => ({
                  ...prev,
                  post_policy: "members",
                }))
              }
              class="w-4 h-4 text-accent"
            />
            <div>
              <div class="text-white font-medium">
                {t("community.postMembers")}
              </div>
              <div class="text-sm text-neutral-500">
                {t("community.postMembersDesc")}
              </div>
            </div>
          </label>
          <label class="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="post_policy"
              checked={props.settingsForm.post_policy === "mods"}
              onChange={() =>
                props.onChangeSettings((prev) => ({
                  ...prev,
                  post_policy: "mods",
                }))
              }
              class="w-4 h-4 text-accent"
            />
            <div>
              <div class="text-white font-medium">
                {t("community.postModerators")}
              </div>
              <div class="text-sm text-neutral-500">
                {t("community.postModeratorsDesc")}
              </div>
            </div>
          </label>
          <label class="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="post_policy"
              checked={props.settingsForm.post_policy === "owners"}
              onChange={() =>
                props.onChangeSettings((prev) => ({
                  ...prev,
                  post_policy: "owners",
                }))
              }
              class="w-4 h-4 text-accent"
            />
            <div>
              <div class="text-white font-medium">
                {t("community.postOwner")}
              </div>
              <div class="text-sm text-neutral-500">
                {t("community.postOwnerDesc")}
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Save Button */}
      <div class="pt-4">
        <button
          onClick={props.onSaveSettings}
          disabled={props.savingSettings}
          class="w-full px-6 py-3 bg-accent text-white rounded-full font-bold transition-colors disabled:opacity-50"
        >
          {props.savingSettings
            ? t("common.saving")
            : t("community.saveSettings")}
        </button>
      </div>
    </div>
  );
}
