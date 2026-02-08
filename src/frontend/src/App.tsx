import { lazy, Suspense, useState, useEffect, useRef, FormEvent } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { I18nProvider, useI18n } from './lib/i18n';
import { LoginForm } from './components/LoginForm';
import { AppLayout } from './components/layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingSpinner } from './components/LoadingSpinner';

// セットアップフォーム（ホスティングモード用）
function SetupForm({ onSetup }: { onSetup: (username: string) => Promise<boolean> }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username) return;

    // バリデーション
    if (!/^[a-z0-9][a-z0-9-]{2,29}$/.test(username)) {
      setError('ユーザー名は3-30文字の小文字英数字とハイフンのみ使用できます（先頭は英数字）');
      return;
    }

    setSubmitting(true);
    setError(null);

    const success = await onSetup(username);
    if (!success) {
      setError('セットアップに失敗しました。ユーザー名が既に使われている可能性があります。');
    }
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <label htmlFor="username" className="block text-sm font-medium text-neutral-300 mb-1">
          ユーザー名
        </label>
        <input
          id="username"
          type="text"
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase())}
          className="w-full px-4 py-2 bg-neutral-800 border border-neutral-700 rounded-md text-neutral-100 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="例: myname"
          disabled={submitting}
          autoFocus
        />
        <p className="text-xs text-neutral-500 mt-1">
          これがあなたのサブドメインになります: <span className="text-neutral-300">{username || 'myname'}.yurucommu.com</span>
        </p>
      </div>

      {error && (
        <div className="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={submitting || !username}
        className="w-full bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'セットアップ中...' : 'セットアップ'}
      </button>
    </form>
  );
}

