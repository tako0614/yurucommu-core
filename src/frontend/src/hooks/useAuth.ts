import { useState, useEffect, useCallback } from 'react';
import { Actor } from '../types';
import { fetchMe, login, logout as apiLogout } from '../lib/api';

export function useAuth() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    fetchMe()
      .then(data => {
        if (data.authenticated && data.actor) {
          setActor(data.actor);
        } else {
          setActor(null);
        }
      })
      .catch(() => {
        setActor(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const doLogin = useCallback(async (password: string) => {
    setLoginError(null);
    try {
      const result = await login(password);
      if (result.success) {
        // Refresh auth state
        const meData = await fetchMe();
        if (meData.authenticated && meData.actor) {
          setActor(meData.actor);
        }
        return true;
      } else {
        setLoginError(result.error || 'Login failed');
        return false;
      }
    } catch (e) {
      setLoginError('Network error');
      return false;
    }
  }, []);

  const doLogout = useCallback(async () => {
    await apiLogout();
    setActor(null);
  }, []);

  return {
    actor,
    loading,
    loginError,
    login: doLogin,
    logout: doLogout,
  };
}
