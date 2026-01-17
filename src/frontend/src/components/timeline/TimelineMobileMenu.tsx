import { Link } from 'react-router-dom';
import type { Actor } from '../../types';
import type { AccountInfo } from '../../lib/api';
import { UserAvatar } from '../UserAvatar';
import { BookmarkIconMenu, ProfileIconMenu, SettingsIconMenu } from './TimelineIcons';

type Translate = (key: string) => string;

interface TimelineMobileMenuProps {
  isOpen: boolean;
  actor: Actor;
  accounts: AccountInfo[];
  accountsLoading: boolean;
  currentApId: string;
  showAccountSwitcher: boolean;
  onToggleAccountSwitcher: () => void;
  onSwitchAccount: (apId: string) => void;
  onClose: () => void;
  t: Translate;
}

export function TimelineMobileMenu({
  isOpen,
  actor,
  accounts,
  accountsLoading,
  currentApId,
  showAccountSwitcher,
  onToggleAccountSwitcher,
  onSwitchAccount,
  onClose,
  t,
}: TimelineMobileMenuProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      {/* Slide-in Menu */}
      <div className="absolute left-0 top-0 bottom-0 w-72 bg-black border-r border-neutral-800 animate-slide-in overflow-y-auto">
        {/* Profile Header */}
        <div className="p-4 border-b border-neutral-800">
          {/* Avatar and Account Switcher Toggle */}
          <div className="flex items-center justify-between mb-3">
            <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.username} size={48} />
            <button
              onClick={onToggleAccountSwitcher}
              className="p-2 rounded-full border border-neutral-700 hover:bg-neutral-800 transition-colors"
            >
              <svg
                className={`w-4 h-4 transition-transform ${showAccountSwitcher ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          {/* Name and Username */}
          <p className="font-bold text-white text-lg">{actor.name || actor.username}</p>
          <p className="text-neutral-500">@{actor.username}</p>
          {/* Follow/Follower counts */}
          <div className="flex gap-4 mt-3">
            <Link
              to={`/profile/${encodeURIComponent(actor.ap_id)}/following`}
              onClick={onClose}
              className="hover:underline"
            >
              <span className="font-bold text-white">{actor.following_count || 0}</span>
              <span className="text-neutral-500 ml-1">{t('profile.following')}</span>
            </Link>
            <Link
              to={`/profile/${encodeURIComponent(actor.ap_id)}/followers`}
              onClick={onClose}
              className="hover:underline"
            >
              <span className="font-bold text-white">{actor.follower_count || 0}</span>
              <span className="text-neutral-500 ml-1">{t('profile.followers')}</span>
            </Link>
          </div>
        </div>

        {/* Account Switcher */}
        {showAccountSwitcher && (
          <div className="border-b border-neutral-800">
            {accountsLoading ? (
              <div className="p-4 text-center text-neutral-500">ì«Ç›çûÇ›íÜ...</div>
            ) : (
              <div className="py-2">
                {accounts.map((account) => (
                  <button
                    key={account.ap_id}
                    onClick={() => onSwitchAccount(account.ap_id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-900 transition-colors ${
                      account.ap_id === currentApId ? 'bg-neutral-900/50' : ''
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

        {/* Navigation */}
        <nav className="p-2">
          <Link
            to="/profile"
            onClick={onClose}
            className="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
          >
            <ProfileIconMenu />
            <span className="text-lg">{t('nav.profile')}</span>
          </Link>
          <Link
            to="/bookmarks"
            onClick={onClose}
            className="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
          >
            <BookmarkIconMenu />
            <span className="text-lg">{t('nav.bookmarks')}</span>
          </Link>
          <Link
            to="/settings"
            onClick={onClose}
            className="flex items-center gap-4 px-4 py-3 rounded-full hover:bg-neutral-900 transition-colors"
          >
            <SettingsIconMenu />
            <span className="text-lg">{t('nav.settings')}</span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
