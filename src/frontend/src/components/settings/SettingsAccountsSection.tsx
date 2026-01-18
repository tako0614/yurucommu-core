import type { AccountInfo } from '../../lib/api';
import type { Actor } from '../../types';
import { UserAvatar } from '../UserAvatar';
import { CheckIcon, CloseIcon, PlusIcon } from './SettingsIcons';
import { SettingsSectionHeader } from './SettingsSectionHeader';
import type { Translate } from '../../lib/i18n';

interface SettingsAccountsSectionProps {
  actor: Actor;
  accounts: AccountInfo[];
  loading: boolean;
  switching: boolean;
  showCreateAccount: boolean;
  newUsername: string;
  newDisplayName: string;
  createError: string | null;
  isUsernameValid: boolean;
  onBack: () => void;
  onSwitchAccount: (apId: string) => void;
  onToggleCreate: (open: boolean) => void;
  onChangeUsername: (value: string) => void;
  onChangeDisplayName: (value: string) => void;
  onCreate: () => void;
  onResetCreate: () => void;
  t: Translate;
}

export function SettingsAccountsSection({
  actor,
  accounts,
  loading,
  switching,
  showCreateAccount,
  newUsername,
  newDisplayName,
  createError,
  isUsernameValid,
  onBack,
  onSwitchAccount,
  onToggleCreate,
  onChangeUsername,
  onChangeDisplayName,
  onCreate,
  onResetCreate,
  t,
}: SettingsAccountsSectionProps) {
  return (
    <div className="flex flex-col h-full">
      <SettingsSectionHeader title="アカウント切り替え" onBack={onBack} />
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : (
          <>
            {/* Account list */}
            {accounts.map((account) => (
              <button
                key={account.ap_id}
                onClick={() => onSwitchAccount(account.ap_id)}
                disabled={switching}
                className="w-full flex items-center gap-3 px-4 py-3 border-b border-neutral-900 hover:bg-neutral-900/50 disabled:opacity-50"
              >
                <UserAvatar
                  avatarUrl={account.icon_url}
                  name={account.name || account.preferred_username}
                  size={48}
                />
                <div className="flex-1 min-w-0 text-left">
                  <div className="font-bold text-white truncate">
                    {account.name || account.preferred_username}
                  </div>
                  <div className="text-neutral-500 truncate">@{account.preferred_username}</div>
                </div>
                {account.ap_id === actor.ap_id && <CheckIcon />}
              </button>
            ))}

            {/* Create new account button */}
            {!showCreateAccount ? (
              <button
                onClick={() => onToggleCreate(true)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900/50 text-blue-400"
              >
                <div className="w-12 h-12 rounded-full bg-neutral-800 flex items-center justify-center">
                  <PlusIcon />
                </div>
                <span>新しいアカウントを作成</span>
              </button>
            ) : (
              <div className="p-4 border-t border-neutral-900">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-bold">新しいアカウント</h3>
                  <button
                    onClick={onResetCreate}
                    aria-label="Close"
                    className="p-1 hover:bg-neutral-800 rounded-full"
                  >
                    <CloseIcon />
                  </button>
                </div>
                {createError && (
                  <div className="mb-3 p-2 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
                    {createError}
                  </div>
                )}
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm text-neutral-400 mb-1">ユーザー名 *</label>
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => onChangeUsername(e.target.value)}
                      placeholder="username"
                      pattern="^[a-zA-Z0-9_]+$"
                      required
                      className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <p className="text-xs text-neutral-500 mt-1">英数字とアンダースコアのみ</p>
                  </div>
                  <div>
                    <label className="block text-sm text-neutral-400 mb-1">表示名</label>
                    <input
                      type="text"
                      value={newDisplayName}
                      onChange={(e) => onChangeDisplayName(e.target.value)}
                      placeholder="Display Name"
                      className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <button
                    onClick={onCreate}
                    disabled={!isUsernameValid}
                    className="w-full py-2 bg-blue-500 hover:bg-blue-600 rounded-lg font-bold transition-colors disabled:opacity-50 disabled:hover:bg-blue-500"
                  >
                    作成
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
