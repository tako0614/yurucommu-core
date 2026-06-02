import { Show } from "solid-js";
import type { CommunityDetail, CommunitySettings } from "../../lib/api.ts";

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
          アイコン
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
            {props.uploadingIcon ? "アップロード中..." : "画像を選択"}
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
          表示名
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
          class="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
          placeholder="グループの表示名"
        />
      </div>

      {/* Summary */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          説明
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
          class="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none resize-none"
          placeholder="グループの説明"
        />
      </div>

      {/* Visibility */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          公開範囲
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
              class="w-4 h-4 text-blue-500"
            />
            <div>
              <div class="text-white font-medium">公開</div>
              <div class="text-sm text-neutral-500">
                誰でもグループを見つけて閲覧できます
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
              class="w-4 h-4 text-blue-500"
            />
            <div>
              <div class="text-white font-medium">非公開</div>
              <div class="text-sm text-neutral-500">
                メンバーのみがグループの内容を閲覧できます
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Join Policy */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          参加ポリシー
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
              class="w-4 h-4 text-blue-500"
            />
            <div>
              <div class="text-white font-medium">オープン</div>
              <div class="text-sm text-neutral-500">誰でも参加できます</div>
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
              class="w-4 h-4 text-blue-500"
            />
            <div>
              <div class="text-white font-medium">承認制</div>
              <div class="text-sm text-neutral-500">
                参加にはオーナーまたはモデレーターの承認が必要です
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
              class="w-4 h-4 text-blue-500"
            />
            <div>
              <div class="text-white font-medium">招待制</div>
              <div class="text-sm text-neutral-500">
                招待コードがないと参加できません
              </div>
            </div>
          </label>
        </div>
      </div>

      {/* Post Policy */}
      <div>
        <label class="block text-sm font-semibold text-neutral-300 mb-2">
          投稿ポリシー
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
              class="w-4 h-4 text-blue-500"
            />
            <div>
              <div class="text-white font-medium">誰でも</div>
              <div class="text-sm text-neutral-500">誰でも投稿できます</div>
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
              class="w-4 h-4 text-blue-500"
            />
            <div>
              <div class="text-white font-medium">メンバーのみ</div>
              <div class="text-sm text-neutral-500">
                グループメンバーのみが投稿できます
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
              class="w-4 h-4 text-blue-500"
            />
            <div>
              <div class="text-white font-medium">モデレーター以上</div>
              <div class="text-sm text-neutral-500">
                モデレーターとオーナーのみが投稿できます
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
              class="w-4 h-4 text-blue-500"
            />
            <div>
              <div class="text-white font-medium">オーナーのみ</div>
              <div class="text-sm text-neutral-500">
                オーナーのみが投稿できます
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
          class="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors disabled:opacity-50"
        >
          {props.savingSettings ? "保存中..." : "設定を保存"}
        </button>
      </div>
    </div>
  );
}
