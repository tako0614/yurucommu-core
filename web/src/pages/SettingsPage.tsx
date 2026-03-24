import { useEffect, useCallback } from 'react';
import { atom } from 'jotai';
import { useAtom, useAtomValue } from 'jotai';
import { actorAtom } from '../atoms/auth';
import type { Actor } from '../types';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';
import { InlineErrorBanner } from '../components/InlineErrorBanner';
import { SettingsAccountsSection } from '../components/settings/SettingsAccountsSection';
import { SettingsDeleteSection } from '../components/settings/SettingsDeleteSection';
import { SettingsUserList } from '../components/settings/SettingsUserList';
import { ChevronRightIcon } from '../components/settings/SettingsIcons';
import {
  fetchAccounts,
  switchAccount,
  createAccount,
  fetchBlockedUsers,
  fetchMutedUsers,
  unblockUser,
  unmuteUser,
  deleteAccount,
  AccountInfo,
} from '../lib/api';

// Atoms defined at module level
const settings_errorAtom = atom<string | null>(null);
const settings_activeSectionAtom = atom<'main' | 'blocked' | 'muted' | 'delete' | 'accounts'>('main');
const settings_blockedUsersAtom = atom<Actor[]>([]);
const settings_mutedUsersAtom = atom<Actor[]>([]);
const settings_loadingAtom = atom(false);
const settings_deleteConfirmAtom = atom('');
const settings_accountsAtom = atom<AccountInfo[]>([]);
const settings_showCreateAccountAtom = atom(false);
const settings_newUsernameAtom = atom('');
const settings_newDisplayNameAtom = atom('');
const settings_createErrorAtom = atom<string | null>(null);
const settings_switchingAtom = atom(false);

