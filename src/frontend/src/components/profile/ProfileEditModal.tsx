import type { ChangeEvent } from 'react';
import { CloseIcon } from './ProfileIcons';
import type { Translate } from '../../lib/i18n';

interface ProfileEditModalProps {
  isOpen: boolean;
  editName: string;
  editSummary: string;
  editIsPrivate: boolean;
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  onChangeName: (event: ChangeEvent<HTMLInputElement>) => void;
  onChangeSummary: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onTogglePrivate: () => void;
  t: Translate;
}

export function ProfileEditModal({
  isOpen,
  editName,
  editSummary,
  editIsPrivate,
  saving,
  onClose,
  onSave,
  onChangeName,
  onChangeSummary,
  onTogglePrivate,
  t,
}: ProfileEditModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-neutral-900 rounded-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="flex items-center gap-4">
            <button
              onClick={onClose}
              aria-label="Close"
              className="p-1 hover:bg-neutral-800 rounded-full transition-colors"
            >
              <CloseIcon />
            </button>
            <h2 className="text-lg font-bold">{t('profile.editProfile')}</h2>
          </div>
          <button
            onClick={onSave}
            disabled={saving}
            className="px-4 py-1.5 bg-white text-black rounded-full font-bold text-sm hover:bg-neutral-200 disabled:bg-neutral-600 transition-colors"
          >
            {saving ? t('common.loading') : t('common.save')}
          </button>
        </div>
        <div className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Name</label>
            <input
              type="text"
              value={editName}
              onChange={onChangeName}
              placeholder="Display name"
              className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-1">Bio</label>
            <textarea
              value={editSummary}
              onChange={onChangeSummary}
              placeholder="Tell us about yourself"
              rows={4}
              className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex items-center justify-between py-2">
            <div>
              <div className="text-white font-medium">フォロー許可制</div>
              <div className="text-sm text-neutral-400">フォローリクエストを承認制にする</div>
            </div>
            <button
              type="button"
              onClick={onTogglePrivate}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                editIsPrivate ? 'bg-blue-500' : 'bg-neutral-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  editIsPrivate ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
