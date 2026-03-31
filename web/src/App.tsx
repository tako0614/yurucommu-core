import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Provider } from 'jotai';
import { useAtomValue } from 'jotai';
import { useAuth } from './hooks/useAuth.ts';
import { tAtom } from './atoms/i18n.ts';
import { actorAtom } from './atoms/auth.ts';
import { LoginForm } from './components/LoginForm.tsx';
import { AppLayout } from './components/layout/index.ts';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { LoadingSpinner } from './components/LoadingSpinner.tsx';

// Lazy load page components for code splitting
const TimelinePage = lazy(() => import('./pages/TimelinePage.tsx'));
const CommunityChatPage = lazy(() => import('./pages/CommunityChatPage.tsx'));
const DMPage = lazy(() => import('./pages/DMPage.tsx'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.tsx'));
const NotificationPage = lazy(() => import('./pages/NotificationPage.tsx'));
const PostDetailPage = lazy(() => import('./pages/PostDetailPage.tsx'));
const BookmarksPage = lazy(() => import('./pages/BookmarksPage.tsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.tsx'));
const FriendsListPage = lazy(() => import('./pages/FriendsListPage.tsx'));
const CommunityProfilePage = lazy(() => import('./pages/CommunityProfilePage.tsx'));
const SearchPage = lazy(() => import('./pages/SearchPage.tsx'));

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