export function SettingsPage() {
  const actor = useAtomValue(actorAtom)!;
  const { t, language, setLanguage } = useI18n();
  const [error, setError] = useAtom(settings_errorAtom);
  const clearError = useCallback(() => setError(null), [setError]);
  const [activeSection, setActiveSection] = useAtom(settings_activeSectionAtom);
  const [blockedUsers, setBlockedUsers] = useAtom(settings_blockedUsersAtom);
  const [mutedUsers, setMutedUsers] = useAtom(settings_mutedUsersAtom);
  const [loading, setLoading] = useAtom(settings_loadingAtom);
  const [deleteConfirm, setDeleteConfirm] = useAtom(settings_deleteConfirmAtom);

  // Account switching
  const [accounts, setAccounts] = useAtom(settings_accountsAtom);
  const [showCreateAccount, setShowCreateAccount] = useAtom(settings_showCreateAccountAtom);
  const [newUsername, setNewUsername] = useAtom(settings_newUsernameAtom);
  const [newDisplayName, setNewDisplayName] = useAtom(settings_newDisplayNameAtom);
  const [createError, setCreateError] = useAtom(settings_createErrorAtom);
  const usernamePattern = /^[a-zA-Z0-9_]+$/;
  const normalizedUsername = newUsername.trim();
  const isUsernameValid = normalizedUsername.length > 0 && usernamePattern.test(normalizedUsername);
  const [switching, setSwitching] = useAtom(settings_switchingAtom);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // Ignore errors
    }
    // Redirect to home to trigger re-auth
    window.location.href = '/';
  };

  const resetCreateAccount = () => {
    setShowCreateAccount(false);
    setNewUsername('');
    setNewDisplayName('');
    setCreateError(null);
  };

  const handleToggleCreate = (open: boolean) => {
    if (open) {
      setShowCreateAccount(true);
    } else {
      resetCreateAccount();
    }
  };

  useEffect(() => {
    setActiveSection('main');
  }, []);

  useEffect(() => {
    if (activeSection === 'blocked') {
      // Only show loading if no cached data
      if (blockedUsers.length === 0) setLoading(true);
      fetchBlockedUsers()
        .then(setBlockedUsers)
        .catch((err) => {
          console.error('Failed to load blocked users:', err);
          setError(t('common.error'));
        })
        .finally(() => setLoading(false));
    } else if (activeSection === 'muted') {
      // Only show loading if no cached data
      if (mutedUsers.length === 0) setLoading(true);
      fetchMutedUsers()
        .then(setMutedUsers)
        .catch((err) => {
          console.error('Failed to load muted users:', err);
          setError(t('common.error'));
        })
        .finally(() => setLoading(false));
    } else if (activeSection === 'accounts') {
      setLoading(true);
      fetchAccounts()
        .then(data => setAccounts(data.accounts))
        .catch((err) => {
          console.error('Failed to load accounts:', err);
          setError(t('common.error'));
        })
        .finally(() => setLoading(false));
    }
  }, [activeSection, setError, t]);

  const handleSwitchAccount = async (apId: string) => {
    if (apId === actor.ap_id) return;
    setSwitching(true);
    try {
      await switchAccount(apId);
      window.location.reload();
    } catch (e) {
      console.error('Failed to switch account:', e);
      setError(t('common.error'));
    } finally {
      setSwitching(false);
    }
  };

  const handleCreateAccount = async () => {
    if (!normalizedUsername) {
      setCreateError('Username is required');
      return;
    }
    if (!usernamePattern.test(normalizedUsername)) {
      setCreateError('Use letters, numbers, and underscores only');
      return;
    }
    setCreateError(null);
    try {
      const newAccount = await createAccount(normalizedUsername, newDisplayName.trim() || undefined);
      setAccounts(prev => [...prev, newAccount]);
      resetCreateAccount();
    } catch (e: any) {
      setCreateError(e.message || 'Failed to create account');
    }
  };

  const handleUnblock = async (userApId: string) => {
    try {
      await unblockUser(userApId);
      setBlockedUsers(prev => prev.filter(u => u.ap_id !== userApId));
    } catch (e) {
      console.error('Failed to unblock:', e);
      setError(t('common.error'));
    }
  };

  const handleUnmute = async (userApId: string) => {
    try {
      await unmuteUser(userApId);
      setMutedUsers(prev => prev.filter(u => u.ap_id !== userApId));
    } catch (e) {
      console.error('Failed to unmute:', e);
      setError(t('common.error'));
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== actor.preferred_username) {
      alert('Username does not match');
      return;
    }
    try {
      await deleteAccount();
      window.location.href = '/';
    } catch (e: any) {
      alert(e.message || 'Failed to delete account');
    }
  };

  const errorBanner = error ? (
    <InlineErrorBanner message={error} onClose={clearError} />
  ) : null;

  if (activeSection === 'blocked') {
    return (
      <div className="flex flex-col h-full">
        {errorBanner}
        <SettingsUserList
          title="Blocked Users"
          emptyLabel="No blocked users"
          actionLabel="Unblock"
          loading={loading}
          users={blockedUsers}
          onBack={() => setActiveSection('main')}
          onAction={handleUnblock}
          t={t}
        />
      </div>
    );
  }

  if (activeSection === 'muted') {
    return (
      <div className="flex flex-col h-full">
        {errorBanner}
        <SettingsUserList
          title="Muted Users"
          emptyLabel="No muted users"
          actionLabel="Unmute"
          loading={loading}
          users={mutedUsers}
          onBack={() => setActiveSection('main')}
          onAction={handleUnmute}
          t={t}
        />
      </div>
    );
  }

  if (activeSection === 'delete') {
    return (
      <div className="flex flex-col h-full">
        {errorBanner}
        <SettingsDeleteSection
          actor={actor}
          deleteConfirm={deleteConfirm}
          onChangeConfirm={setDeleteConfirm}
          onDelete={handleDeleteAccount}
          onBack={() => setActiveSection('main')}
        />
      </div>
    );
  }

  if (activeSection === 'accounts') {
    return (
      <div className="flex flex-col h-full">
        {errorBanner}
        <SettingsAccountsSection
          actor={actor}
          accounts={accounts}
          loading={loading}
          switching={switching}
          showCreateAccount={showCreateAccount}
          newUsername={newUsername}
          newDisplayName={newDisplayName}
          createError={createError}
          isUsernameValid={isUsernameValid}
          onBack={() => setActiveSection('main')}
          onSwitchAccount={handleSwitchAccount}
          onToggleCreate={handleToggleCreate}
          onChangeUsername={setNewUsername}
          onChangeDisplayName={setNewDisplayName}
          onCreate={handleCreateAccount}
          onResetCreate={resetCreateAccount}
          t={t}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {errorBanner}
      <header className="sticky top-0 bg-neutral-900/80 backdrop-blur-sm border-b border-neutral-900 z-10">
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
          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <span>Logout</span>
            <ChevronRightIcon />
          </button>
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

export default SettingsPage;
