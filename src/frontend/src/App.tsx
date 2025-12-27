import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './stores/authStore';
import { useConfigStore } from './stores/configStore';
import { Layout } from './components/layout';
import {
  Login,
  OAuthCallback,
  Home,
  Notifications,
  Profile,
  Settings,
  Setup,
} from './routes';
import { api } from './api/client';

// Protected route wrapper
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuthStore();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Setup check wrapper
function SetupCheck({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    const checkSetup = async () => {
      try {
        await api.getMe();
        setNeedsSetup(false);
      } catch (err) {
        // If 404, user needs setup
        setNeedsSetup(true);
      }
    };

    if (user) {
      // User exists, check if profile is set up
      setNeedsSetup(!user.username);
    } else {
      checkSetup();
    }
  }, [user]);

  if (needsSetup === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (needsSetup) {
    return <Navigate to="/setup" replace />;
  }

  return <>{children}</>;
}

// Main layout with notification count
function MainLayout() {
  const [notificationCount, setNotificationCount] = useState(0);

  useEffect(() => {
    const loadNotifications = async () => {
      try {
        const notifications = await api.getNotifications();
        const unread = notifications.filter((n) => !n.read_at).length;
        setNotificationCount(unread);
      } catch {
        // Ignore
      }
    };

    loadNotifications();
    const interval = setInterval(loadNotifications, 60000); // Poll every minute

    return () => clearInterval(interval);
  }, []);

  return <Layout notificationCount={notificationCount} />;
}

function App() {
  const { checkAuth, isLoading } = useAuthStore();
  const { loadConfig } = useConfigStore();

  useEffect(() => {
    checkAuth();
    loadConfig();
  }, [checkAuth, loadConfig]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<Login />} />
      <Route path="/auth/callback" element={<OAuthCallback />} />

      {/* Setup route (requires auth but not profile) */}
      <Route
        path="/setup"
        element={
          <ProtectedRoute>
            <Setup />
          </ProtectedRoute>
        }
      />

      {/* Protected routes with layout */}
      <Route
        element={
          <ProtectedRoute>
            <SetupCheck>
              <MainLayout />
            </SetupCheck>
          </ProtectedRoute>
        }
      >
        <Route path="/" element={<Home />} />
        <Route path="/notifications" element={<Notifications />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      {/* Fallback */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
