import { atom } from 'jotai';
import type { Actor } from '../types';
import {
  getAuthStrategy,
  type HostedInstance,
  type HostedUserInfo,
  type InstanceHealth,
} from '../lib/plugin';

export type { HostedInstance };

const authStrategy = getAuthStrategy();
export const IS_HOSTED = authStrategy.mode === 'hosted';

// --- State atoms ---
export const actorAtom = atom<Actor | null>(null);
export const authLoadingAtom = atom(true);
export const loginErrorAtom = atom<string | null>(null);
export const needsSetupAtom = atom(false);
export const instancePendingAtom = atom(false);
export const instanceMissingAtom = atom(false);
export const instanceBlockedAtom = atom(false);
export const instanceHealthAtom = atom<InstanceHealth | null>(null);
export const hostedUserAtom = atom<HostedUserInfo | null>(null);
export const instancesAtom = atom<HostedInstance[]>([]);
export const selectedInstanceIdAtom = atom<string | null>(null);
export const instancesLoadingAtom = atom(false);

// --- Action atoms ---
export const checkAuthAtom = atom(null, async (_get, set) => {
  try {
    set(instancesLoadingAtom, true);
    const result = await authStrategy.checkAuth();
    set(actorAtom, result.actor);
    set(hostedUserAtom, result.hostedUser);
    set(needsSetupAtom, result.needsSetup);
    set(instancePendingAtom, result.instancePending);
    set(instanceMissingAtom, result.instanceMissing);
    set(instanceBlockedAtom, result.instanceBlocked);
    set(instanceHealthAtom, result.instanceHealth);
    set(instancesAtom, result.instances);
    set(selectedInstanceIdAtom, result.selectedInstanceId);
  } catch (e) {
    console.error('Auth check failed:', e);
    set(actorAtom, null);
  } finally {
    set(authLoadingAtom, false);
    set(instancesLoadingAtom, false);
  }
});

export const loginAtom = atom(null, async (_get, set, password?: string) => {
  set(loginErrorAtom, null);
  try {
    const result = await authStrategy.login(password);
    if (result.redirect) {
      window.location.href = result.redirect;
      return false;
    }
    if (result.error) {
      set(loginErrorAtom, result.error);
      return false;
    }
    if (result.success) {
      await set(checkAuthAtom);
      return true;
    }
    return false;
  } catch (e) {
    console.error('Login error:', e);
    set(loginErrorAtom, 'Network error');
    return false;
  }
});

export const logoutAtom = atom(null, async (_get, set) => {
  try {
    await authStrategy.logout();
  } catch (e) {
    console.error('Logout error:', e);
  } finally {
    set(actorAtom, null);
  }
});

export const completeSetupAtom = atom(null, async (_get, set, username: string) => {
  if (!IS_HOSTED || !authStrategy.completeSetup) return false;
  const success = await authStrategy.completeSetup(username);
  if (success) await set(checkAuthAtom);
  return success;
});

export const selectInstanceAtom = atom(null, async (_get, set, instanceId: string) => {
  if (!IS_HOSTED || !authStrategy.selectInstance) return;
  set(instancesLoadingAtom, true);
  try {
    await authStrategy.selectInstance(instanceId);
  } finally {
    await set(checkAuthAtom);
    set(instancesLoadingAtom, false);
  }
});

export const rebuildInstanceAtom = atom(null, async (_get, set, instanceId: string) => {
  if (!IS_HOSTED || !authStrategy.rebuildInstance) return false;
  set(instancesLoadingAtom, true);
  try {
    return await authStrategy.rebuildInstance(instanceId);
  } finally {
    await set(checkAuthAtom);
    set(instancesLoadingAtom, false);
  }
});

// Init: extract token from URL on load
export const initAuthAtom = atom(null, async (_get, set) => {
  authStrategy.extractTokenFromUrl();
  await set(checkAuthAtom);
});
