import { useState, useEffect, useCallback } from 'react';
import { Actor } from '../types';

interface SelfHostedMeResponse {
  actor?: Actor;
}

interface LoginResponse {
  success?: boolean;
  error?: string;
}

export function useAuth() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (!res.ok) {
        setActor(null);
        return;
      }

      const data: SelfHostedMeResponse = await res.json();
      setActor(data.actor || null);
    } catch (e) {
      console.error('Auth check failed:', e);
      setActor(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (password?: string) => {
    setLoginError(null);

    if (!password) {
      setLoginError('Password required');
      return false;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password }),
      });
      const data: LoginResponse = await res.json();

      if (!data.success) {
        setLoginError(data.error || 'Login failed');
        return false;
      }

      await checkAuth();
      return true;
    } catch (e) {
      console.error('Login error:', e);
      setLoginError('Network error');
      return false;
    }
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      setActor(null);
    }
  }, []);

  return {
    actor,
    loading,
    loginError,
    login,
    logout,
  };
}
