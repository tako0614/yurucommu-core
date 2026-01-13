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
  const { member, loading, authMode, login, logout, loginError } = useAuth();
  const { t } = useI18n();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-neutral-950 text-neutral-500">
        {t('common.loading')}
      </div>
    );
  }

  // Login page
  if (!member) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-neutral-950 text-neutral-100 p-8">
        <h1 className="text-4xl font-bold mb-4">Yurucommu</h1>
        <p className="text-neutral-500 mb-8">Social Network</p>

        {authMode === 'password' ? (
          <LoginForm onLogin={login} error={loginError} />
        ) : (
          <a
            href="/api/auth/login"
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-md font-medium hover:bg-blue-700 transition-colors"
          >
            takosでログイン
          </a>
        )}
      </div>
    );
  }

  // Main app with routing
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout member={member} />}>
          <Route path="/" element={<TimelinePage currentMember={member} />} />
          <Route path="/groups" element={<GroupPage currentMember={member} />} />
          <Route path="/dm" element={<DMPage currentMember={member} />} />
          <Route path="/dm/:conversationId" element={<DMPage currentMember={member} />} />
          <Route path="/profile" element={<ProfilePage currentMember={member} />} />
          <Route path="/profile/:memberId" element={<ProfilePage currentMember={member} />} />
          <Route path="/notifications" element={<NotificationPage />} />
          <Route path="/post/:postId" element={<PostDetailPage currentMember={member} />} />
          <Route path="/bookmarks" element={<BookmarksPage currentMember={member} />} />
          <Route path="/settings" element={<SettingsPage currentMember={member} />} />
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
