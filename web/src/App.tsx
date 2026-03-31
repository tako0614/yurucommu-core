import { lazy, Show, Suspense, ErrorBoundary } from 'solid-js';
import { Router, Route } from '@solidjs/router';
import { Provider } from 'solid-jotai';
import { useAtomValue } from 'solid-jotai';
import { useAuth } from './hooks/useAuth.ts';
import { tAtom } from './atoms/i18n.ts';
import { LoginForm } from './components/LoginForm.tsx';
import { AppLayout } from './components/layout/index.ts';
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

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="flex items-center justify-center h-screen bg-neutral-950 text-neutral-500">
          {t()('common.loading')}
        </div>
      }
    >
      <Show
        when={actor()}
        fallback={
          <div class="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-neutral-100 p-8">
            <h1 class="text-4xl font-bold mb-4">Yurucommu</h1>
            <p class="text-neutral-500 mb-8">Social Network</p>
            <LoginForm onLogin={login} error={loginError()} />
          </div>
        }
      >
        <Router>
          <Route path="/" component={AppLayout}>
            <Route path="/" component={TimelinePage} />
            <Route path="/search" component={SearchPage} />
            <Route path="/friends" component={FriendsListPage} />
            <Route path="/friends/list" component={FriendsListPage} />
            <Route path="/groups/:name" component={CommunityProfilePage} />
            <Route path="/groups/:name/chat" component={CommunityChatPage} />
            <Route path="/dm" component={DMPage} />
            <Route path="/dm/:contactId" component={DMPage} />
            <Route path="/profile" component={ProfilePage} />
            <Route path="/profile/:actorId" component={ProfilePage} />
            <Route path="/notifications" component={NotificationPage} />
            <Route path="/post/:postId" component={PostDetailPage} />
            <Route path="/bookmarks" component={BookmarksPage} />
            <Route path="/settings" component={SettingsPage} />
          </Route>
        </Router>
      </Show>
    </Show>
  );
}

export default function App() {
  return (
    <ErrorBoundary fallback={(err) => (
      <div class="min-h-screen bg-neutral-950 flex items-center justify-center p-4">
        <div class="max-w-md w-full bg-neutral-900 rounded-xl p-6 text-center">
          <h1 class="text-xl font-bold text-white mb-2">Something went wrong</h1>
          <p class="text-neutral-400 mb-6">An unexpected error occurred. Please try again.</p>
          <button
            onClick={() => window.location.reload()}
            class="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
          >
            Reload page
          </button>
        </div>
      </div>
    )}>
      <Provider>
        <Suspense fallback={<LoadingSpinner />}>
          <AppContent />
        </Suspense>
      </Provider>
    </ErrorBoundary>
  );
}
