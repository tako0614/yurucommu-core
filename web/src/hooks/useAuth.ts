import { onMount } from "solid-js";
import { useAtomValue, useSetAtom } from "solid-jotai";
import {
  actorAtom,
  authErrorAtom,
  authLoadingAtom,
  checkAuthAtom,
  completeSetupAtom,
  hostedUserAtom,
  initAuthAtom,
  instanceBlockedAtom,
  instanceHealthAtom,
  instanceMissingAtom,
  instancePendingAtom,
  instancesAtom,
  instancesLoadingAtom,
  IS_HOSTED,
  loginAtom,
  loginErrorAtom,
  logoutAtom,
  needsSetupAtom,
  rebuildInstanceAtom,
  selectedInstanceIdAtom,
  selectInstanceAtom,
} from "../atoms/auth.ts";
import type { HostedInstance } from "../atoms/auth.ts";

export type { HostedInstance };

export function useAuth() {
  const actor = useAtomValue(actorAtom);
  const loading = useAtomValue(authLoadingAtom);
  const authError = useAtomValue(authErrorAtom);
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

  onMount(() => {
    initAuth();
  });

  return {
    actor,
    loading,
    authError,
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
