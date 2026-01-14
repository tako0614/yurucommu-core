import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { I18nProvider, useI18n } from './lib/i18n';
import { LoginForm } from './components/LoginForm';
import { AppLayout } from './components/layout';
import { TimelinePage } from './pages/TimelinePage';
import { GroupPage } from './pages/GroupPage';
import { DMPage } from './pages/DMPage';
import { ProfilePage } from './pages/ProfilePage';
import { NotificationPage } from './pages/NotificationPage';
import { PostDetailPage } from './pages/PostDetailPage';
import { BookmarksPage } from './pages/BookmarksPage';
import { SettingsPage } from './pages/SettingsPage';

function AppContent() {
  const { actor, loading, loginError, login } = useAuth();
  const { t } = useI18n();

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
      <Routes>
        <Route element={<AppLayout actor={actor} />}>
          <Route path="/" element={<TimelinePage actor={actor} />} />
          <Route path="/groups" element={<GroupPage actor={actor} />} />
          <Route path="/dm" element={<DMPage actor={actor} />} />
          <Route path="/dm/:conversationId" element={<DMPage actor={actor} />} />
          <Route path="/profile" element={<ProfilePage actor={actor} />} />
          <Route path="/profile/:actorId" element={<ProfilePage actor={actor} />} />
          <Route path="/notifications" element={<NotificationPage actor={actor} />} />
          <Route path="/post/:postId" element={<PostDetailPage actor={actor} />} />
          <Route path="/bookmarks" element={<BookmarksPage actor={actor} />} />
          <Route path="/settings" element={<SettingsPage actor={actor} />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  );
}
