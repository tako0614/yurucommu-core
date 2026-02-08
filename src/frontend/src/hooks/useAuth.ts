import { useState, useEffect, useCallback } from 'react';
import { Actor } from '../types';
import { setTenantUrl, clearTenantUrl } from '../lib/api/fetch';

// 環境変数でホスティングモードかどうかを判定
const IS_HOSTED = import.meta.env.VITE_HOSTED_MODE === 'true';
const AUTH_BASE_URL = import.meta.env.VITE_AUTH_URL || '';

// API response types
interface AuthMeResponse {
  user?: {
    id: string;
    subdomain?: string;
    status?: string;
    username?: string;
    allowed?: boolean;
  };
  needs_setup?: boolean;
  tenant_token?: string; // JWT for tenant API calls
}

export interface HostedInstance {
  id: string;
  subdomain: string;
  username: string;
  status: string;
  instance_url: string | null;
  last_selected_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

interface InstancesResponse {
  instances: HostedInstance[];
  selected_instance_id: string | null;
}

interface ActorMeResponse {
  actor?: Actor;
}

interface SelfHostedMeResponse {
  actor?: Actor;
}

interface LoginResponse {
  auth_url?: string; // backend returns snake_case
  authUrl?: string; // fallback
  success?: boolean;
  error?: string;
}

export function useAuth() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [instancePending, setInstancePending] = useState(false);
  const [instanceMissing, setInstanceMissing] = useState(false);
  const [hostedUser, setHostedUser] = useState<{ id: string; username?: string; subdomain?: string; status?: string; allowed?: boolean } | null>(null);
  const [instances, setInstances] = useState<HostedInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [instancesLoading, setInstancesLoading] = useState(false);

  const fetchInstances = useCallback(async (token: string) => {
    setInstancesLoading(true);
    try {
      const res = await fetch(`${AUTH_BASE_URL}/api/instances`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data: InstancesResponse = await res.json();
        setInstances(data.instances || []);
        setSelectedInstanceId(data.selected_instance_id || null);
      }
    } catch (e) {
      console.error('Failed to load instances:', e);
    } finally {
      setInstancesLoading(false);
    }
  }, []);

  const checkAuth = useCallback(async () => {
    try {
      if (IS_HOSTED) {
        // ホスティングモード: takos-auth経由
        const token = localStorage.getItem('session_token');
        if (!token) {
          setActor(null);
          setHostedUser(null);
          setNeedsSetup(false);
          setInstancePending(false);
          setInstanceMissing(false);
          setInstances([]);
          setSelectedInstanceId(null);
          setLoading(false);
          return;
        }

        const res = await fetch(`${AUTH_BASE_URL}/api/auth/me`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.ok) {
          const data: AuthMeResponse = await res.json();
          setInstancePending(false);
          setInstanceMissing(false);
          if (data.needs_setup || (data.user && !data.user.subdomain)) {
            setNeedsSetup(true);
            setHostedUser(null);
            setActor(null);
            setInstances([]);
            setSelectedInstanceId(null);
            clearTenantUrl();
            localStorage.removeItem('tenant_token');
          } else if (data.user) {
            const isAllowed = data.user.allowed !== false;
            setHostedUser({
              id: data.user.id,
              username: data.user.username,
              subdomain: data.user.subdomain,
              status: data.user.status,
              allowed: data.user.allowed,
            });
            setSelectedInstanceId(data.user.id);
            setNeedsSetup(false);
            setActor(null);

            // インスタンスがactive状態かチェック
            if (data.user.status === 'missing' || (data.user.status === 'active' && !isAllowed)) {
              setInstanceMissing(true);
              clearTenantUrl();
              localStorage.removeItem('tenant_token');
            } else if (data.user.status !== 'active' && data.user.status !== undefined) {
              setInstancePending(true);
              clearTenantUrl();
              localStorage.removeItem('tenant_token');
            } else if (data.user.status === 'active' && data.user.subdomain && data.tenant_token && isAllowed) {
              // テナントURLとテナントトークンを保存
              setTenantUrl(data.user.subdomain);
              localStorage.setItem('tenant_token', data.tenant_token);

              // テナントから直接actor情報を取得（テナントJWTを使用）
              const tenantUrl = `https://${data.user.subdomain}.yurucommu.com`;
              const actorRes = await fetch(`${tenantUrl}/api/actors/me`, {
                headers: { 'Authorization': `Bearer ${data.tenant_token}` }
              });
              if (actorRes.ok) {
                const actorData: ActorMeResponse = await actorRes.json();
                if (actorData.actor) {
                  setActor(actorData.actor);
                }
              }
            }
          }

          await fetchInstances(token);
        } else {
          localStorage.removeItem('session_token');
          localStorage.removeItem('tenant_token');
          clearTenantUrl();
          setActor(null);
          setHostedUser(null);
          setNeedsSetup(false);
          setInstancePending(false);
          setInstanceMissing(false);
          setInstances([]);
          setSelectedInstanceId(null);
        }
      } else {
        // セルフホストモード: 従来の認証
        const res = await fetch('/api/auth/me');
        const data: SelfHostedMeResponse = await res.json();
        if (data.actor) {
          setActor(data.actor);
        }
      }
    } catch (e) {
      console.error('Auth check failed:', e);
    } finally {
      setLoading(false);
    }
  }, [fetchInstances]);

