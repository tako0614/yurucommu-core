import type { Actor } from '../../types';
import { UserAvatar } from '../UserAvatar';
import { SettingsSectionHeader } from './SettingsSectionHeader';

type Translate = (key: string) => string;

interface SettingsUserListProps {
  title: string;
  emptyLabel: string;
  actionLabel: string;
  loading: boolean;
  users: Actor[];
  onBack: () => void;
  onAction: (apId: string) => void;
  t: Translate;
}

export function SettingsUserList({
  title,
  emptyLabel,
  actionLabel,
  loading,
  users,
  onBack,
  onAction,
  t,
}: SettingsUserListProps) {
  return (
    <div className="flex flex-col h-full">
      <SettingsSectionHeader title={title} onBack={onBack} />
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center text-neutral-500">{emptyLabel}</div>
        ) : (
          users.map((user) => (
            <div key={user.ap_id} className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900">
              <UserAvatar avatarUrl={user.icon_url} name={user.name || user.preferred_username} size={48} />
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white truncate">{user.name || user.preferred_username}</div>
                <div className="text-neutral-500 truncate">@{user.username}</div>
              </div>
              <button
                onClick={() => onAction(user.ap_id)}
                className="px-3 py-1.5 border border-neutral-600 rounded-full text-sm hover:bg-neutral-900"
              >
                {actionLabel}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
