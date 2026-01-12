import { useState, useEffect, useCallback } from 'react';
import { Member } from '../types';
import { fetchMe, fetchAuthMode, loginWithPassword } from '../lib/api';
import { getCachedMember, setCachedMember } from '../lib/cache';

export function useAuth() {
  const [member, setMember] = useState<Member | null>(null);
  const [loading, setLoading] = useState(true);
  const [authMode, setAuthMode] = useState<'oauth' | 'password'>('oauth');
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    // First, try to show cached member for instant load
    const cachedMember = getCachedMember();
    if (cachedMember) {
      setMember(cachedMember);
      setLoading(false);
    }

    // Get auth mode
    fetchAuthMode()
      .then(data => setAuthMode(data.mode))
      .catch(() => {});

    // Then verify with server
    fetchMe()
      .then(data => {
        if (data.authenticated && data.member) {
          setMember(data.member);
          setCachedMember(data.member);
        } else {
          setMember(null);
          setCachedMember(null);
        }
      })
      .catch(() => {
        // Offline - keep using cached member if available
      })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setLoginError(null);
    try {
      const result = await loginWithPassword(username, password);
      if (result.success && result.member) {
        setMember(result.member);
        setCachedMember(result.member);
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

  const logout = useCallback(() => {
    setMember(null);
    setCachedMember(null);
    // Redirect to logout endpoint
    window.location.href = '/api/auth/logout';
  }, []);

  return { member, loading, authMode, login, logout, loginError };
}