  useEffect(() => {
    // URLからトークンを取得（OAuth callback後）
    if (IS_HOSTED) {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');
      if (token) {
        localStorage.setItem('session_token', token);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }

    checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (password?: string) => {
    setLoginError(null);

    if (IS_HOSTED) {
      // ホスティングモード: takos-auth OAuthへリダイレクト
      try {
        const res = await fetch(`${AUTH_BASE_URL}/api/auth/login`);
        const data: LoginResponse = await res.json();
        const authUrl = data.auth_url || data.authUrl;
        if (authUrl) {
          window.location.href = authUrl;
        } else {
          console.error('No auth URL in response:', data);
          setLoginError('Failed to get login URL');
        }
      } catch (e) {
        console.error('Login error:', e);
        setLoginError('Failed to start login');
      }
      return false;
    } else {
      // セルフホストモード: パスワード認証
      if (!password) {
        setLoginError('Password required');
        return false;
      }
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        const data: LoginResponse = await res.json();
        if (data.success) {
          await checkAuth();
          return true;
        } else {
          setLoginError(data.error || 'Login failed');
          return false;
        }
      } catch (e) {
        setLoginError('Network error');
        return false;
      }
    }
  }, [checkAuth]);

  const logout = useCallback(async () => {
    if (IS_HOSTED) {
      const token = localStorage.getItem('session_token');
      if (token) {
        await fetch(`${AUTH_BASE_URL}/api/auth/logout`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}` }
        });
      }
      localStorage.removeItem('session_token');
      localStorage.removeItem('tenant_token');
      clearTenantUrl();
    } else {
      await fetch('/api/auth/logout', { method: 'POST' });
    }
    setActor(null);
  }, []);

  const completeSetup = useCallback(async (username: string) => {
    if (!IS_HOSTED) return false;

    const token = localStorage.getItem('session_token');
    const res = await fetch(`${AUTH_BASE_URL}/api/auth/setup`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ username, subdomain: username })
    });

    if (res.ok) {
      setNeedsSetup(false);
      await checkAuth();
      return true;
    }
    return false;
  }, [checkAuth]);

  const selectInstance = useCallback(async (instanceId: string) => {
    if (!IS_HOSTED) return;
    const token = localStorage.getItem('session_token');
    if (!token) return;

    setLoading(true);
    try {
      await fetch(`${AUTH_BASE_URL}/api/instances/select`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ instance_id: instanceId })
      });
    } catch (e) {
      console.error('Failed to select instance:', e);
    } finally {
      await checkAuth();
      setLoading(false);
    }
  }, [checkAuth]);

  const rebuildInstance = useCallback(async (instanceId: string) => {
    if (!IS_HOSTED) return false;
    const token = localStorage.getItem('session_token');
    if (!token) return false;

    setLoading(true);
    try {
      const res = await fetch(`${AUTH_BASE_URL}/api/instances/${instanceId}/rebuild`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) {
        return false;
      }
    } catch (e) {
      console.error('Failed to rebuild instance:', e);
      return false;
    } finally {
      await checkAuth();
      setLoading(false);
    }
    return true;
  }, [checkAuth]);

  const createInstance = useCallback(async (username: string) => {
    const success = await completeSetup(username);
    if (success) {
      const token = localStorage.getItem('session_token');
      if (token) {
        await fetchInstances(token);
      }
    }
    return success;
  }, [completeSetup, fetchInstances]);

  return {
    actor,
    loading,
    loginError,
    needsSetup,
    instancePending,
    instanceMissing,
    hostedUser,
    instances,
    selectedInstanceId,
    instancesLoading,
    isHosted: IS_HOSTED,
    login,
    logout,
    completeSetup,
    createInstance,
    selectInstance,
    rebuildInstance,
  };
}
