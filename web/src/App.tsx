import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Provider } from 'jotai';
import { useAtomValue } from 'jotai';
import { useAuth } from './hooks/useAuth';
import { tAtom } from './atoms/i18n';
import { actorAtom } from './atoms/auth';
import { LoginForm } from './components/LoginForm';
import { AppLayout } from './components/layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingSpinner } from './components/LoadingSpinner';

// Lazy load page components for code splitting
const TimelinePage = lazy(() => import('./pages/TimelinePage'));
const CommunityChatPage = lazy(() => import('./pages/CommunityChatPage'));
const DMPage = lazy(() => import('./pages/DMPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const NotificationPage = lazy(() => import('./pages/NotificationPage'));
const PostDetailPage = lazy(() => import('./pages/PostDetailPage'));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const FriendsListPage = lazy(() => import('./pages/FriendsListPage'));
const CommunityProfilePage = lazy(() => import('./pages/CommunityProfilePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));

function AppContent() {
  const { actor, loading, loginError, login } = useAuth();
  const t = useAtomValue(tAtom);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-950 text-neutral-500">
        {t('common.loading')}
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
          <Route element={<AppLayout />}>
            <Route path="/" element={<TimelinePage />} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/friends" element={<FriendsListPage />} />
            <Route path="/friends/list" element={<FriendsListPage />} />
            <Route path="/groups/:name" element={<CommunityProfilePage />} />
            <Route path="/groups/:name/chat" element={<CommunityChatPage />} />
            <Route path="/dm" element={<DMPage />} />
            <Route path="/dm/:contactId" element={<DMPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/profile/:actorId" element={<ProfilePage />} />
            <Route path="/notifications" element={<NotificationPage />} />
            <Route path="/post/:postId" element={<PostDetailPage />} />
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <Provider>
        <AppContent />
      </Provider>
    </ErrorBoundary>
  );
}
