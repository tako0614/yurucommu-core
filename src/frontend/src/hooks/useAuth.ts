import { useState, useEffect, useCallback } from 'react';
import type { Actor } from '../types';
import {
  getAuthStrategy,
  type HostedInstance,
  type HostedUserInfo,
  type InstanceHealth,
} from '../lib/plugin';

export type { HostedInstance };

const authStrategy = getAuthStrategy();
const IS_HOSTED = authStrategy.mode === 'hosted';

export function useAuth() {
  const [actor, setActor] = useState<Actor | null>(null);
  const [loading, setLoading] = useState(true);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [instancePending, setInstancePending] = useState(false);
  const [instanceMissing, setInstanceMissing] = useState(false);
  const [instanceBlocked, setInstanceBlocked] = useState(false);
  const [instanceHealth, setInstanceHealth] = useState<InstanceHealth | null>(null);
  const [hostedUser, setHostedUser] = useState<HostedUserInfo | null>(null);
  const [instances, setInstances] = useState<HostedInstance[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState<string | null>(null);
  const [instancesLoading, setInstancesLoading] = useState(false);

  const checkAuth = useCallback(async () => {
    try {
      setInstancesLoading(true);
      const result = await authStrategy.checkAuth();
      setActor(result.actor);
      setHostedUser(result.hostedUser);
      setNeedsSetup(result.needsSetup);
      setInstancePending(result.instancePending);
      setInstanceMissing(result.instanceMissing);
      setInstanceBlocked(result.instanceBlocked);
      setInstanceHealth(result.instanceHealth);
      setInstances(result.instances);
      setSelectedInstanceId(result.selectedInstanceId);
    } catch (e) {
      console.error('Auth check failed:', e);
      setActor(null);
    } finally {
      setLoading(false);
      setInstancesLoading(false);
    }
  }, []);

  useEffect(() => {
    authStrategy.extractTokenFromUrl();
    void checkAuth();
  }, [checkAuth]);

  const login = useCallback(async (password?: string) => {
    setLoginError(null);

    try {
      const result = await authStrategy.login(password);
      if (result.redirect) {
        window.location.href = result.redirect;
        return false;
      }
      if (result.error) {
        setLoginError(result.error);
        return false;
      }
      if (result.success) {
        await checkAuth();
        return true;
      }
      return false;
    } catch (e) {
      console.error('Login error:', e);
      setLoginError('Network error');
      return false;
    }
  }, [checkAuth]);

  const logout = useCallback(async () => {
    try {
      await authStrategy.logout();
    } catch (e) {
      console.error('Logout error:', e);
    } finally {
      setActor(null);
    }
  }, []);

  const completeSetup = useCallback(async (username: string) => {
    if (!IS_HOSTED || !authStrategy.completeSetup) return false;
    const success = await authStrategy.completeSetup(username);
    if (success) {
      await checkAuth();
    }
    return success;
  }, [checkAuth]);

  const selectInstance = useCallback(async (instanceId: string) => {
    if (!IS_HOSTED || !authStrategy.selectInstance) return;
    setInstancesLoading(true);
    try {
      await authStrategy.selectInstance(instanceId);
    } finally {
      await checkAuth();
      setInstancesLoading(false);
    }
  }, [checkAuth]);

  const rebuildInstance = useCallback(async (instanceId: string) => {
    if (!IS_HOSTED || !authStrategy.rebuildInstance) return false;
    setInstancesLoading(true);
    try {
      const success = await authStrategy.rebuildInstance(instanceId);
      return success;
    } finally {
      await checkAuth();
      setInstancesLoading(false);
    }
  }, [checkAuth]);

  const createInstance = useCallback(async (username: string) => {
    return completeSetup(username);
  }, [completeSetup]);

  return {
    actor,
    loading,
    loginError,
    needsSetup,
    instancePending,
    instanceMissing,
    instanceBlocked,
    instanceHealth,
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
    refreshAuth: checkAuth,
  };
}
