import { useState, useEffect } from 'react';
import { Member } from '../types';
import { fetchBlockedUsers, fetchMutedUsers, unblockUser, unmuteUser, deleteAccount } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { UserAvatar } from '../components/UserAvatar';

interface SettingsPageProps {
  currentMember: Member;
}

const ChevronRightIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

export function SettingsPage({ currentMember }: SettingsPageProps) {
  const { t, language, setLanguage } = useI18n();
  const [activeSection, setActiveSection] = useState<'main' | 'blocked' | 'muted' | 'delete'>('main');
  const [blockedUsers, setBlockedUsers] = useState<Member[]>([]);
  const [mutedUsers, setMutedUsers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');

  useEffect(() => {
    if (activeSection === 'blocked') {
      setLoading(true);
      fetchBlockedUsers()
        .then(data => setBlockedUsers(data.users || []))
        .finally(() => setLoading(false));
    } else if (activeSection === 'muted') {
      setLoading(true);
      fetchMutedUsers()
        .then(data => setMutedUsers(data.users || []))
        .finally(() => setLoading(false));
    }
  }, [activeSection]);

  const handleUnblock = async (userId: string) => {
    try {
      await unblockUser(userId);
      setBlockedUsers(prev => prev.filter(u => u.id !== userId));
    } catch (e) {
      console.error('Failed to unblock:', e);
    }
  };

  const handleUnmute = async (userId: string) => {
    try {
      await unmuteUser(userId);
      setMutedUsers(prev => prev.filter(u => u.id !== userId));
    } catch (e) {
      console.error('Failed to unmute:', e);
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteConfirm !== currentMember.username) {
      alert('ユーザー名が一致しません');
      return;
    }
    try {
      await deleteAccount();
      window.location.href = '/';
    } catch (e: any) {
      alert(e.message || 'アカウント削除に失敗しました');
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
            <h1 className="text-xl font-bold">ブロック中のユーザー</h1>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
          ) : blockedUsers.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">ブロック中のユーザーはいません</div>
          ) : (
            blockedUsers.map(user => (
              <div key={user.id} className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900">
                <UserAvatar avatarUrl={user.avatar_url} name={user.display_name || user.username} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white truncate">{user.display_name || user.username}</div>
                  <div className="text-neutral-500 truncate">@{user.username}</div>
                </div>
                <button
                  onClick={() => handleUnblock(user.id)}
                  className="px-3 py-1.5 border border-neutral-600 rounded-full text-sm hover:bg-neutral-900"
                >
                  解除
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
            <h1 className="text-xl font-bold">ミュート中のユーザー</h1>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-neutral-500">{t('common.loading')}</div>
          ) : mutedUsers.length === 0 ? (
            <div className="p-8 text-center text-neutral-500">ミュート中のユーザーはいません</div>
          ) : (
            mutedUsers.map(user => (
              <div key={user.id} className="flex items-center gap-3 px-4 py-3 border-b border-neutral-900">
                <UserAvatar avatarUrl={user.avatar_url} name={user.display_name || user.username} size={48} />
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-white truncate">{user.display_name || user.username}</div>
                  <div className="text-neutral-500 truncate">@{user.username}</div>
                </div>
                <button
                  onClick={() => handleUnmute(user.id)}
                  className="px-3 py-1.5 border border-neutral-600 rounded-full text-sm hover:bg-neutral-900"
                >
                  解除
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
            <h1 className="text-xl font-bold text-red-500">アカウント削除</h1>
          </div>
        </header>
        <div className="p-4 space-y-4">
          <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
            <p className="text-red-400 text-sm">
              この操作は取り消せません。すべての投稿、いいね、フォロー関係が削除されます。
            </p>
          </div>
          <div>
            <label className="block text-sm text-neutral-400 mb-2">
              確認のため、ユーザー名「{currentMember.username}」を入力してください
            </label>
            <input
              type="text"
              value={deleteConfirm}
              onChange={e => setDeleteConfirm(e.target.value)}
              placeholder={currentMember.username}
              className="w-full bg-neutral-900 rounded-lg px-3 py-2 text-white outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <button
            onClick={handleDeleteAccount}
            disabled={deleteConfirm !== currentMember.username}
            className="w-full py-3 bg-red-600 hover:bg-red-700 disabled:bg-neutral-800 disabled:text-neutral-600 rounded-lg font-bold"
          >
            アカウントを削除
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="sticky top-0 bg-black/80 backdrop-blur-sm border-b border-neutral-900 z-10">
        <h1 className="text-xl font-bold px-4 py-3">設定</h1>
      </header>
      <div className="flex-1 overflow-y-auto">
        {/* Language */}
        <div className="border-b border-neutral-900">
          <div className="px-4 py-2 text-sm text-neutral-500 uppercase">表示</div>
          <button
            onClick={() => setLanguage(language === 'ja' ? 'en' : 'ja')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <span>言語</span>
            <span className="text-neutral-500">{language === 'ja' ? '日本語' : 'English'}</span>
          </button>
        </div>

        {/* Privacy */}
        <div className="border-b border-neutral-900">
          <div className="px-4 py-2 text-sm text-neutral-500 uppercase">プライバシー</div>
          <button
            onClick={() => setActiveSection('blocked')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <span>ブロック中のユーザー</span>
            <ChevronRightIcon />
          </button>
          <button
            onClick={() => setActiveSection('muted')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <span>ミュート中のユーザー</span>
            <ChevronRightIcon />
          </button>
        </div>

        {/* Account */}
        <div className="border-b border-neutral-900">
          <div className="px-4 py-2 text-sm text-neutral-500 uppercase">アカウント</div>
          <a
            href="/api/auth/logout"
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50"
          >
            <span>ログアウト</span>
            <ChevronRightIcon />
          </a>
          <button
            onClick={() => setActiveSection('delete')}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-900/50 text-red-500"
          >
            <span>アカウント削除</span>
            <ChevronRightIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