// Lazy load page components for code splitting
const TimelinePage = lazy(() => import('./pages/TimelinePage'));
const GroupPage = lazy(() => import('./pages/GroupPage'));
const GroupsPage = lazy(() => import('./pages/GroupsPage'));
const CommunityChatPage = lazy(() => import('./pages/CommunityChatPage'));
const DMPage = lazy(() => import('./pages/DMPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const NotificationPage = lazy(() => import('./pages/NotificationPage'));
const PostDetailPage = lazy(() => import('./pages/PostDetailPage'));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const FriendsListPage = lazy(() => import('./pages/FriendsListPage'));
const CommunityProfilePage = lazy(() => import('./pages/CommunityProfilePage'));

function AppContent() {
  const {
    actor,
    loading,
    loginError,
    login,
    needsSetup,
    instancePending,
    instanceMissing,
    hostedUser,
    instances,
    selectedInstanceId,
    selectInstance,
    createInstance,
    rebuildInstance,
    isHosted,
  } = useAuth();
  const { t } = useI18n();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const showHostedIframe = isHosted && hostedUser && hostedUser.status === 'active' && hostedUser.subdomain && !instanceMissing;

  useEffect(() => {
    if (!showHostedIframe || !hostedUser?.subdomain) return;
    const tenantOrigin = `https://${hostedUser.subdomain}.yurucommu.com`;
    const handler = (event: MessageEvent) => {
      if (!event || event.origin !== tenantOrigin) return;
      const data = event.data || {};
      if (data.type === 'yurucommu:ready') {
        const token = localStorage.getItem('session_token');
        if (token) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: 'yurucommu:session', token },
            tenantOrigin
          );
        }
      } else if (data.type === 'yurucommu:return') {
        window.location.assign(window.location.origin);
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [showHostedIframe, hostedUser?.subdomain]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-950 text-neutral-500">
        {t('common.loading')}
      </div>
    );
  }

  // ホスティングモード: セットアップが必要
  if (isHosted && needsSetup) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-neutral-100 p-8">
        <h1 className="text-4xl font-bold mb-4">Yurucommu</h1>
        <p className="text-neutral-500 mb-8">アカウントをセットアップしましょう</p>
        <SetupForm onSetup={createInstance} />
      </div>
    );
  }

  // ホスティングモード: インスタンスが削除された
  if (isHosted && instanceMissing && hostedUser) {
    const otherInstances = instances.filter((instance) => instance.id !== hostedUser.id);

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-neutral-100 p-8">
        <h1 className="text-4xl font-bold mb-4">Yurucommu</h1>
        <div className="max-w-md text-center space-y-6">
          <div>
            <div className="w-16 h-16 mx-auto mb-6 text-amber-500 text-6xl">⚠️</div>
            <h2 className="text-xl font-semibold mb-2 text-amber-300">インスタンスが削除されました</h2>
            <p className="text-neutral-400">
              @{hostedUser.username || hostedUser.subdomain} のインスタンスは takos 側で削除された可能性があります。
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <button
              onClick={() => rebuildInstance(hostedUser.id)}
              className="w-full bg-amber-500 text-black px-6 py-3 rounded-md font-medium hover:bg-amber-400 transition-colors"
            >
              インスタンスを再作成
            </button>
          </div>

          {otherInstances.length > 0 && (
            <div className="text-left space-y-2">
              <div className="text-sm text-neutral-400">他のインスタンスに切り替え</div>
              <div className="space-y-2">
                {otherInstances.map((instance) => (
                  <button
                    key={instance.id}
                    onClick={() => selectInstance(instance.id)}
                    className="w-full text-left px-4 py-3 rounded-lg bg-neutral-900/60 hover:bg-neutral-800 transition-colors"
                  >
                    <div className="font-medium">{instance.subdomain}.yurucommu.com</div>
                    <div className="text-sm text-neutral-500">@{instance.username}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="pt-2">
            <div className="text-sm text-neutral-400 mb-3">新しいインスタンスを作成</div>
            <SetupForm onSetup={createInstance} />
          </div>
        </div>
      </div>
    );
  }

  // ホスティングモード: インスタンスがpending/provisioning状態
  if (isHosted && instancePending && hostedUser) {
    const isFailed = hostedUser.status === 'failed';
    const isProvisioning = hostedUser.status === 'provisioning';

    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-neutral-100 p-8">
        <h1 className="text-4xl font-bold mb-4">Yurucommu</h1>
        <div className="max-w-md text-center">
          {isFailed ? (
            <>
              <div className="w-16 h-16 mx-auto mb-6 text-red-500 text-6xl">⚠️</div>
              <h2 className="text-xl font-semibold mb-2 text-red-400">セットアップに失敗しました</h2>
              <p className="text-neutral-400 mb-4">
                インスタンスの作成中にエラーが発生しました。
                しばらく待ってからもう一度お試しください。
              </p>
            </>
          ) : (
            <>
              <div className="w-16 h-16 mx-auto mb-6 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <h2 className="text-xl font-semibold mb-2">
                {isProvisioning ? 'インスタンスを作成中...' : 'インスタンスを準備中...'}
              </h2>
              <p className="text-neutral-400 mb-4">
                @{hostedUser.username} さんのインスタンスを準備しています。
                {isProvisioning ? '数秒〜数分かかる場合があります。' : 'しばらくお待ちください。'}
              </p>
              <p className="text-sm text-neutral-500">
                準備が完了したらページを更新してください。
              </p>
              <button
                onClick={() => window.location.reload()}
                className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
              >
                ページを更新
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  // ホスティングモード: インスタンスをフルスクリーンiframeで表示
  if (showHostedIframe) {
    const instanceUrl = `https://${hostedUser.subdomain}.yurucommu.com/embed`;
    return (
      <div className="fixed inset-0 bg-black">
        <iframe
          ref={iframeRef}
          title="Yurucommu"
          src={instanceUrl}
          className="w-screen h-screen border-0"
          allow="clipboard-read; clipboard-write; fullscreen"
          allowFullScreen
        />
      </div>
    );
  }

  if (!actor) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-neutral-100 p-8">
        <h1 className="text-4xl font-bold mb-4">Yurucommu</h1>
        <p className="text-neutral-500 mb-8">Social Network</p>
        <LoginForm onLogin={login} error={loginError} />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<LoadingSpinner />}>
        <Routes>
          <Route
            element={
              <AppLayout
                actor={actor}
                isHosted={isHosted}
                instances={instances}
                currentInstanceId={selectedInstanceId}
                onSelectInstance={selectInstance}
                onCreateInstance={createInstance}
                onRebuildInstance={rebuildInstance}
              />
            }
          >
            <Route path="/" element={<TimelinePage actor={actor} />} />
            <Route path="/groups" element={<GroupPage actor={actor} />} />
            <Route path="/friends" element={<FriendsListPage actor={actor} />} />
            <Route path="/friends/list" element={<FriendsListPage actor={actor} />} />
            <Route path="/friends/groups" element={<GroupsPage actor={actor} />} />
            <Route path="/groups/:name" element={<CommunityProfilePage actor={actor} />} />
            <Route path="/groups/:name/chat" element={<CommunityChatPage actor={actor} />} />
            <Route path="/dm" element={<DMPage actor={actor} />} />
            <Route path="/dm/:contactId" element={<DMPage actor={actor} />} />
            <Route path="/profile" element={<ProfilePage actor={actor} />} />
            <Route path="/profile/:actorId" element={<ProfilePage actor={actor} />} />
            <Route path="/notifications" element={<NotificationPage />} />
            <Route path="/post/:postId" element={<PostDetailPage actor={actor} />} />
            <Route path="/bookmarks" element={<BookmarksPage actor={actor} />} />
            <Route path="/settings" element={<SettingsPage actor={actor} />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <I18nProvider>
        <AppContent />
      </I18nProvider>
    </ErrorBoundary>
  );
}
