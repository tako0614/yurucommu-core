import { Link } from 'react-router-dom';
import type { AccountInfo } from '../../lib/api';
import { UserAvatar } from '../UserAvatar';
import { BackIcon } from './ProfileIcons';

interface ProfileHeaderProps {
  actorId?: string;
  isOwnProfile: boolean;
  username: string;
  showAccountSwitcher: boolean;
  onToggleAccountSwitcher: () => void;
  onCloseAccountSwitcher: () => void;
  accounts: AccountInfo[];
  accountsLoading: boolean;
  currentApId: string;
  onSwitchAccount: (apId: string) => void;
}

export function ProfileHeader({
  actorId,
  isOwnProfile,
  username,
  showAccountSwitcher,
  onToggleAccountSwitcher,
  onCloseAccountSwitcher,
  accounts,
  accountsLoading,
  currentApId,
  onSwitchAccount,
}: ProfileHeaderProps) {
  return (
    <>
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <div className="flex items-center justify-between px-4 py-3">
          {/* Left: Back button (only when viewing other's profile) */}
          <div className="w-10">
            {actorId && (
              <Link to="/" aria-label="Back" className="p-2 -ml-2 hover:bg-neutral-900 rounded-full inline-block">
                <BackIcon />
              </Link>
            )}
          </div>

          {/* Center: Username with account switcher (own profile only) */}
          {isOwnProfile ? (
            <button
              onClick={onToggleAccountSwitcher}
              className="flex items-center gap-1 hover:bg-neutral-900 px-3 py-1 rounded-full transition-colors"
            >
              <span className="font-bold text-white">@{username}</span>
              <svg
                className={`w-4 h-4 transition-transform ${showAccountSwitcher ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          ) : (
            <span className="font-bold text-white">@{username}</span>
          )}

          {/* Right: Placeholder for balance */}
          <div className="w-10" />
        </div>

        {/* Account Switcher Dropdown */}
        {showAccountSwitcher && isOwnProfile && (
          <div className="absolute left-1/2 -translate-x-1/2 top-14 bg-neutral-900 rounded-xl shadow-lg border border-neutral-800 min-w-[250px] z-20">
            {accountsLoading ? (
              <div className="p-4 text-center text-neutral-500">読み込み中...</div>
            ) : (
              <div className="py-2">
                {accounts.map((account) => (
                  <button
                    key={account.ap_id}
                    onClick={() => onSwitchAccount(account.ap_id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-800 transition-colors ${
                      account.ap_id === currentApId ? 'bg-neutral-800/50' : ''
                    }`}
                  >
                    <UserAvatar
                      avatarUrl={account.icon_url}
                      name={account.name || account.preferred_username}
                      size={40}
                    />
                    <div className="flex-1 text-left">
                      <p className="font-bold text-white">{account.name || account.preferred_username}</p>
                      <p className="text-sm text-neutral-500">@{account.preferred_username}</p>
                    </div>
                    {account.ap_id === currentApId && (
                      <svg className="w-5 h-5 text-blue-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </header>

      {/* Backdrop for account switcher */}
      {showAccountSwitcher && (
        <div className="fixed inset-0 z-10" onClick={onCloseAccountSwitcher} />
      )}
    </>
  );
}
