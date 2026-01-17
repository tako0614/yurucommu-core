import type { ChangeEvent } from 'react';
import type { CommunityDetail, CommunitySettings } from '../../lib/api';

interface CommunitySettingsPanelProps {
  community: CommunityDetail;
  settingsForm: CommunitySettings;
  settingsError: string | null;
  savingSettings: boolean;
  uploadingIcon: boolean;
  iconPreview: string | null;
  onChangeSettings: (updater: (prev: CommunitySettings) => CommunitySettings) => void;
  onUploadIcon: (event: ChangeEvent<HTMLInputElement>) => void;
  onSaveSettings: () => void;
}

export function CommunitySettingsPanel({
  community,
  settingsForm,
  settingsError,
  savingSettings,
  uploadingIcon,
  iconPreview,
  onChangeSettings,
  onUploadIcon,
  onSaveSettings,
}: CommunitySettingsPanelProps) {
  return (
    <div className="p-4 space-y-6">
      {settingsError && (
        <div className="p-3 bg-red-500/20 border border-red-500 rounded-lg text-red-400 text-sm">
          {settingsError}
        </div>
      )}

      {/* Icon Upload */}
      <div>
        <label className="block text-sm font-semibold text-neutral-300 mb-2">アイコン</label>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-xl overflow-hidden bg-neutral-800 flex items-center justify-center">
            {iconPreview || community.icon_url ? (
              <img
                src={iconPreview || community.icon_url || ''}
                alt=""
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-2xl font-bold text-white">
                {(community.display_name || community.name).charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <label className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg cursor-pointer transition-colors">
            {uploadingIcon ? 'アップロード中...' : '画像を選択'}
            <input
              type="file"
              accept="image/*"
              onChange={onUploadIcon}
              disabled={uploadingIcon}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Display Name */}
      <div>
        <label className="block text-sm font-semibold text-neutral-300 mb-2">表示名</label>
        <input
          type="text"
          value={settingsForm.display_name || ''}
          onChange={(e) => onChangeSettings((prev) => ({ ...prev, display_name: e.target.value }))}
          className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none"
          placeholder="グループの表示名"
        />
      </div>

      {/* Summary */}
      <div>
        <label className="block text-sm font-semibold text-neutral-300 mb-2">説明</label>
        <textarea
          value={settingsForm.summary || ''}
          onChange={(e) => onChangeSettings((prev) => ({ ...prev, summary: e.target.value }))}
          rows={4}
          className="w-full px-3 py-2 bg-neutral-900 border border-neutral-700 rounded-lg text-white placeholder-neutral-500 focus:border-blue-500 focus:outline-none resize-none"
          placeholder="グループの説明"
        />
      </div>

      {/* Visibility */}
      <div>
        <label className="block text-sm font-semibold text-neutral-300 mb-2">公開範囲</label>
        <div className="space-y-2">
          <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="visibility"
              checked={settingsForm.visibility === 'public'}
              onChange={() => onChangeSettings((prev) => ({ ...prev, visibility: 'public' }))}
              className="w-4 h-4 text-blue-500"
            />
            <div>
              <div className="text-white font-medium">公開</div>
              <div className="text-sm text-neutral-500">誰でもグループを見つけて閲覧できます</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="visibility"
              checked={settingsForm.visibility === 'private'}
              onChange={() => onChangeSettings((prev) => ({ ...prev, visibility: 'private' }))}
              className="w-4 h-4 text-blue-500"
            />
            <div>
              <div className="text-white font-medium">非公開</div>
              <div className="text-sm text-neutral-500">メンバーのみがグループの内容を閲覧できます</div>
            </div>
          </label>
        </div>
      </div>

      {/* Join Policy */}
      <div>
        <label className="block text-sm font-semibold text-neutral-300 mb-2">参加ポリシー</label>
        <div className="space-y-2">
          <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="join_policy"
              checked={settingsForm.join_policy === 'open'}
              onChange={() => onChangeSettings((prev) => ({ ...prev, join_policy: 'open' }))}
              className="w-4 h-4 text-blue-500"
            />
            <div>
              <div className="text-white font-medium">オープン</div>
              <div className="text-sm text-neutral-500">誰でも参加できます</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="join_policy"
              checked={settingsForm.join_policy === 'approval'}
              onChange={() => onChangeSettings((prev) => ({ ...prev, join_policy: 'approval' }))}
              className="w-4 h-4 text-blue-500"
            />
            <div>
              <div className="text-white font-medium">承認制</div>
              <div className="text-sm text-neutral-500">参加にはオーナーまたはモデレーターの承認が必要です</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="join_policy"
              checked={settingsForm.join_policy === 'invite'}
              onChange={() => onChangeSettings((prev) => ({ ...prev, join_policy: 'invite' }))}
              className="w-4 h-4 text-blue-500"
            />
            <div>
              <div className="text-white font-medium">招待制</div>
              <div className="text-sm text-neutral-500">招待コードがないと参加できません</div>
            </div>
          </label>
        </div>
      </div>

      {/* Post Policy */}
      <div>
        <label className="block text-sm font-semibold text-neutral-300 mb-2">投稿ポリシー</label>
        <div className="space-y-2">
          <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="post_policy"
              checked={settingsForm.post_policy === 'anyone'}
              onChange={() => onChangeSettings((prev) => ({ ...prev, post_policy: 'anyone' }))}
              className="w-4 h-4 text-blue-500"
            />
            <div>
              <div className="text-white font-medium">誰でも</div>
              <div className="text-sm text-neutral-500">誰でも投稿できます</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="post_policy"
              checked={settingsForm.post_policy === 'members'}
              onChange={() => onChangeSettings((prev) => ({ ...prev, post_policy: 'members' }))}
              className="w-4 h-4 text-blue-500"
            />
            <div>
              <div className="text-white font-medium">メンバーのみ</div>
              <div className="text-sm text-neutral-500">グループメンバーのみが投稿できます</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="post_policy"
              checked={settingsForm.post_policy === 'mods'}
              onChange={() => onChangeSettings((prev) => ({ ...prev, post_policy: 'mods' }))}
              className="w-4 h-4 text-blue-500"
            />
            <div>
              <div className="text-white font-medium">モデレーター以上</div>
              <div className="text-sm text-neutral-500">モデレーターとオーナーのみが投稿できます</div>
            </div>
          </label>
          <label className="flex items-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg cursor-pointer hover:border-neutral-600">
            <input
              type="radio"
              name="post_policy"
              checked={settingsForm.post_policy === 'owners'}
              onChange={() => onChangeSettings((prev) => ({ ...prev, post_policy: 'owners' }))}
              className="w-4 h-4 text-blue-500"
            />
            <div>
              <div className="text-white font-medium">オーナーのみ</div>
              <div className="text-sm text-neutral-500">オーナーのみが投稿できます</div>
            </div>
          </label>
        </div>
      </div>

      {/* Save Button */}
      <div className="pt-4">
        <button
          onClick={onSaveSettings}
          disabled={savingSettings}
          className="w-full px-6 py-3 bg-blue-500 hover:bg-blue-600 text-white rounded-full font-bold transition-colors disabled:opacity-50"
        >
          {savingSettings ? '保存中...' : '設定を保存'}
        </button>
      </div>
    </div>
  );
}
