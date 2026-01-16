import { useState, useEffect } from 'react';
import { Actor } from '../types';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { fetchAccounts, switchAccount, createAccount, AccountInfo } from '../lib/api';

interface SettingsPageProps {
  actor: Actor;
}

const ChevronRightIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export function SettingsPage({ actor }: SettingsPageProps) {
  const { t, language, setLanguage } = useI18n();
  const [activeSection, setActiveSection] = useState<'main' | 'blocked' | 'muted' | 'delete' | 'accounts'>('main');
  const [blockedUsers, setBlockedUsers] = useState<Actor[]>([]);
  const [mutedUsers, setMutedUsers] = useState<Actor[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  // Account switching
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);
  const [showCreateAccount, setShowCreateAccount] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newDisplayName, setNewDisplayName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (activeSection === 'blocked') {
      setLoading(true);
      // TODO: Implement fetchBlockedUsers API
      setBlockedUsers([]);
      setLoading(false);
    } else if (activeSection === 'muted') {
      setLoading(true);
      // TODO: Implement fetchMutedUsers API
      setMutedUsers([]);
      setLoading(false);
    } else if (activeSection === 'accounts') {
      setLoading(true);
      fetchAccounts()
        .then(data => setAccounts(data.accounts))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [activeSection]);

  const handleSwitchAccount = async (apId: string) => {
    if (apId === actor.ap_id) return;
    setSwitching(true);
    try {
      await switchAccount(apId);
      window.location.reload();
    } catch (e) {
      console.error('Failed to switch account:', e);
    } finally {
      setSwitching(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!newUsername.trim()) {
      setCreateError('Username is required');
      return;
    }
    setCreateError(null);
    try {
      const newAccount = await createAccount(newUsername.trim(), newDisplayName.trim() || undefined);
      setAccounts(prev => [...prev, newAccount]);
      setShowCreateAccount(false);
      setNewUsername('');
      setNewDisplayName('');
    } catch (e: any) {
      setCreateError(e.message || 'Failed to create account');
    }
  };

  const handleUnblock = async (userApId: string) => {
    try {
      // TODO: Implement unblockUser API
      setBlockedUsers(prev => prev.filter(u => u.ap_id !== userApId));
    } catch (e) {
      console.error('Failed to unblock:', e);
    }
  };

  const handleUnmute = async (userApId: string) => {
    try {
      // TODO: Implement unmuteUser API
      setMutedUsers(prev => prev.filter(u => u.ap_id !== userApId));
    } catch (e) {
      console.error('Failed to unmute:', e);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== actor.preferred_username) {
      alert('Username does not match');
      return;
    }
    try {
      // TODO: Implement deleteAccount API
      window.location.href = '/';
    } catch (e: any) {
      alert(e.message || 'Failed to delete account');
    }
  };

  if (activeSection === 'blocked') {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <button onClick={() => setActiveSection('main')} className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h1 className="text-xl font-bold">Blocked Users</h1>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
          ) : blockedUsers.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">No blocked users</div>
          ) : (
            blockedUsers.map(user => (
              <div key={user.ap_id} className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900">
                <UserAvatar avatarUrl={user.icon_url} name={user.name || user.preferred_username} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white truncate">{user.name || user.preferred_username}</div>
                  <div className="text-neutral-500 truncate">@{user.username}</div>
                </div>
                <button
                  onClick={() => handleUnblock(user.ap_id)}
                  className="px-3 py-1.5 border border-neutral-600 rounded-full text-sm hover:bg-neutral-900"
                >
                  Unblock
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (activeSection === 'muted') {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <button onClick={() => setActiveSection('main')} className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h1 className="text-xl font-bold">Muted Users</h1>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
          ) : mutedUsers.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">No muted users</div>
          ) : (
            mutedUsers.map(user => (
              <div key={user.ap_id} className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900">
                <UserAvatar avatarUrl={user.icon_url} name={user.name || user.preferred_username} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white truncate">{user.name || user.preferred_username}</div>
                  <div className="text-neutral-500 truncate">@{user.username}</div>
                </div>
                <button
                  onClick={() => handleUnmute(user.ap_id)}
                  className="px-3 py-1.5 border border-neutral-600 rounded-full text-sm hover:bg-neutral-900"
                >
                  Unmute
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  if (activeSection === 'delete') {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <button onClick={() => setActiveSection('main')} className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h1 className="text-xl font-bold text-red-500">Delete Account</h1>
          </div>
        </header>
        <div className="p-4 space-y-4">
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm">
              This action cannot be undone. All posts, likes, and follows will be deleted.
            </p>
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-2">
              Enter your username "{actor.preferred_username}" to confirm
            </label>
            <input
              type="text"
              value={deleteConfirm}
              onChange={e => setDeleteConfirm(e.target.value)}
              placeholder={actor.preferred_username}
              className="w-full bg-neutral-900 rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <button
            onClick={handleDeleteAccount}
            disabled={deleteConfirm !== actor.preferred_username}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-lg font-bold"
          >
            Delete Account
          </button>
        </div>
      </div>
    );
  }

  if (activeSection === 'accounts') {
    return (
      <div className="flex flex-col h-full">
        <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
          <div className="flex items-center gap-4 px-4 py-3">
            <button onClick={() => setActiveSection('main')} className="p-2 -ml-2 hover:bg-neutral-900 rounded-full">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h1 className="text-xl font-bold">アカウント切り替え</h1>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
          ) : (
            <>
              {/* Account list */}
              {accounts.map(account => (
                <button
                  key={account.ap_id}
                  onClick={() => handleSwitchAccount(account.ap_id)}
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
                  onClick={() => setShowCreateAccount(true)}
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
                      onClick={() => {
                        setShowCreateAccount(false);
                        setNewUsername('');
                        setNewDisplayName('');
                        setCreateError(null);
                      }}
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
                        onChange={e => setNewUsername(e.target.value)}
                        placeholder="username"
                        className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <p className="text-xs text-neutral-500 mt-1">英数字とアンダースコアのみ</p>
                    </div>
                    <div>
                      <label className="block text-sm text-neutral-400 mb-1">表示名</label>
                      <input
                        type="text"
                        value={newDisplayName}
                        onChange={e => setNewDisplayName(e.target.value)}
                        placeholder="Display Name"
                        className="w-full bg-neutral-800 rounded-lg px-3 py-2 text-white placeholder-neutral-500 outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </div>
                    <button
                      onClick={handleCreateAccount}
                      className="w-full py-2 bg-blue-500 hover:bg-blue-600 rounded-lg font-bold transition-colors"
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

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 className="text-xl font-bold px-4 py-3">Settings</h1>
      </header>
      <div className="flex-1 overflow-y-auto">
        {/* Language */}
        <div className="border-b border-neutral-900">
          <div className="px-4 py-2 text-sm text-neutral-500 uppercase">Display</div>
          <button
            onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <span>Language</span>
            <span className="text-neutral-500">{language === 'ja' ? 'Japanese' : 'English'}</span>
          </button>
        </div>

        {/* Privacy */}
        <div className="border-b border-neutral-900">
          <div className="px-4 py-2 text-sm text-neutral-500 uppercase">Privacy</div>
          <button
            onClick={() => setActiveSection('blocked')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <span>Blocked Users</span>
            <ChevronRightIcon />
          </button>
          <button
            onClick={() => setActiveSection('muted')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <span>Muted Users</span>
            <ChevronRightIcon />
          </button>
        </div>

        {/* Account */}
        <div className="border-b border-neutral-900">
          <div className="px-4 py-2 text-sm text-neutral-500 uppercase">Account</div>
          <button
            onClick={() => setActiveSection('accounts')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <div className="flex items-center gap-3">
              <UserAvatar avatarUrl={actor.icon_url} name={actor.name || actor.preferred_username} size={32} />
              <div className="text-left">
                <div className="text-sm font-medium">{actor.name || actor.preferred_username}</div>
                <div className="text-xs text-neutral-500">@{actor.preferred_username}</div>
              </div>
            </div>
            <ChevronRightIcon />
          </button>
          <a
            href="/api/auth/logout"
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <span>Logout</span>
            <ChevronRightIcon />
          </a>
          <button
            onClick={() => setActiveSection('delete')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50 text-red-500"
          >
            <span>Delete Account</span>
            <ChevronRightIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
