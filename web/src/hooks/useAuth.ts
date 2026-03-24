import { useEffect } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import {
  actorAtom,
  authLoadingAtom,
  loginErrorAtom,
  needsSetupAtom,
  instancePendingAtom,
  instanceMissingAtom,
  instanceBlockedAtom,
  instanceHealthAtom,
  hostedUserAtom,
  instancesAtom,
  selectedInstanceIdAtom,
  instancesLoadingAtom,
  IS_HOSTED,
  initAuthAtom,
  loginAtom,
  logoutAtom,
  completeSetupAtom,
  selectInstanceAtom,
  rebuildInstanceAtom,
  checkAuthAtom,
} from '../atoms/auth';
import type { HostedInstance } from '../atoms/auth';

export type { HostedInstance };

export function useAuth() {
  const actor = useAtomValue(actorAtom);
  const loading = useAtomValue(authLoadingAtom);
  const loginError = useAtomValue(loginErrorAtom);
  const needsSetup = useAtomValue(needsSetupAtom);
  const instancePending = useAtomValue(instancePendingAtom);
  const instanceMissing = useAtomValue(instanceMissingAtom);
  const instanceBlocked = useAtomValue(instanceBlockedAtom);
  const instanceHealth = useAtomValue(instanceHealthAtom);
  const hostedUser = useAtomValue(hostedUserAtom);
  const instances = useAtomValue(instancesAtom);
  const selectedInstanceId = useAtomValue(selectedInstanceIdAtom);
  const instancesLoading = useAtomValue(instancesLoadingAtom);
  const initAuth = useSetAtom(initAuthAtom);
  const login = useSetAtom(loginAtom);
  const logout = useSetAtom(logoutAtom);
  const completeSetup = useSetAtom(completeSetupAtom);
  const selectInstance = useSetAtom(selectInstanceAtom);
  const rebuildInstance = useSetAtom(rebuildInstanceAtom);
  const refreshAuth = useSetAtom(checkAuthAtom);

  useEffect(() => {
    initAuth();
  }, [initAuth]);

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
    selectInstance,
    rebuildInstance,
    refreshAuth,
  };
}
